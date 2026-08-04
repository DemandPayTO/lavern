/**
 * Mediation Brief front matter — deterministic tables built from the matter
 * record, prepended to the LLM narrative so the numbers a mediator relies on
 * never pass through the model.
 *
 * Grounded in the verified mediator guidance in
 * docs/research/mediation-brief-practices-2026-07.md (Fisher, Rudner, Rose):
 *  - Plaintiff profile / Bardal table up front (Rudner "put a simple table at
 *    the beginning"; Fisher Practice Point 3)
 *  - Fully itemized damages calculation netting ESA amounts paid (Fisher
 *    Practice Point 8)
 *  - Comparable-case table in lieu of settled-law argument (Fisher Practice
 *    Point 4)
 *  - Complete negotiation history, or an honest statement that there has been
 *    none (Fisher Practice Point 7; Rose Tip 16)
 *
 * Tables are omitted, with an explicit lawyer review flag, when the matter
 * lacks the data. Pure and deterministic; unit-tested.
 */

import type { EmploymentIntakeData, IntakeAnalysisResult } from '../types/employment-intake.js';
import type { ComparableCase, CaseBasedRange } from './case-comparables.js';
import type { NegotiationEntry, NegotiationSummary } from './negotiation.js';

export interface MediationFrontMatterInput {
  intake: EmploymentIntakeData;
  analysis: IntakeAnalysisResult;
  comparables?: ComparableCase[] | null;
  comparableRange?: CaseBasedRange | null;
  negotiationEntries?: NegotiationEntry[] | null;
  negotiationSummary?: NegotiationSummary | null;
  /** The firm's opening-table row labels from its style profile, when learned. */
  profileTableRows?: string[] | null;
}

export interface MediationFrontMatter {
  html: string;
  /** Which tables were included (drives the narrative prompt). */
  included: string[];
  /** What could not be built and why (surfaced as lawyer review flags). */
  flags: string[];
}

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cad = (n: number): string =>
  `$${Math.round(n).toLocaleString('en-CA')}`;

function row(label: string, value: string): string {
  return `<tr><th>${esc(label)}</th><td>${value}</td></tr>`;
}

// ── 1. Plaintiff profile (the Bardal table) ──────────────────────────────

/**
 * When a style profile learned the firm's own opening-table row labels,
 * the table is rendered in THAT shape: the firm's labels, the firm's
 * order, the matter's real values. A label Starling cannot map to a known
 * field renders as [LAWYER: complete] and is flagged, so the firm's
 * structure survives with its holes visible instead of silently replaced
 * by the generic layout. Values never come from the model either way.
 */
