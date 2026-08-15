/**
 * Employment routes — Form data, citation canon, outcome and notes.
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

export function registerMiscRoutes(fastify: FastifyInstance): void {

  // NOTE: the legacy /api/employment/templates/:firmId GET/DELETE routes were
  // removed — they let any authenticated user read or delete another firm's
  // templates by guessing a firmId. The routes above derive the firm from auth.

  // ── GET /api/employment/:matterId/form/hrto-form1-data ──────────────────
  // XFA datasets XML that pre-fills the official HRTO Form 1 SmartForm.
  // The lawyer opens the pristine official form and imports this file
  // (Acrobat: Prepare Form → More → Import Data). See hrto-form1-data.ts.

  fastify.get('/api/employment/:matterId/form/hrto-form1-data', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { employment } = loadEmploymentData(row.data_json);
    if (!employment.intake) {
      return reply.status(400).send({ ok: false, error: 'Complete intake before generating the Form 1 data file.' });
    }

    // Representative details from the user profile where available
    let rep: { lawyerName?: string; lsoNumber?: string } = {};
    try {
      const { getUserById } = await import('../../../db/database.js');
      const user = getUserById(userId);
      if (user?.profile_json) {
        const profile = JSON.parse(user.profile_json) as Record<string, unknown>;
        rep = { lawyerName: user.display_name ?? undefined, lsoNumber: (profile.lsoNumber as string) || undefined };
      }
    } catch { /* profile is best-effort */ }

    const { buildForm1DatasetsXml, form1DataFilename } = await import('../../../employment/hrto-form1-data.js');
    const xml = buildForm1DatasetsXml(employment.intake, rep);

    logAuditForm1(userId, matterId);
    return reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${form1DataFilename(employment.intake)}"`)
      .send(xml);
  });

  // ── Canon library ────────────────────────────────────────────────────────
  // Full texts of the citation-canon decisions, with provenance. Once a
  // case's text is on file, quotations and pinpoint references in every
  // generated document are verified against the actual words of the case.

  fastify.get('/api/employment/canon-texts', async (_req: FastifyRequest, reply: FastifyReply) => {
    const { listCanonTexts } = await import('../../../employment/canon-store.js');
    const { CITATION_CANON } = await import('../../../employment/citation-canon.js');
    const stored = listCanonTexts();
    const storedKeys = new Set(stored.map(t => t.keyword));
    // De-duplicate canon aliases (honda/keays point at the same case)
    const seenNames = new Set<string>();
    const canon = CITATION_CANON.filter(c => {
      if (seenNames.has(c.name)) return false;
      seenNames.add(c.name);
      return true;
    }).map(c => ({
      keyword: c.keyword,
      name: c.name,
      citation: c.citations[0].toUpperCase(),
      textOnFile: storedKeys.has(c.keyword),
    }));
    return reply.send({ ok: true, canon, texts: stored });
  });

  const canonUploadSchema = z.object({
    keyword: z.string().trim().min(2).max(60),
    text: z.string().min(500).max(3_000_000),
    source: z.string().trim().max(500).optional(),
  });

  fastify.post('/api/employment/canon-texts', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = canonUploadSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Provide the canon keyword and the full text of the decision (minimum 500 characters).' });
    try {
      const { saveCanonText } = await import('../../../employment/canon-store.js');
      const meta = saveCanonText(parsed.data.keyword, parsed.data.text, parsed.data.source ?? 'manual upload');
      logger.info('Canon text imported', { keyword: meta.keyword, chars: meta.chars, source: meta.source });
      return reply.send({ ok: true, meta });
    } catch (err) {
      return reply.status(400).send({ ok: false, error: err instanceof Error ? err.message : 'The text could not be saved.' });
    }
  });

  // ── POST /api/employment/verify-citations ────────────────────────────────
  // Deterministic citation, quotation, and pinpoint check over any draft.
  // Paste a document (from Starling or anywhere else) and get the flags,
  // at no model cost.

  const verifyCitationsSchema = z.object({
    html: z.string().min(1).max(2_000_000),
    excludeParties: z.array(z.string().max(200)).max(10).optional(),
  });

  fastify.post('/api/employment/verify-citations', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = verifyCitationsSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Provide the document HTML or text.' });
    const { checkCitationIntegrity, checkFillInPlaceholders } = await import('../../../employment/citation-canon.js');
    const { checkCanonTextIntegrity } = await import('../../../employment/canon-verifier.js');
    const flags = [
      ...checkCitationIntegrity(parsed.data.html, parsed.data.excludeParties ?? []),
      ...checkCanonTextIntegrity(parsed.data.html),
      ...checkFillInPlaceholders(parsed.data.html),
    ];
    return reply.send({ ok: true, flags, clean: flags.length === 0 });
  });

  // ── POST /api/employment/:matterId/outcome ──────────────────────────────
  // Close the matter with its outcome. The record completes the lifecycle
  // (the stage derives to resolution), takes a snapshot of the predicted
  // range for calibration, and adds the resolution to the timeline.
  // DELETE reopens the matter.

  const OUTCOME_RESOLUTIONS = [
    'settled', 'judgment', 'tribunal_decision', 'discontinued', 'abandoned',
    'grievance_allowed', 'grievance_dismissed', 'grievance_withdrawn', 'other',
  ] as const;

  const outcomeSchema = z.object({
    resolution: z.enum(OUTCOME_RESOLUTIONS),
    amount: z.number().nonnegative().max(99_999_999).optional(),
    date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/),
    notes: z.string().trim().max(3000).optional(),
  });

  fastify.post('/api/employment/:matterId/outcome', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = outcomeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Provide the resolution type and the date.' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);

    // Calibration snapshot: what was predicted when the matter closed
    const damages = (employment.analysis as Record<string, unknown> | null)?.damagesEstimate as
      | { totalEstimateLow?: number; totalEstimateHigh?: number } | undefined;

    (matter as Record<string, unknown>).outcome = {
      resolution: parsed.data.resolution,
      amount: parsed.data.amount,
      date: parsed.data.date,
      notes: parsed.data.notes,
      recordedAt: new Date().toISOString(),
      predictedLow: damages?.totalEstimateLow,
      predictedHigh: damages?.totalEstimateHigh,
    };
    (matter as Record<string, unknown>).status = 'closed';

    const amountText = typeof parsed.data.amount === 'number'
      ? ` (${parsed.data.amount.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 0 })})`
      : '';
    employment.timeline = [
      ...employment.timeline.filter(ev => ev.label !== 'Matter resolved'),
      {
        date: parsed.data.date,
        label: 'Matter resolved',
        description: `Resolution: ${parsed.data.resolution.replace(/_/g, ' ')}${amountText}.${parsed.data.notes ? ` ${parsed.data.notes}` : ''}`,
        category: 'legal' as const,
        source: 'lawyer_entry' as const,
      },
    ].sort((a, b) => a.date.localeCompare(b.date));

    await saveEmploymentData(userId, matterId, matter, employment, 'closed');
    logger.info('Outcome recorded', { userId, matterId, resolution: parsed.data.resolution, amount: parsed.data.amount });
    return reply.send({ ok: true, outcome: (matter as Record<string, unknown>).outcome });
  });

  fastify.delete('/api/employment/:matterId/outcome', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!(matter as Record<string, unknown>).outcome) {
      return reply.status(400).send({ ok: false, error: 'No outcome is recorded on this matter.' });
    }
    delete (matter as Record<string, unknown>).outcome;
    (matter as Record<string, unknown>).status = 'active';
    employment.timeline = employment.timeline.filter(ev => ev.label !== 'Matter resolved');
    await saveEmploymentData(userId, matterId, matter, employment, 'active');
    logger.info('Matter reopened', { userId, matterId });
    return reply.send({ ok: true });
  });

  // ── POST /api/employment/:matterId/notes ───────────────────────────────
  // Save lawyer notes on a matter.

  const notesBodySchema = z.object({
    notes: z.string().trim().max(50000),
    // The matter timestamp the editor loaded. When supplied and stale, the
    // save is refused rather than silently overwriting a colleague's work.
    ifUpdatedAt: z.string().max(40).optional(),
  });

  fastify.post('/api/employment/:matterId/notes', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = notesBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid notes' });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
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
    (matter as Record<string, unknown>).lawyerNotes = parsed.data.notes;
    await saveEmploymentData(userId, matterId, matter, employment);

    return reply.send({ ok: true });
  });
}
