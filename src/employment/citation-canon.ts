/**
 * Citation Canon — post-generation integrity check for case citations.
 *
 * The generation prompts forbid invented citations, but "forbid" is not
 * "verify". This module scans generated HTML for case-law references and
 * produces lawyer-review flags for:
 *
 *   1. Case names OUTSIDE the known canon of plaintiff-side Ontario
 *      employment law authorities (possible hallucination), and
 *   2. Canon cases paired with a WRONG neutral citation (e.g. "Waksdale,
 *      2019 ONCA 123" — right case, hallucinated cite).
 *
 * Flags never block generation — the lawyer decides. False positives are
 * acceptable; a silent hallucinated citation reaching a court is not.
 */

// ── The canon ────────────────────────────────────────────────────────────
// keyword: lowercase distinctive party name used for matching.
// citations: acceptable citation strings (lowercase, punctuation-insensitive).

interface CanonEntry {
  /** Distinctive lowercase keyword found in the case name. */
  keyword: string;
  /** Canonical case name for the review flag text. */
  name: string;
  /** Acceptable citation substrings (lowercased, normalised). */
  citations: string[];
}

export const CITATION_CANON: CanonEntry[] = [
  { keyword: 'bardal', name: 'Bardal v Globe & Mail', citations: ['[1960] oj no 149', '24 dlr (2d) 140', '1960 canlii'] },
  { keyword: 'waksdale', name: 'Waksdale v Swegon North America Inc', citations: ['2020 onca 391'] },
  { keyword: 'machtinger', name: 'Machtinger v HOJ Industries Ltd', citations: ['[1992] 1 scr 986', '1992 canlii 102'] },
  { keyword: 'mckinley', name: 'McKinley v BC Tel', citations: ['2001 scc 38'] },
  { keyword: 'hryniak', name: 'Hryniak v Mauldin', citations: ['2014 scc 7'] },
  { keyword: 'potter', name: 'Potter v New Brunswick Legal Aid', citations: ['2015 scc 10'] },
  { keyword: 'keays', name: 'Honda Canada Inc v Keays', citations: ['2008 scc 39'] },
  { keyword: 'honda', name: 'Honda Canada Inc v Keays', citations: ['2008 scc 39'] },
  { keyword: 'wallace', name: 'Wallace v United Grain Growers Ltd', citations: ['[1997] 3 scr 701', '1997 canlii 332'] },
  { keyword: 'ceccol', name: 'Ceccol v Ontario Gymnastics Federation', citations: ['2001 canlii 8589'] },
  { keyword: 'whiten', name: 'Whiten v Pilot Insurance Co', citations: ['2002 scc 18'] },
  { keyword: 'matthews', name: 'Matthews v Ocean Nutrition Canada Ltd', citations: ['2020 scc 26'] },
  { keyword: 'shafron', name: 'Shafron v KRG Insurance Brokers', citations: ['2009 scc 6'] },
  { keyword: 'evans', name: 'Evans v Teamsters Local Union No 31', citations: ['2008 scc 20'] },
  { keyword: 'bowes', name: 'Bowes v Goss Power Products Ltd', citations: ['2012 onca 425'] },
  { keyword: 'paquette', name: 'Paquette v TeraGo Networks Inc', citations: ['2016 onca 618'] },
  { keyword: 'dufault', name: 'Dufault v Ignace (Township)', citations: ['2024 onsc 1029', '2024 onca 915'] },
  { keyword: 'rahman', name: 'Rahman v Cannon Design Architecture Inc', citations: ['2022 onca 451'] },
  { keyword: 'fraser', name: 'Fraser v Canada (Attorney General)', citations: ['2020 scc 28'] },
  // Added 2026-07-03 legal currency review (docs/legal-currency-review-2026-07.md).
  // Baker and Li state opposite positions on "at any time" clauses — both
  // heard together at the ONCA March 2026, decision reserved. Update when
  // the appeal is released.
  { keyword: 'de castro', name: 'De Castro v Arista Homes Ltd', citations: ['2025 onca 260'] },
  // Added after the model cited it organically in a severance assessment
  // (changed substratum doctrine — long-service employees whose roles grew
  // beyond the original contract). Real case, verified.
  { keyword: 'celestini', name: 'Celestini v Shoplogix Inc', citations: ['2023 onca 131'] },
  { keyword: 'van dolder', name: "Baker v Van Dolder's Home Team Inc", citations: ['2025 onsc 952'] },
  { keyword: 'wayfair', name: 'Li v Wayfair Canada Inc', citations: ['2025 onsc 2959'] },
  // ── Labour (union-side) canon — added with the labour vertical.
  // Old-format cites (LAC, CLRBR, UMAC) don't match the neutral-citation
  // regex, so no mismatch check fires on them — name recognition only.
  { keyword: 'kvp', name: "Lumber & Sawmill Workers' Union, Local 2537 v KVP Co (1965)", citations: ['16 lac 73'] },
  { keyword: 'william scott', name: 'Wm. Scott & Company Ltd', citations: ['[1977] 1 clrbr 1'] },
  { keyword: 'wm. scott', name: 'Wm. Scott & Company Ltd', citations: ['[1977] 1 clrbr 1'] },
  { keyword: 'weber', name: 'Weber v Ontario Hydro', citations: ['[1995] 2 scr 929', '1995 canlii 108'] },
  { keyword: 'vavilov', name: 'Canada (Minister of Citizenship and Immigration) v Vavilov', citations: ['2019 scc 65'] },
  { keyword: 'millhaven', name: 'Millhaven Fibres Ltd v OCAW, Local 9-670 (1967)', citations: ['1 (a) umac 328'] },
  { keyword: 'parry sound', name: 'Parry Sound (District) Social Services Administration Board v OPSEU, Local 324', citations: ['2003 scc 42'] },
];

