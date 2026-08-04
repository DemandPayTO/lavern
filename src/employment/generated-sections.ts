/**
 * Generated-document section splitting — Phase 3 of the precedent-templates
 * spec (docs/specs/precedent-templates-2026-08.md).
 *
 * Until now every content placeholder in a firm template received the WHOLE
 * generated document: {{LEGAL_ANALYSIS}} and {{FACTS_SECTION}} were both
 * assigned the same html, so a template could only ever be a letterhead
 * wrapper around one undifferentiated block.
 *
 * The generators already emit section headings ("Employment Background",
 * "Termination Facts", "Legal Analysis", "Damages Quantification", "Demand",
 * "Closing"), so the document can be split at those headings and each part
 * mapped to its own placeholder. That is what makes the hybrid model work:
 * the firm's precedent supplies the structure and the boilerplate, and
 * Starling drops generated prose only where the lawyer marked it.
 *
 * Deterministic: no model call.
 */

import { createLogger } from '../utils/logger.js';

const logger = createLogger('GEN-SECTIONS');

/**
 * Heading text (normalised) to the placeholder it fills. Several phrasings
 * map to the same marker because generators vary the wording by document
 * type and forum.
 */
const HEADING_TO_MARKER: Array<[RegExp, string]> = [
  [/^(employment )?background$/, 'EMPLOYMENT_BACKGROUND'],
  [/^employment (history|chronology)$/, 'EMPLOYMENT_BACKGROUND'],
  [/^termination facts?$/, 'TERMINATION_FACTS'],
  [/^the termination$/, 'TERMINATION_FACTS'],
  [/^(the )?facts?( section)?$/, 'FACTS_SECTION'],
  [/^statement of facts$/, 'FACTS_SECTION'],
  [/^legal analysis$/, 'LEGAL_ANALYSIS'],
  [/^(the )?law( and analysis)?$/, 'LEGAL_ANALYSIS'],
  [/^analysis$/, 'LEGAL_ANALYSIS'],
  [/^legal basis$/, 'LEGAL_BASIS'],
  [/^damages( quantification| summary)?$/, 'DAMAGES_SECTION'],
  [/^damages particulars$/, 'DAMAGES_PARTICULARS'],
  [/^(the )?demand$/, 'DEMAND'],
  [/^relief sought$/, 'RELIEF_SOUGHT'],
  [/^(the )?claim$/, 'CLAIM'],
  [/^closing$/, 'CLOSING'],
  [/^terms$/, 'CLOSING'],
  [/^title of proceedings$/, 'TITLE_OF_PROCEEDINGS'],

  // Severance assessment and counter-offer sections. These name parts of a
  // document rather than data fields, so they take content from the
  // generated output like any other section marker.
  [/^(the )?offer$/, 'OFFER_SUMMARY'],
  [/^acknowledgment$/, 'OFFER_SUMMARY'],
  [/^(the )?statutory floor$/, 'STATUTORY_FLOOR'],
  [/^(the )?common law range$/, 'NOTICE_RANGE'],
  [/^termination clause analysis$/, 'CLAUSE_ANALYSIS'],
  [/^(the )?gap$/, 'GAP_ANALYSIS'],
  [/^other factors$/, 'OTHER_FACTORS'],
  [/^recommendation$/, 'RECOMMENDATION'],
  [/^why the offer is inadequate$/, 'LEGAL_ANALYSIS'],
  [/^(the )?counter.?position$/, 'DEMAND'],

  // Mediation brief. The narrative sections follow the mediator-guidance
  // structure (Fisher, Rudner, Rose) and the deterministic front-matter
  // tables carry their own headings, so a firm template built from
  // mediation precedents can place every part deliberately.
  [/^overview$/, 'OVERVIEW'],
  [/^factual background$/, 'FACTUAL_BACKGROUND'],
  [/^issues in dispute$/, 'ISSUES_IN_DISPUTE'],
  [/^(response to )?anticipated defences?$/, 'DEFENCE_RESPONSE'],
  [/^mitigation$/, 'MITIGATION_SECTION'],
  [/^settlement position$/, 'SETTLEMENT_POSITION'],
  [/^mediation objectives$/, 'MEDIATION_OBJECTIVES'],
  [/^practical considerations$/, 'PRACTICAL_CONSIDERATIONS'],
  // Front-matter tables (deterministic, built from the matter record).
  [/^profile of the plaintiff$/, 'PROFILE_TABLE'],
  [/^damages calculation$/, 'DAMAGES_TABLE'],
  [/^comparable cases$/, 'COMPARABLES_TABLE'],
  [/^negotiation history$/, 'NEGOTIATION_HISTORY'],
];

/** Markers that name a PART of a document rather than the whole of it. */
export const SECTION_MARKERS = new Set([
  'EMPLOYMENT_BACKGROUND', 'TERMINATION_FACTS', 'FACTS_SECTION', 'LEGAL_ANALYSIS',
  'LEGAL_BASIS', 'DAMAGES_SECTION', 'DAMAGES_PARTICULARS', 'DEMAND',
  'RELIEF_SOUGHT', 'CLAIM', 'CLOSING', 'TITLE_OF_PROCEEDINGS',
  // Severance assessment and counter-offer
  'OFFER_SUMMARY', 'STATUTORY_FLOOR', 'NOTICE_RANGE', 'CLAUSE_ANALYSIS',
  'GAP_ANALYSIS', 'OTHER_FACTORS', 'RECOMMENDATION',
  // Mediation brief narrative and front-matter tables
  'OVERVIEW', 'FACTUAL_BACKGROUND', 'ISSUES_IN_DISPUTE', 'DEFENCE_RESPONSE',
  'MITIGATION_SECTION', 'SETTLEMENT_POSITION', 'MEDIATION_OBJECTIVES',
  'PRACTICAL_CONSIDERATIONS', 'PROFILE_TABLE', 'DAMAGES_TABLE',
  'COMPARABLES_TABLE', 'NEGOTIATION_HISTORY',
]);