function firmShapedProfileTable(
  intake: EmploymentIntakeData,
  analysis: IntakeAnalysisResult,
  rowSpec: string[],
): { html: string; flags: string[] } {
  const flags: string[] = [];
  const b = analysis.bardalFactors;
  const d = analysis.damagesEstimate;
  const name = [intake.client_first_name, intake.client_last_name].filter(Boolean).join(' ');
  const employer = intake.employer_legal_name ?? intake.employer_operating_name;
  const start = intake.hire_date ?? intake.first_day_of_work;
  const comp: string[] = [];
  if (intake.annual_salary) comp.push(`Base salary ${cad(intake.annual_salary)} per year`);
  if (intake.has_bonus && intake.bonus_amount) comp.push(`bonus ${cad(intake.bonus_amount)}`);
  if (intake.has_commissions && intake.commission_amount) comp.push(`commissions ${cad(intake.commission_amount)}`);
  const dismissalType = intake.was_terminated
    ? (intake.employer_alleged_just_cause ? 'Termination; employer alleges just cause' : 'Termination without cause')
    : intake.is_constructive_dismissal ? 'Constructive dismissal (alleged)' : null;

  // Keyword → value resolvers. First match wins; order the specific
  // before the general ("date of termination" before "termination").
  const resolvers: Array<[RegExp, () => string | null]> = [
    [/plaintiff|client name|employee(?!r)|grievor/i, () => name || null],
    [/employer|defendant|respondent|company/i, () => employer ?? null],
    [/age/i, () => b.age != null ? String(b.age) : null],
    [/(length|years) of (service|employment)|tenure|service/i, () =>
      b.tenureYears != null ? `${start ?? ''}${start && intake.termination_date ? ' to ' : ''}${intake.termination_date ?? ''} (${b.tenureYears} years)`.trim() : null],
    [/date of (hire|start)|start date|hired/i, () => start ?? null],
    [/date of (termination|dismissal)|termination date|dismissed/i, () => intake.termination_date ?? null],
    [/position|title|role|occupation/i, () => intake.job_title ?? null],
    [/character of (the )?employment|character/i, () => b.character ?? null],
    [/availability|comparable employment|similar employment|re-?employment/i, () => b.availability ?? null],
    [/compensation|salary|income|remuneration|earnings/i, () => comp.length ? comp.join('; ') : null],
    [/notice (period )?(sought|claimed|range)|reasonable notice/i, () =>
      d.commonLawHighMonths > 0 ? `${d.commonLawLowMonths} to ${d.commonLawHighMonths} months` : null],
    [/type of (dismissal|termination)|nature of (the )?dismissal/i, () => dismissalType],
    [/termination clause|written contract|employment (agreement|contract)/i, () =>
      intake.termination_clause_exists === true ? 'Yes; enforceability in issue'
        : intake.termination_clause_exists === false ? 'None' : null],
    [/mitigation/i, () => null],   // always case-specific; leave for the lawyer
  ];

  const rows: string[] = [];
  const unmapped: string[] = [];
  // Two labels resolving through the same rule to the same value are one
  // fact ("Age" and "Age at Dismissal"); the second is dropped rather
  // than the plaintiff's age appearing twice.
  const seenFacts = new Set<string>();
  for (const label of rowSpec) {
    let value: string | null = null;
    let resolverIdx = -1;
    for (let ri = 0; ri < resolvers.length; ri++) {
      if (resolvers[ri][0].test(label)) { value = resolvers[ri][1](); resolverIdx = ri; break; }
    }
    if (value) {
      const factKey = `${resolverIdx}|${value}`;
      if (seenFacts.has(factKey)) continue;
      seenFacts.add(factKey);
      rows.push(row(label, esc(value)));
    } else {
      rows.push(row(label, '<em>[LAWYER: complete]</em>'));
      unmapped.push(label);
    }
  }
  if (unmapped.length > 0) {
    flags.push(`Profile table follows your firm's layout; complete these rows by hand before service: ${unmapped.join('; ')}.`);
  }
  return {
    html: `<h2>Profile of the Plaintiff</h2>\n<table>\n${rows.join('\n')}\n</table>`,
    flags,
  };
}

