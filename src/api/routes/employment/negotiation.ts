/**
 * Employment routes — Negotiation ledger, net settlement, comparables.
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

export function registerNegotiationRoutes(fastify: FastifyInstance): void {

  // ── GET /api/employment/:matterId ──────────────────────────────────────
  // Get the full employment data for a matter, with a summary of every
  // generated document and its lifecycle status.

  // ── Negotiation ledger ────────────────────────────────────────────────
  // Every offer and counter, tracked against the assessed entitlement.
  fastify.get('/api/employment/:matterId/negotiation', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const { summarizeNegotiation, amountsFromAnalysis } = await import('../../../employment/negotiation.js');
    const entries = ((matter as Record<string, unknown>).negotiation ?? []) as import('../../../employment/negotiation.js').NegotiationEntry[];
    return reply.send({
      ok: true,
      entries,
      summary: summarizeNegotiation(entries, amountsFromAnalysis(employment?.analysis as Record<string, unknown> | null)),
    });
  });

  fastify.post('/api/employment/:matterId/negotiation', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const schema = z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      party: z.enum(['employer', 'client']),
      kind: z.enum(['offer', 'counter', 'demand', 'acceptance', 'rejection']),
      amountCad: z.number().nonnegative().max(100_000_000).nullable().optional(),
      terms: z.string().trim().max(2000).optional(),
      note: z.string().trim().max(2000).optional(),
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid entry', details: parsed.error.issues.map(i => i.message) });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const m = matter as Record<string, unknown>;
    const entries = (m.negotiation ?? []) as Array<Record<string, unknown>>;
    const entry = {
      id: `neg-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      ...parsed.data,
      amountCad: parsed.data.amountCad ?? null,
      recordedAt: new Date().toISOString(),
    };
    entries.push(entry);
    m.negotiation = entries;

    // Negotiation moves are matter events.
    if (employment) {
      const label = `${parsed.data.party === 'employer' ? 'Employer' : 'Client'} ${parsed.data.kind}${parsed.data.amountCad != null ? `: $${Number(parsed.data.amountCad).toLocaleString('en-CA')}` : ''} recorded`;
      employment.timeline = [
        ...(employment.timeline ?? []),
        { date: parsed.data.date, label, source: 'system' } as (typeof employment.timeline)[number],
      ];
      m.employmentData = employment;
    }
    await saveMatter(userId, matterId, JSON.stringify(m), (m.status as string) ?? 'active');
    const { summarizeNegotiation, amountsFromAnalysis } = await import('../../../employment/negotiation.js');
    return reply.send({
      ok: true,
      entry,
      summary: summarizeNegotiation(m.negotiation as import('../../../employment/negotiation.js').NegotiationEntry[], amountsFromAnalysis(employment?.analysis as Record<string, unknown> | null)),
    });
  });

  fastify.delete('/api/employment/:matterId/negotiation/:entryId', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId, entryId } = req.params as { matterId: string; entryId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter } = loadEmploymentData(row.data_json);
    const m = matter as Record<string, unknown>;
    const entries = (m.negotiation ?? []) as Array<{ id: string }>;
    const idx = entries.findIndex(e => e.id === entryId);
    if (idx === -1) return reply.status(404).send({ ok: false, error: 'Entry not found' });
    entries.splice(idx, 1);
    m.negotiation = entries;
    await saveMatter(userId, matterId, JSON.stringify(m), (m.status as string) ?? 'active');
    return reply.send({ ok: true });
  });

  // ── Net-settlement calculator ─────────────────────────────────────────
  // What the client actually takes home: rule-certain withholding at
  // source, RRSP-eligible transfer room, HST on fees, and the character of
  // each settlement component. Inputs persist on the matter so the numbers
  // survive between sessions; the computation itself is pure.
  fastify.get('/api/employment/:matterId/net-settlement', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter } = loadEmploymentData(row.data_json);
    const saved = (matter as Record<string, unknown>).netSettlement as Record<string, unknown> | undefined;
    if (!saved) return reply.send({ ok: true, inputs: null, result: null });
    const { computeNetSettlement } = await import('../../../employment/net-settlement.js');
    return reply.send({
      ok: true,
      inputs: saved,
      result: computeNetSettlement(saved as unknown as import('../../../employment/net-settlement.js').NetSettlementInputs),
    });
  });

  fastify.post('/api/employment/:matterId/net-settlement', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const allocationSchema = z.object({
      retiringAllowanceCad: z.number().min(0).max(100_000_000).default(0),
      salaryContinuanceCad: z.number().min(0).max(100_000_000).default(0),
      generalDamagesCad: z.number().min(0).max(100_000_000).default(0),
      legalFeeContributionCad: z.number().min(0).max(100_000_000).default(0),
      rrspTransferCad: z.number().min(0).max(100_000_000).optional(),
    }).strict();
    const schema = z.object({
      allocation: allocationSchema,
      yearsBefore1996: z.number().min(0).max(60).optional(),
      yearsBefore1989NoPension: z.number().min(0).max(60).optional(),
      effectiveTaxRatePct: z.number().min(0).max(60).nullable().optional(),
      feePct: z.number().min(0).max(50).nullable().optional(),
      feeOnGross: z.boolean().optional(),
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid inputs', details: parsed.error.issues.map(i => i.message) });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter } = loadEmploymentData(row.data_json);
    const m = matter as Record<string, unknown>;
    m.netSettlement = parsed.data;
    await saveMatter(userId, matterId, JSON.stringify(m), (m.status as string) ?? 'active');
    const { computeNetSettlement } = await import('../../../employment/net-settlement.js');
    return reply.send({ ok: true, inputs: parsed.data, result: computeNetSettlement(parsed.data) });
  });

  fastify.delete('/api/employment/:matterId/net-settlement', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter } = loadEmploymentData(row.data_json);
    const m = matter as Record<string, unknown>;
    delete m.netSettlement;
    await saveMatter(userId, matterId, JSON.stringify(m), (m.status as string) ?? 'active');
    return reply.send({ ok: true });
  });

  // ── GET /api/employment/:matterId/comparables ────────────────────────
  // The internal-research view: the closest decided Ontario cases to this
  // matter's Bardal profile, plus the case-based reasonable-notice range,
  // drawn from the shared DemandPay case library. Returns configured:false
  // (not an error) when the library is not wired up.
  fastify.get('/api/employment/:matterId/comparables', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { employment } = loadEmploymentData(row.data_json);
    const intake = employment?.intake;
    if (!intake) return reply.send({ ok: true, configured: false, reason: 'No intake on this matter yet.' });

    const { computeBardalFactors } = await import('../../../employment/timeline-generator.js');
    const { findComparables, caselawConfigured } = await import('../../../employment/case-comparables.js');
    if (!caselawConfigured()) {
      return reply.send({ ok: true, configured: false, reason: 'The case library is not configured on this server.' });
    }
    const bardal = computeBardalFactors(intake);
    if (bardal.tenureYears == null) {
      return reply.send({ ok: true, configured: true, comparables: [], range: null, reason: 'Tenure is required for matching: fill hire and termination dates on the Intake tab.' });
    }

    const result = await findComparables({
      years: bardal.tenureYears,
      age: bardal.age,
      seniority: null,
    });
    if (!result) return reply.send({ ok: true, configured: true, comparables: [], range: null, reason: 'The case library is temporarily unavailable.' });
    return reply.send({ ok: true, configured: true, profile: { years: bardal.tenureYears, age: bardal.age }, ...result });
  });
}
