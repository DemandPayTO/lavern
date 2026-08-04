/**
 * Revision Loop — apply a client's (or the partner's) feedback to a draft.
 *
 * Spec: docs/specs/revision-loop-2026-08.md.
 *
 * Feedback produces a PLAN, never a direct edit. Each item is mapped to the
 * paragraphs it affects and classified; the lawyer approves item by item;
 * only approved items are applied. Two properties make that safe:
 *
 *  1. Untouched paragraphs must come back byte-identical. A revision pass
 *     must never quietly restyle a pleading, so an apply whose model output
 *     drifted outside the approved paragraphs is REFUSED rather than shown.
 *  2. A factual correction updates the INTAKE, not just the document. A
 *     corrected hire date that lives only in one sentence leaves the matter
 *     wrong: every later document repeats it and the limitation and notice
 *     calculations stay wrong. That is the half-fix that misses deadlines.
 *
 * The planning step is a model call. Everything here is deterministic.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('REVISION-LOOP');

// ── Types ────────────────────────────────────────────────────────────────

export const REVISION_KINDS = ['factual_correction', 'position_change', 'wording', 'needs_lawyer'] as const;
export type RevisionKind = typeof REVISION_KINDS[number];

export interface RevisionItem {
  id: string;
  /** The feedback as the client wrote it, verbatim. */
  feedback: string;
  kind: RevisionKind;
  /** Indices into the document's paragraphs that this item touches. */
  paragraphIndices: number[];
  /** What the planner proposes to do, in plain language. */
  proposal: string;
  /** For factual_correction: the intake field and its corrected value. */
  intakeField?: string;
  intakeValue?: string | number | boolean;
  /** Why the lawyer must decide, when kind is needs_lawyer. */
  reason?: string;
}

export interface RevisionPlan {
  documentType: string;
  paragraphs: string[];
  items: RevisionItem[];
  warnings: string[];
}

export interface ApplyResult {
  ok: boolean;
  error?: string;
  /** The revised paragraphs, when the apply succeeded. */
  paragraphs?: string[];
  /** Paragraph indices that actually changed. */
  changedIndices?: number[];
  /** Intake fields the approved factual corrections write. */
  intakeUpdates?: Record<string, string | number | boolean>;
  /** Paragraphs that drifted without approval — the reason for a refusal. */
  drifted?: number[];
}

// ── Document handling ────────────────────────────────────────────────────

/**
 * Split generated HTML into addressable paragraphs, preserving each block's
 * markup so a revision can be written back without losing structure.
 */
export function toParagraphs(html: string): string[] {
  const blocks = html
    .split(/(?=<(?:p|h[1-6]|li|blockquote|tr)[\s>])/i)
    .map(b => b.trim())
    .filter(Boolean);
  return blocks.length > 0 ? blocks : [html.trim()].filter(Boolean);
}

export function fromParagraphs(paragraphs: string[]): string {
  return paragraphs.join('\n');
}

