/**
 * Employment routes — Intake, analysis, deadlines, matter fetch.
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

export function registerIntakeRoutes(fastify: FastifyInstance): void {

  // ── POST /api/employment/intake ────────────────────────────────────────
  // Save or update structured intake data on a matter.

  const intakeBodySchema = z.object({
    matterId: z.string().min(1).max(200),
    intake: employmentIntakeSchema,
    // See the notes route: refuse a stale write instead of clobbering.
    ifUpdatedAt: z.string().max(40).optional(),
  });

  fastify.post('/api/employment/intake', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';

    const parsed = intakeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn('Intake validation failed', { userId, issues: parsed.error.issues.map(i => i.path.join('.')) });
      // Name the field and the rule it broke. "Invalid intake data" cost
      // the pilot an age: his clause paste was over the length cap, the
      // rejection took the whole save with it, and nothing said why.
      const bodyIntake = ((req.body as Record<string, unknown> | null)?.intake ?? {}) as Record<string, unknown>;
      const detail = parsed.error.issues.slice(0, 4).map(i => {
        const field = String(i.path[i.path.length - 1] ?? i.path[0] ?? 'field');
        const v = bodyIntake[field];
        const size = typeof v === 'string' && i.code === 'too_big'
          ? ` (the value is ${v.length.toLocaleString('en-CA')} characters)` : '';
        return `${field}: ${i.message}${size}`;
      }).join('; ');
      return reply.status(400).send({
        ok: false,
        error: `The intake was not saved. ${detail}. Fix ${parsed.error.issues.length === 1 ? 'that field' : 'those fields'} and save again; your other changes are still in the form.`,
      });
    }

    const { matterId, intake: rawIntake } = parsed.data;
    // Questionnaire answers mirror onto the fields the engines read
    // (vacation_paid = No writes vacation_unpaid = true, and so on).
    const { applyQuestionnaireAliases } = await import('../../../employment/intake-questionnaire.js');
    const intake = applyQuestionnaireAliases(rawIntake as Record<string, unknown>) as typeof rawIntake;

    // Load existing matter
    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }
    if (
      parsed.data.ifUpdatedAt && parsed.data.ifUpdatedAt !== row.updated_at
      && row.last_modified_by && row.last_modified_by !== userId
    ) {
      return reply.status(409).send({
        ok: false,
        error: row.last_modified_by_name
          ? `This file changed while you were editing: ${row.last_modified_by_name} saved a newer version. Copy your text, reload the page, and reapply it.`
          : 'This file changed while you were editing. Copy your text, reload the page, and reapply it.',
        lastModifiedByName: row.last_modified_by_name ?? '',
        updatedAt: row.updated_at,
      });
    }

    const { matter, employment } = loadEmploymentData(row.data_json);
    // MERGE, never replace. This route once assigned the payload over the
    // whole intake, so each partial save (a questionnaire section, the
    // quick-edit grid) silently erased every answer it did not carry: the
    // pilot filled seventeen sections and kept whichever one saved last.
    // An explicit null deletes a field; an absent key changes nothing.
    const merged: Record<string, unknown> = { ...(employment.intake as Record<string, unknown>) };
    for (const [k, v] of Object.entries(intake as Record<string, unknown>)) {
      if (v === null) delete merged[k];
      else if (v !== undefined) merged[k] = v;
    }
    employment.intake = merged as EmploymentIntakeData;
    employment.intakeRevisedAt = new Date().toISOString();

    // Rebuild intake-derived timeline, preserving lawyer entries and
    // route-added ticklers (court dates, SOC-sent, debriefs, outcomes).
    employment.timeline = rebuildTimelinePreserving(employment.timeline, employment.intake);

    // Auto-evaluate gates
    employment.gates = evaluateGates(employment.intake);

    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Intake saved', {
      userId,
      matterId,
      triggeredGates: employment.gates.filter(g => g.triggered).map(g => g.gate),
      timelineEvents: employment.timeline.length,
    });

    return reply.send({
      ok: true,
      timeline: employment.timeline,
      gates: employment.gates,
      triggeredIssueCodes: getTriggeredIssueCodes(employment.gates),
    });
  });

  // ── POST /api/employment/analyze ───────────────────────────────────────
  // Run full analysis: timeline, gates, damages estimate, Bardal, limitations, procedure.

  const analyzeBodySchema = z.object({
    matterId: z.string().min(1).max(200),
  });

  fastify.post('/api/employment/analyze', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';

    const parsed = analyzeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid request' });
    }

    const { matterId } = parsed.data;
    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }

    const { matter, employment } = loadEmploymentData(row.data_json);
    recomputeAnalysis(employment);
    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Analysis complete', {
      userId,
      matterId,
      triggeredGates: employment.gates.filter(g => g.triggered).length,
      estimatedDamagesHigh: employment.analysis?.damagesEstimate.totalEstimateHigh,
      recommendedProcedure: employment.analysis?.recommendedProcedure,
      limitationUrgent: employment.analysis?.limitationDeadline.urgent ?? false,
    });

    return reply.send({ ok: true, analysis: employment.analysis });
  });

  // ── GET /api/employment/deadlines ──────────────────────────────────────
  // Consolidated deadline docket across all of the user's matters:
  // limitations, demand response deadlines, severance offer deadlines,
  // future timeline events. Read-only aggregation, no LLM calls.

  fastify.get('/api/employment/deadlines', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const rows = getMattersByUser(userId);
    const deadlines = collectDeadlines(rows);
    return reply.send({
      ok: true,
      deadlines,
      counts: {
        overdue: deadlines.filter(d => d.urgency === 'overdue').length,
        critical: deadlines.filter(d => d.urgency === 'critical').length,
        soon: deadlines.filter(d => d.urgency === 'soon').length,
      },
      generatedAt: new Date().toISOString(),
    });
  });

  // ── GET /api/employment/deadlines.ics ────────────────────────────────────
  // The docket as an iCalendar file: download it, or subscribe to the URL
  // so every Starling deadline lands in the firm calendar as an all-day
  // event. Stable UIDs mean updates replace events rather than duplicate.

  fastify.get('/api/employment/deadlines.ics', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const rows = getMattersByUser(userId);
    const { buildDocketIcs } = await import('../../../employment/docket-ics.js');
    const ics = buildDocketIcs(collectDeadlines(rows));
    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="starling-docket.ics"')
      .send(ics);
  });

  fastify.get('/api/employment/:matterId', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }

    const { matter, employment } = loadEmploymentData(row.data_json);
    const { deriveEmploymentStage } = await import('../../../employment/stage-model.js');
    const { recommendEmploymentNextSteps } = await import('../../../employment/next-steps.js');
    const stage = deriveEmploymentStage(matter as Record<string, unknown>, employment);
    return reply.send({
      ok: true,
      data: employment,
      lawyerNotes: ((matter as Record<string, unknown>).lawyerNotes as string) ?? '',
      generatedDocuments: collectGeneratedDocuments(matter as Record<string, unknown>),
      debriefs: ((matter as Record<string, unknown>).debriefs ?? []),
      firmFileNumber: ((matter as Record<string, unknown>).firmFileNumber as string) ?? '',
      matterNumber: ((matter as Record<string, unknown>).matterNumber as string) ?? '',
      stage,
      waiting: (await import('../../../employment/worklist.js')).waitingState((matter as Record<string, unknown>).waitingOn),
      nextSteps: recommendEmploymentNextSteps(matter as Record<string, unknown>, employment, stage),
      updatedAt: row.updated_at,
      openedBy: row.owner_name ?? '',
      openedByMe: row.user_id === userId,
      lastModifiedByName: row.last_modified_by_name ?? '',
      rebuttalSource: (() => {
        const src = (matter as Record<string, unknown>).rebuttalSource as { name?: string; words?: number; savedAt?: string } | undefined;
        return src ? { name: src.name, words: src.words, savedAt: src.savedAt } : null;
      })(),
      claimSource: (() => {
        const src = (matter as Record<string, unknown>).claimSource as { name?: string; words?: number; savedAt?: string } | undefined;
        return src ? { name: src.name, words: src.words, savedAt: src.savedAt } : null;
      })(),
      claimOnFile: Boolean(findGeneratedDocKey(matter, 'statement_of_claim')),
      replyComparison: ((matter as Record<string, unknown>).replyComparison ?? null),
      defenceSource: (() => {
        const src = (matter as Record<string, unknown>).defenceSource as { name?: string; words?: number; savedAt?: string } | undefined;
        return src ? { name: src.name, words: src.words, savedAt: src.savedAt } : null;
      })(),
      socSource: (() => {
        const src = (matter as Record<string, unknown>).socSource as { name?: string; words?: number; savedAt?: string } | undefined;
        return src ? { name: src.name, words: src.words, savedAt: src.savedAt } : null;
      })(),
      demandLetterOnFile: Boolean(findGeneratedDocKey(matter, 'demand_letter')),
      rebuttalFeedback: (() => {
        const fb = (matter as Record<string, unknown>).rebuttalFeedback as { name?: string; words?: number; savedAt?: string } | undefined;
        return fb ? { name: fb.name, words: fb.words, savedAt: fb.savedAt } : null;
      })(),
      briefSources: (((matter as Record<string, unknown>).briefSources ?? []) as Array<Record<string, unknown>>)
        .map(sd => ({ id: sd.id, name: sd.name, words: sd.words, kind: sd.kind ?? 'other' })),
      mediationLogistics: (matter as Record<string, unknown>).mediationLogistics ?? null,
    });
  });

  // ── Firm file number ──────────────────────────────────────────────────
  // The lawyer's own file/matter number for this matter. When set, the UI
  // shows it in place of the auto-generated number. Fresh DB read/write so
  // it never clobbers concurrent employment edits.
  fastify.post('/api/employment/:matterId/file-number', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const schema = z.object({ firmFileNumber: z.string().trim().max(60) }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid file number' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter } = loadEmploymentData(row.data_json);
    const m = matter as Record<string, unknown>;
    // Empty string clears it (falls back to the auto number).
    if (parsed.data.firmFileNumber) m.firmFileNumber = parsed.data.firmFileNumber;
    else delete m.firmFileNumber;
    await saveMatter(userId, matterId, JSON.stringify(m), (m.status as string) ?? 'active');
    return reply.send({ ok: true, firmFileNumber: parsed.data.firmFileNumber });
  });

  // ── GET /api/employment/issue-catalog ──────────────────────────────────
  // The full catalogue of legal issues the gates can raise, grouped by gate,
  // so the lawyer can add an issue the analysis did not surface. Static and
  // firm-agnostic.

  fastify.get('/api/employment/issue-catalog', async (_req: FastifyRequest, reply: FastifyReply) => {
    const { buildIssueCatalog } = await import('../../../employment/issue-catalog.js');
    return reply.send({ ok: true, catalog: buildIssueCatalog() });
  });

  // ── POST /api/employment/:matterId/issues ──────────────────────────────
  // Approve or dismiss legal issues. The lawyer decides which issues to
  // include in generated documents.

  const issueDecisionSchema = z.object({
    approved: z.array(z.string().max(100)).max(50),
    dismissed: z.array(z.string().max(100)).max(50),
  });

  fastify.post('/api/employment/:matterId/issues', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = issueDecisionSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid issue decisions' });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }

    const { matter, employment } = loadEmploymentData(row.data_json);
    employment.approvedIssues = parsed.data.approved;
    employment.dismissedIssues = parsed.data.dismissed;

    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Issues approved/dismissed', {
      userId,
      matterId,
      approved: parsed.data.approved.length,
      dismissed: parsed.data.dismissed.length,
    });

    return reply.send({ ok: true, approved: employment.approvedIssues, dismissed: employment.dismissedIssues });
  });

  // ── POST /api/employment/:matterId/timeline ────────────────────────────
  // Add a manual event to the timeline.

  const timelineEventSchema = z.object({
    date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
    label: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional(),
    category: z.enum(['employment', 'termination', 'legal', 'mitigation', 'other']),
    /** Lawyer marks this as a court-imposed / statutory deadline (red-eligible). */
    courtDeadline: z.boolean().optional(),
  });

  fastify.post('/api/employment/:matterId/timeline', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = timelineEventSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid timeline event' });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }

    const { matter, employment } = loadEmploymentData(row.data_json);

    const event: TimelineEvent = {
      ...parsed.data,
      source: 'lawyer_entry',
    };

    employment.timeline = addTimelineEvent(employment.timeline, event);
    await saveEmploymentData(userId, matterId, matter, employment);

    return reply.send({ ok: true, timeline: employment.timeline });
  });

  // ── GET /api/employment/questionnaire ──────────────────────────────────
  // The firm's full intake question bank, generated from its DemandPay
  // schema workbook. Static data; the dashboard renders it as sections.
  fastify.get('/api/employment/questionnaire', async (_req: FastifyRequest, reply: FastifyReply) => {
    const { loadQuestionnaire } = await import('../../../employment/intake-questionnaire.js');
    return reply.send({ ok: true, questionnaire: loadQuestionnaire() });
  });
}
