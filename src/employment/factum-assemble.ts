/**
 * Factum assembly — turn the approved sections into the numbered factum.
 *
 * Once the lawyer has drafted and approved each section of the outline
 * (factum-outline.ts), this stitches them into a single Rule 4.06.1 factum:
 * the Part headings, an argument sub-heading per Part III section, consecutive
 * paragraph numbers across Parts I to IV, and the two schedules built
 * deterministically from the authorities the arguments cite. The section text
 * is the lawyer's approved text; nothing here is written by a model.
 */

import { enforceHouseStyle } from '../utils/house-style.js';
import { numberNarrativeParagraphs, esc } from './mediation-brief-tables.js';
import type { EmploymentIntakeData } from '../types/employment-intake.js';
import type { FactumSectionKind } from './factum-outline.js';

export interface FactumAssemblySection {
  kind: FactumSectionKind;
  header: string;
  html: string;
  authorities?: string;
}

export interface FactumAssemblyResult {
  html: string;
  documentTitle: string;
  lawyerReviewFlags: string[];
  authorities: string[];
}

/** Split an authority string into its individual citations (semicolon list). */
function splitAuthorities(s: string | undefined): string[] {
  return (s ?? '').split(';').map(a => a.trim()).filter(Boolean);
}

/** A citation is legislation (Schedule B) when it names an Act, Code, or
 *  regulation; otherwise it is a case (Schedule A). */
function isLegislation(cite: string): boolean {
  return /\b(Act|Code|Regulation|By-?law)\b|\bR\.?S\.?O\.?\b|\bS\.?O\.?\s*\d|\bO\.?\s*Reg\b/.test(cite);
}

const ROMAN: Record<string, string> = { overview: 'I', facts: 'II', order: 'IV' };
const PART_TITLE: Record<string, string> = {
  overview: 'OVERVIEW',
  facts: 'THE FACTS',
  order: 'THE ORDER REQUESTED',
};

/** Letter labels for the Part III argument sub-headings (A, B, C, ...). */
function argLetter(i: number): string {
  return String.fromCharCode(65 + (i % 26));
}

export function assembleFactum(input: {
  sections: FactumAssemblySection[];
  intake: EmploymentIntakeData;
  claimAmount?: number;
}): FactumAssemblyResult {
  const plaintiff = [input.intake.client_first_name, input.intake.client_last_name].filter(Boolean).join(' ') || 'the Plaintiff';

  const overview = input.sections.find(s => s.kind === 'overview');
  const facts = input.sections.find(s => s.kind === 'facts');
  const args = input.sections.filter(s => s.kind === 'argument');
  const order = input.sections.find(s => s.kind === 'order');

  // Parts I, II: heading + the lawyer's approved paragraphs.
  const parts: string[] = [];
  if (overview) parts.push(`<h2>PART ${ROMAN.overview} - ${PART_TITLE.overview}</h2>\n${overview.html}`);
  if (facts) parts.push(`<h2>PART ${ROMAN.facts} - ${PART_TITLE.facts}</h2>\n${facts.html}`);

  // Part III: one sub-heading per argument, in outline order.
  if (args.length > 0) {
    const body = args.map((a, i) => `<h3>${argLetter(i)}. ${esc(a.header)}</h3>\n${a.html}`).join('\n\n');
    parts.push(`<h2>PART III - THE ISSUES AND THE LAW</h2>\n${body}`);
  }

  // Part IV.
  if (order) parts.push(`<h2>PART ${ROMAN.order} - ${PART_TITLE.order}</h2>\n${order.html}`);

  // Number the argument and narrative paragraphs consecutively across Parts I
  // to IV. Headings are not <p>, so they are untouched; the schedules are
  // appended after numbering so their entries stay unnumbered.
  const numberedBody = numberNarrativeParagraphs(parts.join('\n\n'));

  // Schedules from the authorities the kept arguments cite, deduped in order.
  const seen: string[] = [];
  for (const a of args) for (const c of splitAuthorities(a.authorities)) if (!seen.includes(c)) seen.push(c);
  const cases = seen.filter(c => !isLegislation(c));
  const statutes = seen.filter(isLegislation);

  const scheduleA = `<h2>SCHEDULE "A" - LIST OF AUTHORITIES</h2>\n${
    cases.length > 0
      ? `<ol>\n${cases.map(c => `<li>${esc(c)}</li>`).join('\n')}\n</ol>`
      : '<p>[LAWYER: no case authorities were cited in the kept arguments. Confirm the list.]</p>'
  }`;
  const scheduleB = `<h2>SCHEDULE "B" - TEXT OF STATUTES, REGULATIONS AND BY-LAWS RELIED ON</h2>\n${
    statutes.length > 0
      ? `<ol>\n${statutes.map(c => `<li>${esc(c)}</li>`).join('\n')}\n</ol>\n<p>[LAWYER: attach the text of the provisions relied on, per Rule 4.06.1.]</p>`
      : '<p>[LAWYER: attach the text of any statutory provisions relied on, per Rule 4.06.1.]</p>'
  }`;

  const html = enforceHouseStyle([
    `<h1>Factum of the Plaintiff, ${esc(plaintiff)}</h1>`,
    numberedBody,
    scheduleA,
    scheduleB,
  ].filter(Boolean).join('\n\n'));

  const lawyerReviewFlags = [
    `Assembled from your approved sections. The Schedule of Authorities lists ${cases.length} case authorit${cases.length === 1 ? 'y' : 'ies'} and ${statutes.length} statutory provision${statutes.length === 1 ? '' : 's'} from the arguments you kept; confirm the lists and attach the text for Schedule B.`,
    'Complete each [Affidavit, para X] reference against the sworn record before filing.',
    'Confirm the quantum matches the damages analysis, and check the length against the court requirement (motion factums run to twenty pages).',
  ];

  return { html, documentTitle: "Plaintiff's Factum (Summary Judgment)", lawyerReviewFlags, authorities: seen };
}
