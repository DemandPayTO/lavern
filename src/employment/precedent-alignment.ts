/**
 * Precedent Alignment — turn several of a firm's precedents into a template.
 *
 * Give it three or more precedents of the same document type and fact
 * pattern. Text that recurs across all of them is the firm's boilerplate and
 * is kept verbatim; text that varies is case-specific and becomes a
 * placeholder. The signal is structural, so nothing has to infer what the
 * firm's language is, and no model can rewrite it.
 *
 * This replaces single-document placeholder inference, which had to guess,
 * and which the 2026-07-20 finding showed was unreliable on redacted
 * precedents. Alignment needs to know WHERE the case-specific text sits, not
 * what it says, so a redacted span simply reads as a varying span.
 *
 * Every function here is deterministic and free: no model calls.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('PRECEDENT-ALIGN');

// ── Types ────────────────────────────────────────────────────────────────

export interface PrecedentInput {
  /** Display name, used in the review screen ("Nunes demand letter"). */
  name: string;
  /** Plain text of the precedent, paragraph per line. */
  text: string;
}

export type SlotKind = 'placeholder' | 'optional_block';

export interface AlignedSlot {
  /** Stable id within this alignment, for the review UI. */
  id: string;
  kind: SlotKind;
  /** Zero-based index of the line this slot belongs to. */
  lineIndex: number;
  /** The values seen in each precedent, in input order. */
  observedValues: string[];
  /** Suggested placeholder name, or null when nothing matched. */
  suggestedPlaceholder: string | null;
  /** How the suggestion was reached, shown to the lawyer. */
  basis: 'matter_data' | 'pattern' | 'unclassified';
}

export interface AlignedLine {
  index: number;
  /** Which precedents contain this line (indices into the input array). */
  presentIn: number[];
  /**
   * The line with varying runs replaced by slot tokens of the form
   * `‹slot:ID›`. For a fully stable line this is the line itself.
   */
  skeleton: string;
  /** True when every precedent has this line and it never varies. */
  stable: boolean;
}

export interface AlignmentResult {
  lines: AlignedLine[];
  slots: AlignedSlot[];
  /** Count of lines identical across every precedent. */
  stableLineCount: number;
  /** Lines present in some precedents only: candidate optional blocks. */
  optionalLineCount: number;
  precedentNames: string[];
  warnings: string[];
}

/** Known intake fields a varying value can be matched against, in the order
 *  they should win when a value matches more than one. */
export interface MatterFacts {
  client_first_name?: string;
  client_last_name?: string;
  client_address?: string;
  employer_legal_name?: string;
  employer_address?: string;
  job_title?: string;
  hire_date?: string;
  termination_date?: string;
  annual_salary?: number | null;
}

const SLOT_OPEN = '‹slot:';
const SLOT_CLOSE = '›';

/** Minimum precedents for the diff to mean anything. Two cannot distinguish
 *  a coincidentally shared phrase from real firm boilerplate. */
export const MIN_PRECEDENTS = 3;

// ── Text preparation ─────────────────────────────────────────────────────

/** Split into trimmed, non-empty lines. Paragraph granularity is the right
 *  unit: it survives reformatting, and firms edit precedents by paragraph. */
export function toLines(text: string): string[] {
  return text
    .replace(/\r\n?/g, '\n')
    .split('\n')
    .map(l => l.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

// ── Longest common subsequence (the alignment primitive) ─────────────────

function lcs<T>(a: T[], b: T[]): T[] {
  const m = a.length, n = b.length;
  if (m === 0 || n === 0) return [];
  const table: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      table[i][j] = a[i] === b[j]
        ? table[i + 1][j + 1] + 1
        : Math.max(table[i + 1][j], table[i][j + 1]);
    }
  }
  const out: T[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push(a[i]); i++; j++; }
    else if (table[i + 1][j] >= table[i][j + 1]) i++;
    else j++;
  }
  return out;
}

/**
 * Split a token sequence at the anchor tokens, in order, returning the
 * gaps between them. Always returns anchors.length + 1 gaps, so the same
 * index means the same position in every precedent.
 */
function splitByAnchors(tokens: string[], anchors: string[]): string[][] {
  const gaps: string[][] = [];
  let current: string[] = [];
  let anchorIdx = 0;
  for (const token of tokens) {
    if (anchorIdx < anchors.length && token === anchors[anchorIdx]) {
      gaps.push(current);
      current = [];
      anchorIdx++;
    } else {
      current.push(token);
    }
  }
  gaps.push(current);
  while (gaps.length < anchors.length + 1) gaps.push([]);
  return gaps;
}

// ── Classification of a varying value ────────────────────────────────────

const MONEY_RE = /^\$?\d{1,3}(,\d{3})*(\.\d{2})?$/;
const DATE_RE = /^((January|February|March|April|May|June|July|August|September|October|November|December)\s+\d{1,2},\s*\d{4}|\d{4}-\d{2}-\d{2})$/;

/** Suggest a placeholder for a set of observed values. Matter data wins over
 *  pattern matching, because it is exact rather than inferred. */
