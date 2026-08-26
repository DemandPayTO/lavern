/**
 * The firm's own letter, reproduced.
 *
 * A demand letter's value is partly that it reads exactly like the last
 * one the firm sent. The opening block, the first paragraph, the standing
 * headings: these are the firm's form, settled over years, and a letter
 * that paraphrases them is a letter the partner rewrites.
 *
 * Three things were pushing the other way, all of them deliberate and all
 * of them wrong for correspondence. The profile captured voice and flow
 * rather than wording. The prompt said to reuse phrasings "where they fit
 * naturally, never force them". And the opening block was built from
 * Starling's own format, so no amount of teaching could change it: the
 * firm writes a bold "RE: client v. employer" and got "Re: client and
 * employer".
 *
 * This module fills the firm's learned form from the matter record. The
 * wording stays exactly as the firm wrote it; only the slots move.
 *
 * WHAT THIS TRADES. Reproduction cannot drift, which is safer than
 * paraphrase. The risk moves to two places, and both are flagged rather
 * than hidden: a slot with no value on this file, and standard language
 * whose assumptions do not fit this matter. A Background recitation
 * written for a dismissal, used on a file where the client resigned, is
 * confident, fluent and wrong.
 *
 * Deterministic: no model call.
 */

import type { EmploymentIntakeData, IntakeAnalysisResult } from '../types/employment-intake.js';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface SlotValues {
  intake: EmploymentIntakeData;
  analysis?: IntakeAnalysisResult | null;
  recipientName?: string;
  recipientAddress?: string;
  salutation?: string;
  lawyerName?: string;
  firmName?: string;
  fileNumber?: string;
  demandAmount?: number;
  responseDeadlineDays?: number;
}

const cad = (n: number): string => `$${Math.round(n).toLocaleString('en-CA')}`;

/** ISO date to the long form Ontario correspondence uses. */
function longDate(iso?: string | null): string | undefined {
  if (!iso) return undefined;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return undefined;
  return d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
}

/**
 * What each slot resolves to on this file. A slot with no value resolves
 * to undefined, never to a guess or an empty string: the lawyer is shown
 * the gap instead.
 */
export function resolveSlots(v: SlotValues): Record<string, string | undefined> {
  const client = [v.intake.client_first_name, v.intake.client_last_name].filter(Boolean).join(' ');
  const deadline = v.responseDeadlineDays
    ? longDate(new Date(Date.now() + v.responseDeadlineDays * 86_400_000).toISOString().slice(0, 10))
    : undefined;
  const years = v.analysis?.bardalFactors?.tenureYears;

  return {
    CLIENT: client || undefined,
    'CLIENT NAME': client || undefined,
    EMPLOYER: v.intake.employer_legal_name ?? v.intake.employer_operating_name ?? undefined,
    'EMPLOYER NAME': v.intake.employer_legal_name ?? v.intake.employer_operating_name ?? undefined,
    RECIPIENT: v.recipientName,
    'RECIPIENT ADDRESS': v.recipientAddress,
    SALUTATION: v.salutation,
    DATE: longDate(new Date().toISOString().slice(0, 10)),
    'DATE OF HIRE': longDate(v.intake.hire_date ?? v.intake.first_day_of_work),
    'DATE OF TERMINATION': longDate(v.intake.termination_date),
    POSITION: v.intake.job_title ?? undefined,
    'YEARS OF SERVICE': typeof years === 'number' ? years.toFixed(1) : undefined,
    SALARY: v.intake.annual_salary ? cad(v.intake.annual_salary) : undefined,
    'DEMAND AMOUNT': v.demandAmount ? cad(v.demandAmount) : undefined,
    'RESPONSE DEADLINE': deadline,
    'FILE NUMBER': v.fileNumber,
    LAWYER: v.lawyerName,
    FIRM: v.firmName,
    // The pronoun slots the extractor marks in the firm's wording. With
    // "name only", or with nothing recorded, they resolve to the client's
    // name and possessive rather than to a guess.
    ...pronounSlots(v.intake.client_pronouns, client),
  };
}

