/**
 * Draft review — Starling reads a finished document and says what is wrong
 * with it, so the lawyer's own improved version gets a second pair of eyes.
 *
 * This is the mirror of the revision loop. There, the lawyer supplies the
 * feedback and Starling applies it. Here, STARLING supplies the feedback
 * and the lawyer decides: every observation becomes a proposed revision
 * item, approved or not, and the byte-identity guarantee still holds.
 *
 * Two classes of finding, deliberately kept apart:
 *
 *   DETERMINISTIC (checked, not opined): figures in the draft that do not
 *   appear in the matter record; the record's key figures missing from the
 *   draft; a style profile's flow sections absent. These are computed here
 *   with no model call and ranked first, because they are verifiable.
 *
 *   MODEL OBSERVATIONS (judgment, labelled as such): unsupported
 *   assertions, contradictions with the sources, missing points, thin
 *   sections, style drift. Useful, but opinion — the lawyer is told which
 *   is which rather than letting a rhetorical suggestion pose as a finding.
 */

import type { EmploymentIntakeData, IntakeAnalysisResult } from '../types/employment-intake.js';
import type { StyleGuide } from './style-profile.js';
import { usableFlow } from './style-profile.js';

export const REVIEW_CATEGORIES = [
  'figure_mismatch', 'record_contradiction', 'unsupported_assertion',
  'missing_point', 'thin_section', 'style_divergence',
] as const;
export type ReviewCategory = typeof REVIEW_CATEGORIES[number];

export interface ReviewFinding {
  category: ReviewCategory;
  /** What is wrong, in the lawyer's terms. */
  observation: string;
  /** What to do about it — becomes the proposed revision. */
  suggestion: string;
  /** Paragraph indices in the draft, when it points at specific text. */
  paragraphIndices: number[];
  /** checked: computed deterministically. judgment: the model's opinion. */
  basis: 'checked' | 'judgment';
}

// ── Deterministic checks ─────────────────────────────────────────────────

/** Dollar amounts as written in a document. */
function amountsIn(text: string): string[] {
  return [...text.matchAll(/\$\s?([\d]{1,3}(?:,\d{3})+(?:\.\d{2})?|\d{4,})/g)]
    .map(m => `$${m[1]}`);
}

function normaliseAmount(a: string): number {
  return Number(a.replace(/[^0-9.]/g, ''));
}

/**
 * Figures in the draft that the matter record does not know about, and
 * record figures the draft omits. A mediator checks the numbers first, so
 * a figure with no source in the file is the highest-value finding there
 * is — and it is checkable, not a matter of taste.
 */