/**
 * Compare an observed slot value against a known matter fact.
 *
 * Exact match is the common case, but a shared trailing word becomes an
 * anchor and is therefore excluded from the slot: "Halcyon Retail Inc" in
 * the matter can present as "Halcyon Retail" in the slot when every
 * precedent's employer ends in "Inc". Containment either way handles that,
 * guarded by a length floor so short values do not match by accident.
 */
function valueMatchesFact(value: string, fact: string): boolean {
  const v = value.toLowerCase().trim();
  const f = fact.toLowerCase().trim();
  if (!v || !f) return false;
  if (v === f) return true;
  if (v.length < 4 || f.length < 4) return false;
  return f.includes(v) || v.includes(f);
}

export function classifyValues(
  values: string[],
  factsPerPrecedent: Array<MatterFacts | undefined>,
): { placeholder: string | null; basis: AlignedSlot['basis'] } {
  const cleaned = values.map(v => v.replace(/[.,;:]+$/, '').trim());

  // (a) Exact match against the matter each precedent came from.
  const FIELD_TO_PLACEHOLDER: Array<[keyof MatterFacts, string]> = [
    ['employer_legal_name', 'EMPLOYER_NAME'],
    ['employer_address', 'EMPLOYER_ADDRESS'],
    ['client_address', 'CLIENT_ADDRESS'],
    ['job_title', 'JOB_TITLE'],
    ['hire_date', 'HIRE_DATE'],
    ['termination_date', 'TERMINATION_DATE'],
    ['annual_salary', 'ANNUAL_SALARY'],
  ];
  for (const [field, placeholder] of FIELD_TO_PLACEHOLDER) {
    const hits = cleaned.filter((value, idx) => {
      const factValue = factsPerPrecedent[idx]?.[field];
      if (factValue === undefined || factValue === null || factValue === '') return false;
      return valueMatchesFact(value, String(factValue));
    });
    if (hits.length >= Math.min(2, cleaned.length)) return { placeholder, basis: 'matter_data' };
  }
  // Client name may appear as first, last, or full name.
  const nameHits = cleaned.filter((value, idx) => {
    const f = factsPerPrecedent[idx];
    if (!f) return false;
    const full = [f.client_first_name, f.client_last_name].filter(Boolean).join(' ');
    return [full, f.client_first_name, f.client_last_name]
      .filter((c): c is string => Boolean(c))
      .some(candidate => valueMatchesFact(value, candidate));
  });
  if (nameHits.length >= Math.min(2, cleaned.length)) return { placeholder: 'CLIENT_NAME', basis: 'matter_data' };

  // (b) Pattern match the unambiguous shapes.
  if (cleaned.every(v => MONEY_RE.test(v))) return { placeholder: 'AMOUNT', basis: 'pattern' };
  if (cleaned.every(v => DATE_RE.test(v))) return { placeholder: 'DATE', basis: 'pattern' };

  // (c) Nothing matched: the lawyer names it in the review screen.
  return { placeholder: null, basis: 'unclassified' };
}

// ── Alignment ────────────────────────────────────────────────────────────

/**
 * Align precedents into a skeleton of stable text plus slots.
 *
 * Throws when given fewer than MIN_PRECEDENTS: with two, a phrase shared by
 * coincidence is indistinguishable from firm boilerplate, and a template
 * built on that assumption would quietly hard-code one case's wording.
 */
