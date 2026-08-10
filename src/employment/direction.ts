/**
 * Drafting direction — what the partner said to do on this file.
 *
 * A file's direction lives in call notes and corridor conversations: "on
 * this one we are only chasing the four weeks of resignation notice", "do
 * not plead punitive, he will not wear it", "keep it short, they settle
 * when you do". Until now that lived in the Notes tab, which every
 * generator ignored, so the lawyer retyped the instruction into every
 * draft or watched the draft ignore it.
 *
 * Three things make this safe rather than merely convenient.
 *
 * RAW NOTES ARE NOT INSTRUCTIONS. Call notes are long, contradictory
 * ("partner thinks maybe X, check Y first") and full of things the client
 * said in confidence. Feeding them wholesale to a drafting prompt is how a
 * client's private aside reaches a letter to the other side. So the notes
 * are read once, the INSTRUCTIONS are extracted from them, and the lawyer
 * approves that short list before it binds. Anything that reads as
 * confidential is separated out and never enters a drafting prompt.
 *
 * DIRECTION OUTRANKS THE DEFAULTS. An instruction that narrows the letter
 * has to narrow it, including the deterministic parts. A letter that
 * demands four weeks in its prose while its damages table itemises eight
 * to twelve months of pay in lieu is worse than no direction at all, so
 * the extraction can propose the heads of damage too, and those land in
 * the lawyer's editable rows where they are visible and theirs.
 *
 * A DRAFT THAT DEPARTS SAYS SO. Direction the model quietly ignores is
 * direction the lawyer has to catch by reading. Instructions carry terms
 * that must or must not appear, checked deterministically, and the rest is
 * put to a compact review pass whose verdicts become review flags.
 */

import type { EmploymentIntakeData, IntakeAnalysisResult } from '../types/employment-intake.js';

export const INSTRUCTION_KINDS = ['scope', 'include', 'exclude', 'figures', 'tone', 'process'] as const;
export type InstructionKind = typeof INSTRUCTION_KINDS[number];

export interface DirectionInstruction {
  id: string;
  /** The instruction, in the imperative: "Demand only the unpaid notice period." */
  text: string;
  kind: InstructionKind;
  /** Terms that must appear in a compliant draft. Checked deterministically. */
  mustInclude?: string[];
  /** Terms that must NOT appear. Checked deterministically. */
  mustNotInclude?: string[];
}

export interface ProposedHead {
  label: string;
  basis?: string;
  amount?: number | null;
}

export interface DirectionRecord {
  /** The notes as pasted, kept so the lawyer can see what was read. */
  notes?: string;
  /** The instructions that bind the drafting. */
  instructions: DirectionInstruction[];
  /**
   * Extracted material that must NOT reach a draft: client confidences,
   * settlement floors, candid assessments of the client. Stored so the
   * lawyer can see it was recognised, never sent to a drafting prompt.
   */
  withheld?: string[];
  /** Heads of damage the direction implies, for the lawyer to apply. */
  proposedHeads?: ProposedHead[];
  updatedAt?: string;
  updatedByName?: string;
}

/** Direction on a matter: the file's own, plus per document type. */
export interface MatterDirection {
  matter?: DirectionRecord;
  byDocument?: Record<string, DirectionRecord>;
}

export const MAX_NOTES_CHARS = 100_000;
export const MAX_INSTRUCTIONS = 20;

// ── The extraction ───────────────────────────────────────────────────────