export function checkFigures(
  draftText: string,
  intake: EmploymentIntakeData | null,
  analysis: IntakeAnalysisResult | null,
  sourceTexts: string[],
  /** Offers on the negotiation ledger: these ARE on the file. */
  ledgerAmounts: number[] = [],
): ReviewFinding[] {
  if (!analysis) return [];
  const findings: ReviewFinding[] = [];

  // Everything the file can vouch for: the analysis figures, the intake's
  // own amounts, and any amount appearing in an attached source.
  const known = new Set<number>();
  const d = analysis.damagesEstimate;
  for (const v of [
    d?.esaNoticePay, d?.esaSeverancePay, d?.commonLawLowAmount, d?.commonLawHighAmount,
    d?.totalEstimateLow, d?.totalEstimateHigh, intake?.annual_salary, intake?.bonus_amount,
    intake?.commission_amount,
  ]) if (typeof v === 'number' && v > 0) known.add(Math.round(v));
  for (const head of d?.additionalHeads ?? []) {
    if (typeof head.estimatedAmount === 'number') known.add(Math.round(head.estimatedAmount));
  }
  for (const src of sourceTexts) {
    for (const a of amountsIn(src)) known.add(Math.round(normaliseAmount(a)));
  }
  // Offers and counters are figures the file knows perfectly well; without
  // this the check flags the employer's own counter as unsupported.
  for (const a of ledgerAmounts) if (typeof a === 'number' && a > 0) known.add(Math.round(a));

  // DERIVED figures are supported too. A demand letter properly computes
  // "seven weeks' pay, being $11,727" from the salary; flagging arithmetic
  // the file implies would make the checked column cry wolf, and a checked
  // finding that is wrong costs more trust than one that is missing.
  const salary = typeof intake?.annual_salary === 'number' ? intake.annual_salary : 0;
  if (salary > 0) {
    const weekly = salary / 52;
    const monthly = salary / 12;
    for (let w = 1; w <= 104; w++) known.add(Math.round(weekly * w));
    for (let m = 1; m <= 24; m++) {
      known.add(Math.round(monthly * m));
      // Half-month steps: notice is often expressed as 4.5 or 7.5 months.
      known.add(Math.round(monthly * (m + 0.5)));
    }
    // Common per-period figures quoted in their own right.
    known.add(Math.round(weekly));
    known.add(Math.round(monthly));
  }
  // Sums of the analysis figures: a letter totals heads of damage.
  const base = [...known];
  for (let i = 0; i < base.length && i < 40; i++) {
    for (let j = i + 1; j < base.length && j < 40; j++) known.add(base[i] + base[j]);
  }

  // A figure is "vouched for" if it is within 1% of a known figure
  // (rounding in prose is normal: $110,000 for $109,998).
  const vouched = (n: number) => [...known].some(k => Math.abs(k - n) <= Math.max(1, k * 0.01));

  const unknown = [...new Set(amountsIn(draftText))]
    .filter(a => {
      const n = normaliseAmount(a);
      return n >= 1000 && !vouched(n);
    });

  if (unknown.length > 0) {
    findings.push({
      category: 'figure_mismatch',
      observation: `${unknown.length === 1 ? 'A figure appears' : 'Figures appear'} in the draft that nothing on the file supports: ${unknown.slice(0, 8).join(', ')}${unknown.length > 8 ? ', ...' : ''}.`,
      suggestion: 'Confirm each figure against the record, or correct it. A number a mediator cannot trace is the fastest way to lose the room.',
      paragraphIndices: [],
      basis: 'checked',
    });
  }

  // The reverse: the assessed range absent from the brief entirely.
  const draftAmounts = new Set(amountsIn(draftText).map(a => Math.round(normaliseAmount(a))));
  const rangeHigh = d?.totalEstimateHigh;
  if (typeof rangeHigh === 'number' && rangeHigh > 0 && draftAmounts.size > 0) {
    const present = [...draftAmounts].some(n => Math.abs(n - rangeHigh) <= Math.max(1, rangeHigh * 0.02));
    if (!present) {
      findings.push({
        category: 'figure_mismatch',
        observation: `The assessed high figure on the file ($${Math.round(rangeHigh).toLocaleString('en-CA')}) does not appear in the draft.`,
        suggestion: 'State the range the file supports, or update the analysis if the position has moved.',
        paragraphIndices: [],
        basis: 'checked',
      });
    }
  }

  return findings;
}

/**
 * Sections of the firm's own flow that the draft does not contain. Style
 * divergence the lawyer explicitly asked to see, and structural absence is
 * checkable where "does this sound like us" is not.
 */
export function checkStyleDivergence(
  draftHeadings: string[],
  guide: StyleGuide | null,
): ReviewFinding[] {
  if (!guide) return [];
  const findings: ReviewFinding[] = [];
  const present = draftHeadings.map(h => h.replace(/\s+/g, ' ').trim().toLowerCase());
  const expected = usableFlow(guide.flow).map(f => f.heading.replace(/\s+/g, ' ').trim());
  const missing = expected.filter(h => !present.includes(h.toLowerCase()));

  if (missing.length > 0) {
    findings.push({
      category: 'style_divergence',
      observation: `The draft is missing ${missing.length === 1 ? 'a section' : 'sections'} your firm's briefs normally carry: ${missing.join('; ')}.`,
      suggestion: 'Add the missing section, or confirm this case does not need it.',
      paragraphIndices: [],
      basis: 'checked',
    });
  }

  if (guide.typicalWords) {
    // Length divergence is reported by the caller, which knows the draft's
    // word count; see reviewLengthFinding.
  }
  return findings;
}

