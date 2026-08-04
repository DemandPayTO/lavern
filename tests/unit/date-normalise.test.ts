/**
 * Unit Tests — reading dates as legal documents actually write them.
 *
 * The intake schema needs YYYY-MM-DD. Documents do not supply it. The rule
 * that matters most: an ambiguous numeric date is REFUSED, never guessed,
 * because reading 03/04/2017 the wrong way moves a limitation deadline by
 * a month.
 */

import { describe, it, expect } from 'vitest';
import { normaliseDate, DATE_FIELDS } from '../../src/employment/date-normalise.js';

describe('formats a document actually uses', () => {
  it('reads long-form dates', () => {
    expect(normaliseDate('March 2, 2017').value).toBe('2017-03-02');
    expect(normaliseDate('March 2nd, 2017').value).toBe('2017-03-02');
    expect(normaliseDate('Mar 2 2017').value).toBe('2017-03-02');
    expect(normaliseDate('2 March 2017').value).toBe('2017-03-02');
    expect(normaliseDate('2nd of March, 2017').value).toBe('2017-03-02');
    expect(normaliseDate('December 31, 2026').value).toBe('2026-12-31');
  });

  it('passes through what is already correct', () => {
    expect(normaliseDate('2017-03-02').value).toBe('2017-03-02');
  });

  it('strips a time component from an ISO timestamp', () => {
    expect(normaliseDate('2026-01-15T00:00:00Z').value).toBe('2026-01-15');
    expect(normaliseDate('2026-01-15 09:30').value).toBe('2026-01-15');
  });

  it('pads an unpadded date', () => {
    expect(normaliseDate('2017-3-2').value).toBe('2017-03-02');
    expect(normaliseDate('2017/3/2').value).toBe('2017-03-02');
  });
});

describe('refuses rather than guesses', () => {
  it('refuses an ambiguous day/month date', () => {
    // 3 April or 4 March? Both readings appear in real documents.
    const result = normaliseDate('03/04/2017');
    expect(result.value).toBeUndefined();
    expect(result.reason).toMatch(/two ways/i);
    expect(result.reason).toMatch(/Intake tab/);
  });

  it('resolves a numeric date only when one number cannot be a month', () => {
    expect(normaliseDate('25/03/2017').value).toBe('2017-03-25');
    expect(normaliseDate('03/25/2017').value).toBe('2017-03-25');
  });

  it('refuses a month with no day, which cannot drive a deadline', () => {
    const result = normaliseDate('March 2017');
    expect(result.value).toBeUndefined();
    expect(result.reason).toMatch(/no day/i);
  });

  it('refuses dates that do not exist', () => {
    expect(normaliseDate('February 30, 2017').value).toBeUndefined();
    expect(normaliseDate('2017-04-31').value).toBeUndefined();
    expect(normaliseDate('Smarch 2, 2017').value).toBeUndefined();
  });

  it('refuses gibberish with an actionable reason', () => {
    const result = normaliseDate('sometime last spring');
    expect(result.value).toBeUndefined();
    expect(result.reason).toMatch(/Intake tab/);
  });

  it('refuses an empty value', () => {
    expect(normaliseDate('').value).toBeUndefined();
  });
});

describe('field coverage', () => {
  it('covers the dates that drive deadlines', () => {
    for (const f of ['hire_date', 'termination_date', 'severance_deadline', 'last_day_worked']) {
      expect(DATE_FIELDS.has(f)).toBe(true);
    }
  });
});
