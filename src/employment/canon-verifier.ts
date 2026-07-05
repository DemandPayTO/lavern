/**
 * Canon Verifier — deterministic verification of quotations and pinpoint
 * references against the stored full texts of the canon cases.
 *
 * The citation canon catches invented cases and wrong citations; this
 * module catches the subtler failure: a real case quoted with words it
 * never used, or cited to a paragraph it does not have. Both checks are
 * pure string work over the stored texts: no model call, no cost, and no
 * false confidence.
 *
 * Scope discipline: a quotation is only checked when it appears in the
 * same paragraph as a canon case name, so contract language quoted from
 * the intake is never matched against case reports.
 */

import { CITATION_CANON } from './citation-canon.js';
import { getCanonText } from './canon-store.js';

/** Normalise for containment matching: case, whitespace, and quote glyphs. */
function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/[‘’ʼ]/g, "'")
    .replace(/[“”]/g, '"')
    .replace(/­/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Split rendered HTML into logical paragraphs. */
function paragraphsOf(html: string): string[] {
  return html
    .split(/<\/(?:p|li|blockquote|h[1-6]|td)>/i)
    .map(part => part.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

const QUOTE_RE = /["“]([^"“”]{40,600})["”]/g;
const PINPOINT_RE = /\bparas?\.?\s+(\d{1,4})(?:\s*(?:-|–|to)\s*(\d{1,4}))?/gi;

/** True when the stored text carries CanLII-style [1] paragraph numbering. */
function hasParagraphMarkers(text: string): boolean {
  return /\[\s*1\s*\]/.test(text) && /\[\s*2\s*\]/.test(text);
}

function paragraphExists(text: string, n: number): boolean {
  return new RegExp(`\\[\\s*${n}\\s*\\]`).test(text);
}

/**
 * Verify quotations and pinpoint references attributed to canon cases
 * against the stored full texts. Returns lawyer-review flags; never
 * blocks generation.
 */
export function checkCanonTextIntegrity(html: string): string[] {
  const flags: string[] = [];
  const flaggedMissingText = new Set<string>();
  const flaggedBadQuote = new Set<string>();
  const flaggedBadPinpoint = new Set<string>();

  for (const para of paragraphsOf(html)) {
    const paraNorm = norm(para);
    const entry = CITATION_CANON.find(c => paraNorm.includes(c.keyword));
    if (!entry) continue;

    const stored = getCanonText(entry.keyword);
    const storedNorm = stored ? norm(stored) : null;

    // ── Quotations ──────────────────────────────────────────────────────
    QUOTE_RE.lastIndex = 0;
    let qm: RegExpExecArray | null;
    while ((qm = QUOTE_RE.exec(para)) !== null) {
      const quote = qm[1].trim();
      if (quote.split(/\s+/).length < 6) continue;
      if (!storedNorm) {
        if (!flaggedMissingText.has(entry.keyword)) {
          flaggedMissingText.add(entry.keyword);
          flags.push(
            `A quotation is attributed to ${entry.name}, but the full text of the case is not on file, so it cannot be verified. Import the case text (Canon Library) or verify the quotation against the reported decision before filing.`,
          );
        }
        continue;
      }
      // Tolerate ellipses: every ellipsis-separated fragment must appear.
      const fragments = norm(quote).split(/\s*(?:\.\.\.|…)\s*/).filter(f => f.split(' ').length >= 4);
      const allFound = fragments.length > 0 && fragments.every(f => storedNorm.includes(f));
      if (!allFound && !flaggedBadQuote.has(entry.keyword)) {
        flaggedBadQuote.add(entry.keyword);
        flags.push(
          `A quotation attributed to ${entry.name} was not found in the stored full text of the case: "${quote.slice(0, 120)}${quote.length > 120 ? '...' : ''}". Verify the quotation verbatim before filing.`,
        );
      }
    }

    // ── Pinpoint references ─────────────────────────────────────────────
    if (stored && hasParagraphMarkers(stored)) {
      PINPOINT_RE.lastIndex = 0;
      let pm: RegExpExecArray | null;
      while ((pm = PINPOINT_RE.exec(para)) !== null) {
        const from = parseInt(pm[1], 10);
        const to = pm[2] ? parseInt(pm[2], 10) : from;
        const ok = paragraphExists(stored, from) && paragraphExists(stored, to);
        if (!ok && !flaggedBadPinpoint.has(`${entry.keyword}:${from}`)) {
          flaggedBadPinpoint.add(`${entry.keyword}:${from}`);
          flags.push(
            `A pinpoint reference to paragraph ${pm[2] ? `${from} to ${to}` : from} of ${entry.name} was not found in the stored full text. Verify the paragraph number before filing.`,
          );
        }
      }
    }
  }

  return flags;
}