/**
 * The pronoun set the documents use for this client.
 *
 * Marked as slots when the firm's letters are learned, not swapped at
 * render time, because English does not map back reliably: "her" is both
 * possessive and object, so "her employment" becomes "his employment"
 * while "advised her" becomes "advised him". Code cannot tell which from
 * the word alone. The extractor can, because it sees the sentence, so the
 * decision is made once at teaching time.
 */
const PRONOUNS: Record<string, Record<string, string>> = {
  she: { SUBJECT: 'she', OBJECT: 'her', POSSESSIVE: 'her', POSSESSIVE_PRONOUN: 'hers', REFLEXIVE: 'herself' },
  he: { SUBJECT: 'he', OBJECT: 'him', POSSESSIVE: 'his', POSSESSIVE_PRONOUN: 'his', REFLEXIVE: 'himself' },
  they: { SUBJECT: 'they', OBJECT: 'them', POSSESSIVE: 'their', POSSESSIVE_PRONOUN: 'theirs', REFLEXIVE: 'themselves' },
};

/**
 * How the model is told to refer to the client.
 *
 * The body goes through the model, which can conjugate: "they" takes
 * "were" where "she" takes "was", and a slot fill cannot do that. So the
 * body is instructed rather than substituted.
 */
export function pronounInstruction(pronouns?: string | null, partyTerm?: string): string {
  // "our client" is correspondence register: right in a letter to opposing
  // counsel, wrong in a document filed with a court or tribunal, where the
  // person is the applicant or the plaintiff. Callers drafting a filed
  // document pass their party designation and it replaces "our client" in
  // the two branches that avoid pronouns.
  const noPronounTerm = partyTerm ? `"${partyTerm}"` : '"our client"';
  // A filed document needs the prohibition, not just the alternative. Offering
  // the party designation alongside the client's name still left the model
  // reaching for "our client", which it has seen in every letter precedent.
  const filedRegister = partyTerm
    ? ` This document is filed with a court or tribunal: refer to the client as ${noPronounTerm} throughout. Never write "our client" or "the client" anywhere in it; that is correspondence register and is wrong in a filed document.`
    : '';
  switch (pronouns) {
    case 'she': return `Refer to the client as she, her, hers.${filedRegister}`;
    case 'he': return `Refer to the client as he, him, his.${filedRegister}`;
    case 'they':
      return `Refer to the client as they, them, their. Match the verbs: "they were advised", not "they was advised". Singular they is correct here and is not to be avoided.${filedRegister}`;
    case 'name':
      return `Do not use pronouns for the client at all. Use the client's name, or ${noPronounTerm}, throughout.${filedRegister}`;
    default:
      return `The client's pronouns are not recorded on this file. Use the client's name or ${noPronounTerm} rather than guessing, and never infer pronouns from a name.${filedRegister}`;
  }
}

/** The pronoun slots for this client, resolved for filling. */
function pronounSlots(
  pronouns: string | null | undefined,
  clientName: string,
): Record<string, string | undefined> {
  const set = pronouns ? PRONOUNS[pronouns] : undefined;
  if (set) return set;
  // No pronouns, or "name only": the client's name carries every position.
  const name = clientName || undefined;
  return {
    SUBJECT: name,
    OBJECT: name,
    POSSESSIVE: name ? `${name}'s` : undefined,
    POSSESSIVE_PRONOUN: name ? `${name}'s` : undefined,
    REFLEXIVE: name,
  };
}

export interface FilledText {
  text: string;
  /** Slots the file had no value for, named as the firm wrote them. */
  missing: string[];
}

/**
 * Fill one passage of the firm's wording.
 *
 * An unresolved slot stays visible and marked for the lawyer. Silently
 * dropping it would produce a fluent sentence with a fact missing from the
 * middle of it, which is the failure mode hardest to catch on a read.
 */
