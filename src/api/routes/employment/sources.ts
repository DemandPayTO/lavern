/**
 * Employment routes — Source slots and direction.
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

export function registerSourceRoutes(fastify: FastifyInstance): void {

  // ── Brief sources, persisted on the matter ─────────────────────────────
  // Attach once, reuse for every regeneration: an externally-drafted SOC
  // or a case list should not need re-attaching after each revision.

  const briefSourceSchema = z.object({
    name: z.string().trim().min(1).max(300),
    text: z.string().trim().min(1).max(60_000),
    /**
     * What the document IS. The mediation brief reads every source the
     * same way, but the demand letter argues from specific documents and
     * has to know which is the contract. Optional, so sources attached
     * before this existed still load.
     */
    kind: z.enum(DEMAND_SOURCE_KINDS).optional(),
  });

  fastify.post('/api/employment/:matterId/brief-sources', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = briefSourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid source' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);

    const sources = (((matter as Record<string, unknown>).briefSources ?? []) as Array<Record<string, unknown>>);
    if (sources.length >= 8) return reply.status(400).send({ ok: false, error: 'Eight stored sources at most. Remove one first.' });
    if (sources.some(sd => sd.name === parsed.data.name)) {
      return reply.status(409).send({ ok: false, error: `"${parsed.data.name}" is already attached.` });
    }
    const text = parsed.data.text.replace(/\s+/g, ' ').trim().slice(0, 60_000);
    sources.push({
      id: `src-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
      name: parsed.data.name,
      kind: parsed.data.kind ?? 'other',
      text,
      words: text.split(/\s+/).filter(Boolean).length,
      addedAt: new Date().toISOString(),
    });
    (matter as Record<string, unknown>).briefSources = sources;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true, sources: sources.map(sd => ({ id: sd.id, name: sd.name, words: sd.words, kind: sd.kind ?? 'other' })) });
  });

  fastify.delete('/api/employment/:matterId/brief-sources/:sourceId', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId, sourceId } = req.params as { matterId: string; sourceId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const sources = (((matter as Record<string, unknown>).briefSources ?? []) as Array<Record<string, unknown>>);
    const next = sources.filter(sd => sd.id !== sourceId);
    if (next.length === sources.length) return reply.status(404).send({ ok: false, error: 'Source not found' });
    (matter as Record<string, unknown>).briefSources = next;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true });
  });

  // ── The letter being answered ──────────────────────────────────────────
  // A Reply to Opposing Counsel is built FROM their letter. It is stored
  // on the matter (one at a time; a new save replaces it) so regeneration
  // and the departure checks read the same text the lawyer attached.

  const rebuttalSourceSchema = z.object({
    name: z.string().trim().min(1).max(300),
    text: z.string().trim().min(50).max(80_000),
  }).strict();

  fastify.put('/api/employment/:matterId/rebuttal-source', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = rebuttalSourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid letter', details: parsed.error.issues.map(i => i.message) });
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const text = parsed.data.text.slice(0, 80_000);
    (matter as Record<string, unknown>).rebuttalSource = {
      name: parsed.data.name,
      text,
      words: text.split(/\s+/).filter(Boolean).length,
      savedAt: new Date().toISOString(),
    };
    await saveEmploymentData(userId, matterId, matter, employment);
    logger.info('Rebuttal source saved', { userId, matterId, name: parsed.data.name });
    return reply.send({ ok: true, name: parsed.data.name });
  });

  // The client's feedback, attached raw. The reply generator reads it
  // directly while drafting, so there is no extraction step to fail.
  // Confidences are guarded in the prompt and flagged for review.
  fastify.put('/api/employment/:matterId/rebuttal-feedback', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = rebuttalSourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid feedback', details: parsed.error.issues.map(i => i.message) });
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const text = parsed.data.text.slice(0, 80_000);
    (matter as Record<string, unknown>).rebuttalFeedback = {
      name: parsed.data.name,
      text,
      words: text.split(/\s+/).filter(Boolean).length,
      savedAt: new Date().toISOString(),
    };
    await saveEmploymentData(userId, matterId, matter, employment);
    logger.info('Rebuttal feedback saved', { userId, matterId, name: parsed.data.name });
    return reply.send({ ok: true, name: parsed.data.name });
  });

  fastify.delete('/api/employment/:matterId/rebuttal-feedback', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!(matter as Record<string, unknown>).rebuttalFeedback) return reply.status(404).send({ ok: false, error: 'No feedback attached' });
    delete (matter as Record<string, unknown>).rebuttalFeedback;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true });
  });

  // A document attached to the CLAIM workspace: the slot-fill pass and
  // the Background Facts read it alongside the matter's demand letter.
  fastify.put('/api/employment/:matterId/soc-source', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = rebuttalSourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid document', details: parsed.error.issues.map(i => i.message) });
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const text = parsed.data.text.slice(0, 80_000);
    (matter as Record<string, unknown>).socSource = {
      name: parsed.data.name,
      text,
      words: text.split(/\s+/).filter(Boolean).length,
      savedAt: new Date().toISOString(),
    };
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true, name: parsed.data.name });
  });

  fastify.delete('/api/employment/:matterId/soc-source', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!(matter as Record<string, unknown>).socSource) return reply.status(404).send({ ok: false, error: 'No document attached' });
    delete (matter as Record<string, unknown>).socSource;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true });
  });

  // The Statement of Defence the Reply answers. Required: a Reply to a
  // pleading nobody has read would be anticipation dressed as response.
  fastify.put('/api/employment/:matterId/defence-source', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = rebuttalSourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid document', details: parsed.error.issues.map(i => i.message) });
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const text = parsed.data.text.slice(0, 80_000);
    (matter as Record<string, unknown>).defenceSource = {
      name: parsed.data.name,
      text,
      words: text.split(/\s+/).filter(Boolean).length,
      savedAt: new Date().toISOString(),
    };
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true, name: parsed.data.name });
  });

  fastify.delete('/api/employment/:matterId/defence-source', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!(matter as Record<string, unknown>).defenceSource) return reply.status(404).send({ ok: false, error: 'No Statement of Defence attached' });
    delete (matter as Record<string, unknown>).defenceSource;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true });
  });

  // The as-filed Statement of Claim, when it differs from (or predates)
  // the one Starling generated. The comparison and the Reply read it.
  fastify.put('/api/employment/:matterId/claim-source', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = rebuttalSourceSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid document', details: parsed.error.issues.map(i => i.message) });
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const text = parsed.data.text.slice(0, 80_000);
    (matter as Record<string, unknown>).claimSource = {
      name: parsed.data.name, text,
      words: text.split(/\s+/).filter(Boolean).length,
      savedAt: new Date().toISOString(),
    };
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true, name: parsed.data.name });
  });

  fastify.delete('/api/employment/:matterId/claim-source', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!(matter as Record<string, unknown>).claimSource) return reply.status(404).send({ ok: false, error: 'No claim attached' });
    delete (matter as Record<string, unknown>).claimSource;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true });
  });

  // ── POST /api/employment/:matterId/reply-comparison ───────────────────
  // Read the Defence against the Claim: admissions, bare denials, and the
  // NEW MATTERS a Reply may answer, each quoting the Defence. A review
  // artifact: the lawyer picks which items the Reply addresses.
  fastify.post('/api/employment/:matterId/reply-comparison', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);

    const defence = (matter as Record<string, unknown>).defenceSource as { name?: string; text?: string } | undefined;
    if (!defence?.text) {
      return reply.status(400).send({ ok: false, error: 'Attach the Statement of Defence first.' });
    }
    const attachedClaim = (matter as Record<string, unknown>).claimSource as { name?: string; text?: string } | undefined;
    let claimText = attachedClaim?.text ?? '';
    let claimName = String(attachedClaim?.name ?? '');
    if (!claimText) {
      const socKey = findGeneratedDocKey(matter, 'statement_of_claim');
      if (socKey) {
        const socHtml = String(((matter as Record<string, unknown>)[socKey] as Record<string, unknown>)?.html ?? '');
        claimText = socHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
        claimName = 'the Statement of Claim on this matter';
      }
    }
    if (claimText.length < 200) {
      return reply.status(400).send({ ok: false, error: 'No Statement of Claim to compare against. Generate one, or attach the as-filed claim in the Reply workspace.' });
    }

    const intake = employment.intake;
    const definedTerms = [intake.client_first_name, intake.client_last_name, intake.employer_legal_name]
      .filter((x): x is string => Boolean(x));

    const { compareClaimDefence } = await import('../../../employment/reply-comparison.js');
    let comparison;
    try {
      comparison = await compareClaimDefence({ claimText, defenceText: defence.text, definedTerms });
    } catch (err) {
      logger.error('Reply comparison failed', { matterId, error: err instanceof Error ? err.message.slice(0, 300) : String(err) });
      return reply.status(502).send({ ok: false, error: 'The comparison could not be completed. Try again.' });
    }

    const stored = {
      items: comparison.kept.items,
      droppedUnverified: comparison.dropped,
      claimName, defenceName: String(defence.name ?? 'Statement of Defence'),
      generatedAt: new Date().toISOString(),
      costUsd: comparison.costUsd,
    };
    (matter as Record<string, unknown>).replyComparison = stored;
    await saveEmploymentData(userId, matterId, matter, employment);
    try { recordUsageEvent(userId, matterId, 'analysis', 'reply_comparison', comparison.costUsd); } catch { /* metering never blocks */ }
    return reply.send({ ok: true, comparison: stored });
  });

  fastify.delete('/api/employment/:matterId/rebuttal-source', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!(matter as Record<string, unknown>).rebuttalSource) return reply.status(404).send({ ok: false, error: 'No letter attached' });
    delete (matter as Record<string, unknown>).rebuttalSource;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true });
  });

  // ── Drafting direction ─────────────────────────────────────────────────
  // What the partner said to do on this file. Stored on the matter, read by
  // every generator, and checked against the draft afterwards. Raw notes
  // are never sent to a drafting prompt: they are read once here, the
  // instructions are extracted, and the lawyer approves them.

  const instructionSchema = z.object({
    id: z.string().trim().max(60).optional(),
    text: z.string().trim().min(1).max(600),
    kind: z.enum(INSTRUCTION_KINDS).default('scope'),
    mustInclude: z.array(z.string().trim().max(120)).max(8).optional(),
    mustNotInclude: z.array(z.string().trim().max(120)).max(8).optional(),
  });

  const directionSchema = z.object({
    /** Omitted or empty means the direction for the file as a whole. */
    documentType: z.string().trim().max(60).optional(),
    notes: z.string().trim().max(MAX_NOTES_CHARS).optional(),
    instructions: z.array(instructionSchema).max(MAX_INSTRUCTIONS),
    withheld: z.array(z.string().trim().max(300)).max(20).optional(),
    proposedHeads: z.array(z.object({
      label: z.string().trim().min(1).max(200),
      basis: z.string().trim().max(300).optional(),
      amount: z.number().nonnegative().max(99_999_999).nullable().optional(),
    })).max(20).optional(),
  });

  fastify.get('/api/employment/:matterId/direction', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter } = loadEmploymentData(row.data_json);
    return reply.send({
      ok: true,
      direction: ((matter as Record<string, unknown>).direction ?? {}) as Record<string, unknown>,
    });
  });

  fastify.put('/api/employment/:matterId/direction', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = directionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid direction' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);

    let updatedByName = '';
    try {
      const { getUserById } = await import('../../../db/database.js');
      updatedByName = getUserById(userId)?.display_name ?? '';
    } catch { /* attribution is best-effort */ }

    const record = {
      notes: parsed.data.notes,
      instructions: parsed.data.instructions.map((i, n) => ({
        ...i,
        id: i.id ?? `dir-${Date.now()}-${n}`,
      })),
      withheld: parsed.data.withheld,
      proposedHeads: parsed.data.proposedHeads,
      updatedAt: new Date().toISOString(),
      updatedByName,
    };

    const direction = ((matter as Record<string, unknown>).direction ?? {}) as Record<string, unknown>;
    if (parsed.data.documentType) {
      const byDocument = (direction.byDocument ?? {}) as Record<string, unknown>;
      byDocument[parsed.data.documentType] = record;
      direction.byDocument = byDocument;
    } else {
      direction.matter = record;
    }
    (matter as Record<string, unknown>).direction = direction;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true, direction });
  });
}
