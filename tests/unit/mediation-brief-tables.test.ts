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
  numberNarrativeParagraphs, numberNarrativeAllowingLists, scrubNarrative, buildMediationCover, buildMediationSignOff,
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
    // Two flags now: the row list to complete by hand, and the sparse-
    // intake warning because fewer than three rows carry real values.
    expect(flags).toHaveLength(2);
    expect(flags[0]).toContain('Family Circumstances');
    expect(flags[0]).toContain('Professional Designations');
    expect(flags[1]).toContain('fewer than three');
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


describe('scrubNarrative removes echoed furniture', () => {
  const parties = { plaintiff: 'Aisha Osei', defendant: 'Brightpath Financial Group Inc' };

  it('drops sign-offs, party blocks, and titles wherever the model wrote them', () => {
    const html = [
      '<h2>WHY WE ARE HERE</h2>',
      '<p>The dismissal happened during a medical leave.</p>',
      '<p>ALL OF WHICH IS RESPECTFULLY SUBMITTED.</p>',   // mid-document echo
      '<h2>WHAT RESOLUTION LOOKS LIKE</h2>',
      '<p>BETWEEN:</p>', '<p>Aisha Osei</p>', '<p>Plaintiff</p>', '<p>- and -</p>',
      '<p>Brightpath Financial Group Inc</p>', '<p>Defendant</p>',
      '<h2>MEDIATION BRIEF OF THE PLAINTIFF</h2>',
      '<p>We value the claim at twelve months.</p>',
      '<p>ALL OF WHICH IS RESPECTFULLY SUBMITTED this day.</p>',
    ].join('\n');
    const out = scrubNarrative(html, parties);
    expect(out).not.toMatch(/RESPECTFULLY SUBMITTED/);
    expect(out).not.toMatch(/BETWEEN:/);
    expect(out).not.toMatch(/- and -/);
    expect(out).not.toMatch(/<p>Aisha Osei<\/p>/);
    expect(out).not.toMatch(/MEDIATION BRIEF/);
    // Substance survives, including sentences that merely mention a party.
    expect(out).toContain('during a medical leave');
    expect(out).toContain('twelve months');
    expect(out).toContain('WHY WE ARE HERE');
  });

  it('unwraps a bold lead-in pseudo-heading but leaves real emphasis alone', () => {
    const out = scrubNarrative('<p><strong>The employer knew.</strong> It had written notice for three weeks.</p>\n<p>The clause fails under <strong>Waksdale</strong> principles.</p>', parties);
    expect(out).toContain('<p>The employer knew. It had written notice for three weeks.</p>');
    expect(out).toContain('under <strong>Waksdale</strong> principles');
  });
});


describe('revamp pins: the brief tells the truth', () => {
  const analysis = {
    bardalFactors: { age: 47, tenureYears: 6 },
    damagesEstimate: { esaNoticeWeeks: 6, esaNoticePay: 1, esaSeverancePay: 1, commonLawLowMonths: 8, commonLawHighMonths: 12, commonLawLowAmount: 1, commonLawHighAmount: 2, additionalHeads: [], totalEstimateLow: 1, totalEstimateHigh: 2 },
    timeline: [], gates: [], limitationDeadline: { date: '', daysRemaining: 0, urgent: false }, recommendedProcedure: 'simplified',
  } as never;

  it('a row named Severance package never resolves to the age', () => {
    const intake = { client_first_name: 'A', client_last_name: 'O', annual_salary: 100000, hire_date: '2020-01-01', termination_date: '2026-01-01' } as never;
    const { html } = buildProfileTable(intake, analysis, ['Age', 'Severance package offered', 'Wage details']);
    expect(html).toContain('Severance package offered');
    // Neither non-age row carries the number 47.
    expect((html.match(/47/g) ?? []).length).toBe(1);
  });

  it('an unknown ledger party is flagged, never presented as the Plaintiff', () => {
    const { html } = buildNegotiationTable([
      { id: 'n1', date: '2026-06-01', party: 'employer' as never, kind: 'offer' as never, amountCad: 50000, recordedAt: '' },
      { id: 'n2', date: '2026-06-05', party: 'mediator' as never, kind: 'counter' as never, amountCad: 60000, recordedAt: '' },
    ]);
    expect(html).toContain('Employer');
    expect(html).toContain('[LAWYER: confirm party');
  });

  it('a date-less legacy entry sorts last instead of crashing, and notes render', () => {
    const { html } = buildNegotiationTable([
      { id: 'n2', date: undefined as never, party: 'client' as never, kind: 'demand' as never, amountCad: 90000, note: 'conditional on a reference letter', recordedAt: '' },
      { id: 'n1', date: '2026-06-01', party: 'employer' as never, kind: 'offer' as never, amountCad: 50000, recordedAt: '' },
    ]);
    expect(html.indexOf('2026-06-01')).toBeLessThan(html.indexOf('[LAWYER: date]'));
    expect(html).toContain('conditional on a reference letter');
  });

  it('the comparables table shows year and court, and the range sentence counts both', () => {
    const comps = [
      { id: 'c1', caseName: 'Osei v Acme', citation: '2024 ONSC 1', court: 'ONSC', year: 2024, summary: null, yearsOfService: 6, age: 47, seniorityLevel: 'manager', monthsAwarded: 12, distance: 0.1 },
    ] as never;
    const range = { lowMonths: 8, highMonths: 14, midMonths: 11, basedOnCases: 11 } as never;
    const { html } = buildComparablesTable(comps, range);
    expect(html).toContain('<th>Year</th>');
    expect(html).toContain('2024');
    expect(html).toContain('ONSC');
    expect(html).toContain('the closest 1 shown above');
    expect(html).toContain('11 nearest decided cases');
  });

  it('the cover states the mediation date in words, matching the sign-off register', () => {
    const cover = buildMediationCover({ intake: { client_first_name: 'A', client_last_name: 'O', employer_legal_name: 'E' } as never, lawyerName: 'J', firmName: 'F', mediationDate: '2026-09-14' });
    expect(cover).toContain('September 14, 2026');
    expect(cover).not.toContain('2026-09-14');
  });
});