export function fillSlots(text: string, slots: Record<string, string | undefined>): FilledText {
  const missing: string[] = [];
  const filled = text.replace(/\[([A-Z][A-Z0-9 _'-]{1,40})\]/g, (whole, rawName: string) => {
    const name = rawName.trim().toUpperCase();
    const value = slots[name];
    if (value) return value;
    // Not a slot we know, and not one the file can fill: leave the firm's
    // own marker in place so the lawyer sees exactly what to complete.
    missing.push(name);
    return `[LAWYER: ${rawName.trim().toLowerCase()}]`;
  });
  return { text: filled, missing };
}

/** Render the firm's opening block, filled, as HTML. */
export function renderHouseOpening(
  openingBlock: string[],
  slots: Record<string, string | undefined>,
): { html: string; missing: string[] } {
  const missing = new Set<string>();
  const lines = openingBlock.map(line => {
    const filled = fillSlots(line, slots);
    for (const m of filled.missing) missing.add(m);
    // The firm's own emphasis is part of its form: a line the firm writes
    // in capitals is reproduced in capitals, and a RE: line stays bold.
    const isEmphasised = /^(re:|without prejudice)/i.test(filled.text.trim());
    const body = esc(filled.text);
    return isEmphasised ? `<p><strong>${body}</strong></p>` : `<p>${body}</p>`;
  });
  return { html: lines.join('\n'), missing: [...missing] };
}

/** Render the firm's closing block, filled, as HTML. */
export function renderHouseClosing(
  closingBlock: string[],
  slots: Record<string, string | undefined>,
): { html: string; missing: string[] } {
  const missing = new Set<string>();
  const lines = closingBlock.map(line => {
    const filled = fillSlots(line, slots);
    for (const m of filled.missing) missing.add(m);
    return `<p>${esc(filled.text)}</p>`;
  });
  return { html: lines.join('\n'), missing: [...missing] };
}

// ── Does the firm's standard language fit THIS file? ─────────────────────

/**
 * Standard language carries assumptions. A demand letter precedent for a
 * dismissal says the employer terminated the employment; used on a file
 * where the client resigned, it is fluent, confident and wrong, and it is
 * exactly the sort of error a fast read slides over because the sentence
 * is one the lawyer has read a hundred times.
 */
const ASSUMPTIONS: Array<{
  pattern: RegExp;
  assumes: string;
  fitsFile: (intake: EmploymentIntakeData) => boolean;
}> = [
  {
    pattern: /\b(terminated (her|his|their|the) employment|dismissed (her|him|them)|without cause|termination of (her|his|their) employment)\b/i,
    assumes: 'the employer ended the employment',
    fitsFile: intake => intake.resigned !== true && intake.termination_date != null,
  },
  {
    pattern: /\bconstructive(ly)? dismiss/i,
    assumes: 'a constructive dismissal',
    fitsFile: intake => intake.is_constructive_dismissal === true,
  },
  {
    pattern: /\bfor cause\b/i,
    assumes: 'cause was alleged',
    fitsFile: intake => intake.employer_alleged_just_cause === true,
  },
];

export interface FitIssue {
  part: string;
  message: string;
}

/**
 * Report standard language whose assumptions the file does not support.
 * Conservative on purpose: it speaks only where an assumption is clearly
 * contradicted, because a warning on every letter is a warning ignored.
 */
export function checkHouseFormFit(
  clauses: Array<{ part: string; text: string }>,
  intake: EmploymentIntakeData,
): FitIssue[] {
  const issues: FitIssue[] = [];
  for (const clause of clauses) {
    for (const rule of ASSUMPTIONS) {
      if (rule.pattern.test(clause.text) && !rule.fitsFile(intake)) {
        issues.push({
          part: clause.part,
          message: `Your standard "${clause.part}" language assumes ${rule.assumes}, which this file does not show. Read it against the facts before sending.`,
        });
        break;
      }
    }
  }
  return issues;
}

// ── The drafting instruction ─────────────────────────────────────────────

/**
 * Tell the drafter to reproduce rather than imitate.
 *
 * The prose instruction says to reuse the firm's phrasings "where they fit
 * naturally, never force them", which is right for a mediation brief and
 * wrong for a letter whose worth is that it reads like the last one.
 */
export function houseFormContext(args: {
  label: string;
  fixedClauses: Array<{ part: string; text: string }>;
  formStructure?: string[];
  voice?: string;
  factWeaving?: string;
  /** How to refer to the client, since the body is written not substituted. */
  pronouns?: string | null;
  /** The firm's own median letter length, from its precedents. */
  typicalWords?: number;
}): string {
  if (args.fixedClauses.length === 0 && !args.formStructure?.length) return '';

  const parts: string[] = [
    `THE FIRM'S OWN LETTER ("${args.label}", taken from the firm's precedents)`,
    '',
    'This firm sends this letter in a settled form. Your task is to REPRODUCE that form on this file, not to write a letter informed by it. Where the firm has standard language for a point, use the firm\'s language. Write new prose ONLY where the firm has no standard language for something this file requires.',
    '',
    'Rules:',
    '- Reproduce the standard passages word for word. Do not improve, shorten, modernise or reorder them. Wording you find clumsy is the firm\'s wording and is not yours to correct.',
    '- Where a fact of this file makes the standard wording WRONG, rewrite it, but make the smallest change the facts require and keep every word around it. A passage that says the employer terminated the employment, on a file where the client resigned, becomes a passage about the resignation, in the same voice, of the same length, in the same place. Do not take the mismatch as licence to rewrite the letter.',
    '- Never state a fact the file does not support in order to keep a standard sentence intact. The facts govern the wording, not the other way round.',
    '- Where a passage carries a [SLOT], put this matter\'s value in and leave the rest of the sentence exactly as written.',
    '- Where the firm has standard language for a point this file simply does not raise, leave that passage out.',
    '- The opening block and the closing are supplied already. Do not write them.',
    '',
  ];

  if (args.formStructure?.length) {
    parts.push('THE PARTS OF THE LETTER, IN THE FIRM\'S ORDER:');
    parts.push(...args.formStructure.map((p, i) => `${i + 1}. ${p}`));
    parts.push('');
  }

  if (args.fixedClauses.length) {
    parts.push('THE FIRM\'S STANDARD LANGUAGE. Reproduce each of these, filling the slots:');
    parts.push('');
    for (const clause of args.fixedClauses) {
      parts.push(`--- ${clause.part} ---`);
      parts.push(clause.text);
      parts.push('');
    }
  }

  if (args.voice) parts.push(`VOICE, for the passages that are not standard language: ${args.voice}`);
  if (args.factWeaving) parts.push(`HOW THIS FIRM BRINGS FACTS IN: ${args.factWeaving}`);
  parts.push(`REFERRING TO THE CLIENT: ${pronounInstruction(args.pronouns)}`);
  if (args.typicalWords) {
    parts.push(`LENGTH: this firm's letters of this kind run about ${args.typicalWords.toLocaleString('en-CA')} words. Write to that length. A demand letter is not improved by being longer, and this firm's own practice is the measure.`);
  }

  parts.push('');
  parts.push('Use ONLY this matter\'s facts, parties and figures. The precedents are other clients\' files and none of their names, dates or amounts may appear.');
  return parts.join('\n');
}

/**
 * How a filed document names the party: defined once in full, then carried by
 * a short form, the way a pleading does it. The Tribunal and the respondent
 * read the narrative straight through, and a document that says "the
 * Applicant" in every sentence reads as a form rather than as an account of
 * what happened to a person.
 *
 * Returns undefined where the file has no first name, so the caller keeps the
 * plain party designation rather than defining a party it cannot name.
 */
export function filedNameInstruction(args: {
  firstName?: string | null;
  lastName?: string | null;
  partyLabel: string;
}): string | undefined {
  const first = (args.firstName ?? '').trim();
  if (!first) return undefined;
  const full = [args.firstName, args.lastName].map(n => (n ?? '').trim()).filter(Boolean).join(' ');
  return `NAMING THE PARTY: on first mention write exactly this form, and only once: ${args.partyLabel}, ${full} ("${first}"). Everywhere after that first mention, call the party ${first}. Do not fall back to "${args.partyLabel}" as the referent once the short form is defined, and never write "our client" or "the client".`;
}
