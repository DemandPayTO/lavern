/**
 * Employment routes — Matter debrief.
 *
 * Split out of employment-intake.ts. Shared helpers live in ./shared.ts;
 * this module registers only its own route handlers.
 */


import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import sanitizeHtmlLib from 'sanitize-html';
import { config } from '../../../config.js';
import { employmentIntakeSchema, createEmploymentMatterData } from '../../../types/employment-intake.js';
import type { EmploymentMatterData, EmploymentIntakeData, TimelineEvent, DocumentExtractionResult } from '../../../types/employment-intake.js';
import { evaluateGates, getTriggeredIssueCodes } from '../../../employment/gate-evaluator.js';
import { DEMAND_SOURCE_KINDS, isDemandSourceKind } from '../../../employment/demand-sources.js';
import {
  INSTRUCTION_KINDS, MAX_NOTES_CHARS, MAX_INSTRUCTIONS,
  directionContext, effectiveInstructions, checkDirectionTerms, departureFlags,
  DEPARTURE_CHECK_SYSTEM, buildDepartureCheckPrompt, extractLawyerNote,
} from '../../../employment/direction.js';
import type { MatterFacts } from '../../../employment/precedent-alignment.js';
import { rebuildTimelinePreserving, computeLimitationDeadline, computeBardalFactors, recommendProcedure, addTimelineEvent } from '../../../employment/timeline-generator.js';
import { saveMatter, getMatterById, getMattersByUser, saveFirmTemplate, getFirmTemplates, getFirmTemplate, deleteFirmTemplate, setDefaultFirmTemplate, saveStyleProfile, getStyleProfiles, getStyleProfile, updateStyleProfile, deleteStyleProfile, recordUsageEvent, getUserById } from '../../../db/database.js';
import { collectDeadlines } from '../../../employment/deadlines.js';
import { createLogger } from '../../../utils/logger.js';
import { extractEmploymentDocument } from '../../briefing/employment-extractor.js';
import { UPLOADABLE_DOCUMENT_TYPES, TONE_OPTIONS, PROCEDURE_TYPES } from '../../../types/employment-intake.js';
import { generateDemandLetter } from '../../../employment/demand-letter-generator.js';
import { generateStatementOfClaim } from '../../../employment/soc-generator.js';
import { generateApplication } from '../../../employment/application-generator.js';
import type { ApplicationType } from '../../../employment/application-generator.js';
import { htmlToDocx } from '../../../employment/docx-export.js';
import { generateLitigationDocument } from '../../../employment/litigation-documents.js';
import type { DocxExportOptions } from '../../../employment/docx-export.js';
import type { LitigationDocumentType } from '../../../employment/litigation-documents.js';
import { detectPlaceholders, templateUploadSchema } from '../../../employment/firm-templates.js';
import type { FirmTemplate } from '../../../employment/firm-templates.js';
import {
  DOCUMENT_STATUSES,
  DRAFT_HISTORY_CAP,
  DocumentStatus,
  GeneratedDocumentSummary,
  LEGACY_DOC_KEYS,
  REVISION_KIND_VALUES,
  applyDirectionAftermath,
  backfillIntakeIdentity,
  buildAdditionalHeads,
  collectGeneratedDocuments,
  diffUnlockedCauses,
  directionDepartureFlags,
  directionForGeneration,
  ensureAnalysisFresh,
  findGeneratedDocKey,
  fromParagraphsSafe,
  loadEmploymentData,
  loadStyleForGeneration,
  logger,
  recomputeAnalysis,
  recordDraftHistory,
  resolveFirmId,
  sanitiseHtml,
  saveEmploymentData,
  styleReviewFlags,
  titleForDoc,
  extractBodySchema,
  logAuditForm1,
} from './shared.js';