// ── Detection ────────────────────────────────────────────────────────────

/**
 * Matches "Name v Name" case references (also "v."). Each side is a run of
 * capitalised words plus common legal-name joiners (of, de, &, ...) — the
 * run stops at ordinary lowercase prose so two adjacent case references
 * are never swallowed into one match.
 */
const CAP_WORD = String.raw`[A-Z][\w'’.&()-]*`;
const JOINER = String.raw`(?:of|and|de|la|le|du|des|van|von|&|No\.?)`;
const NAME_SIDE = `${CAP_WORD}(?:\\s+(?:${CAP_WORD}|${JOINER})){0,6}`;
const CASE_NAME_RE = new RegExp(String.raw`\b(${NAME_SIDE})\s+v\.?\s+(${NAME_SIDE})`, 'g');

/** Matches neutral/other citations: "2020 ONCA 391", "[1992] 1 SCR 986", "2001 CanLII 8589". */
const CITE_RE = /(\b\d{4}\s+(?:scc|onca|onsc|canlii|oj)\s+(?:no\s+)?\d+\b|\[\d{4}\]\s+\d*\s*(?:scr|oj|dlr)[\w\s().]*?\d+)/gi;

function normalise(text: string): string {
  return text.toLowerCase().replace(/\s+/g, ' ').trim();
}

/**
 * Detect fill-in placeholders the model left for unknown facts —
 * "[Address]", "[Telephone]", "[Postal Code]" in a signature block, etc.
 * These are correct model behaviour (never invent contact details), but
 * the lawyer must complete them before serving or filing. Anonymisation
 * placeholders ([PARTY_1], [SIN_2] — upper-case with an index) are a
 * different failure mode and are excluded here.
 */
