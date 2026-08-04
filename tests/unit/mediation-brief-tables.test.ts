/**
 * Unit Tests — Mediation Brief front-matter tables
 * (src/employment/mediation-brief-tables.ts)
 *
 * The tables carry the numbers a mediator relies on, so they must be
 * reproducible from the matter record, omit themselves honestly when data
 * is missing, and never contain em-dashes or unescaped HTML.
 */

import { describe, it, expect } from 'vitest';
import {
  buildProfileTable,
  buildDamagesTable,
  buildComparablesTable,
  buildNegotiationTable,
  buildMediationFrontMatter,
  numberNarrativeParagraphs, buildMediationCover, buildMediationSignOff,
} from '../../src/employment/mediation-brief-tables.js';
import type { EmploymentIntakeData, IntakeAnalysisResult } from '../../src/types/employment-intake.js';
import type { ComparableCase, CaseBasedRange } from '../../src/employment/case-comparables.js';
import type { NegotiationEntry } from '../../src/employment/negotiation.js';

const intake = {
  client_first_name: 'Dana',
  client_last_name: 'Woo',
  employer_legal_name: 'Acme Widgets Inc.',
  hire_date: '2013-03-04',
  termination_date: '2026-02-27',
  job_title: 'Operations Manager',
  annual_salary: 104000,
  has_bonus: true,
  bonus_amount: 9000,
  was_terminated: true,
  employer_alleged_just_cause: false,
  termination_clause_exists: true,
} as unknown as EmploymentIntakeData;

const analysis = {
  bardalFactors: {
    age: 52,
    tenureYears: 12.9,
    character: 'Mid-level management, operations',
    availability: 'Specialized sector, limited comparable roles regionally',
  },
  damagesEstimate: {
    esaNoticeWeeks: 8,
    esaNoticePay: 16000,
    esaSeverancePay: 25800,
    commonLawLowMonths: 14,
    commonLawHighMonths: 18,
    commonLawLowAmount: 121333,
    commonLawHighAmount: 156000,
    additionalHeads: [{ name: 'Benefits over the notice period', basis: '10 percent of base', estimatedAmount: 14000 }],
    totalEstimateLow: 135333,
    totalEstimateHigh: 170000,
  },
} as unknown as IntakeAnalysisResult;

const comparables: ComparableCase[] = [
  { id: '1', caseName: 'Bain v UBS Securities Canada Inc', citation: '2016 ONSC 5362', court: 'ONSC', year: 2016, summary: null, yearsOfService: 14, age: 46, seniorityLevel: 'senior', monthsAwarded: 18, distance: 0.4 },
  { id: '2', caseName: 'Paquette v TeraGo Networks Inc', citation: '2016 ONCA 618', court: 'ONCA', year: 2016, summary: null, yearsOfService: 14, age: 49, seniorityLevel: 'manager', monthsAwarded: 17, distance: 0.6 },
];
const range: CaseBasedRange = { lowMonths: 15, midMonths: 17, highMonths: 18, basedOnCases: 6 };

const offers: NegotiationEntry[] = [
  { id: 'a', date: '2026-04-02', party: 'employer', kind: 'offer', amountCad: 42000, terms: 'Lump sum, full release', recordedAt: '2026-04-02T12:00:00Z' },
  { id: 'b', date: '2026-05-11', party: 'client', kind: 'counter', amountCad: 130000, recordedAt: '2026-05-11T12:00:00Z' },
];