/** Markers that historically received the entire generated document. */
export const WHOLE_DOCUMENT_MARKERS = ['LEGAL_ANALYSIS', 'FACTS_SECTION'];

function normaliseHeading(raw: string): string {
  return raw
    .replace(/<[^>]+>/g, ' ')
    .replace(/&[a-z]+;/gi, ' ')
    .replace(/[:.]+\s*$/, '')
    .replace(/\s+/g, ' ')
    .trim()
    .toLowerCase();
}

function markerFor(headingText: string): string | null {
  const normalised = normaliseHeading(headingText);
  for (const [pattern, marker] of HEADING_TO_MARKER) {
    if (pattern.test(normalised)) return marker;
  }
  return null;
}

/**
 * Split generated HTML into its sections, keyed by placeholder name.
 *
 * Content before the first recognised heading is returned as `preamble`
 * (typically the salutation and opening paragraph). Headings that match no
 * known marker keep their content with the preceding section, so nothing
 * is ever dropped.
 */
export function splitGeneratedSections(html: string): {
  sections: Record<string, string>;
  preamble: string;
  unmatchedHeadings: string[];
} {
  const sections: Record<string, string> = {};
  const unmatchedHeadings: string[] = [];

  // Split on h1/h2/h3 boundaries, keeping the heading with its block.
  const parts = html.split(/(?=<h[123][\s>])/i);
  if (parts.length <= 1) return { sections: {}, preamble: html, unmatchedHeadings: [] };

  let preamble = '';
  let currentMarker: string | null = null;

  for (const part of parts) {
    const headingMatch = part.match(/^<h[123][^>]*>([\s\S]*?)<\/h[123]>/i);
    if (!headingMatch) {
      // Text before any heading.
      if (currentMarker) sections[currentMarker] += part;
      else preamble += part;
      continue;
    }

    const marker = markerFor(headingMatch[1]);
    if (marker) {
      currentMarker = marker;
      // A repeated heading appends rather than overwrites (generators emit
      // one "Legal Analysis" block per approved issue in some documents).
      sections[marker] = (sections[marker] ?? '') + part;
    } else {
      const headingText = normaliseHeading(headingMatch[1]);
      // The document title is an h1 and is not a section; ignore it rather
      // than reporting it as unmatched.
      const isTitle = /^<h1/i.test(part);
      if (!isTitle && headingText) unmatchedHeadings.push(headingText);
      if (currentMarker) sections[currentMarker] += part;
      else preamble += part;
    }
  }

  return { sections, preamble, unmatchedHeadings };
}

/**
 * Decide whether a template wants the document split into sections.
 *
 * A template that uses only the historical whole-document markers keeps the
 * old behaviour (the entire document in one place), so every template built
 * before this existed is unaffected. A template that names two or more
 * distinct sections is asking for sectioned filling.
 */
export function wantsSectionedFill(placeholdersInTemplate: string[]): boolean {
  const sectionMarkers = placeholdersInTemplate.filter(p => SECTION_MARKERS.has(p));
  const distinct = new Set(sectionMarkers);
  if (distinct.size < 2) return false;
  // Two whole-document aliases alone are not a request for sections.
  const onlyWholeDocAliases = [...distinct].every(m => WHOLE_DOCUMENT_MARKERS.includes(m));
  return !onlyWholeDocAliases;
}

/**
 * Build the content values for a sectioned template.
 *
 * Every section marker the template uses receives its own part of the
 * document. Any part of the document whose marker the template does NOT
 * use would otherwise be silently dropped, so it is appended to the first
 * section the template does use — losing a damages analysis because the
 * precedent had no heading for it would be a serious, quiet failure.
 */
export function buildSectionValues(
  generatedHtml: string,
  placeholdersInTemplate: string[],
): Record<string, string> {
  const { sections, preamble } = splitGeneratedSections(generatedHtml);
  const used = placeholdersInTemplate.filter(p => SECTION_MARKERS.has(p));
  const usedSet = new Set(used);

  const values: Record<string, string> = {};
  for (const marker of usedSet) values[marker] = sections[marker] ?? '';

  // Anything generated but unplaced goes to the first used section, in
  // document order, so no analysis silently disappears.
  const orphaned: string[] = [];
  if (preamble.trim() && !usedSet.has('TITLE_OF_PROCEEDINGS')) orphaned.push(preamble);
  for (const [marker, content] of Object.entries(sections)) {
    if (!usedSet.has(marker)) orphaned.push(content);
  }

  if (orphaned.length > 0 && used.length > 0) {
    const first = used[0];
    values[first] = orphaned.join('\n') + (values[first] ?? '');
    logger.info('Generated content had no matching placeholder; folded into the first section', {
      foldedInto: first, orphanedBlocks: orphaned.length,
    });
  }

  return values;
}