export function buildProfileTable(intake: EmploymentIntakeData, analysis: IntakeAnalysisResult, rowSpec?: string[] | null): { html: string; flags: string[] } {
  if (rowSpec && rowSpec.length >= 3) return firmShapedProfileTable(intake, analysis, rowSpec);
  const flags: string[] = [];
  const b = analysis.bardalFactors;
  const rows: string[] = [];

  const name = [intake.client_first_name, intake.client_last_name].filter(Boolean).join(' ');
  if (name) rows.push(row('Plaintiff', esc(name)));
  const employer = intake.employer_legal_name ?? intake.employer_operating_name;
  if (employer) rows.push(row('Defendant employer', esc(employer)));

  if (b.age != null) rows.push(row('Age at dismissal', esc(b.age)));
  else flags.push('Profile table: age missing from intake; add the client date of birth (mediators expect it).');

  const start = intake.hire_date ?? intake.first_day_of_work;
  const end = intake.termination_date;
  if (start && end && b.tenureYears != null) {
    rows.push(row('Length of service', `${esc(start)} to ${esc(end)} (${esc(b.tenureYears)} years)`));
  } else if (b.tenureYears != null) {
    rows.push(row('Length of service', `${esc(b.tenureYears)} years`));
  } else {
    flags.push('Profile table: service dates missing from intake.');
  }

  if (intake.job_title) rows.push(row('Position', esc(intake.job_title)));
  if (b.character) rows.push(row('Character of employment', esc(b.character)));
  if (b.availability) rows.push(row('Availability of similar employment', esc(b.availability)));

  const comp: string[] = [];
  if (intake.annual_salary) comp.push(`Base salary ${cad(intake.annual_salary)} per year`);
  if (intake.has_bonus && intake.bonus_amount) comp.push(`bonus ${cad(intake.bonus_amount)}`);
  if (intake.has_commissions && intake.commission_amount) comp.push(`commissions ${cad(intake.commission_amount)}`);
  if (comp.length) rows.push(row('Compensation', esc(comp.join('; '))));
  else flags.push('Profile table: compensation missing from intake.');

  const dismissalType = intake.was_terminated
    ? (intake.employer_alleged_just_cause ? 'Termination; employer alleges just cause' : 'Termination without cause')
    : intake.is_constructive_dismissal ? 'Constructive dismissal (alleged)' : null;
  if (dismissalType) rows.push(row('Type of dismissal', esc(dismissalType)));

  if (intake.termination_clause_exists !== undefined && intake.termination_clause_exists !== null) {
    rows.push(row('Written termination clause', intake.termination_clause_exists ? 'Yes; enforceability in issue' : 'None'));
  }

  if (rows.length < 3) {
    return { html: '', flags: ['Profile table omitted: intake is too sparse to present the Bardal profile. Complete the intake before serving this brief.'] };
  }
  return {
    html: `<h2>Profile of the Plaintiff</h2>\n<table>\n${rows.join('\n')}\n</table>`,
    flags,
  };
}

// ── 2. Itemized damages table ────────────────────────────────────────────

export function buildDamagesTable(intake: EmploymentIntakeData, analysis: IntakeAnalysisResult): { html: string; flags: string[] } {
  const flags: string[] = [];
  const d = analysis.damagesEstimate;
  if (!intake.annual_salary || d.commonLawHighAmount <= 0) {
    return { html: '', flags: ['Damages table omitted: no salary or damages estimate on the matter. Run the analysis before serving this brief.'] };
  }

  const rows: string[] = [];
  rows.push(`<tr><th>Head</th><th>Low (${esc(d.commonLawLowMonths)} months)</th><th>High (${esc(d.commonLawHighMonths)} months)</th></tr>`);
  rows.push(`<tr><td>Base salary over the notice period</td><td>${cad(d.commonLawLowAmount)}</td><td>${cad(d.commonLawHighAmount)}</td></tr>`);

  for (const head of d.additionalHeads ?? []) {
    if (head.estimatedAmount) {
      rows.push(`<tr><td>${esc(head.name)}</td><td colspan="2">${cad(head.estimatedAmount)} (${esc(head.basis)})</td></tr>`);
    } else {
      rows.push(`<tr><td>${esc(head.name)}</td><td colspan="2">${esc(head.basis)}</td></tr>`);
    }
  }

  const esaTotal = (d.esaNoticePay ?? 0) + (d.esaSeverancePay ?? 0);
  if (esaTotal > 0) {
    rows.push(`<tr><td>Less: statutory amounts (ESA notice ${esc(d.esaNoticeWeeks)} weeks ${cad(d.esaNoticePay)}${d.esaSeverancePay ? `; severance ${cad(d.esaSeverancePay)}` : ''})</td><td colspan="2">to be credited if and when paid</td></tr>`);
  }

  rows.push(`<tr><th>Estimated range</th><th>${cad(d.totalEstimateLow)}</th><th>${cad(d.totalEstimateHigh)}</th></tr>`);

  flags.push('Damages table: confirm ESA amounts actually paid and any mitigation earnings, and net them before service (Fisher: deduct monies paid and mitigation income to a net figure).');

  return {
    html: `<h2>Damages Calculation</h2>\n<table>\n${rows.join('\n')}\n</table>`,
    flags,
  };
}

