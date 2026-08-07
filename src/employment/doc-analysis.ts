/**
 * Document analysis — read a document the way a junior would, and show
 * your work.
 *
 * The lawyer uploads a bonus plan, an employment agreement, a termination
 * letter, a pay stub or a client's written summary and asks Starling to
 * read it: summarize it, run the checks that always matter for that kind
 * of document, answer the lawyer's own questions, and, when a second
 * document is attached (a case, an earlier version), compare the two.
 *
 * This is a separate lane from document-reviews.ts, which is the partner
 * approval workflow for OUTBOUND drafts. Nothing here drafts anything or
 * binds anything: the output is an internal read, stored on the matter.
 *
 * Discipline:
 * - Deterministic first: each kind carries a fixed checklist, and a
 *   regex pre-pass surfaces the numbers (percentages, dollar amounts)
 *   before any model is asked anything.
 * - Every "present" checklist finding must carry a quote that verifies
 *   against the document by string search. A finding whose quote does
 *   not survive is downgraded to "unclear" and says so: a claim about a
 *   document the document does not contain is exactly the failure this
 *   feature must never produce.
 * - Clamp before validate: a long document produces long output, and a
 *   schema that rejects "slightly too long" turns good work into an
 *   error message.
 */

import { z } from 'zod';
import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('doc-analysis');

// ── Kinds and their checklists ───────────────────────────────────────────

export const ANALYZABLE_KINDS = [
  'bonus_plan',
  'employment_agreement',
  'termination_letter',
  'pay_stub',
  'client_summary',
  'other',
] as const;
export type AnalyzableKind = typeof ANALYZABLE_KINDS[number];

export const KIND_LABELS: Record<AnalyzableKind, string> = {
  bonus_plan: 'Bonus or incentive plan',
  employment_agreement: 'Employment agreement',
  termination_letter: 'Termination letter',
  pay_stub: 'Pay stub',
  client_summary: 'Written summary from the client',
  other: 'Other document',
};

export interface ChecklistItem {
  id: string;
  label: string;
  /** What the reader is told to look for, in plain terms. */
  lookFor: string;
}

/**
 * The checks that always matter for each kind of document, on a
 * plaintiff-side Ontario employment file. Fixed in code so the same
 * document gets the same read on every matter.
 */