/** Length divergence against the firm's typical depth. */
export function reviewLengthFinding(draftWords: number, guide: StyleGuide | null): ReviewFinding[] {
  if (!guide?.typicalWords || draftWords === 0) return [];
  const ratio = draftWords / guide.typicalWords;
  if (ratio >= 0.6 && ratio <= 1.6) return [];
  const shorter = ratio < 1;
  return [{
    category: 'style_divergence',
    observation: `The draft runs about ${draftWords.toLocaleString('en-CA')} words; your briefs of this kind average about ${guide.typicalWords.toLocaleString('en-CA')}.`,
    suggestion: shorter
      ? 'Consider whether a section has been cut short, or accept the shorter treatment for this case.'
      : 'Consider tightening; mediators stop absorbing long briefs.',
    paragraphIndices: [],
    basis: 'checked',
  }];
}

// ── The model pass ───────────────────────────────────────────────────────

export function buildReviewSystemPrompt(): string {
  return `You review a finished legal document for a senior Ontario employment lawyer who has already edited it. You do NOT rewrite it. You identify what would weaken it in front of a mediator or opposing counsel.

Return findings in these categories only:
- "unsupported_assertion": the draft asserts something the matter record and source documents do not support.
- "record_contradiction": the draft contradicts a fact in the record or in a source document (quote both sides in the observation).
- "missing_point": something in the record or sources that materially helps this client and is not used.
- "thin_section": a section that exists but does too little work for its place in the argument.
- "style_divergence": the draft departs from the firm's described style (flow, voice, or habits) in a way that reads as someone else's document.

RULES:
- Anchor each finding to paragraph indices from the numbered list you are given. A finding with no anchor is only acceptable when it concerns the document as a whole.
- Be specific. "Strengthen the mitigation section" is useless; "paragraph 22 asserts a diligent job search but names no applications, while the mitigation log on file lists eleven" is useful.
- Say what to DO in "suggestion": the lawyer approves it as an instruction.
- Do NOT invent facts, authorities, or figures. If something is unverifiable from what you were given, say so in the observation rather than asserting it.
- Do not comment on formatting, numbering, headings as such, or the cover and closing: those are generated automatically.
- Prefer six sharp findings to twenty soft ones. Say nothing rather than pad.
- Canadian English. No em dashes.

Return ONLY JSON: {"findings":[{"category":"...","observation":"...","suggestion":"...","paragraphIndices":[0]}]}`;
}

export function buildReviewUserPrompt(args: {
  documentTitle: string;
  paragraphs: string[];
  intakeSummary: string;
  sources: Array<{ title: string; text: string }>;
  styleSummary?: string;
}): string {
  const numbered = args.paragraphs
    .map((p, i) => `[${i}] ${p.slice(0, 600)}`)
    .join('\n');
  const sources = args.sources.length > 0
    ? args.sources.map(s => `<source title="${s.title}">\n${s.text.slice(0, 30_000)}\n</source>`).join('\n\n')
    : '(no source documents attached)';
  return `DOCUMENT UNDER REVIEW: ${args.documentTitle}

PARAGRAPHS:
${numbered}

THE MATTER RECORD:
${args.intakeSummary}

SOURCE DOCUMENTS:
${sources}
${args.styleSummary ? `\nTHE FIRM'S STYLE:\n${args.styleSummary}` : ''}

Review the document against the record, the sources, and the firm's style. Report only what would weaken it.`;
}