export const DIRECTION_EXTRACTION_SYSTEM = `You read a lawyer's working notes and pull out the DRAFTING INSTRUCTIONS.

The notes come from client calls and from conversations with the supervising partner. They are working notes: fragmentary, sometimes contradictory, and they contain things that must never appear in a document sent to the other side.

Your job is to separate three things.

1. INSTRUCTIONS. What the drafting must do. Write each in the imperative, in one sentence, as an instruction to the drafter. "Demand only the four weeks of unpaid resignation notice." "Do not plead punitive damages." "Keep the letter to two pages." An instruction must be something a drafter can follow and a reader can check.

2. WITHHELD. Anything that must not reach a document sent to the other side: what the client will actually accept, candid assessments of the client or the case, privileged advice, personal circumstances shared in confidence, anything about the client's financial pressure to settle. When in doubt, withhold it. Reproduce it as a short phrase, not in full.

3. PROPOSED HEADS. Where the notes settle what is being claimed, the heads of damage that follow, with the basis and any figure stated. Only where the notes actually say so.

Rules:
- Extract only what the notes support. Do not infer instructions from what a file of this kind usually needs.
- Where the notes contradict themselves, prefer the later or more definite statement, and say so in the instruction text.
- Where an instruction is conditional on something not yet known ("if they come back under 50, then..."), do not extract it as an instruction. It is not yet direction.
- An instruction attributed to the partner carries more weight than a passing thought. Where the notes mark something as the partner's direction, keep that wording.
- For each instruction, give the terms a compliant draft must contain (mustInclude) or must avoid (mustNotInclude), but ONLY where a specific word or phrase is genuinely required or forbidden. Leave them empty otherwise. These are checked literally, so a term that is merely likely will produce a false alarm.

Do not use em-dashes. Do not use contractions.

Return JSON only:
{
  "instructions": [{"text": "...", "kind": "scope|include|exclude|figures|tone|process", "mustInclude": ["..."], "mustNotInclude": ["..."]}],
  "withheld": ["short phrase describing what is being kept out"],
  "proposedHeads": [{"label": "...", "basis": "...", "amount": 1234 or null}]
}`;

export function buildDirectionExtractionPrompt(args: {
  notes: string;
  documentLabel?: string;
  intake?: EmploymentIntakeData | null;
  analysis?: IntakeAnalysisResult | null;
}): string {
  const parts: string[] = [];
  parts.push(args.documentLabel
    ? `These notes direct the drafting of one document: ${args.documentLabel}.`
    : 'These notes direct the drafting on this file as a whole.');

  if (args.intake) {
    const client = [args.intake.client_first_name, args.intake.client_last_name].filter(Boolean).join(' ');
    parts.push([
      '',
      'For context only, so you can read the notes correctly:',
      client ? `Client: ${client}` : '',
      args.intake.employer_legal_name ? `Employer: ${args.intake.employer_legal_name}` : '',
      args.intake.annual_salary ? `Annual compensation: ${args.intake.annual_salary}` : '',
      args.intake.termination_date ? `Termination date: ${args.intake.termination_date}` : '',
    ].filter(Boolean).join('\n'));
  }

  parts.push('', 'THE NOTES:', '', args.notes.slice(0, MAX_NOTES_CHARS));
  return parts.join('\n');
}

// ── Feeding the drafting ─────────────────────────────────────────────────

/**
 * The direction section of a drafting prompt.
 *
 * Placed so it outranks the default structure: an instruction to demand
 * only the unpaid notice period has to beat the template's habit of
 * arguing every approved issue. Withheld material is never included.
 */
export function directionContext(args: {
  matter?: DirectionRecord;
  document?: DirectionRecord;
}): string {
  const matterInstructions = args.matter?.instructions ?? [];
  const documentInstructions = args.document?.instructions ?? [];
  if (matterInstructions.length === 0 && documentInstructions.length === 0) return '';

  const lines: string[] = [
    'DIRECTION FOR THIS DRAFT',
    '',
    'The instructions below come from the lawyer with carriage of this file and from the supervising partner. They GOVERN. Where an instruction conflicts with the default structure of this document, with the analysis, or with what a document of this kind usually contains, FOLLOW THE INSTRUCTION.',
    '',
    'If an instruction narrows what is being claimed, the draft claims only that. Do not argue issues the direction has taken out, and do not add heads of damage the direction does not support.',
    '',
    'If an instruction cannot be followed without making the document wrong or misleading, follow it as far as it can be followed and say plainly, in a single sentence at the end under the heading "Note to the lawyer", what you could not do and why.',
    '',
  ];

  if (matterInstructions.length > 0) {
    lines.push('Direction for this file:');
    for (const i of matterInstructions) lines.push(`- ${i.text}`);
    lines.push('');
  }
  if (documentInstructions.length > 0) {
    lines.push('Direction for this document specifically. Where it conflicts with the file direction above, this governs:');
    for (const i of documentInstructions) lines.push(`- ${i.text}`);
    lines.push('');
  }
  return lines.join('\n');
}

/** Every instruction that binds a draft, the document's after the file's. */
export function effectiveInstructions(args: {
  matter?: DirectionRecord;
  document?: DirectionRecord;
}): DirectionInstruction[] {
  return [...(args.matter?.instructions ?? []), ...(args.document?.instructions ?? [])];
}

// ── The note the drafter writes back ─────────────────────────────────────