export const KIND_CHECKLISTS: Record<AnalyzableKind, ChecklistItem[]> = {
  bonus_plan: [
    { id: 'active_employment_condition', label: 'Active employment condition', lookFor: 'Language requiring the employee to be actively employed on the payment or vesting date to receive the bonus.' },
    { id: 'forfeiture_on_termination', label: 'Forfeiture on termination', lookFor: 'Language purporting to remove bonus entitlement on termination, resignation, or notice, including during the reasonable notice period.' },
    { id: 'discretion_language', label: 'Discretion language', lookFor: 'Whether the bonus is described as discretionary, and whether the discretion is absolute or structured by criteria such as targets or formulas.' },
    { id: 'notice_period_carveout', label: 'Notice period treatment', lookFor: 'Whether the plan addresses entitlement during a notice period, and whether any exclusion is expressed in language clear enough to oust common law damages.' },
    { id: 'eligibility_and_timing', label: 'Eligibility and payment timing', lookFor: 'Who is eligible, the performance period, and when payment is made.' },
    { id: 'amendment_rights', label: 'Unilateral amendment rights', lookFor: 'Language letting the employer amend or cancel the plan at any time.' },
  ],
  employment_agreement: [
    { id: 'termination_clause', label: 'Termination clause', lookFor: 'The without-cause and for-cause termination provisions, quoted in full.' },
    { id: 'cause_below_wilful', label: 'For-cause standard below wilful misconduct', lookFor: 'A for-cause provision that removes entitlements on a standard lower than the ESA wilful misconduct standard, which can invalidate the whole termination scheme.' },
    { id: 'esa_only_limits', label: 'Attempt to limit to ESA minimums', lookFor: 'Language limiting notice or severance to Employment Standards Act, 2000 minimums, and whether it covers benefit continuation, severance pay, and vacation pay through the notice period.' },
    { id: 'bonus_exclusion', label: 'Variable compensation on termination', lookFor: 'Language addressing bonus, commission, or incentive entitlement on termination.' },
    { id: 'restrictive_covenants', label: 'Restrictive covenants', lookFor: 'Non-competition, non-solicitation, or confidentiality covenants, their scope, and their duration. Note that non-competes entered after October 25, 2021 are generally void in Ontario except for executives and business sales.' },
    { id: 'consideration', label: 'Fresh consideration', lookFor: 'Whether the agreement was signed at hiring or during employment, and any recital of consideration for a mid-employment agreement.' },
    { id: 'probation', label: 'Probationary language', lookFor: 'Any probationary period and what it purports to permit.' },
  ],
  termination_letter: [
    { id: 'cause_alleged', label: 'Cause allegation', lookFor: 'Whether the employer alleges cause or wilful misconduct, and in what words.' },
    { id: 'notice_offered', label: 'Notice or pay offered', lookFor: 'The working notice, pay in lieu, or severance offered, with amounts and periods.' },
    { id: 'benefits_continuation', label: 'Benefit continuation', lookFor: 'Whether benefits continue through the statutory notice period, which the ESA requires.' },
    { id: 'release_demanded', label: 'Release condition', lookFor: 'Whether any payment beyond statutory minimums is conditioned on signing a release, and the deadline given.' },
    { id: 'deadline_pressure', label: 'Deadline pressure', lookFor: 'Short deadlines or language pressing the employee to sign quickly.' },
    { id: 'reference_and_logistics', label: 'Reference and logistics', lookFor: 'Reference commitments, ROE timing, equipment return, and final pay logistics.' },
  ],
  pay_stub: [
    { id: 'vacation_pay_rate', label: 'Vacation pay rate', lookFor: 'The vacation pay percentage or amount. The ESA minimum is 4 percent of wages for under five years of employment and 6 percent for five years or more. Some employers pay vacation pay only when the employee takes vacation time rather than on every cheque, so an absent vacation line is NOT by itself evidence of underpayment: mark it unclear and say the client should confirm whether vacation pay is paid when vacation time is taken.' },
    { id: 'vacation_pay_on_variable', label: 'Vacation pay on variable earnings', lookFor: 'Whether vacation pay is being calculated on commissions, bonuses, and overtime, which are wages, or only on base salary.' },
    { id: 'overtime', label: 'Overtime', lookFor: 'Overtime hours and the rate paid. The ESA requires time and a half after 44 hours in a week for most employees.' },
    { id: 'deductions', label: 'Deductions', lookFor: 'Any deduction that is not statutory or authorized in writing.' },
    { id: 'pay_period_math', label: 'Pay period arithmetic', lookFor: 'Whether gross pay, rate, and hours are internally consistent on the face of the stub.' },
  ],
  client_summary: [
    { id: 'key_dates', label: 'Key dates', lookFor: 'Start date, termination or resignation date, and any dates of specific incidents.' },
    { id: 'compensation_details', label: 'Compensation details', lookFor: 'Salary, bonus, commission, benefits, and any figures the client states.' },
    { id: 'treatment_allegations', label: 'Treatment allegations', lookFor: 'Allegations of harassment, discrimination, bad faith conduct, or changes to duties or pay.' },
    { id: 'mitigation_facts', label: 'Mitigation facts', lookFor: 'Job search efforts, new employment, or income since departure.' },
    { id: 'gaps_and_questions', label: 'Gaps to ask about', lookFor: 'What the summary does not say that the file will need: written agreement, ROE, medical leave, protected grounds.' },
  ],
  other: [
    { id: 'nature', label: 'What this document is', lookFor: 'What kind of document this is and who produced it.' },
    { id: 'obligations', label: 'Obligations created', lookFor: 'Any obligation, deadline, or entitlement the document creates or removes.' },
    { id: 'dates_and_amounts', label: 'Dates and amounts', lookFor: 'Every date and dollar amount that matters, with context.' },
  ],
};

// ── Deterministic pre-pass ───────────────────────────────────────────────

