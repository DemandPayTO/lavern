/**
 * Employment Intake Routes — Lawyer-facing intake for Ontario employment law matters.
 *
 * Routes:
 *   POST /api/employment/intake          — Save/update structured intake data on a matter
 *   POST /api/employment/extract         — Upload a document, extract facts via Claude
 *   POST /api/employment/analyze         — Run full analysis (timeline, gates, damages, Bardal, procedure)
 *   GET  /api/employment/:matterId       — Get employment data for a matter
 *   POST /api/employment/:matterId/issues — Approve/dismiss legal issues
 *   POST /api/employment/:matterId/timeline — Add a manual timeline event
 *
 * All routes require authentication (via auth middleware on the server).
 * Employment data is stored as JSON on the matter record (matter.data_json).
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { employmentIntakeSchema, createEmploymentMatterData } from '../../types/employment-intake.js';
import type { EmploymentMatterData, EmploymentIntakeData, TimelineEvent, DocumentExtractionResult } from '../../types/employment-intake.js';
import { evaluateGates, getTriggeredIssueCodes } from '../../employment/gate-evaluator.js';
import { buildTimelineFromIntake, computeLimitationDeadline, computeBardalFactors, recommendProcedure, addTimelineEvent } from '../../employment/timeline-generator.js';
import { saveMatter, getMatterById, getMattersByUser, saveFirmTemplate, getFirmTemplates, getFirmTemplate, deleteFirmTemplate } from '../../db/database.js';
import { collectDeadlines } from '../../employment/deadlines.js';
import { createLogger } from '../../utils/logger.js';
import { extractEmploymentDocument } from '../briefing/employment-extractor.js';
import { UPLOADABLE_DOCUMENT_TYPES, TONE_OPTIONS, PROCEDURE_TYPES } from '../../types/employment-intake.js';
import { generateDemandLetter } from '../../employment/demand-letter-generator.js';
import { generateStatementOfClaim } from '../../employment/soc-generator.js';
import { generateApplication } from '../../employment/application-generator.js';
import type { ApplicationType } from '../../employment/application-generator.js';
import { htmlToDocx } from '../../employment/docx-export.js';
import { generateLitigationDocument } from '../../employment/litigation-documents.js';
import type { LitigationDocumentType } from '../../employment/litigation-documents.js';
import { detectPlaceholders, templateUploadSchema } from '../../employment/firm-templates.js';
import type { FirmTemplate } from '../../employment/firm-templates.js';

const logger = createLogger('EMPLOYMENT');

/** Strip script tags and event handlers from generated HTML before storing. */
function sanitiseHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/\bon\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\bon\w+\s*=\s*'[^']*'/gi, '');
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Load a matter's employment data, or create a fresh one if none exists. */
function loadEmploymentData(matterDataJson: string): { matter: Record<string, unknown>; employment: EmploymentMatterData } {
  const matter = JSON.parse(matterDataJson) as Record<string, unknown>;
  const employment = (matter.employmentData as EmploymentMatterData) ?? createEmploymentMatterData();
  return { matter, employment };
}

/** Persist employment data back onto the matter record. */
async function saveEmploymentData(
  userId: string,
  matterId: string,
  matter: Record<string, unknown>,
  employment: EmploymentMatterData,
  status?: string,
): Promise<void> {
  matter.employmentData = employment;
  await saveMatter(userId, matterId, JSON.stringify(matter), status ?? (matter.status as string) ?? 'active');
}

/**
 * Draft version history — lawyers iterate tone and amounts; regeneration
 * must never destroy the previous draft. Newest first, capped.
 */
const DRAFT_HISTORY_CAP = 10;
function recordDraftHistory(
  matter: Record<string, unknown>,
  entry: { docType: string; title: string; html: string; costUsd: number; meta?: Record<string, unknown> },
): void {
  const history = Array.isArray(matter.draftHistory) ? matter.draftHistory as Array<Record<string, unknown>> : [];
  history.unshift({ ...entry, generatedAt: new Date().toISOString() });
  matter.draftHistory = history.slice(0, DRAFT_HISTORY_CAP);
}

// ── Generated-document lifecycle ─────────────────────────────────────────
// Generated documents live on the matter under legacy camel-case keys
// (generatedDemandLetter, generatedSOC, generatedApplication) and the
// generated_<type> pattern shared by the litigation and labour routes.
// Each carries a lifecycle status: draft → reviewed → sent or filed.

export const DOCUMENT_STATUSES = ['draft', 'reviewed', 'sent', 'filed'] as const;
export type DocumentStatus = typeof DOCUMENT_STATUSES[number];

const LEGACY_DOC_KEYS: Record<string, string> = {
  generatedDemandLetter: 'demand_letter',
  generatedSOC: 'statement_of_claim',
  generatedApplication: 'application',
};

export interface GeneratedDocumentSummary {
  docType: string;
  title: string;
  status: DocumentStatus;
  generatedAt: string | null;
  statusDate: string | null;
  costUsd: number;
}

/** Locate the matter key holding a generated document of the given type. */
function findGeneratedDocKey(matter: Record<string, unknown>, docType: string): string | null {
  const legacy = Object.entries(LEGACY_DOC_KEYS).find(([, t]) => t === docType);
  if (legacy && matter[legacy[0]]) return legacy[0];
  const key = `generated_${docType}`;
  return matter[key] ? key : null;
}