/**
 * Take the "Note to the lawyer" out of the document.
 *
 * The direction invites the drafter to say what it could not do. That note
 * is addressed to the lawyer, and the document it sits in is one that gets
 * sent to the other side, so leaving it in the deliverable is a document
 * that tells opposing counsel what was deliberately left out of it. It
 * comes out here and goes into the review flags, where the lawyer is
 * already reading.
 *
 * It also has to come out BEFORE the direction is checked. In a live run
 * the note said the letter had omitted "common law reasonable notice" and
 * "punitive damages" exactly as directed, and the literal check read those
 * words and reported two departures. A warning that fires on compliance is
 * how a lawyer learns to ignore warnings.
 */
export function extractLawyerNote(html: string): { html: string; note?: string } {
  const heading = /<h[1-6](?:\s[^>]*)?>\s*note to the lawyer\s*<\/h[1-6]>/i;
  const match = heading.exec(html);
  if (!match) return { html };

  // The note runs to the end of what the MODEL wrote, but the assembled
  // document carries furniture after it: the sign-off is appended once the
  // body is complete. Taking everything to the end of the string swallowed
  // the signature block, and a letter came out with no closing at all. The
  // note therefore ends where the sign-off begins.
  const after = html.slice(match.index + match[0].length);
  const signOff = /<p(?:\s[^>]*)?>\s*(?:<strong>\s*)?(?:yours (?:very )?truly|yours sincerely|all of which is respectfully submitted)/i.exec(after);
  const noteHtml = signOff ? after.slice(0, signOff.index) : after;
  const tail = signOff ? after.slice(signOff.index) : '';

  const note = noteHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
  const withoutNote = html.slice(0, match.index).trimEnd() + (tail ? `\n${tail}` : '');
  return { html: withoutNote, note: note || undefined };
}

// ── Did the draft follow it? ─────────────────────────────────────────────

/** Strip tags and normalise, for literal term checks against a draft. */
function plainText(html: string): string {
  return html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').toLowerCase();
}

/**
 * The deterministic half of the departure check: terms that must or must
 * not appear. Cheap, exact, and no model call, so it runs on every draft.
 */
export function checkDirectionTerms(html: string, instructions: DirectionInstruction[]): string[] {
  const text = plainText(html);
  const flags: string[] = [];
  for (const instruction of instructions) {
    const missing = (instruction.mustInclude ?? []).filter(t => t.trim() && !text.includes(t.toLowerCase()));
    const present = (instruction.mustNotInclude ?? []).filter(t => t.trim() && text.includes(t.toLowerCase()));
    if (missing.length > 0) {
      flags.push(`The draft departs from your direction "${instruction.text}": it does not mention ${missing.map(t => `"${t}"`).join(', ')}.`);
    }
    if (present.length > 0) {
      flags.push(`The draft departs from your direction "${instruction.text}": it mentions ${present.map(t => `"${t}"`).join(', ')}.`);
    }
  }
  return flags;
}

export const DEPARTURE_CHECK_SYSTEM = `You check whether a draft followed the instructions it was given.

You are given the instructions and the draft. For each instruction, answer whether the draft follows it.

Be strict about substance and indifferent to wording. An instruction to demand only the unpaid notice period is NOT followed by a draft that demands the notice period and also claims reasonable notice at common law, however briefly. An instruction to keep a letter short is followed by a draft of roughly the length asked for, not by one twice as long.

Be slow to call a departure on a matter of judgment. If the draft plausibly follows the instruction, say it follows. A false alarm on every draft teaches the lawyer to ignore these.

Where a draft departs, say in one sentence what it did instead. Quote the offending passage briefly where there is one.

Do not use em-dashes. Do not use contractions.

Return JSON only:
{"verdicts": [{"instruction": "the instruction text, verbatim", "followed": true, "departure": "one sentence, only when followed is false"}]}`;

export function buildDepartureCheckPrompt(html: string, instructions: DirectionInstruction[]): string {
  return [
    'THE INSTRUCTIONS:',
    ...instructions.map((i, n) => `${n + 1}. ${i.text}`),
    '',
    'THE DRAFT:',
    '',
    html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim().slice(0, 60_000),
  ].join('\n');
}

/** Turn departure verdicts into review flags the lawyer reads. */
export function departureFlags(verdicts: Array<{ instruction: string; followed: boolean; departure?: string }>): string[] {
  return verdicts
    .filter(v => !v.followed)
    .map(v => `The draft departs from your direction "${v.instruction}". ${v.departure ?? 'Read the draft against the instruction before sending.'}`);
}
