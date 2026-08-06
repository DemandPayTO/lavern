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
import sanitizeHtmlLib from 'sanitize-html';
import { config } from '../../config.js';
import { employmentIntakeSchema, createEmploymentMatterData } from '../../types/employment-intake.js';
import type { EmploymentMatterData, EmploymentIntakeData, TimelineEvent, DocumentExtractionResult } from '../../types/employment-intake.js';
import { evaluateGates, getTriggeredIssueCodes } from '../../employment/gate-evaluator.js';
import { DEMAND_SOURCE_KINDS, isDemandSourceKind } from '../../employment/demand-sources.js';
import {
  INSTRUCTION_KINDS, MAX_NOTES_CHARS, MAX_INSTRUCTIONS,
  directionContext, effectiveInstructions, checkDirectionTerms, departureFlags,
  DEPARTURE_CHECK_SYSTEM, buildDepartureCheckPrompt, extractLawyerNote,
} from '../../employment/direction.js';
import type { MatterFacts } from '../../employment/precedent-alignment.js';
import { rebuildTimelinePreserving, computeLimitationDeadline, computeBardalFactors, recommendProcedure, addTimelineEvent } from '../../employment/timeline-generator.js';
import { saveMatter, getMatterById, getMattersByUser, saveFirmTemplate, getFirmTemplates, getFirmTemplate, deleteFirmTemplate, setDefaultFirmTemplate, saveStyleProfile, getStyleProfiles, getStyleProfile, updateStyleProfile, deleteStyleProfile, recordUsageEvent, getUserById } from '../../db/database.js';
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

/**
 * Sanitiser for generated-document HTML before it is stored and rendered in
 * the dashboard via dangerouslySetInnerHTML.
 *
 * This was a regex blacklist until 2026-08-04. A blacklist cannot be made
 * correct: the security review found live bypasses that all turned on the
 * handler rules requiring literal whitespace before the attribute, so
 * `<img src="x"onerror="...">` and `<details/open/ontoggle=...>` survived,
 * as did `javascript:` URLs containing a quote or an entity-encoded scheme.
 * The tag rule also covered only script/iframe/object/embed/link/meta/base,
 * leaving img, svg, details and form to pass through as tags.
 *
 * It is now an allowlist over the same library the review lane already uses:
 * anything not named here cannot survive, so a novel vector is refused by
 * default rather than needing a new rule. The allowed set is exactly what
 * the generators actually emit (verified against the eval-results corpus):
 * headings, paragraphs, lists, tables, and inline emphasis — plus `class`,
 * which the court-format CSS keys on, and `start`, which carries numbered
 * pleading paragraphs across list breaks.
 */
/**
 * The caller's firm, from the authenticated identity only.
 *
 * Returns undefined when the account has no firm — firm-scoped routes must
 * deny rather than fall back to a shared bucket. In LOCAL MODE (auth off)
 * the synthetic local user carries 'local-firm' from the middleware.
 */
export function resolveFirmId(req: unknown): string | undefined {
  const firmId = (req as { firmId?: string }).firmId;
  return firmId && firmId.trim() ? firmId : undefined;
}

export function sanitiseHtml(html: string): string {
  return sanitizeHtmlLib(html, {
    allowedTags: [
      'h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'div', 'span', 'br', 'hr',
      'strong', 'b', 'em', 'i', 'u', 's', 'sub', 'sup', 'small',
      'blockquote', 'pre', 'code',
      'ul', 'ol', 'li', 'dl', 'dt', 'dd',
      'table', 'thead', 'tbody', 'tfoot', 'tr', 'th', 'td', 'caption', 'colgroup', 'col',
      'a',
    ],
    allowedAttributes: {
      // The court-format stylesheet keys on class (.numbered); `start` keeps
      // numbered pleading paragraphs running across a list break.
      '*': ['class'],
      ol: ['class', 'start', 'type'],
      li: ['class', 'value'],
      a: ['href', 'title'],
      td: ['class', 'colspan', 'rowspan'],
      th: ['class', 'colspan', 'rowspan', 'scope'],
      col: ['span'],
      table: ['class'],
    },
    // http/https/mailto only. Blocks javascript:, data: and vbscript:
    // however they are written, including entity-encoded and quoted forms
    // that defeated the old scheme regex.
    allowedSchemes: ['http', 'https', 'mailto'],
    allowedSchemesAppliedToAttributes: ['href'],
    disallowedTagsMode: 'discard',
    // Inline styles carry their own vectors and the generators do not emit
    // them (verified against the eval-results corpus).
    allowedStyles: {},
  });
}

// ── Helpers ──────────────────────────────────────────────────────────────

/** Load a matter's employment data, or create a fresh one if none exists. */
export function loadEmploymentData(matterDataJson: string): { matter: Record<string, unknown>; employment: EmploymentMatterData } {
  const matter = JSON.parse(matterDataJson) as Record<string, unknown>;
  const employment = (matter.employmentData as EmploymentMatterData) ?? createEmploymentMatterData();
  return { matter, employment };
}

/** Persist employment data back onto the matter record. */
export async function saveEmploymentData(
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
  usage?: { userId: string; matterId: string },
): void {
  const history = Array.isArray(matter.draftHistory) ? matter.draftHistory as Array<Record<string, unknown>> : [];
  history.unshift({ ...entry, generatedAt: new Date().toISOString() });
  matter.draftHistory = history.slice(0, DRAFT_HISTORY_CAP);
  // Durable usage ledger for usage-based pricing (draftHistory caps at 10).
  if (usage) {
    try {
      recordUsageEvent(usage.userId, usage.matterId, 'generation', entry.docType, entry.costUsd);
    } catch { /* metering must never fail a generation */ }
  }
}

// ── Generated-document lifecycle ─────────────────────────────────────────
// Generated documents live on the matter under legacy camel-case keys
// (generatedDemandLetter, generatedSOC, generatedApplication) and the
// generated_<type> pattern shared by the litigation and labour routes.
// Each carries a lifecycle status: draft → reviewed → sent or filed.

export const DOCUMENT_STATUSES = ['draft', 'reviewed', 'sent', 'filed'] as const;

/** Revision item kinds, as a zod-friendly literal tuple. */
const REVISION_KIND_VALUES = ['factual_correction', 'position_change', 'wording', 'needs_lawyer'] as const;

