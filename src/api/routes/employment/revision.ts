/**
 * Employment routes — Revision / feedback loop.
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

export function registerRevisionRoutes(fastify: FastifyInstance): void {

  // ── POST /api/employment/:matterId/revision/upload ─────────────────────
  // Take back a Word file the client edited. Reads the comments and tracked
  // changes out of the .docx and renders them as feedback, so the same
  // planner handles them: the lawyer still approves every item. A file with
  // no comments and no tracked changes is reported as clean rather than
  // treated as an error, since replacing the draft outright is a separate,
  // deliberate act.

  const revisionUploadSchema = z.object({
    docType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    docxBase64: z.string().max(7_000_000),
    filename: z.string().trim().max(300).optional(),
  });

  fastify.post('/api/employment/:matterId/revision/upload', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = revisionUploadSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid upload' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter } = loadEmploymentData(row.data_json);
    if (!findGeneratedDocKey(matter, parsed.data.docType)) {
      return reply.status(404).send({ ok: false, error: 'No generated document of that type on this matter.' });
    }

    const { extractDocxRevisions, revisionsAsFeedback } = await import('../../../documents/docx-revisions.js');
    let revisions;
    try {
      revisions = await extractDocxRevisions(Buffer.from(parsed.data.docxBase64, 'base64'));
    } catch {
      return reply.status(400).send({ ok: false, error: 'Could not read that file as a Word document.' });
    }

    logger.info('Revision upload read', {
      userId, matterId, docType: parsed.data.docType,
      comments: revisions.comments.length, trackedChanges: revisions.trackedChanges.length,
    });

    return reply.send({
      ok: true,
      clean: revisions.clean,
      comments: revisions.comments.length,
      trackedChanges: revisions.trackedChanges.length,
      authors: [...new Set([
        ...revisions.comments.map(c => c.author),
        ...revisions.trackedChanges.map(c => c.author),
      ])],
      feedback: revisionsAsFeedback(revisions),
    });
  });

  // ── POST /api/employment/:matterId/revision/plan ───────────────────────
  // Map feedback (a client's email, or the reviewing partner's comments)
  // onto the paragraphs of a generated document. Returns a PLAN only:
  // nothing is modified until the lawyer approves items and calls apply.

  const revisionPlanSchema = z.object({
    docType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    feedback: z.string().trim().min(1).max(20_000),
    source: z.enum(['client', 'partner', 'lawyer']).default('client'),
    /** Restrict the redraft to one section (its heading text, as rendered). */
    section: z.string().trim().min(1).max(200).optional(),
    /** Stored brief sources (research, case lists) grounding the rewrite. */
    sourceIds: z.array(z.string().max(60)).max(8).optional(),
  });

  /** Resolve stored brief sources by id for the revision loop's research block. */
  function resolveRevisionResearch(matter: Record<string, unknown>, sourceIds: string[] | undefined): Array<{ name: string; text: string }> {
    if (!sourceIds?.length) return [];
    const stored = ((matter.briefSources ?? []) as Array<{ id: string; name: string; text: string }>);
    return stored.filter(s => sourceIds.includes(s.id)).slice(0, 6).map(s => ({ name: s.name, text: s.text }));
  }

  fastify.post('/api/employment/:matterId/revision/plan', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = revisionPlanSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter } = loadEmploymentData(row.data_json);
    const key = findGeneratedDocKey(matter, parsed.data.docType);
    if (!key) return reply.status(404).send({ ok: false, error: 'No generated document of that type on this matter.' });
    const doc = matter[key] as Record<string, unknown>;
    const html = typeof doc.html === 'string' ? doc.html : '';
    if (!html) return reply.status(409).send({ ok: false, error: 'That document has no content to revise.' });

    const rl = await import('../../../employment/revision-loop.js');
    const paragraphs = rl.toParagraphs(html);

    // Section-scoped redraft: resolve the heading to its paragraph range
    // up front, and refuse with the available headings when it does not
    // match — a silent whole-document plan would defeat the point.
    let sectionRange: { heading: string; start: number; end: number } | undefined;
    if (parsed.data.section) {
      const range = rl.sectionParagraphRange(paragraphs, parsed.data.section);
      if (!range) {
        return reply.status(400).send({
          ok: false,
          error: `No section named "${parsed.data.section}" in this document.`,
          sections: rl.listSectionHeadings(paragraphs).map(h => h.heading),
        });
      }
      sectionRange = { heading: parsed.data.section, ...range };
    }

    const { crossProviderChat } = await import('../../../providers/cross-provider-chat.js');
    let text: string;
    let cost = 0;
    try {
      const result = await crossProviderChat({
        system: rl.buildPlannerSystemPrompt(),
        user: rl.buildPlannerUserPrompt({
          documentTitle: String(doc.documentTitle ?? parsed.data.docType),
          paragraphs, feedback: parsed.data.feedback, source: parsed.data.source,
          section: sectionRange,
          research: resolveRevisionResearch(matter as Record<string, unknown>, parsed.data.sourceIds),
        }),
        tier: 'sonnet',
        maxTokens: 4096,
        maxRetries: 4,
      });
      text = result.text; cost = result.cost;
    } catch (err) {
      logger.error('Revision planning failed', { error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'Could not read that feedback. Please try again.' });
    }

    let payload: { items?: unknown[] };
    try {
      const fenced = text.trim().match(/```(?:json)?\s*([\s\S]*?)```/);
      payload = JSON.parse(fenced ? fenced[1] : text.trim()) as { items?: unknown[] };
    } catch {
      return reply.status(502).send({ ok: false, error: 'Could not read that feedback. Please try again.' });
    }

    const rawItems = (Array.isArray(payload.items) ? payload.items : []) as Array<Record<string, unknown>>;
    const typed = rawItems.slice(0, 60).map((it, i) => ({
      id: `rev-${i}`,
      feedback: String(it.feedback ?? '').slice(0, 2000),
      kind: (rl.REVISION_KINDS as readonly string[]).includes(String(it.kind))
        ? String(it.kind) as (typeof rl.REVISION_KINDS)[number]
        : 'needs_lawyer' as const,
      paragraphIndices: Array.isArray(it.paragraphIndices)
        ? (it.paragraphIndices as unknown[]).map(Number).filter(Number.isInteger).slice(0, 50) : [],
      proposal: String(it.proposal ?? '').slice(0, 2000),
      intakeField: it.intakeField ? String(it.intakeField).slice(0, 60) : undefined,
      // The model writes null where it means "no value"; a null stored here
      // failed the whole apply later. Only real values survive.
      intakeValue: typeof it.intakeValue === 'string' ? it.intakeValue.slice(0, 500)
        : typeof it.intakeValue === 'number' || typeof it.intakeValue === 'boolean' ? it.intakeValue
        : undefined,
      reason: it.reason ? String(it.reason).slice(0, 1000) : undefined,
    }));

    const grounded = rl.groundPlan({ items: typed }, paragraphs, rl.CORRECTABLE_INTAKE_FIELDS);
    if (sectionRange) {
      const inRange = (i: number) => i >= sectionRange!.start && i < sectionRange!.end;
      const kept = grounded.items.filter(it =>
        it.paragraphIndices.length === 0 || it.paragraphIndices.every(inRange));
      const dropped = grounded.items.length - kept.length;
      if (dropped > 0) {
        grounded.warnings.push(`${dropped} proposed change${dropped === 1 ? 's' : ''} reached outside "${sectionRange.heading}" and ${dropped === 1 ? 'was' : 'were'} not included.`);
      }
      grounded.items = kept;
    }

    try { recordUsageEvent(userId, matterId, 'analysis', `revision_plan_${parsed.data.docType}`, cost); }
    catch { /* metering must never fail the request */ }

    logger.info('Revision plan built', {
      userId, matterId, docType: parsed.data.docType,
      items: grounded.items.length, source: parsed.data.source,
    });
    return reply.send({
      ok: true,
      docType: parsed.data.docType,
      paragraphs: paragraphs.map((p, i) => ({ index: i, text: rl.paragraphText(p) })),
      items: grounded.items,
      warnings: grounded.warnings,
      costUsd: cost,
    });
  });

  // ── POST /api/employment/:matterId/revision/apply ──────────────────────
  // Apply the approved items. Refuses outright if the revision altered any
  // paragraph the lawyer did not approve. Factual corrections also write
  // the intake and recompute the timeline and gates, because a correction
  // that lives only in one sentence leaves the matter wrong.

  const revisionApplySchema = z.object({
    docType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    approved: z.array(z.object({
      id: z.string().max(40),
      feedback: z.string().max(2000),
      kind: z.enum(REVISION_KIND_VALUES),
      paragraphIndices: z.array(z.number().int().min(0).max(5000)).max(50),
      proposal: z.string().max(2000),
      intakeField: z.string().max(60).optional().nullable(),
      // Null means "no value" wherever a plan or a client stored one; the
      // union rejecting null once failed the pilot's whole apply.
      intakeValue: z.union([z.string().max(2000), z.number(), z.boolean()]).optional().nullable(),
    })).min(1).max(60),
    /** Stored brief sources (research, case lists) grounding the rewrite. */
    sourceIds: z.array(z.string().max(60)).max(8).optional(),
  });

  fastify.post('/api/employment/:matterId/revision/apply', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = revisionApplySchema.safeParse(req.body);
    if (!parsed.success) {
      // Name the field and the rule: "Invalid request" cost the pilot his
      // approved changes with no way to know why.
      const detail = parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      logger.warn('Revision apply validation failed', { userId, matterId, detail });
      return reply.status(400).send({ ok: false, error: `The changes were not applied. ${detail}. Read the feedback again to rebuild the plan, then apply.` });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const key = findGeneratedDocKey(matter, parsed.data.docType);
    if (!key) return reply.status(404).send({ ok: false, error: 'No generated document of that type on this matter.' });
    const doc = matter[key] as Record<string, unknown>;
    const html = typeof doc.html === 'string' ? doc.html : '';
    if (!html) return reply.status(409).send({ ok: false, error: 'That document has no content to revise.' });

    const rl = await import('../../../employment/revision-loop.js');
    const paragraphs = rl.toParagraphs(html);
    // Null normalizes to "no value" before anything downstream reads it: a
    // null intakeValue passing the schema must never become a stored null.
    const approvedItems = parsed.data.approved.map(i => ({
      ...i,
      intakeField: i.intakeField ?? undefined,
      intakeValue: i.intakeValue ?? undefined,
    }));
    // A needs_lawyer item is a question for the lawyer, never an instruction
    // to the model: it cannot be approved into an edit.
    const editable = approvedItems.filter(i => i.kind !== 'needs_lawyer' && i.paragraphIndices.length > 0);

    let revised: Record<number, string> = {};
    let cost = 0;
    if (editable.length > 0) {
      const instructions = editable.map(i =>
        `Paragraphs [${i.paragraphIndices.join(', ')}]: ${i.proposal}\n  (client said: ${i.feedback})`).join('\n\n');
      const targets = [...new Set(editable.flatMap(i => i.paragraphIndices))].sort((a, b) => a - b);
      const shown = targets.map(i => `[${i}] ${paragraphs[i]}`).join('\n');

      const { crossProviderChat } = await import('../../../providers/cross-provider-chat.js');
      // The model returns the revised paragraphs in full, so the budget
      // must scale with what is being revised: a fixed 8k cap truncated
      // the JSON on long firm-depth briefs and 502'd the whole apply.
      const targetChars = targets.reduce((a, i) => a + (paragraphs[i]?.length ?? 0), 0);
      const applyBudget = Math.min(24_576, Math.max(8_192, Math.ceil(targetChars / 2)));
      // Research the lawyer attached rides along, so the rewrite can add
      // the cases and figures it actually contains: a case table populates
      // from the lawyer's own list without regenerating the brief.
      const research = resolveRevisionResearch(matter as Record<string, unknown>, parsed.data.sourceIds);
      const researchBlock = research.length
        ? `\n\nRESEARCH PROVIDED (cite and quote ONLY from it or the paragraphs):\n${research.map(r => `--- ${r.name} ---\n${r.text.slice(0, 15_000)}`).join('\n')}`
        : '';
      try {
        const result = await crossProviderChat({
          system: rl.buildApplySystemPrompt(research.length > 0),
          user: `PARAGRAPHS TO REVISE:\n${shown}${researchBlock}\n\nAPPROVED INSTRUCTIONS:\n${instructions}`,
          tier: 'opus',
          maxTokens: applyBudget,
          maxRetries: 4,
          extendOnTruncation: true,
        });
        const raw = result.text.trim();
        const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
        let payload: { revised?: Record<string, string> };
        try {
          payload = JSON.parse(fenced ? fenced[1] : raw) as { revised?: Record<string, string> };
        } catch (parseErr) {
          logger.error('Revision apply: unparseable response', {
            responseChars: raw.length,
            tail: raw.slice(-120),
            truncated: Boolean(result.truncated),
            budget: applyBudget,
          });
          return reply.status(502).send({
            ok: false,
            error: result.truncated
              ? 'The revision was too large for one pass. Approve fewer changes at a time and apply again.'
              : 'Could not apply the revisions. Please try again.',
          });
        }
        revised = Object.fromEntries(
          Object.entries(payload.revised ?? {}).map(([k, v]) => [Number(k), sanitiseHtml(String(v))]),
        );
        cost = result.cost;
      } catch (err) {
        logger.error('Revision apply failed', { error: err instanceof Error ? err.message : String(err) });
        return reply.status(502).send({ ok: false, error: 'Could not apply the revisions. Please try again.' });
      }
    }

    const outcome = rl.applyRevisions(paragraphs, editable as never, revised);
    if (!outcome.ok) {
      logger.warn('Revision refused', { userId, matterId, drifted: outcome.drifted });
      return reply.status(409).send({ ok: false, error: outcome.error, drifted: outcome.drifted });
    }

    // Keep the previous version: the lawyer must be able to see what the
    // client actually commented on.
    recordDraftHistory(matter, {
      docType: parsed.data.docType,
      title: String(doc.documentTitle ?? parsed.data.docType),
      html: fromParagraphsSafe(rl, outcome.paragraphs!),
      costUsd: cost,
      meta: { source: 'revision', changedParagraphs: outcome.changedIndices },
    }, { userId, matterId });
    doc.html = fromParagraphsSafe(rl, outcome.paragraphs!);
    doc.revisedAt = new Date().toISOString();

    // Phase 2: a factual correction updates the matter, not just the text.
    const intakeUpdates = outcome.intakeUpdates ?? {};
    let intakeApplied: string[] = [];
    let analysisStale = false;
    if (Object.keys(intakeUpdates).length > 0 && employment.intake) {
      const nextIntake = { ...(employment.intake as Record<string, unknown>) };
      for (const [field, value] of Object.entries(intakeUpdates)) {
        if (!rl.CORRECTABLE_INTAKE_FIELDS.has(field)) continue;
        nextIntake[field] = value;
        intakeApplied.push(field);
      }
      if (intakeApplied.length > 0) {
        employment.intake = nextIntake as EmploymentIntakeData;
        employment.intakeRevisedAt = new Date().toISOString();
        employment.timeline = rebuildTimelinePreserving(employment.timeline, employment.intake);
        employment.gates = evaluateGates(employment.intake);
        analysisStale = rl.correctionMakesAnalysisStale(intakeUpdates);
      }
    }

    employment.timeline = [
      ...employment.timeline,
      {
        date: new Date().toISOString().slice(0, 10),
        label: 'Feedback applied',
        description: `${outcome.changedIndices!.length} paragraph${outcome.changedIndices!.length === 1 ? '' : 's'} revised`
          + `${intakeApplied.length > 0 ? `; intake corrected (${intakeApplied.join(', ')})` : ''}.`,
        category: 'legal' as const, source: 'system' as const,
      },
    ].sort((a, b) => a.date.localeCompare(b.date));

    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Revisions applied', {
      userId, matterId, docType: parsed.data.docType,
      changed: outcome.changedIndices!.length, intakeApplied, analysisStale,
    });
    return reply.send({
      ok: true,
      changedParagraphs: outcome.changedIndices,
      intakeApplied,
      analysisStale,
      html: doc.html,
      costUsd: cost,
    });
  });
}
