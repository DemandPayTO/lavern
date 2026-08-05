/**
 * Unit Tests — what the demand letter will be missing.
 *
 * The checks that matter are the ones that would embarrass a served
 * letter: arguing a clause nobody read, demanding a full notice period from
 * a client who started a new job in March, or ignoring a signed release.
 */

import { describe, it, expect } from 'vitest';
import { demandReadiness } from '../../src/employment/demand-readiness.js';

const intake = {
  client_first_name: 'Aisha', client_last_name: 'Osei',
  employer_legal_name: 'Brightpath Financial Group Inc',
  annual_salary: 110000,
  hire_date: '2019-09-03',
  termination_date: '2026-04-20',
} as never;

const analysis = {
  damagesEstimate: { commonLawHighAmount: 110000, commonLawLowMonths: 8, commonLawHighMonths: 12 },
  bardalFactors: { age: 47, tenureYears: 6.6 },
  limitationDeadline: { date: '2028-04-20', daysRemaining: 600, urgent: false },
} as never;

const base = {
  intake, analysis,
  approvedIssues: ['bad_faith_dismissal'],
  sourceKinds: [] as string[],
  styleProfilesCount: 1,
  firmContactComplete: true,
};

const labels = (items: ReturnType<typeof demandReadiness>) => items.map(i => i.label).join(' | ');
const warns = (items: ReturnType<typeof demandReadiness>) => items.filter(i => i.level === 'warn');

describe('demandReadiness', () => {
  it('says run the analysis first when there is nothing to check', () => {
    const items = demandReadiness({ ...base, intake: null, analysis: null });
    expect(items).toHaveLength(1);
    expect(items[0].level).toBe('warn');
    expect(items[0].goTo).toBe('issues');
  });

  it('is quiet on a complete file', () => {
    const items = demandReadiness({
      ...base,
      sourceKinds: ['employment_agreement', 'termination_letter'],
    });
    expect(warns(items)).toHaveLength(0);
  });

  it('warns when the letter would argue a clause it has never read', () => {
    const items = demandReadiness({ ...base, approvedIssues: ['waksdale_at_any_time'] });
    const hit = warns(items).find(i => i.label.includes('without the clause text'));
    expect(hit).toBeTruthy();
    expect(hit?.hint).toContain('exact words');
    expect(hit?.goTo).toBe('intake');
  });

  it('is satisfied once the clause text is on the file', () => {
    const items = demandReadiness({
      ...base,
      approvedIssues: ['waksdale_at_any_time'],
      intake: { ...intake, termination_clause_text: 'The Company may terminate at any time.' } as never,
    });
    expect(labels(items)).toContain('the letter can quote it');
    expect(warns(items)).toHaveLength(0);
  });

  it('does not ask for clause text when no clause argument is approved', () => {
    const items = demandReadiness({ ...base, approvedIssues: ['human_rights_overlay'] });
    expect(labels(items)).not.toContain('clause');
  });

  it('warns that a re-employed client needs mitigation entered', () => {
    const items = demandReadiness({
      ...base,
      intake: { ...intake, new_employment_found: true, new_employment_start_date: '2026-06-01' } as never,
    });
    const hit = warns(items).find(i => i.label.includes('re-employed'));
    expect(hit?.label).toContain('2026-06-01');
    expect(hit?.hint).toContain('nets them off');
  });

  it('points out a severance offer so what was paid gets netted', () => {
    const items = demandReadiness({
      ...base,
      intake: { ...intake, received_severance_offer: true, severance_weeks_offered: 8 } as never,
    });
    expect(labels(items)).toContain('8 weeks offered');
  });

  it('warns about a signed release, which changes what letter this is', () => {
    const items = demandReadiness({ ...base, intake: { ...intake, signed_release: true } as never });
    expect(warns(items).some(i => i.label.includes('signed a release'))).toBe(true);
  });

  it('warns when the limitation period is close, since a letter does not stop the clock', () => {
    const items = demandReadiness({
      ...base,
      analysis: { ...analysis, limitationDeadline: { date: '2026-09-01', daysRemaining: 27, urgent: true } } as never,
    });
    const hit = warns(items).find(i => i.label.includes('Limitation period'));
    expect(hit?.label).toContain('27 days');
    expect(hit?.hint).toContain('does not stop the clock');
  });

  it('reports the attached sources, and asks for the ones missing', () => {
    const attached = demandReadiness({ ...base, sourceKinds: ['employment_agreement', 'termination_letter'] });
    expect(labels(attached)).toContain('Employment agreement attached');
    expect(labels(attached)).toContain('Termination letter attached');

    const bare = demandReadiness(base);
    expect(bare.filter(i => i.level === 'info').some(i => i.label.includes('No employment agreement'))).toBe(true);
    expect(bare.filter(i => i.level === 'info').some(i => i.label.includes('No termination letter'))).toBe(true);
  });

  it('asks for the ROE only when the intake says it is wrong', () => {
    expect(labels(demandReadiness(base))).not.toContain('ROE');
    const items = demandReadiness({ ...base, intake: { ...intake, roe_wrong_or_missing: true } as never });
    expect(labels(items)).toContain('ROE');
    // And stays quiet once it is attached.
    const withRoe = demandReadiness({
      ...base,
      intake: { ...intake, roe_wrong_or_missing: true } as never,
      sourceKinds: ['roe'],
    });
    expect(labels(withRoe)).not.toContain('no ROE is attached');
  });

  it('warns about an incomplete signature block on a letter about to be sent', () => {
    const items = demandReadiness({ ...base, firmContactComplete: false });
    const hit = warns(items).find(i => i.label.includes('Firm address'));
    expect(hit?.hint).toContain('My Page');
  });

  it('warns when there is nothing to demand on', () => {
    const items = demandReadiness({ ...base, approvedIssues: [] });
    expect(warns(items).some(i => i.label === 'No approved issues.')).toBe(true);
  });

  it('warns when the figures cannot be built', () => {
    const items = demandReadiness({ ...base, intake: { ...intake, annual_salary: undefined } as never });
    const hit = warns(items).find(i => i.label.includes('No compensation'));
    expect(hit?.hint).toContain('omitted entirely');
  });
});