export function alignPrecedents(
  precedents: PrecedentInput[],
  factsPerPrecedent: Array<MatterFacts | undefined> = [],
): AlignmentResult {
  if (precedents.length < MIN_PRECEDENTS) {
    throw new Error(`Alignment needs at least ${MIN_PRECEDENTS} precedents; received ${precedents.length}.`);
  }

  const docs = precedents.map(p => toLines(p.text));
  const warnings: string[] = [];

  // Lines common to EVERY precedent are the firm's boilerplate.
  const commonLines = docs.reduce<string[]>((acc, doc, idx) => idx === 0 ? doc : lcs(acc, doc), []);
  const commonSet = new Set(commonLines);

  // Walk the first precedent as the spine; its structure is the template's.
  const lines: AlignedLine[] = [];
  const slots: AlignedSlot[] = [];
  let slotSeq = 0;

  // Varying lines, per precedent, in order — paired up positionally.
  const varyingPerDoc = docs.map(doc => doc.filter(l => !commonSet.has(l)));

  let varyingCursor = 0;
  for (const line of docs[0]) {
    if (commonSet.has(line)) {
      lines.push({ index: lines.length, presentIn: docs.map((_, i) => i), skeleton: line, stable: true });
      continue;
    }

    // A varying line: align its tokens across the precedents that have a
    // counterpart at this position, and replace differing runs with slots.
    const counterparts = varyingPerDoc
      .map(v => v[varyingCursor])
      .map((v, i) => ({ value: v, doc: i }))
      .filter(x => typeof x.value === 'string');
    varyingCursor++;

    const presentIn = counterparts.map(c => c.doc);
    if (counterparts.length < 2) {
      // Only one precedent has anything here: an optional block, not a slot.
      lines.push({ index: lines.length, presentIn, skeleton: line, stable: false });
      continue;
    }

    const tokenised = counterparts.map(c => c.value.split(' '));

    // The tokens common to every version, IN ORDER, are the anchors that
    // hold the sentence together. Splitting each version at those anchors
    // gives the same number of gaps in the same order across precedents,
    // so gap k in one document lines up with gap k in the others. (Using a
    // set of stable tokens instead would lose position and lump every
    // varying token in the line into a single slot.)
    const anchors = tokenised.reduce((acc, t, i) => i === 0 ? t : lcs(acc, t), [] as string[]);
    const gapsPerDoc = tokenised.map(tokens => splitByAnchors(tokens, anchors));

    const skeletonParts: string[] = [];
    for (let gapIdx = 0; gapIdx <= anchors.length; gapIdx++) {
      const observed = gapsPerDoc.map(gaps => (gaps[gapIdx] ?? []).join(' '));
      // A gap is a slot only where at least one precedent has content and
      // the versions are not all identical.
      const meaningful = observed.some(v => v.trim()) && new Set(observed).size > 1;
      if (meaningful) {
        const slotId = `s${++slotSeq}`;
        const { placeholder, basis } = classifyValues(observed, factsPerPrecedent);
        slots.push({
          id: slotId,
          kind: 'placeholder',
          lineIndex: lines.length,
          observedValues: observed,
          suggestedPlaceholder: placeholder,
          basis,
        });
        skeletonParts.push(`${SLOT_OPEN}${slotId}${SLOT_CLOSE}`);
      } else if (observed[0]?.trim()) {
        // Identical in every precedent despite sitting between anchors:
        // it is boilerplate, so keep the words.
        skeletonParts.push(observed[0]);
      }
      if (gapIdx < anchors.length) skeletonParts.push(anchors[gapIdx]);
    }

    lines.push({
      index: lines.length,
      presentIn,
      skeleton: skeletonParts.join(' '),
      stable: false,
    });
  }

  const stableLineCount = lines.filter(l => l.stable).length;
  const optionalLineCount = lines.filter(l => !l.stable && l.presentIn.length < docs.length).length;

  if (stableLineCount === 0) {
    warnings.push('No text recurred across every precedent. Check that these are the same document type and from the same firm.');
  }
  if (stableLineCount > 0 && slots.length === 0) {
    warnings.push('The precedents appear identical. Nothing varies, so there is nothing to turn into a placeholder.');
  }

  logger.info('Precedents aligned', {
    precedents: precedents.length, stableLineCount, slots: slots.length, optionalLineCount,
  });

  return {
    lines,
    slots,
    stableLineCount,
    optionalLineCount,
    precedentNames: precedents.map(p => p.name),
    warnings,
  };
}

// ── Rendering the template ───────────────────────────────────────────────

/**
 * Render the aligned skeleton into template text, substituting each slot
 * with the placeholder the lawyer confirmed.
 *
 * `accepted` maps slot id to placeholder name. A slot the lawyer rejected is
 * restored to the value from the FIRST precedent, so the firm's own wording
 * survives rather than leaving a hole.
 */
export function renderTemplate(
  result: AlignmentResult,
  accepted: Record<string, string | null>,
  options: { includeOptionalLines?: boolean } = {},
): string {
  const includeOptional = options.includeOptionalLines ?? true;
  const slotById = new Map(result.slots.map(s => [s.id, s]));

  const out: string[] = [];
  for (const line of result.lines) {
    const isOptional = !line.stable && line.presentIn.length < result.precedentNames.length;
    if (isOptional && !includeOptional) continue;

    let rendered = line.skeleton;
    for (const [slotId, placeholder] of Object.entries(accepted)) {
      const token = `${SLOT_OPEN}${slotId}${SLOT_CLOSE}`;
      if (!rendered.includes(token)) continue;
      if (placeholder) {
        rendered = rendered.replace(token, `{{${placeholder}}}`);
      } else {
        const slot = slotById.get(slotId);
        rendered = rendered.replace(token, slot?.observedValues[0] ?? '');
      }
    }
    // Any slot the lawyer never decided keeps the first precedent's value,
    // so an unreviewed alignment can never emit a stray token.
    rendered = rendered.replace(
      new RegExp(`${SLOT_OPEN}(s\\d+)${SLOT_CLOSE}`, 'g'),
      (_m, id: string) => slotById.get(id)?.observedValues[0] ?? '',
    );
    out.push(rendered);
  }
  return out.join('\n');
}

/** Verify that every line of the rendered template either is boilerplate
 *  that appeared verbatim in the precedents, or contains a placeholder.
 *  This is the safety property: alignment must never introduce prose. */
export function verifyNoInventedText(
  result: AlignmentResult,
  rendered: string,
  precedents: PrecedentInput[],
): { ok: boolean; offending: string[] } {
  const known = new Set<string>();
  for (const p of precedents) for (const line of toLines(p.text)) known.add(line);

  const offending: string[] = [];
  for (const line of toLines(rendered)) {
    if (line.includes('{{')) continue;        // has a placeholder: shaped, not invented
    if (known.has(line)) continue;             // appeared verbatim in a precedent
    offending.push(line);
  }
  return { ok: offending.length === 0, offending };
}