export function checkFillInPlaceholders(html: string): string[] {
  const text = html.replace(/<[^>]+>/g, ' ');
  const found = new Set<string>();
  const re = /\[([A-Z][A-Za-z][A-Za-z /]{0,28})\]/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(text)) !== null) {
    // Skip anonymisation-style tokens ([PARTY_1]) and all-caps directives
    // like [TO BE ASSIGNED] which court forms legitimately carry
    if (/^[A-Z]+_\d+$/.test(m[1])) continue;
    if (m[1] === m[1].toUpperCase()) continue;
    found.add(`[${m[1]}]`);
  }
  // [LAWYER: ...] markers carry a colon and often run long, which the
  // bracket regex above deliberately excludes; they are THE marker this
  // product emits for a fact the file does not hold, and a served letter
  // reading "[LAWYER: salutation]" is the worst thing this check exists to
  // prevent. Match them explicitly.
  const lawyerMarkers = new Set<string>();
  const lm = /\[LAWYER:[^\]]{1,120}\]/gi;
  let lmm: RegExpExecArray | null;
  while ((lmm = lm.exec(text)) !== null) lawyerMarkers.add(lmm[0]);

  const flags: string[] = [];
  if (lawyerMarkers.size > 0) {
    flags.push(`Do not send yet: the document has ${lawyerMarkers.size} place${lawyerMarkers.size === 1 ? '' : 's'} where a fact is missing and marked for you: ${[...lawyerMarkers].slice(0, 6).join(', ')}. Complete each before sending.`);
  }
  if (found.size > 0) {
    flags.push(`This document contains fill-in placeholders that must be completed before sending: ${[...found].join(', ')}. Adding your firm address and contact details to the Starling Profile will populate these automatically.`);
  }
  return flags;
}

/**
 * Scan generated document HTML for case citations and return lawyer-review
 * flags for anything outside the canon or cited incorrectly.
 *
 * @param html            Generated document HTML.
 * @param excludeParties  Party names of THIS matter (client, employer) — a
 *                        Statement of Claim's own title of proceedings is
 *                        "Smith v Acme Corp" and must not be flagged.
 */
export function checkCitationIntegrity(html: string, excludeParties: string[] = []): string[] {
  const flags: string[] = [];
  const text = html.replace(/<[^>]+>/g, ' ');
  const excludes = excludeParties.map(p => normalise(p)).filter(p => p.length > 2);

  const seenUnknown = new Set<string>();
  const seenMismatch = new Set<string>();

  // Sentence-starter words the regex can absorb into the left side
  // ("As Thompson v ...", "See Smith v ...") — strip for keying/display.
  const STARTERS = new Set(['as', 'see', 'in', 'the', 'per', 'under', 'applying', 'citing', 'following', 'and', 'but', 'also']);

  let match: RegExpExecArray | null;
  CASE_NAME_RE.lastIndex = 0;
  while ((match = CASE_NAME_RE.exec(text)) !== null) {
    let leftWords = match[1].split(/\s+/);
    while (leftWords.length > 1 && STARTERS.has(leftWords[0].toLowerCase())) {
      leftWords = leftWords.slice(1);
    }
    const left = leftWords.join(' ');
    const full = normalise(`${left} v ${match[2]}`);

    // Skip the matter's own style of cause
    if (excludes.some(p => full.includes(p))) continue;

    const canonEntry = CITATION_CANON.find(c => full.includes(c.keyword));

    if (!canonEntry) {
      if (!seenUnknown.has(full)) {
        seenUnknown.add(full);
        flags.push(
          `Citation outside the known canon: "${left} v ${match[2]}". Verify that this case exists and supports the stated proposition before sending.`,
        );
      }
      continue;
    }

    // Canon case — verify any citation that follows within ~80 chars
    const tail = text.slice(match.index + match[0].length, match.index + match[0].length + 80);
    CITE_RE.lastIndex = 0;
    const citeMatch = CITE_RE.exec(tail);
    if (citeMatch) {
      const cite = normalise(citeMatch[0]);
      const ok = canonEntry.citations.some(c => cite.includes(c) || c.includes(cite));
      if (!ok && !seenMismatch.has(canonEntry.keyword)) {
        seenMismatch.add(canonEntry.keyword);
        flags.push(
          `Citation mismatch for ${canonEntry.name}: the document cites "${citeMatch[0].trim()}" but the reported citation is ${canonEntry.citations[0].toUpperCase()}. Verify the citation before sending.`,
        );
      }
    }
  }

  return flags;
}