// ── 3. Comparable cases table ────────────────────────────────────────────

export function buildComparablesTable(comparables: ComparableCase[] | null | undefined, range: CaseBasedRange | null | undefined): { html: string; flags: string[] } {
  const usable = (comparables ?? []).filter((c) => c.monthsAwarded != null).slice(0, 6);
  if (usable.length === 0) {
    return { html: '', flags: ['Comparable-case table omitted: the case library returned no comparables for this profile (or the caselaw connection is not configured). Mediators prefer a comparable-case report over legal argument; consider adding one manually.'] };
  }

  const rows = usable.map((c) =>
    `<tr><td>${esc(c.caseName)}${c.citation ? `, ${esc(c.citation)}` : ''}</td><td>${c.age ?? ''}</td><td>${c.yearsOfService ?? ''}</td><td>${esc(c.seniorityLevel ?? '')}</td><td>${c.monthsAwarded}</td></tr>`);

  const rangeLine = range
    ? `<p>Across the ${range.basedOnCases} nearest decided cases, notice awarded ranged from ${range.lowMonths} to ${range.highMonths} months (midpoint ${range.midMonths}).</p>`
    : '';

  return {
    html: `<h2>Comparable Cases</h2>\n<table>\n<tr><th>Case</th><th>Age</th><th>Years of service</th><th>Seniority</th><th>Months awarded</th></tr>\n${rows.join('\n')}\n</table>\n${rangeLine}`,
    flags: ['Comparable-case table: verify each case against the source decision before service.'],
  };
}

// ── 4. Negotiation history table ─────────────────────────────────────────

export function buildNegotiationTable(entries: NegotiationEntry[] | null | undefined): { html: string; flags: string[] } {
  const list = (entries ?? []).slice().sort((a, b) => a.date.localeCompare(b.date));
  if (list.length === 0) {
    // Fisher: if there have been no real negotiations, be honest and say so.
    return {
      html: '<h2>Negotiation History</h2>\n<p>There have been no substantive negotiations between the parties to date.</p>',
      flags: ['Negotiation history: the matter ledger records no offers. If offers HAVE been exchanged, record them on the Negotiation tab and regenerate; mediators expect the complete history including Rule 49 offers.'],
    };
  }

  const partyLabel = (p: string) => (p === 'employer' ? 'Employer' : 'Plaintiff');
  const rows = list.map((e) =>
    `<tr><td>${esc(e.date)}</td><td>${esc(partyLabel(e.party))}</td><td>${esc(e.kind)}</td><td>${e.amountCad != null ? cad(e.amountCad) : ''}</td><td>${esc(e.terms ?? '')}</td></tr>`);

  return {
    html: `<h2>Negotiation History</h2>\n<table>\n<tr><th>Date</th><th>Party</th><th>Step</th><th>Amount</th><th>Terms</th></tr>\n${rows.join('\n')}\n</table>`,
    flags: ['Negotiation history: attach copies of any Rule 49 offers served, whether or not still open.'],
  };
}

// ── Cover and sign-off (deterministic boilerplate) ───────────────────────

/**
 * The brief's first page: full parties, the title, counsel. These stay
 * consistent across every brief the firm serves, so they are assembled
 * from the matter record, never drafted.
 */