/** Text of a paragraph, for comparison and for the planner's view. */
export function paragraphText(block: string): string {
  return block
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/\s+/g, ' ')
    // Removing an inline tag leaves a space before the punctuation that
    // followed it ("March 2 ." from "March 2</strong>."). The planner reads
    // this text and cites it back, so it should read as the document does.
    .replace(/\s+([.,;:!?)\]])/g, '$1')
    .replace(/([(\[])\s+/g, '$1')
    .trim();
}

// ── Sections ─────────────────────────────────────────────────────────────

/** Heading paragraph indices and their text, for section-scoped redrafts. */
export function listSectionHeadings(paragraphs: string[]): Array<{ index: number; heading: string }> {
  const out: Array<{ index: number; heading: string }> = [];
  for (let i = 0; i < paragraphs.length; i++) {
    if (/^<h[123][\s>]/i.test(paragraphs[i])) {
      const text = paragraphText(paragraphs[i]);
      if (text) out.push({ index: i, heading: text });
    }
  }
  return out;
}

/**
 * The paragraph range of one section: from the paragraph after its heading
 * to the paragraph before the next heading (end exclusive). The heading
 * itself is excluded — a redraft rewrites content, not the document's
 * structure. Null when no heading matches.
 */
export function sectionParagraphRange(
  paragraphs: string[],
  sectionHeading: string,
): { start: number; end: number } | null {
  const wanted = sectionHeading.replace(/\s+/g, ' ').trim().toLowerCase();
  const headings = listSectionHeadings(paragraphs);
  for (let h = 0; h < headings.length; h++) {
    if (headings[h].heading.toLowerCase() === wanted) {
      const start = headings[h].index + 1;
      const end = h + 1 < headings.length ? headings[h + 1].index : paragraphs.length;
      return start < end ? { start, end } : null;
    }
  }
  return null;
}

// ── The safety property ──────────────────────────────────────────────────

/**
 * Verify that only the approved paragraphs changed.
 *
 * Everything the lawyer did not approve a change to must be byte-identical.
 * This is what stops a revision pass from rewording an untouched paragraph
 * of a pleading, which no diff review would reliably catch across a long
 * document.
 */
export function verifyOnlyApprovedChanged(
  before: string[],
  after: string[],
  approvedIndices: ReadonlySet<number>,
): { ok: boolean; drifted: number[]; changed: number[] } {
  const drifted: number[] = [];
  const changed: number[] = [];

  if (before.length !== after.length) {
    // A changed paragraph COUNT means blocks were added or removed, which
    // no approved item authorises: an item edits paragraphs in place.
    return { ok: false, drifted: [-1], changed: [] };
  }

  for (let i = 0; i < before.length; i++) {
    if (before[i] === after[i]) continue;
    changed.push(i);
    if (!approvedIndices.has(i)) drifted.push(i);
  }
  return { ok: drifted.length === 0, drifted, changed };
}

/**
 * Apply the revised paragraphs from the model, refusing on drift.
 *
 * `revised` maps paragraph index to its new markup. Indices outside the
 * approved set are ignored rather than trusted, and the verification below
 * then catches any that slipped through.
 */
export function applyRevisions(
  paragraphs: string[],
  approvedItems: RevisionItem[],
  revised: Record<number, string>,
): ApplyResult {
  const approvedIndices = new Set<number>();
  for (const item of approvedItems) {
    for (const idx of item.paragraphIndices) {
      if (idx >= 0 && idx < paragraphs.length) approvedIndices.add(idx);
    }
  }

  const next = [...paragraphs];
  for (const [rawIdx, markup] of Object.entries(revised)) {
    const idx = Number(rawIdx);
    if (!approvedIndices.has(idx)) continue;      // not authorised: ignore
    if (typeof markup !== 'string' || !markup.trim()) continue;
    next[idx] = markup.trim();
  }

  const check = verifyOnlyApprovedChanged(paragraphs, next, approvedIndices);
  if (!check.ok) {
    logger.warn('Revision refused: text changed outside the approved paragraphs', { drifted: check.drifted });
    return {
      ok: false,
      error: check.drifted[0] === -1
        ? 'The revision changed the number of paragraphs. Nothing was applied.'
        : 'The revision altered paragraphs that were not approved. Nothing was applied.',
      drifted: check.drifted,
    };
  }

  // Intake corrections carried by the approved items.
  const intakeUpdates: Record<string, string | number | boolean> = {};
  for (const item of approvedItems) {
    if (item.kind === 'factual_correction' && item.intakeField && item.intakeValue !== undefined) {
      intakeUpdates[item.intakeField] = item.intakeValue;
    }
  }

  return { ok: true, paragraphs: next, changedIndices: check.changed, intakeUpdates };
}

// ── Plan validation ──────────────────────────────────────────────────────

/**
 * Ground a model-proposed plan against the real document.
 *
 * Items pointing at paragraphs that do not exist are dropped rather than
 * shown, and an item that proposes an intake change to a field outside the
 * allowlist is demoted to needs_lawyer instead of being trusted.
 */
export function groundPlan(
  plan: { items: RevisionItem[] },
  paragraphs: string[],
  allowedIntakeFields: ReadonlySet<string>,
): { items: RevisionItem[]; warnings: string[] } {
  const warnings: string[] = [];
  const items: RevisionItem[] = [];

  for (const raw of plan.items) {
    const indices = (raw.paragraphIndices ?? []).filter(i => Number.isInteger(i) && i >= 0 && i < paragraphs.length);

    if (raw.kind !== 'needs_lawyer' && indices.length === 0) {
      // Cannot be grounded in the document: the lawyer decides rather than
      // the system guessing where it belongs.
      items.push({ ...raw, kind: 'needs_lawyer', paragraphIndices: [],
        reason: raw.reason ?? 'This feedback could not be tied to a specific paragraph.' });
      continue;
    }

    if (raw.kind === 'factual_correction' && raw.intakeField && !allowedIntakeFields.has(raw.intakeField)) {
      warnings.push(`"${raw.intakeField}" is not a field Starling stores, so this correction changes the document only.`);
      items.push({ ...raw, paragraphIndices: indices, intakeField: undefined, intakeValue: undefined });
      continue;
    }

    // A factual correction that carries no intake field changes the
    // document only: the matter keeps the wrong fact, so later documents
    // repeat it and the deadline maths stays wrong. Say so rather than
    // letting it pass as a complete fix.
    if (raw.kind === 'factual_correction' && !raw.intakeField) {
      warnings.push(
        `"${(raw.feedback ?? '').slice(0, 60)}" corrects the document only. `
        + 'The matter still holds the original value, so check the Intake tab if this fact matters to the deadlines.',
      );
    }

    items.push({ ...raw, paragraphIndices: indices });
  }

  return { items, warnings };
}

/** Fields a factual correction may write. Mirrors the extraction apply
 *  loop's allowlist: the same guard, for the same reason. */
export const CORRECTABLE_INTAKE_FIELDS: ReadonlySet<string> = new Set([
  'client_first_name', 'client_last_name', 'client_address', 'client_email',
  'client_phone', 'client_age', 'client_date_of_birth',
  'employer_legal_name', 'employer_address', 'employer_industry',
  'job_title', 'hire_date', 'termination_date', 'annual_salary',
  'salary_period', 'bonus_structure', 'benefits_description',
  'employment_type', 'hours_per_week', 'reporting_to',
  'termination_reasons', 'employer_alleged_just_cause',
  'severance_weeks_offered', 'severance_payment_type', 'severance_deadline',
]);

/** Corrections that invalidate a previously run analysis. */
const ANALYSIS_INPUT_FIELDS: ReadonlySet<string> = new Set([
  'hire_date', 'termination_date', 'annual_salary', 'salary_period',
  'employer_alleged_just_cause', 'severance_weeks_offered', 'job_title',
]);

export function correctionMakesAnalysisStale(intakeUpdates: Record<string, unknown>): boolean {
  return Object.keys(intakeUpdates).some(f => ANALYSIS_INPUT_FIELDS.has(f));
}

// ── Planner prompt ───────────────────────────────────────────────────────

export function buildPlannerSystemPrompt(): string {
  return `You map a client's feedback on a legal document onto the specific paragraphs it affects. You do NOT rewrite the document.

For each distinct piece of feedback, return one item classified as exactly one of:
- "factual_correction": the client corrects a fact (a date, a name, a figure, a job title). You MUST set "intakeField" and "intakeValue" whenever the corrected fact is one of the fields listed below. This is not optional: a correction that changes only the document leaves the matter's own record wrong, so every later document repeats the error and the limitation and notice calculations stay wrong.
  Fields you may set, with their formats:
    client_first_name, client_last_name, client_address, client_email, client_phone (text)
    client_age (number), client_date_of_birth, hire_date, termination_date, severance_deadline (YYYY-MM-DD)
    employer_legal_name, employer_address, employer_industry, job_title, reporting_to (text)
    annual_salary, hours_per_week, severance_weeks_offered (number)
    salary_period, employment_type, bonus_structure, benefits_description, termination_reasons, severance_payment_type (text)
    employer_alleged_just_cause (true/false)
  Convert dates to YYYY-MM-DD and strip currency symbols and commas from numbers.
- "position_change": the client wants a different claim, remedy, or legal position advanced.
- "wording": tone, emphasis, clarity, or length, with no change to facts or position.
- "needs_lawyer": anything you must not act on alone. This includes a client's characterisation of motive or state of mind ("they fired me because they hated me"), an instruction that would change the legal theory of the case, an allegation with no factual support in the document, an instruction to remove something that appears to be legally required, and anything you cannot tie to a specific paragraph.

RULES:
- Cite paragraph indices from the numbered list you are given. Never invent an index.
- Prefer "needs_lawyer" whenever you are unsure. A refused item costs the lawyer a moment; a wrongly applied one damages the file.
- A client's belief about why something happened is not a pleadable fact. Classify it "needs_lawyer" and say so in "reason".
- Never propose removing a limitation date, a statutory entitlement, or a required formality.
- Do not use em dashes.

Return ONLY JSON: {"items":[{"feedback":"...","kind":"...","paragraphIndices":[0],"proposal":"...","intakeField":"...","intakeValue":"...","reason":"..."}]}
Omit intakeField, intakeValue and reason where they do not apply.`;
}

export function buildPlannerUserPrompt(args: {
  documentTitle: string;
  paragraphs: string[];
  feedback: string;
  source: 'client' | 'partner' | 'lawyer';
  /** Restrict the plan to one section's paragraphs. */
  section?: { heading: string; start: number; end: number };
}): string {
  const numbered = args.paragraphs
    .map((p, i) => `[${i}] ${paragraphText(p).slice(0, 600)}`)
    .join('\n');
  const sourceLabel = args.source === 'partner' ? 'REVIEWING LAWYER'
    : args.source === 'lawyer' ? 'DRAFTING LAWYER (their own redraft instructions)'
    : 'CLIENT';
  const sectionRule = args.section
    ? `\n\nSCOPE: The lawyer is redrafting ONLY the section "${args.section.heading}" (paragraphs ${args.section.start} to ${args.section.end - 1}). Every item MUST target only paragraphs in that range. Feedback that touches anything outside it becomes a needs_lawyer item with no paragraph indices.`
    : '';
  return `DOCUMENT: ${args.documentTitle}

PARAGRAPHS:
${numbered}

FEEDBACK FROM THE ${sourceLabel}:
${args.feedback}${sectionRule}

Map each distinct piece of feedback onto the paragraphs above.`;
}

/** Prompt for the apply step: rewrite ONLY the approved paragraphs. */
export function buildApplySystemPrompt(): string {
  return `You revise specific paragraphs of a legal document according to instructions the lawyer has approved.

RULES:
- Return ONLY the paragraphs you were asked to revise, each under its original index.
- Preserve the HTML structure of each paragraph (the same tag it arrived in).
- Change nothing beyond what the instruction requires. Keep the firm's wording, numbering, and citations intact wherever the instruction does not touch them.
- Never add a new claim, authority, or figure that the instruction does not give you.
- Canadian English. Do not use em dashes.

Return ONLY JSON: {"revised":{"0":"<p>...</p>"}}`;
}
