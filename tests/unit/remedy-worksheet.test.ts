/**
 * Unit Tests — Remedy Worksheet (src/labour/remedy-worksheet.ts)
 *
 * Deterministic make-whole arithmetic: every figure must be reproducible
 * from the intake, and missing inputs must fail loudly rather than
 * produce a wrong number.
 */

import { describe, it, expect } from 'vitest';
import { buildRemedyWorksheet, weeklyWage } from '../../src/labour/remedy-worksheet.js';
import type { GrievanceIntakeData } from '../../src/types/labour-intake.js';

describe('weeklyWage', () => {
  it('derives the weekly wage from hourly, weekly, and annual rates', () => {
    expect(weeklyWage({ wage_rate: 30, wage_rate_period: 'hour', hours_per_week: 37.5 } as GrievanceIntakeData)).toBe(1125);
    expect(weeklyWage({ wage_rate: 30, wage_rate_period: 'hour' } as GrievanceIntakeData)).toBe(1200); // 40h default
    expect(weeklyWage({ wage_rate: 1500, wage_rate_period: 'week' } as GrievanceIntakeData)).toBe(1500);
    expect(weeklyWage({ wage_rate: 104000, wage_rate_period: 'year' } as GrievanceIntakeData)).toBe(2000);
    expect(weeklyWage({} as GrievanceIntakeData)).toBeNull();
  });
});

describe('buildRemedyWorksheet', () => {
  const base = {
    grievor_first_name: 'Claude', grievor_last_name: 'Boisvert',
    discipline_letter_date: '2026-05-01',
    wage_rate: 1000, wage_rate_period: 'week',
  } as GrievanceIntakeData;
  const asOf = new Date('2026-07-10T00:00:00'); // 70 days = 10 weeks

  it('computes back pay, percentages, and the mitigation set-off', () => {
    const result = buildRemedyWorksheet({
      ...base,
      vacation_pay_percent: 4,
      benefits_load_percent: 10,
      pension_contrib_percent: 6,
      interim_earnings: 2000,
    } as GrievanceIntakeData, asOf);

    expect(result.html).toContain('$10,000.00');  // gross: 1000 × 10 weeks
    expect(result.html).toContain('$400.00');     // vacation 4%
    expect(result.html).toContain('$1,000.00');   // benefits 10%
    expect(result.html).toContain('$600.00');     // pension 6%
    expect(result.html).toContain('$12,000.00');  // subtotal
    expect(result.html).toContain('($2,000.00)'); // interim earnings
    expect(result.html).toContain('$10,000.00');  // net
    expect(result.html).toContain('Boisvert');
    expect(result.documentTitle).toBe('Remedy Worksheet');
    expect(result.reviewerFlags.length).toBeGreaterThan(0);
  });

  it('flags missing benefits and vacation inputs for the reviewer', () => {
    const result = buildRemedyWorksheet(base, asOf);
    expect(result.reviewerFlags.join(' ')).toContain('vacation');
    expect(result.reviewerFlags.join(' ')).toContain('benefits');
  });

  it('refuses to compute without a wage rate or a loss start date', () => {
    expect(() => buildRemedyWorksheet({ discipline_letter_date: '2026-05-01' } as GrievanceIntakeData, asOf))
      .toThrow(/wage rate/i);
    expect(() => buildRemedyWorksheet({ wage_rate: 1000, wage_rate_period: 'week' } as GrievanceIntakeData, asOf))
      .toThrow(/date/i);
  });

  it('never produces a negative net claim', () => {
    const result = buildRemedyWorksheet({
      ...base,
      interim_earnings: 999999,
    } as GrievanceIntakeData, asOf);
    expect(result.html).toContain('$0.00');
  });
});