describe('numberNarrativeAllowingLists', () => {
  const nums = (html: string) => [...html.matchAll(/<p[^>]*>(\d+)\.&nbsp;/g)].map(m => Number(m[1]));

  it('leaves a healthy paragraph narrative to the ordinary numbering', () => {
    const html = '<h2>Overview</h2><p>First.</p><p>Second.</p><p>Third.</p>';
    const out = numberNarrativeAllowingLists(html);
    expect(out.convertedFromList).toBe(false);
    expect(nums(out.html)).toEqual([1, 2, 3]);
  });

  it('keeps a genuine sub-list intact when paragraphs exist', () => {
    const html = '<p>The applicant seeks:</p><ol><li>Compensation.</li><li>Reinstatement.</li></ol><p>And costs.</p>';
    const out = numberNarrativeAllowingLists(html);
    expect(out.convertedFromList).toBe(false);
    expect(out.html).toContain('<ol>');
    expect(out.html).toContain('<li>Compensation.</li>');
    expect(nums(out.html)).toEqual([1, 2]);
  });

  it('numbers a narrative the model wrote as a list', () => {
    const html = '<h2>The Facts</h2><ol><li>She was hired in 1988.</li><li>She was dismissed in 2026.</li><li>The role continued.</li></ol>';
    const out = numberNarrativeAllowingLists(html);
    expect(out.convertedFromList).toBe(true);
    expect(nums(out.html)).toEqual([1, 2, 3]);
    expect(out.html).not.toContain('<li>');
  });

  it('runs the sequence unbroken across headings when converting', () => {
    const html = '<h2>A</h2><ol><li>One.</li><li>Two.</li></ol><h2>B</h2><ol><li>Three.</li><li>Four.</li></ol>';
    expect(nums(numberNarrativeAllowingLists(html).html)).toEqual([1, 2, 3, 4]);
  });

  it('loses no item from a nested list', () => {
    const html = '<ol><li>Outer one.<ol><li>Inner.</li></ol></li><li>Outer two.</li></ol>';
    const out = numberNarrativeAllowingLists(html);
    expect(out.html).toContain('Inner.');
    expect(out.html).toContain('Outer two.');
    expect(nums(out.html).length).toBeGreaterThanOrEqual(3);
  });

  it('strips the model\'s own list numbers rather than doubling them', () => {
    const html = '<ol><li>1. She was hired.</li><li>2. She was dismissed.</li></ol>';
    const out = numberNarrativeAllowingLists(html);
    expect(nums(out.html)).toEqual([1, 2]);
    expect(out.html).not.toContain('1. 1.');
  });

  it('reports nothing to convert on an empty narrative', () => {
    expect(numberNarrativeAllowingLists('<h2>Overview</h2>').convertedFromList).toBe(false);
  });
});