/**
 * Surface the numbers before any model reads anything. Free, exact,
 * instant. These notes ride along in the stored analysis so the lawyer
 * sees what a regex found regardless of what the model made of it.
 */
export function deterministicNotes(kind: AnalyzableKind, text: string): string[] {
  const notes: string[] = [];

  const percents = [...new Set([...text.matchAll(/(\d{1,2}(?:\.\d{1,2})?)\s?%/g)].map(m => m[1]))];
  if (percents.length > 0) {
    notes.push(`Percentages on the face of the document: ${percents.map(p => `${p}%`).join(', ')}.`);
  }
  if (kind === 'pay_stub') {
    const hasVacationWord = /vacation/i.test(text);
    if (!hasVacationWord) {
      notes.push('No vacation pay line appears on this stub. Some employers pay vacation pay only when the employee takes vacation time rather than on every cheque, so this alone proves nothing: confirm with the client how vacation pay is handled.');
    } else if (!percents.some(p => parseFloat(p) >= 4)) {
      notes.push('No percentage of 4% or higher appears on the stub. The ESA minimum vacation pay is 4% (6% at five years of employment). Confirm whether additional vacation pay is paid when vacation time is taken.');
    }
  }

  const amounts = [...text.matchAll(/\$\s?([\d,]+(?:\.\d{2})?)/g)]
    .map(m => m[1])
    .filter(a => a.replace(/[^\d]/g, '').length >= 3);
  if (amounts.length > 0) {
    const unique = [...new Set(amounts)].slice(0, 12);
    notes.push(`Dollar amounts on the face of the document: ${unique.map(a => `$${a}`).join(', ')}${amounts.length > unique.length ? ' and others' : ''}.`);
  }

  if (kind === 'employment_agreement' && /non.?compet/i.test(text)) {
    notes.push('The document contains non-competition language. Non-competes entered after October 25, 2021 are generally void in Ontario outside the executive and sale-of-business exceptions.');
  }

  return notes;
}

// ── Result schema ────────────────────────────────────────────────────────

const checklistFindingSchema = z.object({
  id: z.string().max(80),
  status: z.enum(['present', 'absent', 'unclear']),
  finding: z.string().max(2000),
  quote: z.string().max(1500).optional(),
});

const answerSchema = z.object({
  question: z.string().max(600),
  answer: z.string().max(3000),
  quote: z.string().max(1500).optional(),
});

const comparisonSchema = z.object({
  commonGround: z.array(z.string().max(1200)).max(10),
  differences: z.array(z.string().max(1200)).max(12),
  takeaway: z.string().max(2500),
});

export const docAnalysisResultSchema = z.object({
  summary: z.string().min(1).max(6000),
  checklist: z.array(checklistFindingSchema).max(30),
  answers: z.array(answerSchema).max(12),
  comparison: comparisonSchema.nullable().optional(),
  redFlags: z.array(z.string().max(1200)).max(12),
});

export type DocAnalysisResult = z.infer<typeof docAnalysisResultSchema>;

export interface StoredDocAnalysis {
  id: string;
  createdAt: string;
  docName: string;
  kind: AnalyzableKind;
  questions: string[];
  comparisonName?: string;
  deterministicNotes: string[];
  result: DocAnalysisResult;
  costUsd: number;
}

/** How many analyses a matter keeps. Oldest are dropped past the cap. */
export const DOC_ANALYSES_CAP = 25;

// ── Clamp before validate ────────────────────────────────────────────────

/**
 * A model writing every key emits null where the schema says optional,
 * and a long document earns a long summary. Neither is a failure worth
 * showing a lawyer, so both are normalised before Zod sees them.
 */