function titleForDoc(docType: string, doc: Record<string, unknown>): string {
  if (typeof doc.documentTitle === 'string' && doc.documentTitle) return doc.documentTitle;
  if (typeof doc.formName === 'string' && doc.formName) return doc.formName;
  if (docType === 'demand_letter') return 'Demand Letter';
  if (docType === 'statement_of_claim') return 'Statement of Claim';
  return docType.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

export function collectGeneratedDocuments(matter: Record<string, unknown>): GeneratedDocumentSummary[] {
  const out: GeneratedDocumentSummary[] = [];
  const push = (docType: string, doc: Record<string, unknown>) => {
    const status = DOCUMENT_STATUSES.includes(doc.status as DocumentStatus) ? doc.status as DocumentStatus : 'draft';
    out.push({
      docType,
      title: titleForDoc(docType, doc),
      status,
      generatedAt: typeof doc.generatedAt === 'string' ? doc.generatedAt : null,
      statusDate: typeof doc.statusDate === 'string' ? doc.statusDate : null,
      costUsd: typeof doc.costUsd === 'number' ? doc.costUsd : 0,
    });
  };
  for (const [key, docType] of Object.entries(LEGACY_DOC_KEYS)) {
    const doc = matter[key];
    if (doc && typeof doc === 'object') push(docType, doc as Record<string, unknown>);
  }
  for (const key of Object.keys(matter)) {
    if (!key.startsWith('generated_')) continue;
    const doc = matter[key];
    if (doc && typeof doc === 'object') push(key.slice('generated_'.length), doc as Record<string, unknown>);
  }
  out.sort((a, b) => String(b.generatedAt ?? '').localeCompare(String(a.generatedAt ?? '')));
  return out;
}

// ── Route registration ───────────────────────────────────────────────────

export function registerEmploymentIntakeRoutes(fastify: FastifyInstance): void {

  // ── POST /api/employment/intake ────────────────────────────────────────
  // Save or update structured intake data on a matter.

  const intakeBodySchema = z.object({
    matterId: z.string().min(1).max(200),
    intake: employmentIntakeSchema,
  });

  fastify.post('/api/employment/intake', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';

    const parsed = intakeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn('Intake validation failed', { userId, issues: parsed.error.issues.map(i => i.path.join('.')) });
      return reply.status(400).send({ ok: false, error: 'Invalid intake data' });
    }

    const { matterId, intake } = parsed.data;

    // Load existing matter
    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }

    const { matter, employment } = loadEmploymentData(row.data_json);
    employment.intake = intake as EmploymentIntakeData;

    // Auto-generate timeline from intake
    employment.timeline = buildTimelineFromIntake(intake as EmploymentIntakeData);

    // Auto-evaluate gates
    employment.gates = evaluateGates(intake as EmploymentIntakeData);

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
    const intake = employment.intake;

    // Timeline
    employment.timeline = buildTimelineFromIntake(intake);

    // Gates
    employment.gates = evaluateGates(intake);

    // Bardal factors
    const bardal = computeBardalFactors(intake);

    // Limitation deadline
    const limitation = computeLimitationDeadline(intake.termination_date);

    // ESA calculation (simplified — full version would mirror DemandPay's calculator)
    const salary = intake.annual_salary ?? 0;
    const startDate = intake.hire_date ?? intake.first_day_of_work;
    const endDate = intake.termination_date;
    let tenureYears = 0;
    if (startDate && endDate) {
      const start = new Date(startDate);
      const end = new Date(endDate);
      if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
        tenureYears = (end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25);
      }
    }

    const weeklySalary = salary / 52;
    const esaNoticeWeeks = Math.min(8, Math.max(0, Math.floor(tenureYears)));
    const esaNoticePay = Math.round(esaNoticeWeeks * weeklySalary);
    // ESA severance: only if 5+ years and employer payroll >= $2.5M (we assume yes for estimate)
    const esaSeverancePay = tenureYears >= 5 ? Math.round(Math.min(26, tenureYears) * weeklySalary) : 0;

    // Common law reasonable notice (simplified Bardal estimate)
    const age = bardal.age ?? 45;
    const ageAdd = age >= 60 ? 4 : age >= 50 ? 3 : age >= 40 ? 2 : age >= 30 ? 1 : 0;
    const clLowMonths = Math.min(24, Math.max(1, Math.round(tenureYears + ageAdd * 0.4)));
    const clHighMonths = Math.min(24, Math.round(tenureYears * 1.3 + ageAdd + 1));
    const monthlySalary = salary / 12;
    const clLow = Math.round(monthlySalary * clLowMonths);
    const clHigh = Math.round(monthlySalary * clHighMonths);

    const totalLow = Math.max(esaNoticePay + esaSeverancePay, clLow);
    const totalHigh = clHigh;

    const analysis = {
      timeline: employment.timeline,
      gates: employment.gates,
      damagesEstimate: {
        esaNoticeWeeks,
        esaNoticePay,
        esaSeverancePay,
        commonLawLowMonths: clLowMonths,
        commonLawHighMonths: clHighMonths,
        commonLawLowAmount: clLow,
        commonLawHighAmount: clHigh,
        additionalHeads: [] as Array<{ name: string; basis: string; estimatedAmount?: number }>,
        totalEstimateLow: totalLow,
        totalEstimateHigh: totalHigh,
      },
      bardalFactors: bardal,
      limitationDeadline: limitation ?? { date: '', daysRemaining: 0, urgent: false },
      recommendedProcedure: recommendProcedure(totalHigh),
    };

    employment.analysis = analysis;
    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Analysis complete', {
      userId,
      matterId,
      triggeredGates: employment.gates.filter(g => g.triggered).length,
      estimatedDamagesHigh: totalHigh,
      recommendedProcedure: analysis.recommendedProcedure,
      limitationUrgent: limitation?.urgent ?? false,
    });

    return reply.send({ ok: true, analysis });
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

  // ── GET /api/employment/:matterId ──────────────────────────────────────
  // Get the full employment data for a matter, with a summary of every
  // generated document and its lifecycle status.

  fastify.get('/api/employment/:matterId', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }

    const { matter, employment } = loadEmploymentData(row.data_json);
    return reply.send({
      ok: true,
      data: employment,
      lawyerNotes: ((matter as Record<string, unknown>).lawyerNotes as string) ?? '',
      generatedDocuments: collectGeneratedDocuments(matter as Record<string, unknown>),
    });
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

  // ── POST /api/employment/extract ───────────────────────────────────────
  // Extract structured facts from an uploaded document via Claude.
  // The lawyer reviews and confirms each extracted field before saving.

  const extractBodySchema = z.object({
    matterId: z.string().min(1).max(200),
    documentContent: z.string().min(1).max(100_000),
    documentName: z.string().trim().min(1).max(500),
    documentKind: z.enum(UPLOADABLE_DOCUMENT_TYPES),
    /** Optional party names for anonymisation (e.g. employer name, client name). */
    definedTerms: z.array(z.string().max(200)).max(20).optional(),
  });

  fastify.post('/api/employment/extract', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';

    const parsed = extractBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn('Extract validation failed', { userId, issues: parsed.error.issues.map(i => i.path.join('.')) });
      return reply.status(400).send({ ok: false, error: 'Invalid request' });
    }

    const { matterId, documentContent, documentName, documentKind, definedTerms } = parsed.data;

    // Verify matter exists
    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }

    // Merge the matter's known party names into the anonymisation terms —
    // an uploaded termination letter contains the client's and employer's
    // names in plain text, and the caller may not have passed them.
    const { employment: existingEmployment } = loadEmploymentData(row.data_json);
    const partyTerms: string[] = [];
    const intake = existingEmployment.intake as Record<string, unknown> | undefined;
    if (intake?.client_first_name && intake?.client_last_name) {
      partyTerms.push(`${intake.client_first_name} ${intake.client_last_name}`);
      partyTerms.push(String(intake.client_last_name));
    }
    if (intake?.employer_legal_name) partyTerms.push(String(intake.employer_legal_name));
    if (intake?.employer_operating_name) partyTerms.push(String(intake.employer_operating_name));
    const mergedTerms = [...new Set([...(definedTerms ?? []), ...partyTerms])].slice(0, 20);

    // Extract facts via Claude (anonymised via crossProviderChat)
    const extraction = await extractEmploymentDocument(
      documentContent,
      documentName,
      documentKind,
      mergedTerms,
    );

    // Store extraction on the matter (lawyer reviews before confirming)
    const { matter, employment } = loadEmploymentData(row.data_json);
    employment.documentExtractions.push(extraction);

    // Collective agreements feed the grievance clocks: fill any blank CA
    // fields on the labour intake and recompute gates/timeline/deadlines.
    // Reviewer-entered values are never overwritten.
    let labourAutoFilled: string[] = [];
    const labour = matter.labourData as import('../../types/labour-intake.js').LabourMatterData | undefined;
    if (documentKind === 'collective_agreement' && labour?.intake) {
      const { applyCaExtraction } = await import('../../labour/ca-extraction.js');
      const { intake: updatedIntake, filled } = applyCaExtraction(labour.intake, extraction.extractedFields);
      if (filled.length > 0) {
        const { evaluateLabourGates, buildGrievanceTimeline, computeGrievanceDeadlines } = await import('../../labour/gate-evaluator.js');
        labour.intake = updatedIntake;
        labour.gates = evaluateLabourGates(updatedIntake);
        labour.timeline = buildGrievanceTimeline(updatedIntake);
        labour.analysis = {
          ...(labour.analysis ?? {}),
          deadlines: computeGrievanceDeadlines(updatedIntake),
          evaluatedAt: new Date().toISOString(),
        };
        matter.labourData = labour;
        labourAutoFilled = filled;
      }
    }

    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Document extracted', {
      userId,
      matterId,
      documentName,
      documentKind,
      fieldsExtracted: Object.keys(extraction.extractedFields).length,
      keyFindings: extraction.keyFindings.length,
      labourAutoFilled: labourAutoFilled.length > 0 ? labourAutoFilled : undefined,
    });

    return reply.send({ ok: true, extraction, labourAutoFilled });
  });

  // ── POST /api/employment/:matterId/demand-letter ───────────────────────
  // Generate a demand letter from the matter's intake data, approved issues,
  // and tone selection. The lawyer reviews and edits before finalising.

  const demandLetterBodySchema = z.object({
    tone: z.enum(TONE_OPTIONS).default('professional'),
    demandAmount: z.number().positive().max(99_999_999),
    lawyerName: z.string().trim().min(1).max(200),
    firmName: z.string().trim().min(1).max(200),
    firmAddress: z.string().trim().max(500).optional(),
    responseDeadlineDays: z.number().int().min(1).max(90).default(14),
  });

  fastify.post('/api/employment/:matterId/demand-letter', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = demandLetterBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn('Demand letter validation failed', { userId, issues: parsed.error.issues.map(i => i.path.join('.')) });
      return reply.status(400).send({ ok: false, error: 'Invalid request' });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }

    const { matter, employment } = loadEmploymentData(row.data_json);

    // Verify intake and analysis exist
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and run analysis before generating a demand letter.' });
    }

    // Verify at least one issue is approved
    if (employment.approvedIssues.length === 0) {
      return reply.status(400).send({ ok: false, error: 'Approve at least one legal issue before generating a demand letter.' });
    }

    // Build party names for anonymisation
    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);
    if (employment.intake.employer_operating_name) definedTerms.push(employment.intake.employer_operating_name);

    // Generate the demand letter
    const result = await generateDemandLetter({
      intake: employment.intake,
      gates: employment.gates,
      approvedIssues: employment.approvedIssues,
      analysis: employment.analysis,
      tone: parsed.data.tone,
      demandAmount: parsed.data.demandAmount,
      lawyerName: parsed.data.lawyerName,
      firmName: parsed.data.firmName,
      firmAddress: parsed.data.firmAddress,
      responseDeadlineDays: parsed.data.responseDeadlineDays,
    }, definedTerms);

    // Store the generated letter on the matter
    recordDraftHistory(matter as Record<string, unknown>, {
      docType: 'demand_letter', title: 'Demand Letter', html: sanitiseHtml(result.html),
      costUsd: result.costUsd, meta: { tone: parsed.data.tone, demandAmount: parsed.data.demandAmount },
    });
    (matter as Record<string, unknown>).generatedDemandLetter = {
      html: sanitiseHtml(result.html),
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      tone: parsed.data.tone,
      demandAmount: parsed.data.demandAmount,
      responseDeadlineDays: parsed.data.responseDeadlineDays,
      generatedAt: new Date().toISOString(),
      costUsd: result.costUsd,
      status: 'draft', // lawyer must review before finalising
    };
    employment.selectedTone = parsed.data.tone;
    employment.demandAmount = parsed.data.demandAmount;
    employment.selectedDocumentType = 'demand_letter';

    // Tickler: the response deadline goes on the matter timeline so the
    // dashboard docket and weekly digest can surface it
    const responseDue = new Date();
    responseDue.setDate(responseDue.getDate() + parsed.data.responseDeadlineDays);
    employment.timeline = addTimelineEvent(employment.timeline, {
      date: responseDue.toISOString().slice(0, 10),
      label: 'Demand letter response due',
      description: `${parsed.data.responseDeadlineDays}-day response deadline from the demand letter generated today. Follow up if no response.`,
      category: 'legal',
      source: 'system',
    });

    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Demand letter generated', {
      userId,
      matterId,
      tone: parsed.data.tone,
      demandAmount: parsed.data.demandAmount,
      htmlLength: result.html.length,
      reviewFlags: result.lawyerReviewFlags.length,
    });

    return reply.send({
      ok: true,
      html: sanitiseHtml(result.html),
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      costUsd: result.costUsd,
    });
  });

  // ── POST /api/employment/:matterId/statement-of-claim ──────────────────
  // Generate a Statement of Claim (Form 14A or 7A) or override procedure type.

  const socBodySchema = z.object({
    procedureType: z.enum(PROCEDURE_TYPES),
    claimAmount: z.number().positive().max(99_999_999),
    lawyerName: z.string().trim().min(1).max(200),
    firmName: z.string().trim().min(1).max(200),
    firmAddress: z.string().trim().max(500).optional(),
    courtLocation: z.string().trim().min(1).max(200),
  });

  fastify.post('/api/employment/:matterId/statement-of-claim', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = socBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid request' });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and analysis first.' });
    }
    if (employment.approvedIssues.length === 0) {
      return reply.status(400).send({ ok: false, error: 'Approve at least one legal issue first.' });
    }

    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);

    const result = await generateStatementOfClaim({
      intake: employment.intake,
      approvedIssues: employment.approvedIssues,
      analysis: employment.analysis,
      procedureType: parsed.data.procedureType,
      claimAmount: parsed.data.claimAmount,
      lawyerName: parsed.data.lawyerName,
      firmName: parsed.data.firmName,
      firmAddress: parsed.data.firmAddress,
      courtLocation: parsed.data.courtLocation,
    }, definedTerms);

    recordDraftHistory(matter as Record<string, unknown>, {
      docType: 'statement_of_claim', title: 'Statement of Claim', html: sanitiseHtml(result.html),
      costUsd: result.costUsd, meta: { procedureType: result.procedureType, claimAmount: parsed.data.claimAmount },
    });
    (matter as Record<string, unknown>).generatedSOC = {
      html: sanitiseHtml(result.html),
      procedureType: result.procedureType,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      claimAmount: parsed.data.claimAmount,
      generatedAt: new Date().toISOString(),
      costUsd: result.costUsd,
      status: 'draft',
    };
    employment.selectedProcedure = parsed.data.procedureType;
    employment.selectedDocumentType = 'statement_of_claim';

    await saveEmploymentData(userId, matterId, matter, employment);

    return reply.send({
      ok: true,
      html: sanitiseHtml(result.html),
      procedureType: result.procedureType,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      costUsd: result.costUsd,
    });
  });

  // ── POST /api/employment/:matterId/application ─────────────────────────
  // Generate a Notice of Application, HRTO Application, or ESA Complaint.

  const APPLICATION_TYPES = ['notice_of_application', 'hrto_application', 'esa_complaint'] as const;

  const applicationBodySchema = z.object({
    applicationType: z.enum(APPLICATION_TYPES),
    claimAmount: z.number().positive().max(99_999_999).optional(),
    lawyerName: z.string().trim().min(1).max(200),
    firmName: z.string().trim().min(1).max(200),
    firmAddress: z.string().trim().max(500).optional(),
    courtLocation: z.string().trim().max(200).optional(),
  });

  fastify.post('/api/employment/:matterId/application', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = applicationBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid request' });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and analysis first.' });
    }

    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);

    const result = await generateApplication({
      intake: employment.intake,
      approvedIssues: employment.approvedIssues,
      analysis: employment.analysis,
      applicationType: parsed.data.applicationType as ApplicationType,
      claimAmount: parsed.data.claimAmount,
      lawyerName: parsed.data.lawyerName,
      firmName: parsed.data.firmName,
      firmAddress: parsed.data.firmAddress,
      courtLocation: parsed.data.courtLocation,
    }, definedTerms);

    recordDraftHistory(matter as Record<string, unknown>, {
      docType: parsed.data.applicationType, title: result.formName, html: sanitiseHtml(result.html),
      costUsd: result.costUsd,
    });
    (matter as Record<string, unknown>).generatedApplication = {
      html: sanitiseHtml(result.html),
      applicationType: result.applicationType,
      formName: result.formName,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      generatedAt: new Date().toISOString(),
      costUsd: result.costUsd,
      status: 'draft',
    };
    employment.selectedDocumentType = parsed.data.applicationType === 'notice_of_application'
      ? 'notice_of_application'
      : parsed.data.applicationType === 'hrto_application'
        ? 'hrto_application'
        : 'esa_complaint';

    await saveEmploymentData(userId, matterId, matter, employment);

    return reply.send({
      ok: true,
      html: sanitiseHtml(result.html),
      applicationType: result.applicationType,
      formName: result.formName,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      costUsd: result.costUsd,
    });
  });

  // ── POST /api/employment/:matterId/litigation-document ──────────────────
  // Generate a discovery plan, affidavit of documents, or mediation brief.

  const LITIGATION_DOC_TYPES = ['discovery_plan', 'affidavit_of_documents', 'mediation_brief', 'severance_assessment', 'counter_offer', 'reply', 'rule49_offer', 'settlement_minutes', 'retainer_agreement', 'mitigation_log', 'settlement_conference_brief', 'hrto_schedule_a', 'notice_of_action', 'sj_notice_of_motion', 'sj_affidavit', 'sj_factum', 'affidavit_of_service', 'rule49_withdrawal', 'rule49_acceptance', 'costs_outline'] as const;

  const litigationDocBodySchema = z.object({
    documentType: z.enum(LITIGATION_DOC_TYPES),
    claimAmount: z.number().positive().max(99_999_999).optional(),
    lawyerName: z.string().trim().min(1).max(200),
    firmName: z.string().trim().min(1).max(200),
    firmAddress: z.string().trim().max(500).optional(),
    courtLocation: z.string().trim().max(200).optional(),
    additionalContext: z.string().trim().max(5000).optional(),
    /** Structured inputs for the deterministic court forms. */
    formFields: z.record(z.string().max(60), z.union([z.string().max(3000), z.number()])).optional(),
  });

  fastify.post('/api/employment/:matterId/litigation-document', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = litigationDocBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid request' });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and analysis first.' });
    }

    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);

    const COURT_FORM_TYPES = ['affidavit_of_service', 'rule49_withdrawal', 'rule49_acceptance', 'costs_outline'];
    let result;
    try {
      result = await generateLitigationDocument({
        intake: employment.intake,
        approvedIssues: employment.approvedIssues,
        analysis: employment.analysis,
        documentType: parsed.data.documentType as LitigationDocumentType,
        claimAmount: parsed.data.claimAmount,
        lawyerName: parsed.data.lawyerName,
        firmName: parsed.data.firmName,
        firmAddress: parsed.data.firmAddress,
        courtLocation: parsed.data.courtLocation,
        additionalContext: parsed.data.additionalContext,
        formFields: parsed.data.formFields,
      }, definedTerms);
    } catch (err) {
      // Deterministic court forms validate their inputs and fail with a
      // plain message the lawyer can act on.
      if (COURT_FORM_TYPES.includes(parsed.data.documentType)) {
        return reply.status(400).send({ ok: false, error: err instanceof Error ? err.message : 'Form inputs are incomplete.' });
      }
      throw err;
    }

    // Store on the matter
    recordDraftHistory(matter as Record<string, unknown>, {
      docType: parsed.data.documentType, title: result.documentTitle, html: sanitiseHtml(result.html),
      costUsd: result.costUsd,
    });
    const docKey = `generated_${parsed.data.documentType}`;
    (matter as Record<string, unknown>)[docKey] = {
      html: sanitiseHtml(result.html),
      documentType: result.documentType,
      documentTitle: result.documentTitle,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      generatedAt: new Date().toISOString(),
      costUsd: result.costUsd,
      status: 'draft',
    };

    await saveEmploymentData(userId, matterId, matter, employment);

    return reply.send({
      ok: true,
      html: sanitiseHtml(result.html),
      documentType: result.documentType,
      documentTitle: result.documentTitle,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      costUsd: result.costUsd,
    });
  });

  // ── GET /api/employment/:matterId/download/:docType ────────────────────
  // Download a generated document as DOCX.

  fastify.get('/api/employment/:matterId/download/:docType', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId, docType } = req.params as { matterId: string; docType: string };

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const matterData = JSON.parse(row.data_json) as Record<string, unknown>;
    const employment = (matterData.employmentData as EmploymentMatterData) ?? null;

    const firmId = (req as { firmId?: string }).firmId ?? 'local-firm';
    let html: string | null = null;
    let title = '';

    // Extract firm/lawyer name from the most recent generated document
    const genDL = matterData.generatedDemandLetter as Record<string, unknown> | undefined;
    const genSOC = matterData.generatedSOC as Record<string, unknown> | undefined;
    const firmName = (genDL?.firmName as string) ?? (genSOC?.firmName as string) ?? '';
    const lawyerName = (genDL?.lawyerName as string) ?? (genSOC?.lawyerName as string) ?? '';

    if (docType === 'demand-letter') {
      if (!genDL?.html) return reply.status(404).send({ ok: false, error: 'No demand letter generated yet.' });
      html = genDL.html as string;
      const clientName = employment ? `${employment.intake?.client_last_name ?? ''}` : '';
      const employerName = employment?.intake?.employer_legal_name ?? '';
      title = `Demand Letter${clientName ? ` re ${clientName}` : ''}${employerName ? ` v. ${employerName}` : ''}`;
    } else if (docType === 'statement-of-claim') {
      const soc = matterData.generatedSOC as Record<string, unknown> | undefined;
      if (!soc?.html) return reply.status(404).send({ ok: false, error: 'No statement of claim generated yet.' });
      html = soc.html as string;
      title = `Statement of Claim${employment?.intake?.client_last_name ? ` re ${employment.intake.client_last_name} v. ${employment.intake.employer_legal_name ?? 'Defendant'}` : ''}`;
    } else if (docType === 'application') {
      const app = matterData.generatedApplication as Record<string, unknown> | undefined;
      if (!app?.html) return reply.status(404).send({ ok: false, error: 'No application generated yet.' });
      html = app.html as string;
      title = (app.formName as string) ?? 'Application';
    } else if (['discovery-plan', 'affidavit-of-documents', 'mediation-brief', 'severance-assessment', 'counter-offer', 'reply', 'rule49-offer', 'settlement-minutes', 'retainer-agreement', 'mitigation-log', 'settlement-conference-brief', 'hrto-schedule-a', 'grievance-filing', 'referral-to-arbitration', 'arbitration-brief', 'dfr-response', 'merits-assessment', 'decline-letter', 'member-update', 'remedy-worksheet', 'notice-of-action', 'sj-notice-of-motion', 'sj-affidavit', 'sj-factum', 'affidavit-of-service', 'rule49-withdrawal', 'rule49-acceptance', 'costs-outline', 'particulars', 'production-request', 'settlement-memorandum', 'ohsa-reprisal-complaint'].includes(docType)) {
      const key = `generated_${docType.replace(/-/g, '_')}`;
      const litDoc = matterData[key] as Record<string, unknown> | undefined;
      if (!litDoc?.html) return reply.status(404).send({ ok: false, error: `No ${docType.replace(/-/g, ' ')} generated yet.` });
      html = litDoc.html as string;
      title = (litDoc.documentTitle as string) ?? docType.replace(/-/g, ' ');
    } else {
      return reply.status(400).send({ ok: false, error: 'Invalid document type. Use: demand-letter, statement-of-claim, application, discovery-plan, affidavit-of-documents, or mediation-brief.' });
    }

    const docTypeMap: Record<string, string> = {
      'demand-letter': 'demand_letter',
      'statement-of-claim': 'statement_of_claim',
      'application': 'notice_of_application',
      'discovery-plan': 'discovery_plan',
      'affidavit-of-documents': 'affidavit_of_documents',
      'mediation-brief': 'mediation_brief',
      'severance-assessment': 'severance_assessment',
      'counter-offer': 'counter_offer',
      'reply': 'reply',
      'rule49-offer': 'rule49_offer',
      'settlement-minutes': 'settlement_minutes',
      'retainer-agreement': 'retainer_agreement',
      'mitigation-log': 'mitigation_log',
      'settlement-conference-brief': 'settlement_conference_brief',
      'hrto-schedule-a': 'hrto_schedule_a',
      'grievance-filing': 'grievance_filing',
      'referral-to-arbitration': 'referral_to_arbitration',
      'arbitration-brief': 'arbitration_brief',
      'dfr-response': 'dfr_response',
      'merits-assessment': 'merits_assessment',
      'decline-letter': 'decline_letter',
      'member-update': 'member_update',
      'remedy-worksheet': 'remedy_worksheet',
      'notice-of-action': 'notice_of_action',
      'sj-notice-of-motion': 'sj_notice_of_motion',
      'sj-affidavit': 'sj_affidavit',
      'sj-factum': 'sj_factum',
      'affidavit-of-service': 'affidavit_of_service',
      'rule49-withdrawal': 'rule49_withdrawal',
      'rule49-acceptance': 'rule49_acceptance',
      'costs-outline': 'costs_outline',
      'particulars': 'particulars',
      'production-request': 'production_request',
      'settlement-memorandum': 'settlement_memorandum',
      'ohsa-reprisal-complaint': 'ohsa_reprisal_complaint',
    };

    const buffer = await htmlToDocx(html, {
      title,
      firmName,
      lawyerName,
      firmId,
      documentType: docTypeMap[docType],
      intake: employment?.intake ? {
        client_first_name: employment.intake.client_first_name,
        client_last_name: employment.intake.client_last_name,
        client_address: employment.intake.client_address,
        employer_legal_name: employment.intake.employer_legal_name,
        employer_address: employment.intake.employer_address,
      } : undefined,
    });

    const filename = `${title.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim()}.docx`;

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });

  // ── POST /api/employment/templates ─────────────────────────────────────
  // Upload or update a firm's DOCX template for a specific document type.

  fastify.post('/api/employment/templates', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = templateUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid template upload' });
    }

    const { documentType, name, templateBase64 } = parsed.data;
    // Prefer the authenticated user's firm — the body value is a legacy fallback
    const firmId = (req as { firmId?: string }).firmId ?? parsed.data.firmId ?? 'local-firm';

    // Decode base64 to detect placeholders in the template text
    let templateText = '';
    try {
      templateText = Buffer.from(templateBase64, 'base64').toString('utf-8');
    } catch {
      // Binary DOCX — placeholder detection will work on the raw bytes
      templateText = templateBase64;
    }
    const placeholders = detectPlaceholders(templateText);

    const id = `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    saveFirmTemplate(id, firmId, documentType, name, templateBase64, placeholders);

    logger.info('Template uploaded', { firmId, documentType, name, placeholders: placeholders.length });

    return reply.send({
      ok: true,
      templateId: id,
      placeholders,
    });
  });

  // ── GET /api/employment/templates ──────────────────────────────────────
  // List the requesting user's firm templates. Once uploaded, a template is
  // the firm default for its document type across ALL matters.

  fastify.get('/api/employment/templates', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = (req as { firmId?: string }).firmId ?? 'local-firm';
    const templates = getFirmTemplates(firmId);

    return reply.send({
      ok: true,
      templates: templates.map(t => ({
        id: t.id,
        documentType: t.document_type,
        name: t.name,
        placeholders: JSON.parse(t.placeholders),
        uploadedAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  });

  // ── DELETE /api/employment/templates/:documentType ─────────────────────
  // Remove the requesting user's firm template for a document type.

  fastify.delete('/api/employment/templates/:documentType', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = (req as { firmId?: string }).firmId ?? 'local-firm';
    const { documentType } = req.params as { documentType: string };
    deleteFirmTemplate(firmId, documentType);
    logger.info('Template deleted', { firmId, documentType });
    return reply.send({ ok: true });
  });

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
      const { getUserById } = await import('../../db/database.js');
      const user = getUserById(userId);
      if (user?.profile_json) {
        const profile = JSON.parse(user.profile_json) as Record<string, unknown>;
        rep = { lawyerName: user.display_name ?? undefined, lsoNumber: (profile.lsoNumber as string) || undefined };
      }
    } catch { /* profile is best-effort */ }

    const { buildForm1DatasetsXml, form1DataFilename } = await import('../../employment/hrto-form1-data.js');
    const xml = buildForm1DatasetsXml(employment.intake, rep);

    logAuditForm1(userId, matterId);
    return reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${form1DataFilename(employment.intake)}"`)
      .send(xml);
  });

  function logAuditForm1(userId: string, matterId: string): void {
    logger.info('Form 1 data file generated', { userId, matterId });
  }

  // ── GET /api/employment/:matterId/drafts ────────────────────────────────
  // Draft version history — every generated document, newest first.

  fastify.get('/api/employment/:matterId/drafts', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    const drafts = Array.isArray(matter.draftHistory) ? matter.draftHistory : [];
    return reply.send({ ok: true, drafts });
  });

  // ── POST /api/employment/:matterId/client-update ────────────────────────
  // Draft a plain-language client status update from the matter's timeline
  // and current state, in the client-communications voice. The lawyer
  // reviews and sends it themselves — Starling never contacts clients.

  const clientUpdateBodySchema = z.object({
    /** Anything the lawyer wants emphasised or added (optional). */
    additionalContext: z.string().trim().max(3000).optional(),
  });

  fastify.post('/api/employment/:matterId/client-update', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = clientUpdateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid request' });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const intake = employment.intake as Record<string, unknown> | undefined;
    if (!intake) {
      return reply.status(400).send({ ok: false, error: 'Complete intake before drafting a client update.' });
    }

    const clientFirst = String(intake.client_first_name ?? 'the client');
    const definedTerms: string[] = [];
    if (intake.client_first_name && intake.client_last_name) {
      definedTerms.push(`${intake.client_first_name} ${intake.client_last_name}`);
    }
    if (intake.employer_legal_name) definedTerms.push(String(intake.employer_legal_name));

    const recentEvents = (employment.timeline ?? []).slice(-8)
      .map(ev => `- ${ev.date}: ${ev.label}${ev.description ? ` (${ev.description})` : ''}`)
      .join('\n');
    const generated: string[] = [];
    if ((matter as Record<string, unknown>).generatedDemandLetter) generated.push('demand letter (drafted)');
    if ((matter as Record<string, unknown>).generatedSOC) generated.push('Statement of Claim (drafted)');
    if ((matter as Record<string, unknown>).generatedApplication) generated.push('application (drafted)');

    const { crossProviderChat } = await import('../../providers/cross-provider-chat.js');
    try {
      const result = await crossProviderChat({
        system: `You draft client update emails for a plaintiff-side Ontario employment law firm. Voice: warm, professional, plain language; job loss is one of life's most stressful events and your reader is living it. Lead with the bottom line. Explain what happened, what it means, what happens next, and any dates the client must know. Use dollar amounts, not legal formulas. Never over-promise outcomes. Give no legal advice beyond describing the status of this matter. End by inviting questions. This is a DRAFT for the lawyer to review, edit, and send. Never reference Starling or AI. Do not use em dashes; use commas, colons, semicolons, or parentheses instead. Output clean HTML (p, strong, ul/li only).`,
        user: `Draft a status update email to ${clientFirst}.

MATTER STATE:
- Stage: ${String((matter as Record<string, unknown>).status ?? 'active')}
- Documents prepared so far: ${generated.join(', ') || 'none yet'}
${employment.analysis ? '- Analysis complete: entitlements assessed' : '- Analysis pending'}

RECENT TIMELINE:
${recentEvents || '- Matter opened; work is underway'}
${parsed.data.additionalContext ? `\nLAWYER'S NOTES FOR THIS UPDATE:\n${parsed.data.additionalContext}` : ''}`,
        tier: 'sonnet',
        maxTokens: 1500,
        temperature: 0.5,
        definedTerms,
      });

      const html = sanitiseHtml(result.text);
      (matter as Record<string, unknown>).generatedClientUpdate = {
        html,
        generatedAt: new Date().toISOString(),
        costUsd: result.cost,
      };
      await saveEmploymentData(userId, matterId, matter, employment);

      logger.info('Client update drafted', { userId, matterId, costUsd: result.cost.toFixed(4) });
      return reply.send({ ok: true, html, costUsd: result.cost });
    } catch (err) {
      logger.error('Client update generation failed', { matterId, error: err instanceof Error ? err.message : String(err) });
      return reply.status(500).send({ ok: false, error: 'Draft generation failed. Please try again.' });
    }
  });

  // ── POST /api/employment/:matterId/document-status ──────────────────────
  // Advance a generated document through its lifecycle: draft → reviewed →
  // sent or filed. The docket reacts where the status carries a real-world
  // date: marking a demand letter sent recomputes the response tickler from
  // the date of sending rather than the date of generation.

  const documentStatusSchema = z.object({
    docType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    status: z.enum(DOCUMENT_STATUSES),
    /** The real-world date of the event (date sent, date filed). Defaults to today. */
    date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional(),
  });

  fastify.post('/api/employment/:matterId/document-status', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = documentStatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid status update' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const key = findGeneratedDocKey(matter as Record<string, unknown>, parsed.data.docType);
    if (!key) return reply.status(404).send({ ok: false, error: 'No generated document of that type on this matter.' });

    const doc = (matter as Record<string, unknown>)[key] as Record<string, unknown>;
    const statusDate = parsed.data.date ?? new Date().toISOString().slice(0, 10);
    doc.status = parsed.data.status;
    doc.statusDate = statusDate;
    const history = Array.isArray(doc.statusHistory) ? doc.statusHistory as Array<Record<string, unknown>> : [];
    history.push({ status: parsed.data.status, date: statusDate, recordedAt: new Date().toISOString() });
    doc.statusHistory = history.slice(-20);

    // A demand letter marked sent starts the response clock from the date
    // of sending; the generation-time tickler was a conservative default.
    if (parsed.data.docType === 'demand_letter' && parsed.data.status === 'sent') {
      const deadlineDays = typeof doc.responseDeadlineDays === 'number' ? doc.responseDeadlineDays : 14;
      const due = new Date(`${statusDate}T00:00:00`);
      due.setDate(due.getDate() + deadlineDays);
      const dueIso = due.toISOString().slice(0, 10);
      employment.timeline = [
        ...employment.timeline.filter(ev => ev.label !== 'Demand letter response due'),
        {
          date: dueIso,
          label: 'Demand letter response due',
          description: `${deadlineDays}-day response deadline from the demand letter sent on ${statusDate}. Follow up if no response.`,
          category: 'legal' as const,
          source: 'system' as const,
        },
      ].sort((a, b) => a.date.localeCompare(b.date));
    }

    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Document status updated', { userId, matterId, docType: parsed.data.docType, status: parsed.data.status, statusDate });
    return reply.send({
      ok: true,
      docType: parsed.data.docType,
      status: parsed.data.status,
      statusDate,
      generatedDocuments: collectGeneratedDocuments(matter as Record<string, unknown>),
    });
  });

  // ── Canon library ────────────────────────────────────────────────────────
  // Full texts of the citation-canon decisions, with provenance. Once a
  // case's text is on file, quotations and pinpoint references in every
  // generated document are verified against the actual words of the case.

  fastify.get('/api/employment/canon-texts', async (_req: FastifyRequest, reply: FastifyReply) => {
    const { listCanonTexts } = await import('../../employment/canon-store.js');
    const { CITATION_CANON } = await import('../../employment/citation-canon.js');
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
      const { saveCanonText } = await import('../../employment/canon-store.js');
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
    const { checkCitationIntegrity, checkFillInPlaceholders } = await import('../../employment/citation-canon.js');
    const { checkCanonTextIntegrity } = await import('../../employment/canon-verifier.js');
    const flags = [
      ...checkCitationIntegrity(parsed.data.html, parsed.data.excludeParties ?? []),
      ...checkCanonTextIntegrity(parsed.data.html),
      ...checkFillInPlaceholders(parsed.data.html),
    ];
    return reply.send({ ok: true, flags, clean: flags.length === 0 });
  });

  // ── POST /api/employment/:matterId/notes ───────────────────────────────
  // Save lawyer notes on a matter.

  const notesBodySchema = z.object({
    notes: z.string().trim().max(50000),
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

    const { matter, employment } = loadEmploymentData(row.data_json);
    (matter as Record<string, unknown>).lawyerNotes = parsed.data.notes;
    await saveEmploymentData(userId, matterId, matter, employment);

    return reply.send({ ok: true });
  });
}