describe('buildProfileTable', () => {
  it('renders the Bardal profile with age, service, position, compensation, dismissal type', () => {
    const { html, flags } = buildProfileTable(intake, analysis);
    expect(html).toContain('Profile of the Plaintiff');
    expect(html).toContain('52');
    expect(html).toContain('2013-03-04 to 2026-02-27 (12.9 years)');
    expect(html).toContain('Operations Manager');
    expect(html).toContain('$104,000');
    expect(html).toContain('Termination without cause');
    expect(html).toContain('enforceability in issue');
    expect(flags).toEqual([]);
  });

  it('omits itself with a flag when intake is too sparse', () => {
    const sparse = {} as EmploymentIntakeData;
    const { html, flags } = buildProfileTable(sparse, { ...analysis, bardalFactors: { age: null, tenureYears: null, character: '', availability: '' } } as IntakeAnalysisResult);
    expect(html).toBe('');
    expect(flags.some((f) => f.includes('omitted'))).toBe(true);
  });

  it('escapes HTML in intake values', () => {
    const nasty = { ...intake, job_title: '<script>alert(1)</script>' } as EmploymentIntakeData;
    const { html } = buildProfileTable(nasty, analysis);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('buildDamagesTable', () => {
  it('itemizes the range with ESA credit note and totals', () => {
    const { html, flags } = buildDamagesTable(intake, analysis);
    expect(html).toContain('Damages Calculation');
    expect(html).toContain('$121,333');
    expect(html).toContain('$156,000');
    expect(html).toContain('Benefits over the notice period');
    expect(html).toContain('ESA notice 8 weeks $16,000');
    expect(html).toContain('$135,333');
    expect(html).toContain('$170,000');
    expect(flags.some((f) => f.includes('mitigation'))).toBe(true);
  });

  it('omits itself when there is no damages estimate', () => {
    const { html, flags } = buildDamagesTable({} as EmploymentIntakeData, {
      ...analysis,
      damagesEstimate: { ...analysis.damagesEstimate, commonLawHighAmount: 0 },
    } as IntakeAnalysisResult);
    expect(html).toBe('');
    expect(flags[0]).toContain('omitted');
  });
});

describe('buildComparablesTable', () => {
  it('renders each case with months awarded and the range line', () => {
    const { html } = buildComparablesTable(comparables, range);
    expect(html).toContain('Comparable Cases');
    expect(html).toContain('Bain v UBS Securities Canada Inc, 2016 ONSC 5362');
    expect(html).toContain('<td>18</td>');
    expect(html).toContain('ranged from 15 to 18 months');
  });

  it('omits itself with a flag when the library returned nothing', () => {
    const { html, flags } = buildComparablesTable(null, null);
    expect(html).toBe('');
    expect(flags[0]).toContain('Comparable-case table omitted');
  });
});

describe('buildNegotiationTable', () => {
  it('renders offers in date order', () => {
    const { html, flags } = buildNegotiationTable([offers[1], offers[0]]);
    expect(html).toContain('Negotiation History');
    expect(html.indexOf('2026-04-02')).toBeLessThan(html.indexOf('2026-05-11'));
    expect(html).toContain('$42,000');
    expect(html).toContain('Lump sum, full release');
    expect(flags.some((f) => f.includes('Rule 49'))).toBe(true);
  });

  it('states honestly that there were no negotiations (Fisher rule)', () => {
    const { html, flags } = buildNegotiationTable([]);
    expect(html).toContain('no substantive negotiations');
    expect(flags.some((f) => f.includes('ledger records no offers'))).toBe(true);
  });
});

describe('numberNarrativeParagraphs', () => {
  it('numbers paragraphs consecutively across sections (factum convention)', () => {
    const html = '<h2>Overview</h2>\n<p>First.</p>\n<p>Second.</p>\n<h2>Facts</h2>\n<p>Third.</p>';
    const out = numberNarrativeParagraphs(html);
    expect(out).toContain('<p>1.&nbsp;&nbsp;First.</p>');
    expect(out).toContain('<p>2.&nbsp;&nbsp;Second.</p>');
    expect(out).toContain('<p>3.&nbsp;&nbsp;Third.</p>');
  });

  it('leaves headings and list items unnumbered', () => {
    const html = '<h2>Issues</h2>\n<ol><li>One issue</li><li>Another</li></ol>\n<p>Wrap up.</p>';
    const out = numberNarrativeParagraphs(html);
    expect(out).toContain('<li>One issue</li>');
    expect(out).toContain('<h2>Issues</h2>');
    expect(out).toContain('<p>1.&nbsp;&nbsp;Wrap up.</p>');
  });

  it('handles paragraphs with attributes and empty input', () => {
    expect(numberNarrativeParagraphs('<p class="x">A.</p>')).toContain('<p class="x">1.&nbsp;&nbsp;A.</p>');
    expect(numberNarrativeParagraphs('')).toBe('');
  });
});

describe('buildMediationFrontMatter', () => {
  it('composes all four tables and reports what is included', () => {
    const fm = buildMediationFrontMatter({ intake, analysis, comparables, comparableRange: range, negotiationEntries: offers });
    expect(fm.included).toEqual(['profile', 'damages', 'comparables', 'negotiation']);
    expect(fm.html).toContain('Profile of the Plaintiff');
    expect(fm.html).toContain('Comparable Cases');
  });

  it('contains no em-dashes anywhere (house style)', () => {
    const fm = buildMediationFrontMatter({ intake, analysis, comparables, comparableRange: range, negotiationEntries: offers });
    expect(fm.html.includes('—')).toBe(false);
    expect(fm.flags.join(' ').includes('—')).toBe(false);
  });

  it('degrades to flags-only on an empty matter', () => {
    const fm = buildMediationFrontMatter({
      intake: {} as EmploymentIntakeData,
      analysis: { bardalFactors: { age: null, tenureYears: null, character: '', availability: '' }, damagesEstimate: { ...analysis.damagesEstimate, commonLawHighAmount: 0 } } as unknown as IntakeAnalysisResult,
    });
    expect(fm.included).toEqual(['negotiation']);
    expect(fm.flags.length).toBeGreaterThanOrEqual(3);
  });
});


describe('firm-shaped profile table (style profile rowSpec)', () => {
  const intake = {
    client_first_name: 'Aisha', client_last_name: 'Osei',
    employer_legal_name: 'Brightpath Financial Group Inc',
    job_title: 'Senior Analyst', hire_date: '2019-09-03', termination_date: '2026-04-20',
    annual_salary: 110000, was_terminated: true, termination_clause_exists: false,
  } as never;
  const analysis = {
    bardalFactors: { age: 47, tenureYears: 6.6, character: 'Specialised analytical role', availability: 'Limited comparable roles' },
    damagesEstimate: { esaNoticeWeeks: 6, esaNoticePay: 12692, esaSeverancePay: 13962, commonLawLowMonths: 8, commonLawHighMonths: 12, commonLawLowAmount: 73333, commonLawHighAmount: 110000, additionalHeads: [], totalEstimateLow: 73333, totalEstimateHigh: 110000 },
    timeline: [], gates: [], limitationDeadline: { date: '2028-04-20', daysRemaining: 600, urgent: false },
    recommendedProcedure: 'simplified',
  } as never;

  it('renders the firm labels in the firm order with the matter values', () => {
    const { html, flags } = buildProfileTable(intake, analysis, [
      'Name of Employee', 'Age at Dismissal', 'Length of Service', 'Position Held',
      'Annual Compensation', 'Reasonable Notice Sought',
    ]);
    const order = ['Name of Employee', 'Age at Dismissal', 'Length of Service', 'Position Held', 'Annual Compensation', 'Reasonable Notice Sought'];
    let last = -1;
    for (const label of order) {
      const at = html.indexOf(label);
      expect(at, label).toBeGreaterThan(last);
      last = at;
    }
    expect(html).toContain('Aisha Osei');
    expect(html).toContain('47');
    expect(html).toContain('6.6 years');
    expect(html).toContain('Senior Analyst');
    expect(html).toContain('$110,000');
    expect(html).toContain('8 to 12 months');
    expect(flags).toEqual([]);
  });

  it('keeps an unmappable firm row visible as [LAWYER: complete] and flags it', () => {
    const { html, flags } = buildProfileTable(intake, analysis, [
      'Age at Dismissal', 'Family Circumstances', 'Professional Designations',
    ]);
    expect(html).toContain('Family Circumstances');
    expect(html).toContain('[LAWYER: complete]');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('Family Circumstances');
    expect(flags[0]).toContain('Professional Designations');
  });

  it('falls back to the standard table when the spec is too thin to be a table', () => {
    const { html } = buildProfileTable(intake, analysis, ['Age']);
    expect(html).toContain('Age at dismissal');
  });
});


describe('cover and sign-off (deterministic boilerplate)', () => {
  const intake = { client_first_name: 'Aisha', client_last_name: 'Osei', employer_legal_name: 'Brightpath Financial Group Inc' } as never;

  it('builds the first page: parties, -and-, title, counsel', () => {
    const cover = buildMediationCover({ intake, lawyerName: 'Jordan Haworth', firmName: 'Evans Law Firm', firmAddress: '1 King St W' });
    const order = ['BETWEEN:', 'Aisha Osei', 'Plaintiff', '- and -', 'Brightpath Financial Group Inc', 'Defendant', 'MEDIATION BRIEF OF THE PLAINTIFF', 'Evans Law Firm', 'Per: Jordan Haworth', 'Lawyers for the Plaintiff'];
    let last = -1;
    for (const piece of order) {
      const at = cover.indexOf(piece);
      expect(at, piece).toBeGreaterThan(last);
      last = at;
    }
    // Centered via class, never inline style (the sanitiser strips styles).
    expect(cover).toContain('class="centered"');
    expect(cover).not.toContain('style=');
  });

  it('marks missing parties for the lawyer instead of omitting the block', () => {
    const cover = buildMediationCover({ intake: {} as never, lawyerName: 'J', firmName: 'F' });
    expect(cover).toContain('[LAWYER: plaintiff name]');
    expect(cover).toContain('[LAWYER: defendant name]');
  });

  it('signs off with the date, the firm, and counsel', () => {
    const signOff = buildMediationSignOff({ lawyerName: 'Jordan Haworth', firmName: 'Evans Law Firm', date: new Date('2026-08-05T12:00:00') });
    expect(signOff).toContain('ALL OF WHICH IS RESPECTFULLY SUBMITTED this August 5, 2026');
    expect(signOff).toContain('Per: Jordan Haworth');
  });
});

describe('firm table never states one fact twice', () => {
  it('drops a second label that resolves to the same value (Age / Age at Dismissal)', () => {
    const intake = { client_first_name: 'A', client_last_name: 'O', annual_salary: 100000 } as never;
    const analysis = {
      bardalFactors: { age: 47, tenureYears: 6 },
      damagesEstimate: { esaNoticeWeeks: 6, esaNoticePay: 1, esaSeverancePay: 1, commonLawLowMonths: 8, commonLawHighMonths: 12, commonLawLowAmount: 1, commonLawHighAmount: 2, additionalHeads: [], totalEstimateLow: 1, totalEstimateHigh: 2 },
      timeline: [], gates: [], limitationDeadline: { date: '', daysRemaining: 0, urgent: false }, recommendedProcedure: 'simplified',
    } as never;
    const { html } = buildProfileTable(intake, analysis, ['Age at Dismissal', 'Length of Service', 'Age']);
    expect((html.match(/47/g) ?? []).length).toBe(1);
    expect(html).toContain('Age at Dismissal');
    expect(html).not.toContain('>Age<');
  });
});


describe('numberNarrativeParagraphs strips model self-numbering', () => {
  it('replaces the model\'s numbers with the consecutive sequence', () => {
    const html = '<p>1. The case.</p>\n<p>4.&nbsp;&nbsp;Skipped by the model.</p>\n<p>Unnumbered point.</p>';
    const out = numberNarrativeParagraphs(html);
    expect(out).toContain('<p>1.&nbsp;&nbsp;The case.</p>');
    expect(out).toContain('<p>2.&nbsp;&nbsp;Skipped by the model.</p>');
    expect(out).toContain('<p>3.&nbsp;&nbsp;Unnumbered point.</p>');
    // Never doubled.
    expect(out).not.toMatch(/\d+\.&nbsp;&nbsp;\s*\d+[.)]/);
  });

  it('does not eat a paragraph that legitimately starts with a year', () => {
    const out = numberNarrativeParagraphs('<p>2020 ONCA 391 changed the analysis.</p>');
    expect(out).toContain('2020 ONCA 391 changed the analysis');
  });
});