export function clampDocAnalysis(raw: unknown): unknown {
  if (typeof raw !== 'object' || raw === null) return raw;
  const r = { ...(raw as Record<string, unknown>) };

  const clampStr = (v: unknown, max: number): unknown =>
    typeof v === 'string' && v.length > max ? v.slice(0, max - 1).trimEnd() + '…' : v;
  const dropNull = (obj: Record<string, unknown>, keys: string[]) => {
    for (const k of keys) if (obj[k] === null || obj[k] === '') delete obj[k];
  };

  r.summary = clampStr(r.summary, 6000);
  if (Array.isArray(r.checklist)) {
    r.checklist = r.checklist.slice(0, 30).map(item => {
      if (typeof item !== 'object' || item === null) return item;
      const c = { ...(item as Record<string, unknown>) };
      c.finding = clampStr(c.finding, 2000);
      c.quote = clampStr(c.quote, 1500);
      dropNull(c, ['quote']);
      return c;
    });
  }
  if (Array.isArray(r.answers)) {
    r.answers = r.answers.slice(0, 12).map(item => {
      if (typeof item !== 'object' || item === null) return item;
      const a = { ...(item as Record<string, unknown>) };
      a.question = clampStr(a.question, 600);
      a.answer = clampStr(a.answer, 3000);
      a.quote = clampStr(a.quote, 1500);
      dropNull(a, ['quote']);
      return a;
    });
  }
  if (r.comparison && typeof r.comparison === 'object') {
    const c = { ...(r.comparison as Record<string, unknown>) };
    if (Array.isArray(c.commonGround)) c.commonGround = c.commonGround.slice(0, 10).map(s => clampStr(s, 1200));
    if (Array.isArray(c.differences)) c.differences = c.differences.slice(0, 12).map(s => clampStr(s, 1200));
    c.takeaway = clampStr(c.takeaway, 2500);
    r.comparison = c;
  }
  if (Array.isArray(r.redFlags)) r.redFlags = r.redFlags.slice(0, 12).map(s => clampStr(s, 1200));

  return r;
}

// ── Quote verification ───────────────────────────────────────────────────

const normalise = (s: string) =>
  s.toLowerCase().replace(/[‘’]/g, "'").replace(/[“”]/g, '"').replace(/\s+/g, ' ').trim();

/** True when the quote appears in the document, whitespace and smart quotes aside. */
export function quoteVerifies(quote: string | undefined, docText: string): boolean {
  if (!quote || quote.trim().length < 8) return false;
  return normalise(docText).includes(normalise(quote));
}

/**
 * A "present" finding whose quote does not verify is downgraded to
 * "unclear" and says why. Answers keep their prose but lose a quote
 * that does not verify, so nothing on screen claims the document says
 * something it does not.
 */
export function enforceAnalysisQuotes(result: DocAnalysisResult, docText: string, comparisonText?: string): DocAnalysisResult {
  const inEither = (q: string | undefined) =>
    quoteVerifies(q, docText) || (comparisonText ? quoteVerifies(q, comparisonText) : false);

  const checklist = result.checklist.map(item => {
    if (item.status !== 'present') return item.quote && !inEither(item.quote) ? { ...item, quote: undefined } : item;
    if (inEither(item.quote)) return item;
    return {
      ...item,
      status: 'unclear' as const,
      quote: undefined,
      finding: `${item.finding} [The quote offered for this finding did not verify against the document. Read the document on this point before relying on it.]`,
    };
  });

  const answers = result.answers.map(a => (a.quote && !inEither(a.quote) ? { ...a, quote: undefined } : a));

  return { ...result, checklist, answers };
}

// ── Prompt ───────────────────────────────────────────────────────────────

const ANALYSIS_SYSTEM = `You are a careful employment law document reader working inside a plaintiff-side Ontario employment law practice. You read documents for the lawyer, not for the court. You never draft anything outbound, never give advice to a client, and never invent facts.

Rules you must follow:
- Every checklist finding you mark "present" MUST include a verbatim quote from the document, copied exactly. If you cannot quote it, mark it "unclear" and say what you could and could not find.
- "absent" means you read for it and it is not there. That is a real finding on a checklist and it matters: say so plainly.
- Answer the lawyer's questions from the document alone. Where the document does not answer, say so rather than guessing.
- Plain language. No em-dashes. No contractions. Short paragraphs.
- Do not cite caselaw by name unless a case document was provided for comparison, in which case discuss only that case.
- Output strict JSON matching the shape you are given. No markdown, no commentary outside the JSON.`;