/** Rejoin revised paragraphs into document html. */
function fromParagraphsSafe(rl: { fromParagraphs: (p: string[]) => string }, paragraphs: string[]): string {
  return rl.fromParagraphs(paragraphs);
}
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
export function findGeneratedDocKey(matter: Record<string, unknown>, docType: string): string | null {
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

/**
 * Load a firm style profile for a generation request: the prompt context,
 * the identifier list for the bleed scan, and the structured fields.
 * Returns an error string instead of throwing so routes can 4xx cleanly.
 */
async function loadStyleForGeneration(
  req: unknown,
  styleProfileId: string,
  documentType: string,
): Promise<
  | { error: string; status: number }
  | {
      context: string; identifiers: string[]; label: string; typicalWords?: number;
      profileTableRows?: string[]; flowHeadings?: string[];
      /** The guide itself, for callers that reproduce the firm's own wording. */
      guide?: import('../../employment/style-profile.js').StyleGuide;
    }
> {
  const firmId = resolveFirmId(req);
  const profile = firmId ? getStyleProfile(firmId, styleProfileId) : undefined;
  if (!profile) return { error: 'Style profile not found.', status: 404 };
  if (profile.document_type !== documentType) {
    return { error: 'That style profile is for a different document type.', status: 400 };
  }
  const { styleContextForPrompt, styleGuideSchema, usableFlow } = await import('../../employment/style-profile.js');
  const guide = styleGuideSchema.safeParse(JSON.parse(profile.guide_json));
  if (!guide.success) return { error: 'The stored style profile is unreadable. Rebuild it.', status: 500 };
  let identifiers: string[] = [];
  try { identifiers = JSON.parse(profile.identifiers_json) as string[]; } catch { identifiers = []; }
  return {
    context: styleContextForPrompt(guide.data, profile.label),
    identifiers,
    label: profile.label,
    typicalWords: guide.data.typicalWords,
    profileTableRows: guide.data.profileTableRows,
    flowHeadings: usableFlow(guide.data.flow).map(f => f.heading),
    guide: guide.data,
  };
}

/**
 * The direction that binds a draft: the file's, then this document's.
 *
 * Every generator reads this, so the partner's instruction on the file
 * reaches the letter, the claim and the brief without being retyped into
 * each one.
 */
function directionForGeneration(matter: unknown, documentType: string): {
  context: string;
  instructions: Array<{ id: string; text: string; kind: string; mustInclude?: string[]; mustNotInclude?: string[] }>;
} {
  const direction = ((matter as Record<string, unknown>).direction ?? {}) as {
    matter?: { instructions?: unknown[] };
    byDocument?: Record<string, { instructions?: unknown[] }>;
  };
  const args = {
    matter: direction.matter as never,
    document: direction.byDocument?.[documentType] as never,
  };
  return {
    context: directionContext(args),
    instructions: effectiveInstructions(args) as never,
  };
}

/**
 * Apply the direction's aftermath to a generated result: lift the drafter's
 * note out of the document, then check the draft against the instructions.
 * Mutates the result the way the call sites already expect.
 */
async function applyDirectionAftermath(
  result: { html: string; lawyerReviewFlags?: string[] },
  direction: { instructions: Array<{ id: string; text: string; kind: string; mustInclude?: string[]; mustNotInclude?: string[] }> },
): Promise<void> {
  const { html, note } = extractLawyerNote(result.html);
  result.html = html;
  result.lawyerReviewFlags = [
    ...(result.lawyerReviewFlags ?? []),
    ...(note ? [`The drafter left a note for you rather than putting it in the document: ${note}`] : []),
    ...await directionDepartureFlags(html, direction.instructions),
  ];
}

/**
 * Did the draft follow the direction?
 *
 * The literal half runs always: terms that must or must not appear are
 * exact, free and instant. The judgment half is a compact review pass, and
 * it is best-effort by design, since a checker that fails must not fail
 * the generation the lawyer has already paid for.
 */
async function directionDepartureFlags(
  html: string,
  instructions: Array<{ id: string; text: string; kind: string; mustInclude?: string[]; mustNotInclude?: string[] }>,
): Promise<string[]> {
  if (instructions.length === 0) return [];
  const flags = [...checkDirectionTerms(html, instructions as never)];

  try {
    const { crossProviderChat } = await import('../../providers/cross-provider-chat.js');
    const result = await crossProviderChat({
      system: DEPARTURE_CHECK_SYSTEM,
      user: buildDepartureCheckPrompt(html, instructions as never),
      tier: 'sonnet',
      maxTokens: 2048,
      maxRetries: 1,
    });
    let jsonText = result.text.trim();
    const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonText = fenced[1].trim();
    const braced = jsonText.match(/\{[\s\S]*\}/);
    const parsed = JSON.parse(braced ? braced[0] : jsonText) as {
      verdicts?: Array<{ instruction: string; followed: boolean; departure?: string }>;
    };
    // Do not repeat what the literal check already said.
    const already = new Set(flags);
    for (const flag of departureFlags(parsed.verdicts ?? [])) {
      if (![...already].some(a => a.includes(flag.slice(0, 60)))) flags.push(flag);
    }
  } catch (err) {
    logger.warn('Direction departure check failed', { error: err instanceof Error ? err.message : String(err) });
  }
  return flags;
}

/**
 * The precedent-bleed review flags for a styled generation, plus the
 * standing read-it-against-an-example reminder.
 */
async function styleReviewFlags(
  html: string,
  identifiers: string[],
  label: string,
  intake: Record<string, unknown>,
  amount?: number,
): Promise<string[]> {
  const { checkPrecedentBleed } = await import('../../employment/style-profile.js');
  const matterValues = [
    [intake.client_first_name, intake.client_last_name].filter(Boolean).join(' '),
    String(intake.employer_legal_name ?? ''),
    String(intake.employer_operating_name ?? ''),
    ...(amount ? [`$${Number(amount).toLocaleString('en-CA')}`] : []),
  ];
  return [
    ...checkPrecedentBleed(html, identifiers, matterValues),
    `Drafted in the firm style "${label}". Read it against a recent example: style profiles guide the draft, they do not guarantee it.`,
  ];
}

/**
 * Recompute the deterministic analysis (timeline, gates, damages, Bardal,
 * limitation, procedure) from the CURRENT intake, in place, and stamp when
 * it happened. Called by the analyze route, and by the generation routes
 * whenever the intake is newer than the analysis, so stale figures never
 * feed a document silently. No model call.
 */
function recomputeAnalysis(employment: EmploymentMatterData): void {
  const intake = employment.intake;

  // Timeline (preserving rebuild — lawyer entries and ticklers survive)
  employment.timeline = rebuildTimelinePreserving(employment.timeline, intake);

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

  employment.analysis = {
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
  employment.analysisRevisedAt = new Date().toISOString();
}

/**
 * The generation-time freshness guard: when the intake changed after the
 * analysis was computed, recompute before drafting. Deterministic and
 * cheap, so silently doing the right thing beats refusing.
 * Returns true when a recompute happened (surfaced to the lawyer).
 */
function ensureAnalysisFresh(employment: EmploymentMatterData): boolean {
  if (!employment.analysis) return false;
  const revised = employment.intakeRevisedAt;
  const analysed = employment.analysisRevisedAt;
  if (revised && (!analysed || analysed < revised)) {
    recomputeAnalysis(employment);
    return true;
  }
  return false;
}

// ── Route registration ───────────────────────────────────────────────────

export function registerEmploymentIntakeRoutes(fastify: FastifyInstance): void {

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
      return reply.status(400).send({ ok: false, error: 'Invalid intake data' });
    }

    const { matterId, intake } = parsed.data;

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
    employment.intake = intake as EmploymentIntakeData;
    employment.intakeRevisedAt = new Date().toISOString();

    // Rebuild intake-derived timeline, preserving lawyer entries and
    // route-added ticklers (court dates, SOC-sent, debriefs, outcomes).
    employment.timeline = rebuildTimelinePreserving(employment.timeline, intake as EmploymentIntakeData);

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
    const { buildDocketIcs } = await import('../../employment/docket-ics.js');
    const ics = buildDocketIcs(collectDeadlines(rows));
    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="starling-docket.ics"')
      .send(ics);
  });

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
    const { summarizeNegotiation, amountsFromAnalysis } = await import('../../employment/negotiation.js');
    const entries = ((matter as Record<string, unknown>).negotiation ?? []) as import('../../employment/negotiation.js').NegotiationEntry[];
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
    const { summarizeNegotiation, amountsFromAnalysis } = await import('../../employment/negotiation.js');
    return reply.send({
      ok: true,
      entry,
      summary: summarizeNegotiation(m.negotiation as import('../../employment/negotiation.js').NegotiationEntry[], amountsFromAnalysis(employment?.analysis as Record<string, unknown> | null)),
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
      rawNotes: z.string().trim().min(1).max(20000),
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
    const { DEBRIEF_SYSTEM_PROMPT, buildDebriefUserPrompt, debriefAnalysisSchema } = await import('../../employment/debrief.js');
    const { crossProviderChat } = await import('../../providers/cross-provider-chat.js');

    let text: string;
    try {
      const result = await crossProviderChat({
        system: DEBRIEF_SYSTEM_PROMPT,
        user: buildDebriefUserPrompt(parsed.data.rawNotes, parsed.data.callType, callDate),
        tier: 'sonnet',
        maxTokens: 4096,
        maxRetries: 2,
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
      proposed = debriefAnalysisSchema.parse(JSON.parse(braced ? braced[0] : jsonText));
    } catch {
      return reply.status(502).send({ ok: false, error: 'Could not structure the notes. Try rephrasing or shortening them.' });
    }
    return reply.send({ ok: true, proposed, callDate });
  });

  // Save a REVIEWED debrief: wire dated items into the docket, draft email
  // items, record a timeline event.
  fastify.post('/api/employment/:matterId/debrief', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
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
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid debrief', details: parsed.error.issues.map(i => i.message) });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const m = matter as Record<string, unknown>;

    const { toStoredActionItems } = await import('../../employment/debrief.js');
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

    const emailDrafts = entry.actionItems.filter((it) => it.kind === 'email' && (it.emailSubject || it.emailBody)).length;
    return reply.send({
      ok: true,
      debrief: entry,
      scheduled: entry.actionItems.filter((it) => it.dueDate).length,
      emailDrafts,
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
    const { computeNetSettlement } = await import('../../employment/net-settlement.js');
    return reply.send({
      ok: true,
      inputs: saved,
      result: computeNetSettlement(saved as unknown as import('../../employment/net-settlement.js').NetSettlementInputs),
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
    const { computeNetSettlement } = await import('../../employment/net-settlement.js');
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

    const { computeBardalFactors } = await import('../../employment/timeline-generator.js');
    const { findComparables, caselawConfigured } = await import('../../employment/case-comparables.js');
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

  fastify.get('/api/employment/:matterId', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }

    const { matter, employment } = loadEmploymentData(row.data_json);
    const { deriveEmploymentStage } = await import('../../employment/stage-model.js');
    const { recommendEmploymentNextSteps } = await import('../../employment/next-steps.js');
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
      nextSteps: recommendEmploymentNextSteps(matter as Record<string, unknown>, employment, stage),
      updatedAt: row.updated_at,
      openedBy: row.owner_name ?? '',
      openedByMe: row.user_id === userId,
      lastModifiedByName: row.last_modified_by_name ?? '',
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

  // ── GET /api/employment/:matterId/case-review ────────────────────────
  // Cross-document aggregation for the bulk drop (Phase 3): the master
  // chronology (every dated fact, source-cited) and cross-document
  // conflicts. Deterministic — no LLM, no cost.
  fastify.get('/api/employment/:matterId/case-review', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { employment } = loadEmploymentData(row.data_json);
    const { buildChronology, findConflicts } = await import('../../employment/case-file-review.js');
    const extractions = employment.documentExtractions ?? [];
    return reply.send({
      ok: true,
      extractionCount: extractions.length,
      chronology: buildChronology(extractions, employment.timeline),
      conflicts: findConflicts(extractions, employment.intake),
    });
  });

  // ── POST /api/employment/:matterId/case-review/timeline ──────────────
  // Apply APPROVED chronology entries to the matter timeline. Deterministic;
  // dedups against existing (date, label) pairs; events carry their source
  // document and survive intake rebuilds (source document_extraction).
  const chronologyApplySchema = z.object({
    events: z.array(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      label: z.string().trim().min(1).max(300),
      category: z.enum(['employment', 'termination', 'legal', 'mitigation', 'other']).default('other'),
      sourceDoc: z.string().trim().max(500).default(''),
    })).min(1).max(100),
  }).strict();

  fastify.post('/api/employment/:matterId/case-review/timeline', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = chronologyApplySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid events', details: parsed.error.issues.map(i => i.message) });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const existing = new Set((employment.timeline ?? []).map(e => `${e.date}|${e.label}`));
    const added: Array<{ date: string; label: string }> = [];
    for (const ev of parsed.data.events) {
      if (existing.has(`${ev.date}|${ev.label}`)) continue;
      employment.timeline = addTimelineEvent(employment.timeline ?? [], {
        date: ev.date,
        label: ev.label,
        description: ev.sourceDoc ? `From ${ev.sourceDoc} (case file review).` : 'From the case file review.',
        category: ev.category,
        source: 'document_extraction',
      });
      existing.add(`${ev.date}|${ev.label}`);
      added.push({ date: ev.date, label: ev.label });
    }
    (matter as Record<string, unknown>).employmentData = employment;
    await saveMatter(userId, matterId, JSON.stringify(matter), ((matter as Record<string, unknown>).status as string) ?? 'active');

    logger.info('Chronology applied', { userId, matterId, added: added.length, requested: parsed.data.events.length });
    return reply.send({ ok: true, added, skippedExisting: parsed.data.events.length - added.length });
  });

  // ── POST /api/employment/:matterId/case-synthesis ────────────────────
  // The one LLM pass of the bulk drop: a source-cited internal review memo
  // over the structured extractions. Stored and metered like any generated
  // document; never drafts anything outbound.
  fastify.post('/api/employment/:matterId/case-synthesis', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const extractions = employment.documentExtractions ?? [];
    if (extractions.length === 0) {
      return reply.status(400).send({ ok: false, error: 'No document extractions on this matter yet. Upload documents first.' });
    }

    const { buildChronology, findConflicts } = await import('../../employment/case-file-review.js');
    const { generateCaseSynthesis } = await import('../../employment/case-synthesis.js');
    const intake = employment.intake;
    const partyTerms = [intake.client_first_name, intake.client_last_name, intake.employer_legal_name, intake.employer_operating_name]
      .filter((s): s is string => Boolean(s));

    let result;
    try {
      result = await generateCaseSynthesis({
        intake,
        extractions,
        chronology: buildChronology(extractions, employment.timeline),
        conflicts: findConflicts(extractions, intake),
      }, partyTerms);
    } catch (err) {
      logger.error('Case synthesis failed', { matterId, error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'The case review memo could not be generated. Please try again.' });
    }

    const m = matter as Record<string, unknown>;
    const stored = {
      html: sanitiseHtml(result.html),
      documentType: 'case_synthesis',
      documentTitle: result.documentTitle,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: [],
      generatedAt: new Date().toISOString(),
      costUsd: result.costUsd,
      status: 'draft',
    };
    m.generated_case_synthesis = stored;
    recordDraftHistory(m, {
      docType: 'case_synthesis', title: result.documentTitle, html: stored.html, costUsd: result.costUsd,
    }, { userId, matterId });
    m.employmentData = employment;
    await saveMatter(userId, matterId, JSON.stringify(m), (m.status as string) ?? 'active');

    return reply.send({ ok: true, document: stored });
  });

  // ── POST /api/employment/classify ────────────────────────────────────
  // Detect the document type before extraction (Phase 2 of the document-
  // intelligence spec). The lawyer confirms or overrides the detected kind
  // before the type-specific extraction prompt runs; a failure degrades to
  // {other, low} so the upload flow never blocks on classification.

  const classifyBodySchema = z.object({
    matterId: z.string().min(1).max(200),
    documentContent: z.string().min(1).max(100_000),
    documentName: z.string().trim().min(1).max(500),
  });

  fastify.post('/api/employment/classify', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const parsed = classifyBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(parsed.data.matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { classifyEmploymentDocument } = await import('../briefing/document-classifier.js');
    const result = await classifyEmploymentDocument(parsed.data.documentContent, parsed.data.documentName);
    if (result.costUsd > 0) {
      // Metered like every LLM step; 'analysis' kind so generation counts stay honest.
      try { recordUsageEvent(userId, parsed.data.matterId, 'analysis', 'classification', result.costUsd); }
      catch { /* metering never blocks the flow */ }
    }
    return reply.send({ ok: true, kind: result.kind, confidence: result.confidence, fallback: result.fallback });
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

    // Store extraction on the matter (lawyer reviews before confirming).
    // The id addresses this extraction in the apply loop.
    extraction.id = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if ((extraction.costUsd ?? 0) > 0) {
      // Metered like every LLM step; 'analysis' kind keeps generation counts honest.
      try { recordUsageEvent(userId, matterId, 'analysis', `extract_${documentKind}`, extraction.costUsd!); }
      catch { /* metering never blocks the flow */ }
    }
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

  // ── POST /api/employment/:matterId/apply-extraction ─────────────────────
  // The apply loop: move the lawyer's SELECTED extracted fields onto the
  // intake. Deterministic (no LLM); blanks fill by default, non-blank fields
  // change only with per-field overwrite opt-in; gates and timeline recompute
  // through the same preserving path as every other intake mutation; the
  // response carries the consequence diff (which dated events appeared or
  // moved). See docs/specs/document-extraction-apply-2026-07.md.

  const applyExtractionBodySchema = z.object({
    extractionId: z.string().min(1).max(100),
    fields: z.array(z.string().min(1).max(100)).max(80).default([]),
    overwrite: z.array(z.string().min(1).max(100)).max(80).default([]),
    // Approved settlement offers, by index into the STORED extraction's
    // offers array. Only the date is client-supplied (the document may not
    // state it); party, kind, amount and terms come from the stored
    // proposal so the client cannot smuggle arbitrary ledger entries.
    offers: z.array(z.object({
      index: z.number().int().min(0).max(11),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })).max(12).default([]),
  }).strict().refine(b => b.fields.length + b.offers.length > 0, { message: 'Nothing selected' });

  fastify.post('/api/employment/:matterId/apply-extraction', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = applyExtractionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid request', details: parsed.error.issues.map(i => i.message) });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);

    const { applyExtractionSelections, diffTimelines, resolveExtraction } = await import('../../employment/extraction-apply.js');
    const extraction = resolveExtraction(employment.documentExtractions ?? [], parsed.data.extractionId);
    if (!extraction) return reply.status(404).send({ ok: false, error: 'Extraction not found on this matter' });
    if (extraction.documentType === 'collective_agreement') {
      return reply.status(400).send({ ok: false, error: 'Collective agreements apply automatically at extraction time.' });
    }

    const outcome = parsed.data.fields.length > 0
      ? applyExtractionSelections(
          employment.intake,
          extraction,
          parsed.data.fields,
          new Set(parsed.data.overwrite),
        )
      : { intake: employment.intake, applied: [] as string[], overwritten: [] as string[], skippedNotBlank: [] as string[], unmapped: [] as string[], analysisStale: false };
    if ('error' in outcome) {
      return reply.status(400).send({ ok: false, error: outcome.error, invalidFields: outcome.invalidFields });
    }

    // Approved offers land on the negotiation ledger. Values come from the
    // stored proposal; duplicates (same date, party, kind and amount as an
    // existing entry) are skipped so re-applying an extraction never
    // doubles the history the mediation brief presents.
    const appliedOffers: string[] = [];
    let skippedDuplicateOffers = 0;
    if (parsed.data.offers.length > 0) {
      const proposals = extraction.offers ?? [];
      const ledger = (((matter as Record<string, unknown>).negotiation ?? []) as Array<Record<string, unknown>>);
      const keyOf = (o: { date?: unknown; party?: unknown; kind?: unknown; amountCad?: unknown }) =>
        `${o.date}|${o.party}|${o.kind}|${o.amountCad ?? ''}`;
      const existing = new Set(ledger.map(e => keyOf(e)));
      for (const sel of parsed.data.offers) {
        const proposal = proposals[sel.index];
        if (!proposal) {
          return reply.status(400).send({ ok: false, error: `Offer ${sel.index + 1} is not on this extraction.` });
        }
        const entry = {
          id: `neg-${Date.now()}-${sel.index}-${Math.random().toString(36).slice(2, 7)}`,
          date: sel.date,
          party: proposal.party,
          kind: proposal.kind,
          amountCad: proposal.amountCad,
          ...(proposal.terms ? { terms: proposal.terms } : {}),
          note: `From ${extraction.filename}`,
          recordedAt: new Date().toISOString(),
        };
        if (existing.has(keyOf(entry))) { skippedDuplicateOffers++; continue; }
        existing.add(keyOf(entry));
        ledger.push(entry);
        appliedOffers.push(`${entry.party} ${entry.kind} (${entry.date})`);
      }
      (matter as Record<string, unknown>).negotiation = ledger;
    }

    const changed = [...outcome.applied, ...outcome.overwritten];
    if (changed.length === 0 && appliedOffers.length === 0 && skippedDuplicateOffers === 0) {
      return reply.send({ ok: true, ...outcome, appliedOffers: [], timelineDiff: { added: [], removed: [] } });
    }
    if (changed.length === 0) {
      // Offers only: no intake mutation, so gates and timeline stand.
      await saveEmploymentData(userId, matterId, matter, employment);
      logger.info('Extraction offers applied', { userId, matterId, extractionId: extraction.id, offers: appliedOffers.length, skippedDuplicateOffers });
      return reply.send({ ok: true, ...outcome, appliedOffers, skippedDuplicateOffers, timelineDiff: { added: [], removed: [] } });
    }

    const timelineBefore = employment.timeline ?? [];
    employment.intake = outcome.intake;
    employment.intakeRevisedAt = new Date().toISOString();
    employment.timeline = rebuildTimelinePreserving(timelineBefore, outcome.intake);
    employment.gates = evaluateGates(outcome.intake);

    // Audit: the apply is a matter event, and the extraction records what
    // it contributed.
    employment.timeline = addTimelineEvent(employment.timeline, {
      date: new Date().toISOString().slice(0, 10),
      label: `Facts applied from ${extraction.filename}`,
      description: `Applied ${changed.length} field${changed.length === 1 ? '' : 's'} from the extracted document: ${changed.join(', ')}.`,
      category: 'legal',
      source: 'document_extraction',
    });
    extraction.appliedAt = new Date().toISOString();
    extraction.appliedFields = [...new Set([...(extraction.appliedFields ?? []), ...changed])];

    await saveEmploymentData(userId, matterId, matter, employment);

    const timelineDiff = diffTimelines(timelineBefore, employment.timeline);
    logger.info('Extraction applied', { userId, matterId, extractionId: extraction.id, applied: outcome.applied, overwritten: outcome.overwritten });
    return reply.send({
      ok: true,
      applied: outcome.applied,
      overwritten: outcome.overwritten,
      skippedNotBlank: outcome.skippedNotBlank,
      unmapped: outcome.unmapped,
      analysisStale: outcome.analysisStale,
      appliedOffers,
      skippedDuplicateOffers,
      timelineDiff,
      gates: employment.gates,
    });
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
    /** Draft in the firm's style, learned from its precedents. */
    styleProfileId: z.string().trim().max(100).optional(),
    /** Who the letter is addressed to; counsel where known. */
    recipientName: z.string().trim().max(300).optional(),
    /** Heads of damage the lawyer chose, overriding the analysis defaults. */
    damageHeads: z.array(z.object({
      label: z.string().trim().min(1).max(200),
      amount: z.number().nonnegative().max(99_999_999).nullable().optional(),
      basis: z.string().trim().max(300).optional(),
    })).max(20).optional(),
    /** Amounts already paid, netted off the claim. */
    amountsPaid: z.array(z.object({
      label: z.string().trim().min(1).max(200),
      amount: z.number().nonnegative().max(99_999_999),
    })).max(10).optional(),
    /** Mitigation earnings to date, netted off the claim. */
    mitigationEarnings: z.number().nonnegative().max(99_999_999).nullable().optional(),
    /** Which attached documents this letter reads. Omitted means all of them. */
    sourceIds: z.array(z.string().trim().max(100)).max(20).optional(),
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
    ensureAnalysisFresh(employment);

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

    // The firm's style, when picked: context into the prompt, identifiers
    // into the bleed scan afterwards.
    let dlStyle: {
      context: string; identifiers: string[]; label: string; typicalWords?: number;
      guide?: import('../../employment/style-profile.js').StyleGuide;
    } | undefined;
    if (parsed.data.styleProfileId) {
      const style = await loadStyleForGeneration(req, parsed.data.styleProfileId, 'demand_letter');
      if ('error' in style) return reply.status(style.status).send({ ok: false, error: style.error });
      dlStyle = style;
    }

    // The documents on the file. The letter argues about specific words,
    // so it reads the contract and the termination letter rather than the
    // intake form's summary of them.
    const { demandSourceContext } = await import('../../employment/demand-sources.js');
    const attached = (((matter as Record<string, unknown>).briefSources ?? []) as Array<{
      name: string; text: string; kind?: string;
    }>);
    const requested = parsed.data.sourceIds;
    const chosen = requested
      ? attached.filter(sd => requested.includes((sd as { id?: string }).id ?? ''))
      : attached;
    const { context: caseDocumentContext, dropped: droppedSources } = demandSourceContext(
      chosen.map(sd => ({
        name: sd.name,
        kind: isDemandSourceKind(sd.kind) ? sd.kind : 'other',
        text: sd.text,
      })),
    );

    // The firm's own letter, where it has taught one. Its opening and
    // closing replace Starling's, and the drafting instruction becomes
    // reproduce rather than imitate.
    let houseForm: {
      openingHtml?: string; closingHtml?: string; context?: string;
    } | undefined;
    const houseFlags: string[] = [];
    if (dlStyle?.guide && dlStyle.guide.documentKind === 'letter') {
      const hf = await import('../../employment/house-form.js');
      const guide = dlStyle.guide;
      const slots = hf.resolveSlots({
        intake: employment.intake,
        analysis: employment.analysis,
        recipientName: parsed.data.recipientName,
        salutation: parsed.data.recipientName ? 'Counsel' : undefined,
        lawyerName: parsed.data.lawyerName,
        firmName: parsed.data.firmName,
        fileNumber: ((matter as Record<string, unknown>).firmFileNumber as string)
          || ((matter as Record<string, unknown>).matterNumber as string) || undefined,
        demandAmount: parsed.data.demandAmount,
        responseDeadlineDays: parsed.data.responseDeadlineDays,
      });
      const opening = guide.openingBlock?.length
        ? hf.renderHouseOpening(guide.openingBlock, slots) : null;
      const closing = guide.closingBlock?.length
        ? hf.renderHouseClosing(guide.closingBlock, slots) : null;
      const fixed = (guide.fixedClauses ?? []).map((c: { part: string; text: string }) => ({
        part: c.part,
        text: hf.fillSlots(c.text, slots).text,
      }));

      houseForm = {
        openingHtml: opening?.html,
        closingHtml: closing?.html,
        context: hf.houseFormContext({
          label: dlStyle.label,
          fixedClauses: fixed,
          formStructure: guide.formStructure,
          voice: guide.voice,
          factWeaving: guide.factWeaving,
        }) || undefined,
      };

      const missing = [...new Set([...(opening?.missing ?? []), ...(closing?.missing ?? [])])];
      if (missing.length > 0) {
        houseFlags.push(`Your standard opening needs ${missing.map(m => m.toLowerCase()).join(', ')}, which this file does not have. Each is marked in the letter for you to complete.`);
      }
      // Standard language carries assumptions. One written for a dismissal,
      // used where the client resigned, is fluent, confident and wrong.
      for (const issue of hf.checkHouseFormFit(guide.fixedClauses ?? [], employment.intake)) {
        houseFlags.push(issue.message);
      }
    }

    // What the partner said to do on this file, and on this letter.
    const direction = directionForGeneration(matter, 'demand_letter');

    // Direction governs the FIGURES too, not only the prose. A letter that
    // demands four weeks in its narrative while its table itemises eight to
    // twelve months of pay in lieu is worse than no direction at all, and
    // the table is ours, not the model's. Where the direction settled what
    // is being claimed and the lawyer has not overridden the heads
    // themselves, the table follows the direction.
    const directionRecord = ((matter as Record<string, unknown>).direction ?? {}) as {
      matter?: { proposedHeads?: Array<{ label: string; basis?: string; amount?: number | null }> };
      byDocument?: Record<string, { proposedHeads?: Array<{ label: string; basis?: string; amount?: number | null }> }>;
    };
    const directionHeads = directionRecord.byDocument?.demand_letter?.proposedHeads
      ?? directionRecord.matter?.proposedHeads;
    const headsFromDirection = (parsed.data.damageHeads?.length ?? 0) === 0
      && (directionHeads?.length ?? 0) > 0;
    const effectiveHeads = headsFromDirection ? directionHeads : parsed.data.damageHeads;

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
      recipientName: parsed.data.recipientName,
      fileNumber: ((matter as Record<string, unknown>).firmFileNumber as string)
        || ((matter as Record<string, unknown>).matterNumber as string) || undefined,
      damageHeads: effectiveHeads,
      amountsPaid: parsed.data.amountsPaid,
      mitigationEarnings: parsed.data.mitigationEarnings,
      caseDocumentContext: caseDocumentContext || undefined,
      directionContext: direction.context || undefined,
      houseForm,
      styleContext: dlStyle?.context,
      styleTypicalWords: dlStyle?.typicalWords,
    }, definedTerms);
    if (houseFlags.length > 0) {
      result.lawyerReviewFlags = [...result.lawyerReviewFlags, ...houseFlags];
    }
    if (headsFromDirection) {
      result.lawyerReviewFlags = [
        ...result.lawyerReviewFlags,
        `The damages table itemises the heads from your direction rather than the analysis defaults: ${directionHeads!.map(h => h.label).join(', ')}. Edit the heads beside Generate to change that.`,
      ];
    }
    await applyDirectionAftermath(result, direction);
    if (droppedSources.length > 0) {
      result.lawyerReviewFlags = [
        ...result.lawyerReviewFlags,
        `More documents are attached than the letter can read at once. These were not used: ${droppedSources.join(', ')}. Detach what the letter does not need.`,
      ];
    }
    if (dlStyle) {
      result.lawyerReviewFlags = [
        ...result.lawyerReviewFlags,
        ...await styleReviewFlags(result.html, dlStyle.identifiers, dlStyle.label, employment.intake as Record<string, unknown>, parsed.data.demandAmount),
      ];
    }

    // Store the generated letter on the matter
    recordDraftHistory(matter as Record<string, unknown>, {
      docType: 'demand_letter', title: 'Demand Letter', html: sanitiseHtml(result.html),
      costUsd: result.costUsd, meta: { tone: parsed.data.tone, demandAmount: parsed.data.demandAmount },
    }, { userId, matterId });
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
    /** Draft in the firm's style, learned from its precedents. */
    styleProfileId: z.string().trim().max(100).optional(),
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
    ensureAnalysisFresh(employment);
    if (employment.approvedIssues.length === 0) {
      return reply.status(400).send({ ok: false, error: 'Approve at least one legal issue first.' });
    }

    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);

    let socStyle: { context: string; identifiers: string[]; label: string; typicalWords?: number } | undefined;
    if (parsed.data.styleProfileId) {
      const style = await loadStyleForGeneration(req, parsed.data.styleProfileId, 'statement_of_claim');
      if ('error' in style) return reply.status(style.status).send({ ok: false, error: style.error });
      socStyle = style;
    }

    const socDirection = directionForGeneration(matter, 'statement_of_claim');
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
      styleContext: [socStyle?.context, socDirection.context].filter(Boolean).join('\n\n') || undefined,
      styleTypicalWords: socStyle?.typicalWords,
    }, definedTerms);
    await applyDirectionAftermath(result, socDirection);
    if (socStyle) {
      result.lawyerReviewFlags = [
        ...result.lawyerReviewFlags,
        ...await styleReviewFlags(result.html, socStyle.identifiers, socStyle.label, employment.intake as Record<string, unknown>, parsed.data.claimAmount),
      ];
    }

    recordDraftHistory(matter as Record<string, unknown>, {
      docType: 'statement_of_claim', title: 'Statement of Claim', html: sanitiseHtml(result.html),
      costUsd: result.costUsd, meta: { procedureType: result.procedureType, claimAmount: parsed.data.claimAmount },
    }, { userId, matterId });
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
    ensureAnalysisFresh(employment);

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
    }, { userId, matterId });
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

  const LITIGATION_DOC_TYPES = ['discovery_plan', 'affidavit_of_documents', 'mediation_brief', 'severance_assessment', 'counter_offer', 'reply', 'rule49_offer', 'settlement_minutes', 'retainer_agreement', 'mitigation_log', 'settlement_conference_brief', 'hrto_schedule_a', 'notice_of_action', 'notice_of_arbitration', 'sj_notice_of_motion', 'sj_affidavit', 'sj_factum', 'sp_timetable_motion', 'consent_timetable_order', 'timetable_order', 'undertakings_answers', 'affidavit_of_service', 'rule49_withdrawal', 'rule49_acceptance', 'costs_outline', 'esa_filing_sheet', 'scc_filing_sheet'] as const;

  const litigationDocBodySchema = z.object({
    documentType: z.enum(LITIGATION_DOC_TYPES),
    claimAmount: z.number().positive().max(99_999_999).optional(),
    lawyerName: z.string().trim().min(1).max(200),
    firmName: z.string().trim().min(1).max(200),
    firmAddress: z.string().trim().max(500).optional(),
    courtLocation: z.string().trim().max(200).optional(),
    additionalContext: z.string().trim().max(5000).optional(),
    /** Draft in the firm's style, learned from its precedents. */
    styleProfileId: z.string().trim().max(100).optional(),
    /** Which procedure the action is under; the timetable motion adapts. */
    procedureType: z.enum(['simplified', 'ordinary']).optional(),
    /** Structured inputs for the deterministic court forms. */
    formFields: z.record(z.string().max(60), z.union([z.string().max(3000), z.number()])).optional(),
    /**
     * Documents attached at generation time to ground the brief (an
     * externally-drafted SOC, a demand letter, a list of authorities).
     * Text is parsed client-side via /api/documents/parse.
     */
    extraSources: z.array(z.object({
      name: z.string().trim().min(1).max(300),
      text: z.string().trim().min(1).max(60_000),
    })).max(6).optional(),
    /** Stored brief sources to include, by id (attach once, reuse). */
    briefSourceIds: z.array(z.string().max(60)).max(6).optional(),
    /** Affidavit furniture: who swears, in what capacity, on what basis. */
    affidavit: z.object({
      deponentName: z.string().trim().max(200),
      deponentCity: z.string().trim().max(120).optional(),
      capacity: z.enum(['plaintiff', 'lawyer', 'law_clerk', 'other']),
      capacityDescription: z.string().trim().max(300).optional(),
      knowledgeBasis: z.enum(['personal', 'information_and_belief', 'mixed']),
      informationSource: z.string().trim().max(300).optional(),
      sworn: z.enum(['sworn', 'affirmed']).default('sworn'),
      title: z.string().trim().max(200).optional(),
      exhibits: z.array(z.object({
        letter: z.string().trim().max(4).optional(),
        description: z.string().trim().min(1).max(400),
      })).max(26).optional(),
    }).optional(),
    /**
     * The lawyer's own timetable rows: their wording, their order. Takes
     * precedence over the fixed-step formFields when present.
     */
    timetableRows: z.array(z.object({
      label: z.string().trim().min(1).max(300),
      date: z.string().trim().min(1).max(40),
    })).max(30).optional(),
    /** Include the matter's generated positions (default yes, when they exist). */
    includeGeneratedDemand: z.boolean().default(true),
    includeGeneratedSoc: z.boolean().default(true),
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
    // Facts changed since the analysis ran? Recompute before drafting so
    // the damages table and clocks reflect the current intake, and say so.
    const analysisRefreshed = ensureAnalysisFresh(employment);

    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);

    const COURT_FORM_TYPES = ['affidavit_of_service', 'rule49_withdrawal', 'rule49_acceptance', 'costs_outline', 'esa_filing_sheet', 'scc_filing_sheet'];

    // Mediation brief: load the deterministic table inputs from the matter
    // record (comparables from the case library; offers from the negotiation
    // ledger). Both are best-effort; the generator omits a table and flags
    // it when the data is missing.
    let comparables: import('../../employment/case-comparables.js').ComparableCase[] | null = null;
    let comparableRange: import('../../employment/case-comparables.js').CaseBasedRange | null = null;
    let negotiationEntries: import('../../employment/negotiation.js').NegotiationEntry[] | null = null;
    // The brief is built FROM the positions already served: the matter's
    // demand letter and statement of claim ground the story and figures,
    // and double as citation sources so claims attribute to them.
    let positionDocuments: Array<{ title: string; text: string }> = [];
    let droppedSources: string[] = [];
    if (parsed.data.documentType === 'mediation_brief') {
      const { assembleBriefSources } = await import('../../employment/brief-sources.js');
      const dl = (matter as Record<string, unknown>).generatedDemandLetter as Record<string, unknown> | undefined;
      const soc = (matter as Record<string, unknown>).generatedSOC as Record<string, unknown> | undefined;
      const stored = (((matter as Record<string, unknown>).briefSources ?? []) as Array<{ id: string; name: string; text: string }>);
      const selectedStored = parsed.data.briefSourceIds
        ? stored.filter(sd => parsed.data.briefSourceIds!.includes(sd.id))
        : [];
      const assembled = assembleBriefSources({
        generatedDemandHtml: dl?.html,
        generatedSocHtml: soc?.html,
        includeGeneratedDemand: parsed.data.includeGeneratedDemand,
        includeGeneratedSoc: parsed.data.includeGeneratedSoc,
        extraSources: [
          ...selectedStored.map(sd => ({ name: sd.name, text: sd.text })),
          ...(parsed.data.extraSources ?? []),
        ],
      });
      positionDocuments = assembled.sources;
      droppedSources = assembled.dropped;
    }
    if (parsed.data.documentType === 'mediation_brief') {
      negotiationEntries = ((matter as Record<string, unknown>).negotiation ?? null) as import('../../employment/negotiation.js').NegotiationEntry[] | null;
      try {
        const { computeBardalFactors } = await import('../../employment/timeline-generator.js');
        const { findComparables } = await import('../../employment/case-comparables.js');
        const bardal = computeBardalFactors(employment.intake);
        if (bardal.tenureYears != null) {
          const found = await findComparables({ years: bardal.tenureYears, age: bardal.age, seniority: null });
          if (found) {
            comparables = found.comparables;
            comparableRange = found.range;
          }
        }
      } catch {
        // Comparables are additive; the brief generates without them.
      }
    }

    // Timetable documents: the lawyer's proposed dates are validated here
    // (readable, future, correctly ordered, Rule 48.14 checked) and passed
    // into the generator so Schedule A carries real dates rather than
    // [DATE] placeholders. They are docketed after a successful generation.
    const TIMETABLE_TYPES = ['sp_timetable_motion', 'consent_timetable_order', 'timetable_order'];
    let timetableContext: string | undefined;
    let timetableDates: import('../../employment/timetable.js').TimetableDates | undefined;
    let timetableCautions: string[] = [];
    let customRows: Array<{ label: string; date: string }> | undefined;
    if (TIMETABLE_TYPES.includes(parsed.data.documentType)) {
      const tt = await import('../../employment/timetable.js');
      const claimIssued = tt.claimIssuedDate(employment.intake);

      if (parsed.data.timetableRows && parsed.data.timetableRows.length > 0) {
        // The lawyer wrote their own steps: their wording and their order
        // govern, and the checks are the ones that stay meaningful.
        const check = tt.validateCustomTimetable(parsed.data.timetableRows, { claimIssuedDate: claimIssued });
        if (!check.ok) {
          return reply.status(400).send({
            ok: false,
            error: 'The proposed timetable needs fixing before the document can be drafted.',
            issues: check.issues.filter(i => i.severity === 'error').map(i => i.message),
          });
        }
        if (check.rows.length > 0) {
          timetableContext = tt.customTimetableForPrompt(check.rows);
          customRows = check.rows;
        }
        timetableCautions = check.issues.filter(i => i.severity === 'caution').map(i => i.message);
      } else {
        const raw = Object.fromEntries(
          Object.entries(parsed.data.formFields ?? {}).map(([k, v]) => [k, String(v ?? '')]),
        );
        const check = tt.validateTimetable(raw, { claimIssuedDate: claimIssued });
        if (!check.ok) {
          return reply.status(400).send({
            ok: false,
            error: 'The proposed timetable needs fixing before the document can be drafted.',
            issues: check.issues.filter(i => i.severity === 'error').map(i => i.message),
          });
        }
        if (Object.keys(check.dates).length > 0) {
          timetableContext = tt.timetableForPrompt(check.dates);
          timetableDates = check.dates;
        }
        timetableCautions = check.issues.filter(i => i.severity === 'caution').map(i => i.message);
      }
    }

    // The firm's style profile, when the lawyer picked one: its guide is
    // folded into the drafting prompt, and its identifier list drives the
    // deterministic precedent-bleed scan after generation.
    let styleContext: string | undefined;
    let styleIdentifiers: string[] = [];
    let styleLabel = '';
    let styleTypicalWords: number | undefined;
    let styleProfileTableRows: string[] | undefined;
    let styleFlowHeadings: string[] | undefined;
    if (parsed.data.styleProfileId) {
      const style = await loadStyleForGeneration(req, parsed.data.styleProfileId, parsed.data.documentType);
      if ('error' in style) return reply.status(style.status).send({ ok: false, error: style.error });
      styleContext = style.context;
      styleIdentifiers = style.identifiers;
      styleLabel = style.label;
      styleTypicalWords = style.typicalWords;
      styleProfileTableRows = style.profileTableRows;
      styleFlowHeadings = style.flowHeadings;
    }

    // Mediation logistics: the date is validated like every other
    // lawyer-typed date (ambiguity refused, never guessed) and docketed
    // below as a real scheduled proceeding.
    let mediationDateIso: string | undefined;
    if (parsed.data.documentType === 'mediation_brief' && parsed.data.formFields?.mediation_date) {
      const { normaliseDate } = await import('../../employment/date-normalise.js');
      const norm = normaliseDate(String(parsed.data.formFields.mediation_date));
      if (!norm.value) {
        return reply.status(400).send({ ok: false, error: `Mediation date: ${norm.reason}` });
      }
      mediationDateIso = norm.value;
      parsed.data.formFields.mediation_date = norm.value;
    }

    const litDirection = directionForGeneration(matter, parsed.data.documentType);

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
        // The direction goes last in the context: it is what overrides
        // the rest, so it is read with the rest still in view.
        additionalContext: [parsed.data.additionalContext, timetableContext, styleContext, litDirection.context]
          .filter(Boolean).join('\n\n') || undefined,
        formFields: parsed.data.formFields,
        procedureType: parsed.data.procedureType,
        comparables,
        comparableRange,
        negotiationEntries,
        styleTypicalWords,
        styleProfileTableRows,
        styleFlowHeadings,
        affidavit: parsed.data.affidavit,
        positionDocuments: positionDocuments.length > 0 ? positionDocuments : undefined,
        sourceDocuments: positionDocuments.length > 0
          ? positionDocuments.map(d => ({ name: d.title, content: d.text }))
          : undefined,
      }, definedTerms);
    } catch (err) {
      // Deterministic court forms validate their inputs and fail with a
      // plain message the lawyer can act on.
      if (COURT_FORM_TYPES.includes(parsed.data.documentType)) {
        return reply.status(400).send({ ok: false, error: err instanceof Error ? err.message : 'Form inputs are incomplete.' });
      }
      throw err;
    }

    await applyDirectionAftermath(result, litDirection);

    // Deterministic precedent-bleed scan: the precedents' names and
    // amounts must not surface in this matter's draft. This matter's own
    // parties and figures are excluded first.
    if (styleIdentifiers.length > 0) {
      result.lawyerReviewFlags = [
        ...result.lawyerReviewFlags,
        ...await styleReviewFlags(result.html, styleIdentifiers, styleLabel, employment.intake as Record<string, unknown>, parsed.data.claimAmount),
      ];
    }

    // Store on the matter
    recordDraftHistory(matter as Record<string, unknown>, {
      docType: parsed.data.documentType, title: result.documentTitle, html: sanitiseHtml(result.html),
      costUsd: result.costUsd,
    }, { userId, matterId });
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

    // Docket the proposed timetable. These are the lawyer's own dates, not
    // yet ordered by a court, so they go on as ordinary docket items rather
    // than court deadlines and are replaced (not duplicated) if the document
    // is regenerated with different dates.
    let docketed = 0;
    if (mediationDateIso || (parsed.data.formFields?.mediator_name)) {
      (matter as Record<string, unknown>).mediationLogistics = {
        ...(mediationDateIso ? { date: mediationDateIso } : {}),
        ...(typeof parsed.data.formFields?.mediator_name === 'string' && parsed.data.formFields.mediator_name
          ? { mediator: parsed.data.formFields.mediator_name } : {}),
      };
    }
    if (mediationDateIso) {
      // A scheduled mediation is a commitment, not a proposal: it goes on
      // as a real deadline, replaced (not duplicated) on regeneration.
      const mediatorName = typeof parsed.data.formFields?.mediator_name === 'string' ? parsed.data.formFields.mediator_name : '';
      const label = 'Mediation';
      employment.timeline = [
        ...employment.timeline.filter(ev => ev.label !== label),
        {
          date: mediationDateIso,
          label,
          description: `Mediation${mediatorName ? ` before ${mediatorName}` : ''}. Serve the brief in good time beforehand.`,
          category: 'legal' as const,
          source: 'system' as const,
          courtDeadline: true,
        },
      ].sort((a, b) => a.date.localeCompare(b.date));
      docketed += 1;
    }
    if (customRows && customRows.length > 0) {
      const tt = await import('../../employment/timetable.js');
      const events = tt.customTimetableEvents(customRows);
      const labels = new Set(events.map(e => e.label));
      employment.timeline = [
        ...employment.timeline.filter(ev => !labels.has(ev.label)),
        ...events,
      ].sort((a, b) => a.date.localeCompare(b.date));
      docketed += events.length;
    }
    if (timetableDates && Object.keys(timetableDates).length > 0) {
      const tt = await import('../../employment/timetable.js');
      const events = tt.timetableTimelineEvents(timetableDates);
      const proposedLabels = new Set(events.map(e => e.label));
      employment.timeline = [
        ...employment.timeline.filter(ev => !proposedLabels.has(ev.label)),
        ...events,
      ].sort((a, b) => a.date.localeCompare(b.date));
      docketed = events.length;
    }

    await saveEmploymentData(userId, matterId, matter, employment);

    return reply.send({
      ok: true,
      html: sanitiseHtml(result.html),
      documentType: result.documentType,
      documentTitle: result.documentTitle,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      costUsd: result.costUsd,
      ...(positionDocuments.length > 0 ? { positionsUsed: positionDocuments.map(d => d.title) } : {}),
      ...(droppedSources.length > 0 ? { droppedSources } : {}),
      ...(docketed > 0 ? { docketedDates: docketed } : {}),
      ...(timetableCautions.length > 0 || analysisRefreshed ? {
        cautions: [
          ...(analysisRefreshed ? ['The facts changed after the last analysis, so the analysis was recomputed from the current intake before drafting.'] : []),
          ...timetableCautions,
        ],
      } : {}),
    });
  });

  // ── POST /api/employment/:matterId/draft/replace ───────────────────────
  // The lawyer's own improved version becomes the version of record. Until
  // now an edited Word file could only donate its comments and tracked
  // changes; a lawyer who rewrote the prose directly saw their work stay
  // outside the system. The previous version is kept in draft history.

  const replaceDraftSchema = z.object({
    docType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    /** A Word file... */
    docxBase64: z.string().max(20_000_000).optional(),
    filename: z.string().trim().max(300).optional(),
    /** ...or the revised text pasted straight in. */
    pastedText: z.string().max(400_000).optional(),
  }).refine(b => Boolean(b.docxBase64 || b.pastedText), { message: 'Provide a file or pasted text' });

  fastify.post('/api/employment/:matterId/draft/replace', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = replaceDraftSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const key = findGeneratedDocKey(matter, parsed.data.docType);
    if (!key) return reply.status(404).send({ ok: false, error: 'No generated document of that type on this matter.' });
    const doc = matter[key] as Record<string, unknown>;

    let html: string;
    if (parsed.data.pastedText) {
      // Pasted text arrives as plain paragraphs (or as HTML the lawyer
      // copied from the preview); sanitising covers both, and blank lines
      // become paragraph breaks so the structure survives.
      const raw = parsed.data.pastedText;
      html = /<(p|h[1-6]|div|table)[\s>]/i.test(raw)
        ? sanitiseHtml(raw)
        : sanitiseHtml(raw
            .split(/\n\s*\n/)
            .map(block => `<p>${block.trim().replace(/\n/g, '<br>')}</p>`)
            .join('\n'));
    } else {
      try {
        const buffer = Buffer.from(parsed.data.docxBase64!, 'base64');
        const mammoth = (await import('mammoth')).default;
        const { value } = await mammoth.convertToHtml({ buffer });
        html = sanitiseHtml(value ?? '');
      } catch {
        return reply.status(400).send({ ok: false, error: 'That file could not be read as a Word document.' });
      }
    }
    if (html.replace(/<[^>]+>/g, '').trim().length < 200) {
      return reply.status(400).send({ ok: false, error: 'That file has too little text to be the document. Is it the right file?' });
    }

    // Keep what is being replaced: the lawyer must be able to get back.
    recordDraftHistory(matter, {
      docType: parsed.data.docType,
      title: String(doc.documentTitle ?? parsed.data.docType),
      html: String(doc.html ?? ''),
      costUsd: 0,
      meta: { source: 'superseded_by_upload' },
    }, { userId, matterId });

    doc.html = html;
    doc.revisedAt = new Date().toISOString();
    doc.lawyerEdited = {
      at: new Date().toISOString(),
      filename: parsed.data.pastedText ? 'pasted by the lawyer' : (parsed.data.filename ?? 'edited.docx'),
    };
    // A lawyer-edited version is the version of record; a stale uploaded
    // DOCX from the approval lane must not keep overriding the download.
    delete doc.uploadedDocx;
    await saveEmploymentData(userId, matterId, matter, employment);
    logger.info('Draft replaced by lawyer version', { userId, matterId, docType: parsed.data.docType });
    return reply.send({ ok: true, html });
  });

  // ── POST /api/employment/:matterId/draft/review ────────────────────────
  // Starling reviews a finished document and reports what would weaken it.
  // Deterministic checks (figures against the record, missing firm
  // sections, length divergence) run first and are labelled "checked";
  // the model pass adds judgment findings, labelled as judgment. Every
  // finding is returned in the revision loop's item shape, so the lawyer
  // approves them through the same gate with the same byte-identity
  // guarantee.

  const draftReviewSchema = z.object({
    docType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    /** Stored brief sources to weigh in the review. */
    briefSourceIds: z.array(z.string().max(60)).max(6).optional(),
    /** Review against this firm style as well as the record. */
    styleProfileId: z.string().trim().max(100).optional(),
  });

  fastify.post('/api/employment/:matterId/draft/review', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = draftReviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const key = findGeneratedDocKey(matter, parsed.data.docType);
    if (!key) return reply.status(404).send({ ok: false, error: 'No generated document of that type on this matter.' });
    const doc = matter[key] as Record<string, unknown>;
    const html = typeof doc.html === 'string' ? doc.html : '';
    if (!html) return reply.status(409).send({ ok: false, error: 'That document has no content to review.' });

    const rl = await import('../../employment/revision-loop.js');
    const dr = await import('../../employment/draft-review.js');
    const paragraphs = rl.toParagraphs(html);
    const draftText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // Sources the lawyer chose, plus the served positions.
    const stored = (((matter as Record<string, unknown>).briefSources ?? []) as Array<{ id: string; name: string; text: string }>);
    const chosen = parsed.data.briefSourceIds
      ? stored.filter(sd => parsed.data.briefSourceIds!.includes(sd.id))
      : stored;
    const sources = chosen.map(sd => ({ title: sd.name, text: sd.text }));

    // The firm's style, when the lawyer picked one.
    let guide: import('../../employment/style-profile.js').StyleGuide | null = null;
    if (parsed.data.styleProfileId) {
      const firmId = resolveFirmId(req);
      const profile = firmId ? getStyleProfile(firmId, parsed.data.styleProfileId) : undefined;
      if (profile) {
        const { styleGuideSchema, clampStyleGuide } = await import('../../employment/style-profile.js');
        const validated = styleGuideSchema.safeParse(clampStyleGuide(JSON.parse(profile.guide_json)));
        if (validated.success) guide = validated.data;
      }
    }

    // Deterministic first: these are checked, not opined.
    const draftHeadings = [...html.matchAll(/<h[123][^>]*>([^<]{1,120})<\/h[123]>/gi)].map(m => m[1]);
    const checked = [
      ...dr.checkFigures(
        draftText, employment.intake, employment.analysis, sources.map(s => s.text),
        (((matter as Record<string, unknown>).negotiation ?? []) as Array<{ amountCad?: number | null }>)
          .map(e => e.amountCad ?? 0).filter(n => n > 0),
      ),
      ...dr.checkStyleDivergence(draftHeadings, guide),
      ...dr.reviewLengthFinding(draftText.split(/\s+/).filter(Boolean).length, guide),
    ];

    // The model pass.
    const intake = employment.intake as Record<string, unknown> | null;
    const analysis = employment.analysis;
    const intakeSummary = [
      `Client: ${[intake?.client_first_name, intake?.client_last_name].filter(Boolean).join(' ') || 'unknown'}`,
      `Employer: ${intake?.employer_legal_name ?? intake?.employer_operating_name ?? 'unknown'}`,
      `Position: ${intake?.job_title ?? 'unknown'}; hired ${intake?.hire_date ?? 'unknown'}; terminated ${intake?.termination_date ?? 'unknown'}`,
      `Salary: ${intake?.annual_salary ? `$${Number(intake.annual_salary).toLocaleString('en-CA')}` : 'unknown'}`,
      analysis ? `Assessed range: $${Math.round(analysis.damagesEstimate.totalEstimateLow).toLocaleString('en-CA')} to $${Math.round(analysis.damagesEstimate.totalEstimateHigh).toLocaleString('en-CA')} (${analysis.damagesEstimate.commonLawLowMonths} to ${analysis.damagesEstimate.commonLawHighMonths} months)` : 'No analysis on file.',
      `Approved issues: ${(employment.approvedIssues ?? []).join(', ') || 'none'}`,
    ].join('\n');

    const { crossProviderChat } = await import('../../providers/cross-provider-chat.js');
    let judgment: Array<Record<string, unknown>> = [];
    let cost = 0;
    try {
      const result = await crossProviderChat({
        system: dr.buildReviewSystemPrompt(),
        user: dr.buildReviewUserPrompt({
          documentTitle: String(doc.documentTitle ?? parsed.data.docType),
          paragraphs: paragraphs.map(p => rl.paragraphText(p)),
          intakeSummary,
          sources,
          styleSummary: guide
            ? `Flow: ${guide.flow.map(f => f.heading).join(' | ')}\nVoice: ${guide.voice}\nHabits: ${guide.notes.join('; ')}`
            : undefined,
        }),
        tier: 'opus',
        maxTokens: 8192,
        maxRetries: 2,
        extendOnTruncation: true,
      });
      cost = result.cost;
      const raw = result.text.trim();
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const payload = JSON.parse(fenced ? fenced[1] : raw) as { findings?: Array<Record<string, unknown>> };
      judgment = Array.isArray(payload.findings) ? payload.findings : [];
    } catch (err) {
      logger.warn('Draft review model pass failed; returning checked findings only', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Everything becomes a revision item the lawyer approves. Checked
    // findings first: they are verifiable, the rest are opinion.
    const maxIdx = paragraphs.length - 1;
    const items = [
      ...checked.map((f, i) => ({
        id: `rev-chk-${i}`,
        feedback: f.observation,
        kind: 'needs_lawyer' as const,
        paragraphIndices: f.paragraphIndices.filter(n => n >= 0 && n <= maxIdx),
        proposal: f.suggestion,
        reason: 'Checked against the matter record.',
        category: f.category,
        basis: 'checked' as const,
      })),
      ...judgment.slice(0, 20).map((f, i) => {
        const indices = Array.isArray(f.paragraphIndices)
          ? (f.paragraphIndices as unknown[]).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= maxIdx)
          : [];
        return {
          id: `rev-obs-${i}`,
          feedback: String(f.observation ?? '').slice(0, 2000),
          kind: 'needs_lawyer' as const,
          paragraphIndices: indices,
          proposal: String(f.suggestion ?? '').slice(0, 2000),
          reason: "Starling's judgment, not a checked fact.",
          category: (dr.REVIEW_CATEGORIES as readonly string[]).includes(String(f.category))
            ? String(f.category) : 'unsupported_assertion',
          basis: 'judgment' as const,
        };
      }),
    ].filter(it => it.feedback);

    try { recordUsageEvent(userId, matterId, 'analysis', `draft_review_${parsed.data.docType}`, cost); }
    catch { /* metering must never fail the request */ }

    logger.info('Draft reviewed', { userId, matterId, docType: parsed.data.docType, checked: checked.length, judgment: judgment.length, costUsd: cost.toFixed(4) });
    return reply.send({
      ok: true,
      docType: parsed.data.docType,
      paragraphs: paragraphs.map((p, i) => ({ index: i, text: rl.paragraphText(p) })),
      items,
      costUsd: cost,
    });
  });

  // ── POST /api/employment/:matterId/timetable-package ───────────────────
  // The three timetable documents are prepared together in practice, from
  // one schedule. Generating them separately invites the model-written
  // parts to drift apart (a consent order saying seven days to vary while
  // the draft order says ten). One action, one set of inputs, generated in
  // PARALLEL and stored as SEPARATE documents so each keeps its own
  // template, review, redraft and download.

  fastify.post('/api/employment/:matterId/timetable-package', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const packageSchema = z.object({
      lawyerName: z.string().trim().min(1).max(200),
      firmName: z.string().trim().min(1).max(200),
      firmAddress: z.string().trim().max(500).optional(),
      courtLocation: z.string().trim().max(200).optional(),
      /** Which procedure the action is under; the motion adapts. */
      procedureType: z.enum(['simplified', 'ordinary']).default('simplified'),
      timetableRows: z.array(z.object({
        label: z.string().trim().min(1).max(300),
        date: z.string().trim().min(1).max(40),
      })).min(1).max(30),
      /** Style profile per document type, when the firm has taught one. */
      styleProfileIds: z.record(z.string().max(60), z.string().max(100)).optional(),
      /** Include the supporting affidavit for the motion. */
      includeAffidavit: z.boolean().default(true),
      affidavit: z.object({
        deponentName: z.string().trim().max(200),
        deponentCity: z.string().trim().max(120).optional(),
        capacity: z.enum(['plaintiff', 'lawyer', 'law_clerk', 'other']),
        capacityDescription: z.string().trim().max(300).optional(),
        knowledgeBasis: z.enum(['personal', 'information_and_belief', 'mixed']),
        informationSource: z.string().trim().max(300).optional(),
        sworn: z.enum(['sworn', 'affirmed']).default('sworn'),
        exhibits: z.array(z.object({
          letter: z.string().trim().max(4).optional(),
          description: z.string().trim().min(1).max(400),
        })).max(26).optional(),
      }).optional(),
    });

    const parsed = packageSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and analysis first.' });
    }
    ensureAnalysisFresh(employment);

    // Validate the schedule ONCE. Every document in the package carries
    // the same rows, so they cannot disagree.
    const tt = await import('../../employment/timetable.js');
    const check = tt.validateCustomTimetable(parsed.data.timetableRows, {
      claimIssuedDate: tt.claimIssuedDate(employment.intake),
    });
    if (!check.ok) {
      return reply.status(400).send({
        ok: false,
        error: 'The proposed timetable needs fixing before the package can be drafted.',
        issues: check.issues.filter(i => i.severity === 'error').map(i => i.message),
      });
    }
    const timetableContext = tt.customTimetableForPrompt(check.rows);

    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);

    const types: LitigationDocumentType[] = [
      'sp_timetable_motion', 'consent_timetable_order', 'timetable_order',
      ...(parsed.data.includeAffidavit ? ['motion_affidavit' as LitigationDocumentType] : []),
    ];

    // Parallel: the package is one wait, not four.
    const results = await Promise.allSettled(types.map(async docType => {
      let styleContext: string | undefined;
      let styleIdentifiers: string[] = [];
      let styleLabel = '';
      const styleId = parsed.data.styleProfileIds?.[docType];
      if (styleId) {
        const style = await loadStyleForGeneration(req, styleId, docType);
        if (!('error' in style)) {
          styleContext = style.context;
          styleIdentifiers = style.identifiers;
          styleLabel = style.label;
        }
      }
      const result = await generateLitigationDocument({
        intake: employment.intake!,
        approvedIssues: employment.approvedIssues,
        analysis: employment.analysis!,
        documentType: docType,
        lawyerName: parsed.data.lawyerName,
        firmName: parsed.data.firmName,
        firmAddress: parsed.data.firmAddress,
        courtLocation: parsed.data.courtLocation,
        procedureType: parsed.data.procedureType,
        additionalContext: [
          timetableContext,
          docType === 'motion_affidavit'
            ? 'This affidavit supports a motion for an order fixing the timetable set out above. Depose to the steps taken to agree a timetable and what remains outstanding.'
            : undefined,
          styleContext,
        ].filter(Boolean).join('\n\n'),
        ...(docType === 'motion_affidavit' && parsed.data.affidavit
          ? { affidavit: { ...parsed.data.affidavit, title: 'Affidavit (Timetable Motion)' } }
          : {}),
      }, definedTerms);
      if (styleIdentifiers.length > 0) {
        result.lawyerReviewFlags = [
          ...result.lawyerReviewFlags,
          ...await styleReviewFlags(result.html, styleIdentifiers, styleLabel, employment.intake as unknown as Record<string, unknown>),
        ];
      }
      return { docType, result };
    }));

    const generated: Array<{ docType: string; title: string; costUsd: number }> = [];
    const failed: Array<{ docType: string; error: string }> = [];
    let totalCost = 0;

    for (let i = 0; i < results.length; i++) {
      const settled = results[i];
      if (settled.status === 'rejected') {
        failed.push({ docType: types[i], error: settled.reason instanceof Error ? settled.reason.message : 'Generation failed' });
        continue;
      }
      const { docType, result } = settled.value;
      const html = sanitiseHtml(result.html);
      recordDraftHistory(matter as Record<string, unknown>, {
        docType, title: result.documentTitle, html, costUsd: result.costUsd,
      }, { userId, matterId });
      (matter as Record<string, unknown>)[`generated_${docType}`] = {
        html,
        documentType: result.documentType,
        documentTitle: result.documentTitle,
        lawyerReviewFlags: result.lawyerReviewFlags,
        citations: result.citations,
        generatedAt: new Date().toISOString(),
        costUsd: result.costUsd,
        status: 'draft',
      };
      generated.push({ docType, title: result.documentTitle, costUsd: result.costUsd });
      totalCost += result.costUsd;
    }

    // Docket the schedule once, from the shared rows.
    const events = tt.customTimetableEvents(check.rows);
    const labels = new Set(events.map(e => e.label));
    employment.timeline = [
      ...employment.timeline.filter(ev => !labels.has(ev.label)),
      ...events,
    ].sort((a, b) => a.date.localeCompare(b.date));

    await saveEmploymentData(userId, matterId, matter, employment);
    logger.info('Timetable package generated', {
      userId, matterId, generated: generated.map(g => g.docType), failed: failed.map(f => f.docType), costUsd: totalCost.toFixed(4),
    });

    return reply.send({
      ok: generated.length > 0,
      generated,
      failed,
      docketedDates: events.length,
      cautions: check.issues.filter(i => i.severity === 'caution').map(i => i.message),
      costUsd: totalCost,
    });
  });

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
      const { getUserById } = await import('../../db/database.js');
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

  // Read the notes ONCE, here, and return the instructions for the lawyer
  // to approve. Nothing from this call binds a draft until it is saved.
  fastify.post('/api/employment/:matterId/direction/extract', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = z.object({
      notes: z.string().trim().min(1).max(MAX_NOTES_CHARS),
      documentType: z.string().trim().max(60).optional(),
      documentLabel: z.string().trim().max(120).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Paste the notes to read.' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { employment } = loadEmploymentData(row.data_json);

    const { DIRECTION_EXTRACTION_SYSTEM, buildDirectionExtractionPrompt } = await import('../../employment/direction.js');
    const { crossProviderChat } = await import('../../providers/cross-provider-chat.js');

    let text: string;
    try {
      const result = await crossProviderChat({
        system: DIRECTION_EXTRACTION_SYSTEM,
        user: buildDirectionExtractionPrompt({
          notes: parsed.data.notes,
          documentLabel: parsed.data.documentLabel,
          intake: employment.intake,
          analysis: employment.analysis,
        }),
        tier: 'sonnet',
        maxTokens: 4096,
        maxRetries: 2,
      });
      text = result.text;
    } catch (err) {
      logger.error('Direction extraction failed', { error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'The notes could not be read. Please try again.' });
    }

    let jsonText = text.trim();
    const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonText = fenced[1].trim();
    const braced = jsonText.match(/\{[\s\S]*\}/);
    const extractionSchema = z.object({
      instructions: z.array(z.object({
        text: z.string().trim().min(1).max(600),
        kind: z.enum(INSTRUCTION_KINDS).catch('scope'),
        mustInclude: z.array(z.string().trim().max(120)).max(8).optional(),
        mustNotInclude: z.array(z.string().trim().max(120)).max(8).optional(),
      })).max(MAX_INSTRUCTIONS),
      withheld: z.array(z.string().trim().max(300)).max(20).optional(),
      proposedHeads: z.array(z.object({
        label: z.string().trim().min(1).max(200),
        basis: z.string().trim().max(300).optional(),
        amount: z.number().nonnegative().max(99_999_999).nullable().optional(),
      })).max(20).optional(),
    });
    let proposed;
    try {
      proposed = extractionSchema.parse(JSON.parse(braced ? braced[0] : jsonText));
    } catch {
      return reply.status(502).send({ ok: false, error: 'Could not turn those notes into instructions. Try shortening them, or write the instruction yourself.' });
    }
    return reply.send({ ok: true, proposed });
  });

  // ── GET /api/employment/:matterId/demand-readiness ─────────────────────
  // What the demand letter will be missing, before generating. A demand
  // letter is the first thing the other side reads, so the checks are its
  // own: arguing a clause nobody attached, ignoring known mitigation, a
  // signed release, a limitation period a letter does not stop.

  fastify.get('/api/employment/:matterId/demand-readiness', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const { demandReadiness } = await import('../../employment/demand-readiness.js');
    const { defaultDamageHeads } = await import('../../employment/demand-letter-parts.js');
    const firmId = resolveFirmId(req);

    const sources = (((matter as Record<string, unknown>).briefSources ?? []) as Array<{ kind?: string }>);
    // Signature-block details live on the user profile; best-effort, since
    // a missing profile is a warn in the checklist rather than an error.
    let profile: Record<string, unknown> = {};
    try {
      const { getUserById } = await import('../../db/database.js');
      const user = getUserById(userId);
      if (user?.profile_json) profile = JSON.parse(user.profile_json) as Record<string, unknown>;
    } catch { /* profile is best-effort */ }

    return reply.send({
      ok: true,
      // What the table will itemise unless the lawyer overrides it. Sent
      // here so the workspace prefills the real heads rather than its own
      // approximation of them.
      defaultHeads: employment.analysis ? defaultDamageHeads(employment.analysis) : [],
      items: demandReadiness({
        intake: employment.intake,
        analysis: employment.analysis,
        approvedIssues: employment.approvedIssues ?? [],
        sourceKinds: sources.map(sd => sd.kind ?? 'other'),
        styleProfilesCount: firmId ? getStyleProfiles(firmId, 'demand_letter').length : 0,
        firmContactComplete: Boolean(profile.firmAddress && (profile.firmPhone || profile.firmEmail)),
      }),
    });
  });

  // ── GET /api/employment/:matterId/brief-readiness ──────────────────────
  // What the mediation brief will be missing, before generating: every
  // check mirrors a decision the deterministic assemblers make, so the
  // lawyer fixes holes from a checklist instead of a paid draft.

  fastify.get('/api/employment/:matterId/brief-readiness', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const { briefReadiness } = await import('../../employment/brief-readiness.js');
    const { caselawConfigured } = await import('../../employment/case-comparables.js');
    const firmId = resolveFirmId(req);
    const dl = (matter as Record<string, unknown>).generatedDemandLetter as Record<string, unknown> | undefined;
    const soc = (matter as Record<string, unknown>).generatedSOC as Record<string, unknown> | undefined;

    return reply.send({
      ok: true,
      items: briefReadiness({
        intake: employment.intake,
        analysis: employment.analysis,
        approvedIssuesCount: employment.approvedIssues?.length ?? 0,
        negotiationCount: (((matter as Record<string, unknown>).negotiation ?? []) as unknown[]).length,
        caselawConfigured: caselawConfigured(),
        styleProfilesCount: firmId ? getStyleProfiles(firmId, 'mediation_brief').length : 0,
        sourcesCount: (dl?.html ? 1 : 0) + (soc?.html ? 1 : 0),
        mediationDocketed: (employment.timeline ?? []).some(e => e.label === 'Mediation'),
      }),
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

    const firmId = resolveFirmId(req) ?? '';
    let html: string | null = null;
    let title = '';

    // Firm and lawyer identity for the template's letterhead placeholders.
    // A generated demand letter or SOC carries what the lawyer typed at
    // generation time, so prefer that; otherwise fall back to the account
    // profile. Without the fallback these render as literal {{FIRM_NAME}}
    // markers on every document type that is not a demand letter or SOC.
    const genDL = matterData.generatedDemandLetter as Record<string, unknown> | undefined;
    const genSOC = matterData.generatedSOC as Record<string, unknown> | undefined;
    let firmName = (genDL?.firmName as string) || (genSOC?.firmName as string) || '';
    let lawyerName = (genDL?.lawyerName as string) || (genSOC?.lawyerName as string) || '';
    let firmAddress = '';
    try {
      const user = getUserById(userId);
      if (user) {
        firmName = firmName || user.firm_name || '';
        lawyerName = lawyerName || user.display_name || '';
        if (user.profile_json) {
          const profile = JSON.parse(user.profile_json) as Record<string, unknown>;
          firmAddress = [profile.firmAddress, profile.firmPhone, profile.firmEmail]
            .filter(v => typeof v === 'string' && v.trim())
            .join(' · ');
        }
      }
    } catch { /* profile is best-effort; markers simply stay visible */ }

    // The firm's own file number where set, otherwise the matter number.
    const fileNumber = String(
      (matterData.firmFileNumber as string) || (matterData.matterNumber as string) || '',
    );
    // Court name follows the forum: the lawyer's chosen procedure where set,
    // otherwise the analysis recommendation.
    const procedure = employment?.selectedProcedure
      ?? employment?.analysis?.recommendedProcedure
      ?? null;
    const courtName = procedure === 'small_claims'
      ? 'ONTARIO SUPERIOR COURT OF JUSTICE (SMALL CLAIMS COURT)'
      : 'ONTARIO SUPERIOR COURT OF JUSTICE';

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
    } else if (['discovery-plan', 'affidavit-of-documents', 'mediation-brief', 'severance-assessment', 'counter-offer', 'reply', 'rule49-offer', 'settlement-minutes', 'retainer-agreement', 'mitigation-log', 'settlement-conference-brief', 'hrto-schedule-a', 'grievance-filing', 'referral-to-arbitration', 'arbitration-brief', 'dfr-response', 'merits-assessment', 'decline-letter', 'member-update', 'remedy-worksheet', 'notice-of-action', 'sj-notice-of-motion', 'sj-affidavit', 'sj-factum', 'sp-timetable-motion', 'consent-timetable-order', 'timetable-order', 'undertakings-answers', 'affidavit-of-service', 'rule49-withdrawal', 'rule49-acceptance', 'costs-outline', 'esa-filing-sheet', 'scc-filing-sheet', 'notice-of-arbitration', 'particulars', 'production-request', 'settlement-memorandum', 'ohsa-reprisal-complaint'].includes(docType)) {
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
      'notice-of-arbitration': 'notice_of_arbitration',
      'sj-notice-of-motion': 'sj_notice_of_motion',
      'sj-affidavit': 'sj_affidavit',
      'sj-factum': 'sj_factum',
      'sp-timetable-motion': 'sp_timetable_motion',
      'consent-timetable-order': 'consent_timetable_order',
      'timetable-order': 'timetable_order',
      'undertakings-answers': 'undertakings_answers',
      'affidavit-of-service': 'affidavit_of_service',
      'rule49-withdrawal': 'rule49_withdrawal',
      'rule49-acceptance': 'rule49_acceptance',
      'costs-outline': 'costs_outline',
      'esa-filing-sheet': 'esa_filing_sheet',
      'scc-filing-sheet': 'scc_filing_sheet',
      'particulars': 'particulars',
      'production-request': 'production_request',
      'settlement-memorandum': 'settlement_memorandum',
      'ohsa-reprisal-complaint': 'ohsa_reprisal_complaint',
    };

    // An approved review may carry a Word file the reviewer uploaded; that
    // file, not a regeneration from html, is the version of record.
    const canonicalType = docTypeMap[docType] ?? docType.replace(/-/g, '_');
    const docKey = findGeneratedDocKey(matterData, canonicalType);
    const uploaded = docKey ? (matterData[docKey] as Record<string, unknown>).uploadedDocx as { b64?: string; filename?: string } | undefined : undefined;
    if (uploaded?.b64) {
      const safe = `${(uploaded.filename ?? title).replace(/[^a-zA-Z0-9\-_. ]/g, '').trim() || 'document'}`;
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${safe.endsWith('.docx') ? safe : `${safe}.docx`}"`)
        .send(Buffer.from(uploaded.b64, 'base64'));
    }

    // The lawyer may pick which of the firm's templates for this document
    // type to render on; without one, the type's default is used.
    const { templateVariantId } = (req.query ?? {}) as { templateVariantId?: string };

    const buffer = await htmlToDocx(html, {
      title,
      firmName,
      lawyerName,
      firmAddress,
      matterNumber: fileNumber,
      courtName,
      firmId,
      documentType: docTypeMap[docType],
      templateVariantId,
      demandAmount: employment?.demandAmount ?? null,
      intake: employment?.intake ? {
        client_first_name: employment.intake.client_first_name,
        client_last_name: employment.intake.client_last_name,
        client_address: employment.intake.client_address,
        employer_legal_name: employment.intake.employer_legal_name,
        employer_address: employment.intake.employer_address,
        job_title: employment.intake.job_title,
        hire_date: employment.intake.hire_date,
        termination_date: employment.intake.termination_date,
        annual_salary: employment.intake.annual_salary,
      } : undefined,
    });

    const filename = `${title.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim()}.docx`;

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });

  // ── Style profiles ─────────────────────────────────────────────────────
  // The complement to templates for flowing prose: Starling reads several
  // of the firm's precedents ONCE, describes how the firm writes that
  // document (flow, voice, recurring language), and stores the description.
  // Every later generation can draft in that style for the current
  // matter's facts. Two precedents suffice here (unlike alignment, which
  // needs three to tell boilerplate from coincidence), because the model
  // describes rather than diffs.

  /**
   * Document types that are FORMS, not prose: orders, notices of motion,
   * court forms. Their precedents are read for fixed wording and part
   * order, never for voice.
   */
  const FORM_DOCUMENT_TYPES = new Set([
    'sp_timetable_motion', 'consent_timetable_order', 'timetable_order',
    'sj_notice_of_motion', 'affidavit_of_service', 'rule49_offer',
    'rule49_withdrawal', 'rule49_acceptance', 'costs_outline',
    'esa_filing_sheet', 'scc_filing_sheet', 'notice_of_action',
    'settlement_minutes', 'undertakings_answers',
  ]);

  // Correspondence is built on firm boilerplate: the same opening block,
  // the same first paragraph, letter after letter, with the facts swapped.
  // Prose mode learns voice and flow and deliberately writes fresh
  // language, which is wrong for a letter whose worth is that it reads
  // exactly like the last one the firm sent.
  const LETTER_DOCUMENT_TYPES = new Set([
    'demand_letter', 'counter_offer', 'reply', 'decline_letter', 'member_update',
  ]);

  const styleBuildSchema = z.object({
    documentType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    label: z.string().trim().min(1).max(120),
    /** Override the automatic prose/form choice. */
    documentKind: z.enum(['prose', 'form', 'letter']).optional(),
    /** Proceed even though a precedent looks like a different document. */
    ignoreTypeMismatch: z.boolean().optional(),
    precedents: z.array(z.object({
      name: z.string().trim().min(1).max(300),
      docxBase64: z.string().max(7_000_000),
    })).min(2).max(8),
  });

  fastify.post('/api/employment/style-profiles/build', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });

    const parsed = styleBuildSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid style profile request' });

    const mammoth = (await import('mammoth')).default;
    const texts: Array<{ name: string; text: string }> = [];
    for (const p of parsed.data.precedents) {
      try {
        const buffer = Buffer.from(p.docxBase64, 'base64');
        const { value } = await mammoth.extractRawText({ buffer });
        if (!value || value.trim().length < 150) {
          return reply.status(400).send({ ok: false, error: `"${p.name}" has too little text to learn from. Is it the right file?` });
        }
        texts.push({ name: p.name, text: value });
      } catch {
        return reply.status(400).send({ ok: false, error: `"${p.name}" could not be read as a Word document.` });
      }
    }

    // Does each precedent look like the document it is being taught for?
    // The firm's timetable materials are three documents in one folder;
    // teaching the motion from consent orders would shape every later
    // motion, silently. Checked BEFORE the model call, so a mistake costs
    // nothing.
    const { checkPrecedentTypes } = await import('../../employment/precedent-type-check.js');
    const typeIssues = checkPrecedentTypes(texts, parsed.data.documentType);
    if (typeIssues.length > 0 && !parsed.data.ignoreTypeMismatch) {
      return reply.status(409).send({
        ok: false,
        error: 'Some of those precedents look like a different document.',
        typeIssues: typeIssues.map(i => i.message),
        canOverride: true,
      });
    }

    const { analyseStyle, extractIdentifiers } = await import('../../employment/style-profile.js');
    const documentKind = parsed.data.documentKind
      ?? (FORM_DOCUMENT_TYPES.has(parsed.data.documentType) ? 'form'
        : LETTER_DOCUMENT_TYPES.has(parsed.data.documentType) ? 'letter'
        : 'prose');
    let guide;
    let costUsd = 0;
    try {
      const analysed = await analyseStyle(texts, documentKind);
      guide = analysed.guide;
      costUsd = analysed.costUsd;
    } catch (err) {
      return reply.status(502).send({ ok: false, error: err instanceof Error ? err.message : 'Analysis failed.' });
    }

    const id = `style-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    saveStyleProfile({
      id,
      firm_id: firmId,
      document_type: parsed.data.documentType,
      label: parsed.data.label,
      guide_json: JSON.stringify(guide),
      identifiers_json: JSON.stringify(extractIdentifiers(texts.map(t => t.text))),
      source_count: texts.length,
      source_names: JSON.stringify(texts.map(t => t.name)),
      cost_usd: costUsd,
    });
    try { recordUsageEvent(userId, 'firm', 'analysis', `style_profile_${parsed.data.documentType}`, costUsd); } catch { /* metering is best-effort */ }
    logger.info('Style profile built', { userId, firmId, documentType: parsed.data.documentType, sources: texts.length, costUsd: costUsd.toFixed(4) });
    return reply.send({ ok: true, id, label: parsed.data.label, guide, documentKind, sourceCount: texts.length, costUsd });
  });

  fastify.get('/api/employment/style-profiles', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.send({ ok: true, profiles: [] });
    const { documentType } = (req.query ?? {}) as { documentType?: string };
    const rows = getStyleProfiles(firmId, documentType && /^[a-z0-9_]{1,60}$/.test(documentType) ? documentType : undefined);
    return reply.send({
      ok: true,
      profiles: rows.map(r => ({
        id: r.id, documentType: r.document_type, label: r.label,
        sourceCount: r.source_count, createdAt: r.created_at,
      })),
    });
  });

  fastify.get('/api/employment/style-profiles/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { id } = req.params as { id: string };
    const row = getStyleProfile(firmId, id);
    if (!row) return reply.status(404).send({ ok: false, error: 'Style profile not found.' });
    let guide: unknown = null;
    try { guide = JSON.parse(row.guide_json); } catch { /* shown as unreadable below */ }
    return reply.send({
      ok: true,
      profile: {
        id: row.id, documentType: row.document_type, label: row.label,
        guide, sourceCount: row.source_count, createdAt: row.created_at,
      },
    });
  });

  // The tweak that persists: the lawyer edits the guide (flow, voice,
  // language, depth, table rows) and the SAME profile improves for every
  // later draft — no rebuilding, no repeating the same correction.
  fastify.put('/api/employment/style-profiles/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { id } = req.params as { id: string };
    const existing = getStyleProfile(firmId, id);
    if (!existing) return reply.status(404).send({ ok: false, error: 'Style profile not found.' });

    const { styleGuideSchema } = await import('../../employment/style-profile.js');
    const bodySchema = z.object({
      label: z.string().trim().min(1).max(120),
      guide: styleGuideSchema,
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'The edited style profile is invalid: ' + parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).slice(0, 3).join('; '),
      });
    }
    updateStyleProfile(firmId, id, parsed.data.label, JSON.stringify(parsed.data.guide));
    logger.info('Style profile edited', { firmId, id });
    return reply.send({ ok: true });
  });

  fastify.delete('/api/employment/style-profiles/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { id } = req.params as { id: string };
    const removed = deleteStyleProfile(firmId, id);
    if (!removed) return reply.status(404).send({ ok: false, error: 'Style profile not found.' });
    return reply.send({ ok: true });
  });

  // ── POST /api/employment/templates/align ───────────────────────────────
  // Turn several of the firm's precedents into a template proposal by
  // diffing them: recurring text is the firm's boilerplate, varying text
  // becomes a placeholder. Deterministic and free — no model call, and the
  // precedents never leave this server. The lawyer reviews the proposal
  // before anything is saved (POST .../align/save).

  const alignSchema = z.object({
    documentType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    precedents: z.array(z.object({
      name: z.string().trim().min(1).max(300),
      docxBase64: z.string().max(7_000_000),
      /** Optional: the matter this precedent came from. Naming placeholders
       *  from real intake data is exact, where pattern matching guesses. */
      matterId: z.string().trim().max(200).optional(),
    })).min(3).max(8),
  });

  fastify.post('/api/employment/templates/align', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });

    const parsed = alignSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'Provide a document type and at least three precedents (up to eight).',
      });
    }

    const mammoth = (await import('mammoth')).default;
    const { alignPrecedents } = await import('../../employment/precedent-alignment.js');

    const inputs: Array<{ name: string; text: string }> = [];
    const facts: Array<MatterFacts | undefined> = [];
    for (const p of parsed.data.precedents) {
      let text = '';
      try {
        const { value } = await mammoth.extractRawText({ buffer: Buffer.from(p.docxBase64, 'base64') });
        text = value;
      } catch {
        return reply.status(400).send({ ok: false, error: `Could not read “${p.name}” as a Word document.` });
      }
      if (!text.trim()) {
        return reply.status(400).send({ ok: false, error: `“${p.name}” appears to contain no text.` });
      }
      inputs.push({ name: p.name, text });

      // Matter facts are read under the CALLER's id, so a precedent can
      // only be tied to a matter the caller already owns.
      let matterFacts: MatterFacts | undefined;
      if (p.matterId) {
        const row = getMatterById(p.matterId, userId);
        if (row) {
          const { employment } = loadEmploymentData(row.data_json);
          const i = employment.intake;
          if (i) {
            matterFacts = {
              client_first_name: i.client_first_name, client_last_name: i.client_last_name,
              client_address: i.client_address, employer_legal_name: i.employer_legal_name,
              employer_address: i.employer_address, job_title: i.job_title,
              hire_date: i.hire_date, termination_date: i.termination_date,
              annual_salary: i.annual_salary,
            };
          }
        }
      }
      facts.push(matterFacts);
    }

    try {
      const result = alignPrecedents(inputs, facts);
      logger.info('Precedents aligned', {
        firmId, documentType: parsed.data.documentType,
        precedents: inputs.length, slots: result.slots.length,
      });
      return reply.send({ ok: true, documentType: parsed.data.documentType, alignment: result });
    } catch (err) {
      return reply.status(400).send({
        ok: false,
        error: err instanceof Error ? err.message : 'Alignment failed.',
      });
    }
  });

  // ── POST /api/employment/templates/align/save ──────────────────────────
  // Save a reviewed alignment as a template variant. The lawyer's decisions
  // arrive as slot id → placeholder name (or null to keep the original
  // wording). The rendered template is verified to contain no invented
  // prose before it is stored.

  const alignSaveSchema = z.object({
    documentType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    variantLabel: z.string().trim().min(1).max(80),
    isDefault: z.boolean().optional(),
    alignment: z.object({
      lines: z.array(z.object({
        index: z.number(), presentIn: z.array(z.number()),
        skeleton: z.string(), stable: z.boolean(),
      })).max(2000),
      slots: z.array(z.object({
        id: z.string().max(20), kind: z.string().max(20), lineIndex: z.number(),
        observedValues: z.array(z.string().max(4000)).max(8),
        suggestedPlaceholder: z.string().max(60).nullable(),
        basis: z.string().max(20),
      })).max(500),
      stableLineCount: z.number(), optionalLineCount: z.number(),
      precedentNames: z.array(z.string().max(300)).max(8),
      warnings: z.array(z.string().max(500)).max(20),
    }),
    decisions: z.record(z.string().max(20), z.string().max(60).nullable()),
    includeOptionalLines: z.boolean().optional(),
  });

  fastify.post('/api/employment/templates/align/save', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });

    const parsed = alignSaveSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid template to save.' });

    const { renderTemplate } = await import('../../employment/precedent-alignment.js');
    const { Document, Packer, Paragraph, TextRun } = await import('docx');

    const alignment = parsed.data.alignment as unknown as Parameters<typeof renderTemplate>[0];
    const templateText = renderTemplate(alignment, parsed.data.decisions, {
      includeOptionalLines: parsed.data.includeOptionalLines ?? true,
    });
    if (!templateText.trim()) {
      return reply.status(400).send({ ok: false, error: 'The reviewed template is empty.' });
    }

    // Build a DOCX carrying the firm's own words plus the confirmed
    // placeholders. Formatting comes from the firm's later edits; the point
    // here is that the language is theirs, verbatim.
    const doc = new Document({
      sections: [{
        children: templateText.split('\n').map(line =>
          new Paragraph({ children: [new TextRun({ text: line, font: 'Times New Roman', size: 24 })] })),
      }],
    });
    const buffer = await Packer.toBuffer(doc);
    const templateBase64 = buffer.toString('base64');

    const placeholders = detectPlaceholders(templateText);
    const label = parsed.data.variantLabel.trim();
    const variantId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'variant'}-${Math.random().toString(36).slice(2, 6)}`;
    const id = `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    saveFirmTemplate(id, firmId, parsed.data.documentType, `${label}.docx`, templateBase64, placeholders,
      { variantId, variantLabel: label, isDefault: parsed.data.isDefault });

    logger.info('Aligned template saved', {
      firmId, documentType: parsed.data.documentType, variantId, placeholders: placeholders.length,
    });
    return reply.send({ ok: true, templateId: id, variantId, variantLabel: label, placeholders });
  });

  // ── POST /api/employment/templates ─────────────────────────────────────
  // Upload or update a firm's DOCX template for a specific document type.

  fastify.post('/api/employment/templates', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = templateUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid template upload' });
    }

    const { documentType, name, templateBase64, variantLabel, isDefault } = parsed.data;
    // The firm comes from the authenticated identity ONLY. A body-supplied
    // firmId let any caller overwrite another firm's template (the same
    // tenant-isolation hole the legacy /:firmId routes were removed for).
    const firmId = resolveFirmId(req);
    if (!firmId) {
      return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    }

    // Detect placeholders from the DOCX's actual text. A .docx is a zip, so
    // reading the raw bytes as utf-8 finds nothing (the text is compressed) —
    // that made every upload report zero placeholders. Unzip and read the
    // document body plus any headers and footers, which is where letterhead
    // markers usually live.
    let placeholders: string[] = [];
    let templateNotice: string | null = null;
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(Buffer.from(templateBase64, 'base64'));
      const parts = Object.keys(zip.files).filter(f =>
        f === 'word/document.xml' || f.startsWith('word/header') || f.startsWith('word/footer'));
      const chunks: string[] = [];
      for (const part of parts) {
        const file = zip.file(part);
        if (file) chunks.push(await file.async('string'));
      }
      // Markers split across XML runs by Word would otherwise be missed:
      // strip the tags between braces before detecting.
      const joined = chunks.join('\n').replace(/(\{\{[A-Z_]*)(<[^>]+>)+([A-Z_]*\}\})/g, '$1$3');
      placeholders = detectPlaceholders(joined);
      // A template with no markers is about to behave in a way the lawyer
      // has to know about, and reporting "0 placeholders detected" is not
      // telling them. Say what will happen, and name the notation they
      // appear to be using where there is one.
      if (placeholders.length === 0) {
        const { detectForeignMarkerStyle } = await import('../../employment/docx-splice.js');
        const plainText = joined.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const foreign = detectForeignMarkerStyle(plainText);
        templateNotice = foreign
          ? `No Starling markers found. This template appears to use ${foreign}, which Starling does not read. It will be used as letterhead: your header, footer, fonts and margins are kept, and the generated document replaces the body. To place content yourself, put {{LEGAL_ANALYSIS}} where the body should go.`
          : 'No Starling markers found. This template will be used as letterhead: your header, footer, fonts and margins are kept, and the generated document replaces the body. To control placement, put {{LEGAL_ANALYSIS}} where the body should go.';
      }
    } catch {
      // Not a readable DOCX: store it anyway, but report no placeholders
      // rather than guessing from the raw bytes.
      placeholders = [];
    }

    // The variant id is derived from the lawyer's label so it stays
    // readable, with a short suffix so two similar labels cannot collide.
    const label = variantLabel?.trim() || 'Standard';
    const variantId = parsed.data.variantId?.trim()
      || `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'variant'}-${Math.random().toString(36).slice(2, 6)}`;

    const id = `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    saveFirmTemplate(id, firmId, documentType, name, templateBase64, placeholders,
      { variantId, variantLabel: label, isDefault });

    logger.info('Template uploaded', { firmId, documentType, name, variantId, placeholders: placeholders.length });

    return reply.send({
      ok: true,
      templateId: id,
      variantId,
      variantLabel: label,
      placeholders,
      notice: templateNotice,
    });
  });

  // ── POST /api/employment/templates/:documentType/default ───────────────
  // Make one variant the default for its document type.

  fastify.post('/api/employment/templates/:documentType/default', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { documentType } = req.params as { documentType: string };
    const body = z.object({ variantId: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ ok: false, error: 'A variant is required.' });

    const ok = setDefaultFirmTemplate(firmId, documentType, body.data.variantId);
    if (!ok) return reply.status(404).send({ ok: false, error: 'That template variant was not found.' });
    logger.info('Template default changed', { firmId, documentType, variantId: body.data.variantId });
    return reply.send({ ok: true });
  });

  // ── GET /api/employment/templates ──────────────────────────────────────
  // List the requesting user's firm templates. Once uploaded, a template is
  // the firm default for its document type across ALL matters.

  fastify.get('/api/employment/templates', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req) ?? '';
    const templates = getFirmTemplates(firmId);

    return reply.send({
      ok: true,
      templates: templates.map(t => ({
        id: t.id,
        documentType: t.document_type,
        variantId: t.variant_id,
        variantLabel: t.variant_label,
        isDefault: t.is_default === 1,
        name: t.name,
        placeholders: JSON.parse(t.placeholders),
        uploadedAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  });

  // ── DELETE /api/employment/templates/:documentType ─────────────────────
  // Remove one variant (?variantId=...), or every variant of a type.
  // Deleting the default promotes the most recently updated survivor so a
  // type is never left without one.

  fastify.delete('/api/employment/templates/:documentType', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { documentType } = req.params as { documentType: string };
    const { variantId } = (req.query ?? {}) as { variantId?: string };
    deleteFirmTemplate(firmId, documentType, variantId);
    logger.info('Template deleted', { firmId, documentType, variantId: variantId ?? 'ALL' });
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

    // Review lane guard: a document with an open review cannot be marked
    // sent or filed until the review is approved or withdrawn.
    // Only while the approval lane is switched ON. Otherwise a review left
    // open before it was turned off would strand the document forever, with
    // no queue in the UI to withdraw it from.
    if (config.starling?.approvalsEnabled && (parsed.data.status === 'sent' || parsed.data.status === 'filed')) {
      const { getOpenReviewForDoc } = await import('../../employment/document-reviews.js');
      const open = getOpenReviewForDoc(matterId, parsed.data.docType);
      if (open && open.status !== 'approved') {
        return reply.status(409).send({ ok: false, error: 'This document is in the approval queue. It can be marked sent or filed once the review is approved or withdrawn.' });
      }
    }

    const statusDate = parsed.data.date ?? new Date().toISOString().slice(0, 10);
    doc.status = parsed.data.status;
    doc.statusDate = statusDate;
    const history = Array.isArray(doc.statusHistory) ? doc.statusHistory as Array<Record<string, unknown>> : [];
    history.push({ status: parsed.data.status, date: statusDate, recordedAt: new Date().toISOString() });
    doc.statusHistory = history.slice(-20);

    // Litigation event chains: a real-world date on one document starts
    // the clock on the next step. Each tickler replaces any earlier
    // system-set event of the same label; the docket, the calendar feed,
    // and the digest carry it automatically.
    const setTickler = (label: string, days: number, description: string) => {
      const due = new Date(`${statusDate}T00:00:00`);
      due.setDate(due.getDate() + days);
      const dueIso = due.toISOString().slice(0, 10);
      employment.timeline = [
        ...employment.timeline.filter(ev => ev.label !== label),
        { date: dueIso, label, description, category: 'legal' as const, source: 'system' as const },
      ].sort((a, b) => a.date.localeCompare(b.date));
    };

    // A demand letter marked sent starts the response clock from the date
    // of sending; the generation-time tickler was a conservative default.
    if (parsed.data.docType === 'demand_letter' && parsed.data.status === 'sent') {
      const deadlineDays = typeof doc.responseDeadlineDays === 'number' ? doc.responseDeadlineDays : 14;
      setTickler('Demand letter response due', deadlineDays,
        `${deadlineDays}-day response deadline from the demand letter sent on ${statusDate}. Follow up if no response.`);
    }

    // A Statement of Claim marked sent (served) starts the defence clock:
    // twenty days for a defendant served in Ontario (rule 18.01; forty
    // days elsewhere in Canada or the United States, sixty days beyond).
    if (parsed.data.docType === 'statement_of_claim' && parsed.data.status === 'sent') {
      setTickler('Statement of Defence due', 20,
        `Twenty days from service of the Statement of Claim on ${statusDate}, for a defendant served in Ontario (forty days elsewhere in Canada or the United States; sixty days beyond; a Notice of Intent to Defend adds ten). Consider noting default if nothing is delivered.`);
    }

    // A Notice of Action marked filed (issued) starts the thirty-day
    // clock to file the Statement of Claim (Form 14D).
    if (parsed.data.docType === 'notice_of_action' && parsed.data.status === 'filed') {
      setTickler('Statement of Claim (Form 14D) due', 30,
        `Thirty days from the issuance of the Notice of Action on ${statusDate} to file the Statement of Claim (Form 14D).`);
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

    const { extractDocxRevisions, revisionsAsFeedback } = await import('../../documents/docx-revisions.js');
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
  });

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

    const rl = await import('../../employment/revision-loop.js');
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

    const { crossProviderChat } = await import('../../providers/cross-provider-chat.js');
    let text: string;
    let cost = 0;
    try {
      const result = await crossProviderChat({
        system: rl.buildPlannerSystemPrompt(),
        user: rl.buildPlannerUserPrompt({
          documentTitle: String(doc.documentTitle ?? parsed.data.docType),
          paragraphs, feedback: parsed.data.feedback, source: parsed.data.source,
          section: sectionRange,
        }),
        tier: 'sonnet',
        maxTokens: 4096,
        maxRetries: 2,
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
        ? (it.paragraphIndices as unknown[]).map(Number).filter(Number.isInteger) : [],
      proposal: String(it.proposal ?? '').slice(0, 2000),
      intakeField: it.intakeField ? String(it.intakeField).slice(0, 60) : undefined,
      intakeValue: it.intakeValue as string | number | boolean | undefined,
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
      intakeField: z.string().max(60).optional(),
      intakeValue: z.union([z.string().max(500), z.number(), z.boolean()]).optional(),
    })).min(1).max(60),
  });

  fastify.post('/api/employment/:matterId/revision/apply', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = revisionApplySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const key = findGeneratedDocKey(matter, parsed.data.docType);
    if (!key) return reply.status(404).send({ ok: false, error: 'No generated document of that type on this matter.' });
    const doc = matter[key] as Record<string, unknown>;
    const html = typeof doc.html === 'string' ? doc.html : '';
    if (!html) return reply.status(409).send({ ok: false, error: 'That document has no content to revise.' });

    const rl = await import('../../employment/revision-loop.js');
    const paragraphs = rl.toParagraphs(html);
    // A needs_lawyer item is a question for the lawyer, never an instruction
    // to the model: it cannot be approved into an edit.
    const editable = parsed.data.approved.filter(i => i.kind !== 'needs_lawyer' && i.paragraphIndices.length > 0);

    let revised: Record<number, string> = {};
    let cost = 0;
    if (editable.length > 0) {
      const instructions = editable.map(i =>
        `Paragraphs [${i.paragraphIndices.join(', ')}]: ${i.proposal}\n  (client said: ${i.feedback})`).join('\n\n');
      const targets = [...new Set(editable.flatMap(i => i.paragraphIndices))].sort((a, b) => a - b);
      const shown = targets.map(i => `[${i}] ${paragraphs[i]}`).join('\n');

      const { crossProviderChat } = await import('../../providers/cross-provider-chat.js');
      // The model returns the revised paragraphs in full, so the budget
      // must scale with what is being revised: a fixed 8k cap truncated
      // the JSON on long firm-depth briefs and 502'd the whole apply.
      const targetChars = targets.reduce((a, i) => a + (paragraphs[i]?.length ?? 0), 0);
      const applyBudget = Math.min(24_576, Math.max(8_192, Math.ceil(targetChars / 2)));
      try {
        const result = await crossProviderChat({
          system: rl.buildApplySystemPrompt(),
          user: `PARAGRAPHS TO REVISE:\n${shown}\n\nAPPROVED INSTRUCTIONS:\n${instructions}`,
          tier: 'opus',
          maxTokens: applyBudget,
          maxRetries: 2,
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
