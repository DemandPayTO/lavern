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