export interface DocAnalysisRequest {
  docName: string;
  kind: AnalyzableKind;
  docText: string;
  questions: string[];
  comparisonName?: string;
  comparisonText?: string;
  /** Party names for anonymisation before the text leaves the machine. */
  definedTerms?: string[];
}

export function buildAnalysisPrompt(req: DocAnalysisRequest): string {
  const checklist = KIND_CHECKLISTS[req.kind];
  const lines: string[] = [];

  lines.push(`DOCUMENT KIND: ${KIND_LABELS[req.kind]}`);
  lines.push(`DOCUMENT NAME: ${req.docName}`);
  lines.push('');
  lines.push('CHECKLIST. Report on every item by id:');
  for (const item of checklist) {
    lines.push(`- id "${item.id}" (${item.label}): ${item.lookFor}`);
  }
  lines.push('');
  if (req.questions.length > 0) {
    lines.push('THE LAWYER\'S QUESTIONS. Answer each one:');
    for (const q of req.questions) lines.push(`- ${q}`);
    lines.push('');
  }
  if (req.comparisonText) {
    lines.push(`A COMPARISON DOCUMENT IS ATTACHED (${req.comparisonName ?? 'comparison document'}). After reading the main document, compare the two: what common ground, what differences, and what the comparison means for this file. If the comparison document is a court decision, say how its facts and clauses line up with this document.`);
    lines.push('');
  }
  lines.push('Return JSON of this exact shape:');
  lines.push(JSON.stringify({
    summary: 'A plain-language summary of the document in at most three short paragraphs.',
    checklist: [{ id: 'checklist item id', status: 'present | absent | unclear', finding: 'what you found, in plain words', quote: 'verbatim quote when status is present' }],
    answers: [{ question: 'the question as asked', answer: 'the answer from the document', quote: 'verbatim supporting quote when one exists' }],
    comparison: req.comparisonText ? { commonGround: ['...'], differences: ['...'], takeaway: 'what the comparison means for this file' } : null,
    redFlags: ['anything in the document a plaintiff-side lawyer should not miss'],
  }));
  lines.push('');
  lines.push('THE DOCUMENT:');
  lines.push('"""');
  lines.push(req.docText);
  lines.push('"""');
  if (req.comparisonText) {
    lines.push('');
    lines.push('THE COMPARISON DOCUMENT:');
    lines.push('"""');
    lines.push(req.comparisonText);
    lines.push('"""');
  }
  return lines.join('\n');
}

// ── The run ──────────────────────────────────────────────────────────────

export interface DocAnalysisRun {
  result: DocAnalysisResult;
  deterministicNotes: string[];
  costUsd: number;
}

export async function runDocAnalysis(req: DocAnalysisRequest): Promise<DocAnalysisRun> {
  const notes = deterministicNotes(req.kind, req.docText);

  const chat = await crossProviderChat({
    system: ANALYSIS_SYSTEM,
    user: buildAnalysisPrompt(req),
    tier: 'sonnet',
    maxTokens: 6144,
    extendOnTruncation: true,
    maxRetries: 2,
    definedTerms: req.definedTerms,
  });

  let jsonText = chat.text.trim();
  const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) jsonText = fenced[1].trim();
  const braced = jsonText.match(/\{[\s\S]*\}/);

  let raw: unknown;
  try {
    raw = JSON.parse(braced ? braced[0] : jsonText);
  } catch {
    logger.warn('Doc analysis returned unparseable JSON', { docName: req.docName, kind: req.kind });
    throw new Error('The analysis did not come back in a readable shape. Try again.');
  }

  const parsed = docAnalysisResultSchema.safeParse(clampDocAnalysis(raw));
  if (!parsed.success) {
    logger.warn('Doc analysis failed schema after clamp', {
      docName: req.docName, kind: req.kind,
      issues: parsed.error.issues.slice(0, 5).map(i => `${i.path.join('.')}: ${i.message}`),
    });
    throw new Error('The analysis did not come back in a readable shape. Try again.');
  }

  const result = enforceAnalysisQuotes(parsed.data, req.docText, req.comparisonText);
  return { result, deterministicNotes: notes, costUsd: chat.cost };
}
