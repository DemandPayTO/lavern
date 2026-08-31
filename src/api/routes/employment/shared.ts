/**
 * Shared helpers for the employment-intake route modules.
 *
 * Extracted from employment-intake.ts so the domain route files under
 * routes/employment/ can share one home for firm resolution, HTML
 * sanitisation, matter load/save, draft history, document collection,
 * style/direction wiring, and analysis recomputation. The barrel
 * (employment-intake.ts) re-exports the public members so existing
 * importers keep working.
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

export const logger = createLogger('EMPLOYMENT');

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
  backfillIntakeIdentity(matter, employment);
  return { matter, employment };
}

/**
 * The matter record knows the parties: the lawyer typed them at creation
 * and they live in the title ("Kimberly Botsford v. Hamilton Health
 * Sciences Corporation") and clientId. The intake's name fields can be
 * missing (the replace-bug era erased some), and every generator reads
 * the intake, so the cover said PLAINTIFF while the file's own title
 * named her. Names the intake lacks are derived from the matter itself,
 * on every read; the next save persists them.
 */
export function backfillIntakeIdentity(matter: Record<string, unknown>, employment: EmploymentMatterData): void {
  const intake = employment.intake as Record<string, unknown>;
  if (!intake) return;

  if (!intake.client_first_name && !intake.client_last_name) {
    const clientName = String(matter.clientId ?? '').trim();
    // Only something that reads as a person's name; never an opaque id.
    if (clientName && /^[A-Za-z][A-Za-z.'-]*(?:\s+[A-Za-z][A-Za-z.'-]*){1,3}$/.test(clientName)) {
      const parts = clientName.split(/\s+/);
      intake.client_first_name = parts.slice(0, -1).join(' ');
      intake.client_last_name = parts[parts.length - 1];
    }
  }

  if (!intake.employer_legal_name && !intake.employer_operating_name) {
    const title = String(matter.title ?? '');
    const m = title.match(/\bv\.?\s+(.{2,200})$/);
    if (m) intake.employer_legal_name = m[1].trim();
  }
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
export const DRAFT_HISTORY_CAP = 10;
export function recordDraftHistory(
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
export const REVISION_KIND_VALUES = ['factual_correction', 'position_change', 'wording', 'needs_lawyer'] as const;

/** Rejoin revised paragraphs into document html. */
export function fromParagraphsSafe(rl: { fromParagraphs: (p: string[]) => string }, paragraphs: string[]): string {
  return rl.fromParagraphs(paragraphs);
}
export type DocumentStatus = typeof DOCUMENT_STATUSES[number];

export const LEGACY_DOC_KEYS: Record<string, string> = {
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

export function titleForDoc(docType: string, doc: Record<string, unknown>): string {
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
export async function loadStyleForGeneration(
  req: unknown,
  styleProfileId: string,
  documentType: string,
): Promise<
  | { error: string; status: number }
  | {
      context: string; identifiers: string[]; label: string; typicalWords?: number;
      profileTableRows?: string[]; flowHeadings?: string[];
      /** The guide itself, for callers that reproduce the firm's own wording. */
      guide?: import('../../../employment/style-profile.js').StyleGuide;
    }
> {
  const firmId = resolveFirmId(req);
  const profile = firmId ? getStyleProfile(firmId, styleProfileId) : undefined;
  if (!profile) return { error: 'Style profile not found.', status: 404 };
  if (profile.document_type !== documentType) {
    return { error: 'That style profile is for a different document type.', status: 400 };
  }
  const { styleContextForPrompt, styleGuideSchema, usableFlow } = await import('../../../employment/style-profile.js');
  const guide = styleGuideSchema.safeParse(JSON.parse(profile.guide_json));
  if (!guide.success) return { error: 'The stored style profile is unreadable. Rebuild it.', status: 409 };
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
 * Which causes of action a change just made pleadable.
 *
 * Approving a fact must never arm a claim invisibly, so the callers that
 * write intake facts compute the picker's statuses before and after and
 * report every cause that moved from off to eligible or firing.
 */
export async function diffUnlockedCauses(
  matter: unknown,
  before: EmploymentIntakeData | null | undefined,
  after: EmploymentIntakeData | null | undefined,
  employment: { analysis?: unknown; gates?: unknown; approvedIssues?: string[]; demandAmount?: number | null },
): Promise<string[]> {
  if (!before || !after) return [];
  const { loadSocNodes, buildSocEvalContext, nodeStatuses } = await import('../../../employment/soc-nodes.js');
  const overrides = ((matter as Record<string, unknown>).socNodeOverrides ?? {}) as Record<string, 'on' | 'off'>;
  const nodes = loadSocNodes();
  const statusFor = (intake: EmploymentIntakeData) => {
    const ctx = buildSocEvalContext({
      intake,
      analysis: (employment.analysis ?? null) as never,
      gates: (employment.gates ?? []) as never,
      approvedIssues: employment.approvedIssues ?? [],
      claimAmount: employment.demandAmount || 0,
    });
    return new Map(nodeStatuses(nodes, ctx, employment.approvedIssues ?? [], overrides).map(r => [r.blockId, { status: r.status, header: r.sectionHeader }]));
  };
  const was = statusFor(before);
  const now = statusFor(after);
  const unlocked: string[] = [];
  for (const [blockId, cur] of now) {
    const prev = was.get(blockId);
    const on = (st: string) => st === 'firing' || st === 'eligible_unapproved';
    if (prev && !on(prev.status) && on(cur.status)) unlocked.push(cur.header);
  }
  return unlocked;
}

/**
 * The direction that binds a draft: the file's, then this document's.
 *
 * Every generator reads this, so the partner's instruction on the file
 * reaches the letter, the claim and the brief without being retyped into
 * each one.
 */
export function directionForGeneration(matter: unknown, documentType: string): {
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
export async function applyDirectionAftermath(
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
export async function directionDepartureFlags(
  html: string,
  instructions: Array<{ id: string; text: string; kind: string; mustInclude?: string[]; mustNotInclude?: string[] }>,
): Promise<string[]> {
  if (instructions.length === 0) return [];
  const flags = [...checkDirectionTerms(html, instructions as never)];

  try {
    const { crossProviderChat } = await import('../../../providers/cross-provider-chat.js');
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
export async function styleReviewFlags(
  html: string,
  identifiers: string[],
  label: string,
  intake: Record<string, unknown>,
  amount?: number,
): Promise<string[]> {
  const { checkPrecedentBleed } = await import('../../../employment/style-profile.js');
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
/**
 * Additional heads of damage the FILE supports, beyond pay in lieu of
 * notice. Head and basis are asserted from the record; the amount stays
 * null for the lawyer to quantify, because these figures are judgment, not
 * arithmetic. Only what the intake actually flags appears.
 */
export function buildAdditionalHeads(intake: EmploymentIntakeData): Array<{ name: string; basis: string; estimatedAmount?: number }> {
  const heads: Array<{ name: string; basis: string; estimatedAmount?: number }> = [];
  if (intake.believes_discriminatory_termination || intake.hrc_protected_ground) {
    heads.push({ name: 'Human Rights Code damages', basis: 'injury to dignity, feelings and self-respect (Human Rights Code s. 46.1)' });
  }
  if (intake.bad_faith_details || (Array.isArray(intake.bad_faith_conduct) && intake.bad_faith_conduct.length > 0)) {
    heads.push({ name: 'Moral (aggravated) damages', basis: 'bad faith in the manner of dismissal (Honda v Keays)' });
  }
  if (intake.false_cause_alleged || intake.employer_alleged_just_cause) {
    heads.push({ name: 'Punitive damages', basis: 'reserved pending the conduct particulars; plead where the manner of dismissal warrants' });
  }
  if (intake.esa_sev_shortfall || intake.esa_term_shortfall) {
    heads.push({ name: 'ESA termination and severance shortfall', basis: 'statutory minimums under the Employment Standards Act, 2000, to the extent unpaid' });
  }
  if (intake.unpaid_commission || intake.vacation_unpaid || intake.holiday_pay_unpaid) {
    heads.push({ name: 'Unpaid wages and vacation pay', basis: 'earned amounts outstanding at termination' });
  }
  return heads;
}

export function recomputeAnalysis(employment: EmploymentMatterData): void {
  const intake = employment.intake;

  // Timeline (preserving rebuild — lawyer entries and ticklers survive)
  employment.timeline = rebuildTimelinePreserving(employment.timeline, intake);

  // Gates
  employment.gates = evaluateGates(intake);

  // Bardal factors
  const bardal = computeBardalFactors(intake);

  // Limitation deadline
  const limitation = computeLimitationDeadline(intake.termination_date ?? undefined);

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
  // The recited tenure carries the maths when the exact dates are
  // unknowable ("33 years of service" in the demand letter).
  if (tenureYears === 0 && typeof intake.years_of_service_estimate === 'number' && intake.years_of_service_estimate > 0) {
    tenureYears = intake.years_of_service_estimate;
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
      // The additional heads the file supports, so the demand table and the
      // brief itemise more than pay-in-lieu. Amounts stay unquantified
      // (the lawyer supplies them); the head and its basis are what the
      // record can assert. An empty list made every multi-head letter fire
      // the "differs materially" alarm and trained the lawyer to ignore it.
      additionalHeads: buildAdditionalHeads(employment.intake),
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
export function ensureAnalysisFresh(employment: EmploymentMatterData): boolean {
  if (!employment.analysis) return false;
  const revised = employment.intakeRevisedAt;
  const analysed = employment.analysisRevisedAt;
  if (revised && (!analysed || analysed < revised)) {
    recomputeAnalysis(employment);
    return true;
  }
  return false;
}


// ── Lifted from the route handlers (shared across domains) ──────────────
export const extractBodySchema = z.object({
  matterId: z.string().min(1).max(200),
  documentContent: z.string().min(1).max(100_000),
  documentName: z.string().trim().min(1).max(500),
  documentKind: z.enum(UPLOADABLE_DOCUMENT_TYPES),
  /** Optional party names for anonymisation (e.g. employer name, client name). */
  definedTerms: z.array(z.string().max(200)).max(20).optional(),
});

export function logAuditForm1(userId: string, matterId: string): void {
  logger.info('Form 1 data file generated', { userId, matterId });
}

