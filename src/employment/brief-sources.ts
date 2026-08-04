/**
 * Brief sources — what grounds a mediation brief, assembled explicitly.
 *
 * The brief argues the positions already taken in the matter. Those live
 * in two places: documents Starling generated (the demand letter, the
 * statement of claim), and documents drafted OUTSIDE Starling that the
 * lawyer attaches at generation time (an externally-drafted SOC, a list
 * of authorities, a research memo). Both feed the drafting prompt and
 * the citation extractor, so the brief's claims attribute back to them.
 *
 * The cap is honest prompt economics: each source costs attention and
 * money, and ten sources dilute the draft. Six, generated positions
 * first, and the caller is told what was dropped rather than it
 * vanishing.
 *
 * Deterministic: no model call.
 */

export interface BriefSource {
  title: string;
  text: string;
}

const MAX_SOURCES = 6;
const MAX_CHARS_PER_SOURCE = 15_000;

/** Strip HTML to text and cap, for generated documents stored as HTML. */
function stripCap(html: unknown): string {
  return String(html ?? '')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, MAX_CHARS_PER_SOURCE);
}

export function assembleBriefSources(opts: {
  generatedDemandHtml?: unknown;
  generatedSocHtml?: unknown;
  includeGeneratedDemand: boolean;
  includeGeneratedSoc: boolean;
  extraSources: Array<{ name: string; text: string }>;
}): { sources: BriefSource[]; dropped: string[] } {
  const sources: BriefSource[] = [];
  const dropped: string[] = [];

  // Generated positions first: they are the operative documents.
  if (opts.includeGeneratedDemand && opts.generatedDemandHtml) {
    const text = stripCap(opts.generatedDemandHtml);
    if (text) sources.push({ title: 'Demand Letter', text });
  }
  if (opts.includeGeneratedSoc && opts.generatedSocHtml) {
    const text = stripCap(opts.generatedSocHtml);
    if (text) sources.push({ title: 'Statement of Claim', text });
  }

  for (const extra of opts.extraSources) {
    const title = extra.name.trim().slice(0, 200);
    const text = extra.text.replace(/\s+/g, ' ').trim().slice(0, MAX_CHARS_PER_SOURCE);
    if (!title || !text) continue;
    if (sources.length >= MAX_SOURCES) { dropped.push(title); continue; }
    sources.push({ title, text });
  }

  return { sources, dropped };
}