export function buildMediationCover(args: {
  intake: EmploymentIntakeData;
  lawyerName: string;
  firmName: string;
  firmAddress?: string;
  mediationDate?: string;
  mediatorName?: string;
}): string {
  const plaintiff = esc([args.intake.client_first_name, args.intake.client_last_name].filter(Boolean).join(' ') || '[LAWYER: plaintiff name]');
  const defendant = esc(args.intake.employer_legal_name ?? args.intake.employer_operating_name ?? '[LAWYER: defendant name]');
  const logistics = args.mediationDate || args.mediatorName
    ? `<p class="centered"><strong>Mediation${args.mediationDate ? ` scheduled for ${esc(args.mediationDate)}` : ''}${args.mediatorName ? ` before ${esc(args.mediatorName)}` : ''}</strong></p>`
    : '';
  return [
    '<p class="centered">BETWEEN:</p>',
    `<p class="centered"><strong>${plaintiff}</strong></p>`,
    '<p class="centered">Plaintiff</p>',
    '<p class="centered">- and -</p>',
    `<p class="centered"><strong>${defendant}</strong></p>`,
    '<p class="centered">Defendant</p>',
    '<h1>MEDIATION BRIEF OF THE PLAINTIFF</h1>',
    logistics,
    `<p class="centered">${esc(args.firmName)}<br>Per: ${esc(args.lawyerName)}<br>Lawyers for the Plaintiff${args.firmAddress ? `<br>${esc(args.firmAddress)}` : ''}</p>`,
    '<hr>',
  ].filter(Boolean).join('\n');
}

/** The closing the brief must never go out without. */
export function buildMediationSignOff(args: {
  lawyerName: string;
  firmName: string;
  firmAddress?: string;
  date?: Date;
}): string {
  const d = args.date ?? new Date();
  const dateLine = d.toLocaleDateString('en-CA', { year: 'numeric', month: 'long', day: 'numeric' });
  return [
    `<p>ALL OF WHICH IS RESPECTFULLY SUBMITTED this ${dateLine}.</p>`,
    `<p>${esc(args.firmName)}<br>Per: ${esc(args.lawyerName)}<br>Lawyers for the Plaintiff${args.firmAddress ? `<br>${esc(args.firmAddress)}` : ''}</p>`,
  ].join('\n');
}

// ── Paragraph numbering (factum convention) ──────────────────────────────

/**
 * Number the narrative paragraphs consecutively ("1. ", "2. ", ...), the
 * factum convention counsel and mediators use to reference the brief.
 * Applied deterministically after generation so the numbering can never
 * skip, repeat, or drift; the model is never asked to count. Only <p>
 * elements are numbered; headings, tables, and list items keep their own
 * structure.
 */
export function numberNarrativeParagraphs(html: string): string {
  let n = 0;
  // The model sometimes numbers paragraphs itself despite instruction.
  // Its number is stripped and OURS applied, so the sequence is always
  // consecutive; keeping the model's would double-number ("12. 12. ...")
  // and trusting it would let the sequence skip or repeat.
  return html.replace(/<p(\s[^>]*)?>(\s*(?:&nbsp;|\u00a0|\s)*\d{1,3}[.)](?:&nbsp;|\u00a0|\s)+)?/g, (_m, attrs) => {
    n += 1;
    return `<p${attrs ?? ''}>${n}.&nbsp;&nbsp;`;
  });
}

// ── Composition ──────────────────────────────────────────────────────────

export function buildMediationFrontMatter(input: MediationFrontMatterInput): MediationFrontMatter {
  const profile = buildProfileTable(input.intake, input.analysis, input.profileTableRows);
  const damages = buildDamagesTable(input.intake, input.analysis);
  const comparables = buildComparablesTable(input.comparables, input.comparableRange);
  const negotiation = buildNegotiationTable(input.negotiationEntries);

  const included: string[] = [];
  if (profile.html) included.push('profile');
  if (damages.html) included.push('damages');
  if (comparables.html) included.push('comparables');
  if (negotiation.html) included.push('negotiation');

  const html = [profile.html, damages.html, comparables.html, negotiation.html]
    .filter(Boolean)
    .join('\n\n');

  return {
    html,
    included,
    flags: [...profile.flags, ...damages.flags, ...comparables.flags, ...negotiation.flags],
  };
}
