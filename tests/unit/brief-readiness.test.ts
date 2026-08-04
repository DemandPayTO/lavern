/**
 * Unit Tests — brief readiness checklist.
 *
 * Each check mirrors a decision the deterministic assemblers make at
 * generation time. The property under test: a hole that would surface in
 * the finished brief surfaces here first, as the right severity, pointing
 * at the right tab.
 */

import { describe, it, expect } from 'vitest';
import { briefReadiness } from '../../src/employment/brief-readiness.js';

const fullIntake = {
  client_first_name: 'Aisha', client_last_name: 'Osei',
  annual_salary: 110000, hire_date: '2019-09-03', termination_date: '2026-04-20',
} as never;
const fullAnalysis = {
  bardalFactors: { age: 47, tenureYears: 6.6 },
  damagesEstimate: {}, timeline: [], gates: [],
  limitationDeadline: { date: '', daysRemaining: 0, urgent: false }, recommendedProcedure: 'simplified',
} as never;

const base = {
  intake: fullIntake, analysis: fullAnalysis,
  approvedIssuesCount: 3, negotiationCount: 2, caselawConfigured: true,
  styleProfilesCount: 1, sourcesCount: 2, mediationDocketed: true,
};

describe('briefReadiness', () => {
  it('a fully-prepared matter reads all ok', () => {
    const items = briefReadiness(base);
    expect(items.every(i => i.level === 'ok')).toBe(true);
  });

  it('no analysis short-circuits to the one thing that matters', () => {
    const items = briefReadiness({ ...base, intake: null, analysis: null });
    expect(items).toHaveLength(1);
    expect(items[0].level).toBe('warn');
    expect(items[0].goTo).toBe('issues');
  });

  it('warns on the holes that render visibly in the brief', () => {
    const items = briefReadiness({
      ...base,
      approvedIssuesCount: 0,
      analysis: { ...fullAnalysis, bardalFactors: { age: null, tenureYears: 6.6 } } as never,
      intake: { ...fullIntake, annual_salary: undefined } as never,
    });
    const warns = items.filter(i => i.level === 'warn');
    expect(warns.map(w => w.goTo)).toEqual(expect.arrayContaining(['issues', 'intake']));
    expect(warns.some(w => w.label.includes('No approved issues'))).toBe(true);
    expect(warns.some(w => w.label.includes('age'))).toBe(true);
    expect(warns.some(w => w.label.includes('salary'))).toBe(true);
  });

  it('honest omissions are info, not warnings', () => {
    const items = briefReadiness({
      ...base, negotiationCount: 0, caselawConfigured: false,
      styleProfilesCount: 0, sourcesCount: 0, mediationDocketed: false,
    });
    const infos = items.filter(i => i.level === 'info');
    expect(infos.length).toBeGreaterThanOrEqual(5);
    expect(items.filter(i => i.level === 'warn')).toHaveLength(0);
  });
});
