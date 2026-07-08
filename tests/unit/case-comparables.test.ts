/**
 * Unit Tests — case comparables matching math (src/employment/case-comparables.ts)
 *
 * The distance function must rank closer Bardal profiles first; the range
 * must be the interquartile band of the nearest outcomes and refuse to
 * pronounce on thin data.
 */

import { describe, it, expect } from 'vitest';
import { bardalDistance, rangeFromComparables, caselawConfigured } from '../../src/employment/case-comparables.js';

describe('bardalDistance', () => {
  const profile = { years: 14, age: 52, seniority: null };

  it('identical tenure and age beats distant ones', () => {
    const close = bardalDistance(profile, { years: 14, age: 52, seniority: null });
    const far = bardalDistance(profile, { years: 2, age: 30, seniority: null });
    expect(close).toBeLessThan(far);
  });

  it('tenure dominates age', () => {
    const tenureOff = bardalDistance(profile, { years: 4, age: 52, seniority: null });   // 10 years off
    const ageOff = bardalDistance(profile, { years: 14, age: 32, seniority: null });     // 20 years age off
    expect(ageOff).toBeLessThan(tenureOff);
  });

  it('unknown age carries a mild penalty, not a cliff', () => {
    const known = bardalDistance(profile, { years: 14, age: 52, seniority: null });
    const unknown = bardalDistance(profile, { years: 14, age: null, seniority: null });
    expect(unknown).toBeGreaterThan(known);
    expect(unknown - known).toBeLessThanOrEqual(2);
  });

  it('seniority mismatch adds a band penalty', () => {
    const p = { years: 10, age: 45, seniority: 'manager' };
    const match = bardalDistance(p, { years: 10, age: 45, seniority: 'manager' });
    const mismatch = bardalDistance(p, { years: 10, age: 45, seniority: 'labour' });
    expect(mismatch - match).toBeCloseTo(2.0, 5);
  });
});

describe('rangeFromComparables', () => {
  it('returns the interquartile band with the median', () => {
    const r = rangeFromComparables([6, 8, 10, 12, 14, 16, 18, 20, 22])!;
    expect(r.lowMonths).toBe(10);
    expect(r.midMonths).toBe(14);
    expect(r.highMonths).toBe(18);
    expect(r.basedOnCases).toBe(9);
  });

  it('refuses thin data (< 5 outcomes)', () => {
    expect(rangeFromComparables([12, 14, 16, 18])).toBeNull();
  });

  it('ignores non-finite entries', () => {
    expect(rangeFromComparables([12, NaN, 14, NaN, 16])).toBeNull(); // 3 finite → thin
  });

  it('excludes zero-month outcomes from range fuel', () => {
    const r = rangeFromComparables([0, 0, 10, 12, 14, 16, 18])!;
    expect(r.basedOnCases).toBe(5);
    expect(r.lowMonths).toBeGreaterThan(0);
  });
});

describe('caselawConfigured', () => {
  it('is false without the env pair', () => {
    const saved = { u: process.env.DEMANDPAY_CASELAW_URL, k: process.env.DEMANDPAY_CASELAW_KEY };
    delete process.env.DEMANDPAY_CASELAW_URL;
    delete process.env.DEMANDPAY_CASELAW_KEY;
    try {
      expect(caselawConfigured()).toBe(false);
    } finally {
      if (saved.u) process.env.DEMANDPAY_CASELAW_URL = saved.u;
      if (saved.k) process.env.DEMANDPAY_CASELAW_KEY = saved.k;
    }
  });
});