export function registerDebriefRoutes(fastify: FastifyInstance): void {

  // ── Matter Debrief ────────────────────────────────────────────────────
  // Call notes → reviewed summary + dated, checkable action items. The LLM
  // proposes; the lawyer reviews and approves; dated items become docket
  // deadlines (and flow to the ICS feed) and email items carry a draft the
  // lawyer sends manually. Starling never sends. See
  // docs/specs/matter-debrief-2026-07.md.

  // Analyze notes into a PROPOSED debrief. Does not persist anything.
  fastify.post('/api/employment/:matterId/debrief/analyze', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const schema = z.object({
      // 100k characters is roughly forty pages: a marathon call, or a
      // pasted transcript. The input cost at that size is a few cents. The
      // old 20k cap was the kind of arbitrary ceiling this pilot has
      // already hit twice elsewhere, and rightly complained about.
      rawNotes: z.string().trim().min(1).max(100_000),
      callType: z.enum(['client', 'opposing', 'internal', 'other']).default('client'),
      callDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { employment } = loadEmploymentData(row.data_json);

    // Party names as defined terms so the anonymiser masks them before the
    // notes leave for the model (defence in depth over the no-training/ZDR
    // posture).
    const definedTerms: string[] = [];
    const intake = employment?.intake;
    if (intake?.client_first_name && intake?.client_last_name) definedTerms.push(`${intake.client_first_name} ${intake.client_last_name}`);
    if (intake?.employer_legal_name) definedTerms.push(intake.employer_legal_name);
    if (intake?.employer_operating_name) definedTerms.push(intake.employer_operating_name);

    const callDate = parsed.data.callDate ?? new Date().toISOString().slice(0, 10);
    const { DEBRIEF_SYSTEM_PROMPT, buildDebriefUserPrompt, debriefAnalysisSchema, clampDebriefAnalysis } = await import('../../../employment/debrief.js');
    const { crossProviderChat } = await import('../../../providers/cross-provider-chat.js');

    let text: string;
    try {
      const result = await crossProviderChat({
        system: DEBRIEF_SYSTEM_PROMPT,
        user: buildDebriefUserPrompt(parsed.data.rawNotes, parsed.data.callType, callDate),
        tier: 'sonnet',
        // Scales with the notes: a long call proposes many items, and email
        // drafts are wordy. 8192 stays under the streaming threshold, and
        // a truncated response extends rather than failing: cut-off JSON
        // would otherwise surface as "could not structure the notes".
        maxTokens: 8192,
        extendOnTruncation: true,
        maxRetries: 4,
        definedTerms: definedTerms.length > 0 ? definedTerms : undefined,
      });
      text = result.text;
    } catch (err) {
      logger.error('Debrief analysis failed', { error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'Analysis failed. Please try again.' });
    }

    let jsonText = text.trim();
    const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonText = fenced[1].trim();
    const braced = jsonText.match(/\{[\s\S]*\}/);
    let proposed;
    try {
      proposed = debriefAnalysisSchema.parse(clampDebriefAnalysis(JSON.parse(braced ? braced[0] : jsonText)));
    } catch (err) {
      // The reason goes to the log, not the lawyer: they cannot fix a Zod
      // path, but we cannot fix what we never see.
      logger.warn('Debrief analysis did not fit the schema', {
        error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      });
      return reply.status(502).send({ ok: false, error: 'Could not structure the notes. Try rephrasing or shortening them.' });
    }
    // The same evidence discipline as document extraction, with the notes
    // as the document: a cause-trigger true whose quote does not verify
    // against what the lawyer actually typed is discarded, and a false is
    // discarded because notes not mentioning a thing prove nothing.
    if (proposed.proposedIntakeFields && Object.keys(proposed.proposedIntakeFields).length > 0) {
      const { verifySourceQuotes, enforcePleadingEvidence } = await import('../../../api/briefing/employment-extractor.js');
      const { APPLYABLE_INTAKE_FIELDS } = await import('../../../employment/extraction-apply.js');
      const verified = enforcePleadingEvidence(
        verifySourceQuotes(proposed.proposedIntakeFields, parsed.data.rawNotes),
      ).fields;
      proposed.proposedIntakeFields = Object.fromEntries(
        Object.entries(verified).filter(([name, f]) =>
          APPLYABLE_INTAKE_FIELDS.has(name) && f.value !== null && f.value !== ''),
      );
    }
    return reply.send({ ok: true, proposed, callDate });
  });

  // Save a REVIEWED debrief: wire dated items into the docket, draft email
  // items, record a timeline event.
  fastify.post('/api/employment/:matterId/debrief', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const debriefDirectionSchema = z.object({
      text: z.string().trim().min(1).max(600),
      kind: z.enum(['scope', 'include', 'exclude', 'figures', 'tone', 'process']).default('scope'),
    });
    const itemSchema = z.object({
      task: z.string().trim().min(1).max(500),
      owner: z.enum(['lawyer', 'client', 'other']).default('lawyer'),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().default(null),
      kind: z.enum(['task', 'email', 'call', 'filing', 'document']).default('task'),
      context: z.string().trim().max(1200).default(''),
      emailSubject: z.string().trim().max(300).optional(),
      emailBody: z.string().trim().max(4000).optional(),
    });
    const schema = z.object({
      callType: z.enum(['client', 'opposing', 'internal', 'other']).default('client'),
      summary: z.string().trim().min(1).max(4000),
      actionItems: z.array(itemSchema).max(40).default([]),
      /** Approved direction instructions; matter-level, accumulating. */
      directionInstructions: z.array(debriefDirectionSchema).max(10).default([]),
      /** Approved intake facts, applied with blank-fill semantics. */
      intakeFields: z.record(z.string(), z.union([z.string(), z.number(), z.boolean()])).default({}),
      /** Approved case events for the matter timeline. */
      timelineEvents: z.array(z.object({
        date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
        label: z.string().trim().min(1).max(200),
        description: z.string().trim().max(500).optional(),
      })).max(15).default([]),
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid debrief', details: parsed.error.issues.map(i => i.message) });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const m = matter as Record<string, unknown>;

    const { toStoredActionItems } = await import('../../../employment/debrief.js');
    const entry = {
      id: `dbf-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      callType: parsed.data.callType,
      summary: parsed.data.summary,
      actionItems: toStoredActionItems(parsed.data.actionItems),
    };
    const debriefs = (m.debriefs ?? []) as Array<Record<string, unknown>>;
    debriefs.push(entry);
    m.debriefs = debriefs;

    // Record the debrief as a matter event.
    if (employment) {
      const dated = entry.actionItems.filter((it) => it.dueDate).length;
      employment.timeline = [
        ...(employment.timeline ?? []),
        {
          date: new Date().toISOString().slice(0, 10),
          label: `Debrief captured: ${entry.actionItems.length} action item${entry.actionItems.length === 1 ? '' : 's'}${dated ? `, ${dated} dated` : ''}`,
          source: 'system',
        } as (typeof employment.timeline)[number],
      ];
      m.employmentData = employment;
    }
    await saveMatter(userId, matterId, JSON.stringify(m), (m.status as string) ?? 'active');

    // Approved case events join the matter timeline, the chronology the
    // claim's Background Facts pleads from. Same date and label twice is
    // the same event: skipped, not doubled.
    let eventsAdded = 0;
    if (parsed.data.timelineEvents.length > 0 && employment) {
      const existing = new Set((employment.timeline ?? []).map(e => `${e.date}|${e.label}`));
      const fresh = parsed.data.timelineEvents.filter(e => !existing.has(`${e.date}|${e.label}`));
      eventsAdded = fresh.length;
      if (fresh.length > 0) {
        employment.timeline = [
          ...(employment.timeline ?? []),
          ...fresh.map(e => ({
            date: e.date, label: e.label, description: e.description,
            category: 'other' as const, source: 'lawyer_entry' as const,
          })),
        ];
        m.employmentData = employment;
      }
    }

    // Approved direction ACCUMULATES on the matter, at matter level: the
    // partner says something on the August call that sits alongside June.
    let directionAdded = 0;
    if (parsed.data.directionInstructions.length > 0) {
      const direction = (m.direction ?? {}) as { matter?: { instructions?: Array<{ id: string; text: string; kind: string }>; withheld?: string[]; notes?: string } };
      const current = direction.matter?.instructions ?? [];
      const fresh = parsed.data.directionInstructions
        .filter(d => !current.some(e => e.text.trim() === d.text.trim()))
        .map((d, n) => ({ id: `dir-${Date.now()}-db${n}`, text: d.text, kind: d.kind }));
      directionAdded = fresh.length;
      if (fresh.length > 0) {
        direction.matter = {
          ...(direction.matter ?? {}),
          instructions: [...current, ...fresh],
          updatedAt: new Date().toISOString(),
          updatedByName: 'from a debrief',
        } as never;
        m.direction = direction;
      }
    }

    // Approved intake facts go through the SAME deterministic apply as
    // document extraction: blank-fill, no overwrites, dates normalised.
    let fieldsApplied: string[] = [];
    let fieldsSkipped: string[] = [];
    let analysisStale = false;
    let causesUnlocked: string[] = [];
    const intakeBefore = employment?.intake ? { ...employment.intake } : undefined;
    const fieldNames = Object.keys(parsed.data.intakeFields).slice(0, 30);
    if (fieldNames.length > 0 && employment?.intake) {
      const { applyExtractionSelections } = await import('../../../employment/extraction-apply.js');
      const ephemeral = {
        documentType: 'correspondence' as const,
        filename: 'debrief call notes',
        extractedFields: Object.fromEntries(fieldNames.map(name => [
          name, { value: parsed.data.intakeFields[name], confidence: 'high' as const },
        ])),
        keyFindings: [],
      };
      const outcome = applyExtractionSelections(employment.intake, ephemeral as never, fieldNames, new Set());
      if (!('error' in outcome)) {
        employment.intake = outcome.intake;
        fieldsApplied = outcome.applied;
        fieldsSkipped = outcome.skippedNotBlank;
        analysisStale = outcome.analysisStale;
        m.employmentData = employment;
        causesUnlocked = await diffUnlockedCauses(matter, intakeBefore, employment.intake, employment);
      }
    }
    if (directionAdded > 0 || fieldsApplied.length > 0 || eventsAdded > 0) {
      await saveMatter(userId, matterId, JSON.stringify(m), (m.status as string) ?? 'active');
    }

    const emailDrafts = entry.actionItems.filter((it) => it.kind === 'email' && (it.emailSubject || it.emailBody)).length;
    return reply.send({
      ok: true,
      debrief: entry,
      scheduled: entry.actionItems.filter((it) => it.dueDate).length,
      emailDrafts,
      directionAdded,
      fieldsApplied,
      fieldsSkipped,
      analysisStale,
      eventsAdded,
      causesUnlocked,
    });
  });

  // Toggle an action item's status (check off / reopen).
  fastify.post('/api/employment/:matterId/debrief/:itemId/status', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId, itemId } = req.params as { matterId: string; itemId: string };
    const schema = z.object({ status: z.enum(['open', 'done']) }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid status' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter } = loadEmploymentData(row.data_json);
    const m = matter as Record<string, unknown>;
    const debriefs = (m.debriefs ?? []) as Array<{ actionItems?: Array<{ id: string; status: string }> }>;
    let found = false;
    for (const d of debriefs) {
      for (const it of d.actionItems ?? []) {
        if (it.id === itemId) { it.status = parsed.data.status; found = true; }
      }
    }
    if (!found) return reply.status(404).send({ ok: false, error: 'Action item not found' });
    m.debriefs = debriefs;
    await saveMatter(userId, matterId, JSON.stringify(m), (m.status as string) ?? 'active');
    return reply.send({ ok: true });
  });
}
