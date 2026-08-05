/**
 * Unit Tests — litigation timetable dates.
 *
 * The value of collecting these rather than leaving [DATE] placeholders is
 * that they can be checked and docketed. So the checks are the feature:
 * ordering, dates in the past, unreadable dates, and the Rule 48.14 window.
 */

import { describe, it, expect } from 'vitest';
import {
  validateTimetable, timetableForPrompt, timetableTimelineEvents, TIMETABLE_STEPS,
} from '../../src/employment/timetable.js';

const TODAY = '2026-08-04';

const goodDates = {
  affidavits_of_documents: '2026-09-15',
  productions: '2026-10-01',
  examinations: '2026-11-14',
  mediation: '2027-01-20',
  set_down: '2027-03-01',
  pre_trial: '2027-05-10',
  trial: '2027-09-13',
};

describe('validation', () => {
  it('accepts a well-ordered timetable', () => {
    const result = validateTimetable(goodDates, { today: TODAY });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.dates.trial).toBe('2027-09-13');
  });

  it('reads dates as a lawyer might type them', () => {
    const result = validateTimetable(
      { mediation: 'January 20, 2027', set_down: '2027-3-1' }, { today: TODAY },
    );
    expect(result.ok).toBe(true);
    expect(result.dates.mediation).toBe('2027-01-20');
    expect(result.dates.set_down).toBe('2027-03-01');
  });

  it('catches steps that fall out of order', () => {
    const result = validateTimetable(
      { ...goodDates, mediation: '2026-09-01' },   // before productions
      { today: TODAY },
    );
    expect(result.ok).toBe(false);
    expect(result.issues.some(i => /Mediation completed.*falls before/i.test(i.message))).toBe(true);
  });

  it('ignores blank steps rather than treating them as breaks in order', () => {
    // Only two steps given, far apart: still valid.
    const result = validateTimetable(
      { affidavits_of_documents: '2026-09-15', trial: '2027-09-13' }, { today: TODAY },
    );
    expect(result.ok).toBe(true);
    expect(Object.keys(result.dates)).toHaveLength(2);
  });

  it('refuses a date in the past', () => {
    const result = validateTimetable({ mediation: '2026-01-01' }, { today: TODAY });
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toMatch(/in the past/i);
  });

  it('refuses a date it cannot read unambiguously', () => {
    const result = validateTimetable({ mediation: '03/04/2027' }, { today: TODAY });
    expect(result.ok).toBe(false);
    expect(result.issues[0].message).toMatch(/two ways/i);
  });

  it('cautions when setting down misses the Rule 48.14 deadline', () => {
    const result = validateTimetable(
      { set_down: '2027-03-01' },
      { today: TODAY, claimIssuedDate: '2021-06-01' },   // five years = 2026-06-01
    );
    // A caution, not an error: the motion can still be brought, asking for
    // the extension. It must not silently block the lawyer.
    expect(result.ok).toBe(true);
    const caution = result.issues.find(i => i.severity === 'caution');
    expect(caution?.message).toMatch(/48\.14/);
    expect(caution?.message).toMatch(/extension/i);
  });

  it('stays quiet on Rule 48.14 when setting down is within the window', () => {
    const result = validateTimetable(
      { set_down: '2027-03-01' }, { today: TODAY, claimIssuedDate: '2025-06-01' },
    );
    expect(result.issues).toEqual([]);
  });
});

describe('rendering for the generator', () => {
  it('gives the generator the dates in the form a court document uses', () => {
    const { dates } = validateTimetable(goodDates, { today: TODAY });
    const prompt = timetableForPrompt(dates);
    expect(prompt).toContain('January 20, 2027');
    expect(prompt).toContain('September 13, 2027');
    expect(prompt).toContain('reproduce EXACTLY');
  });

  it('lists only the steps the lawyer dated', () => {
    const { dates } = validateTimetable({ mediation: '2027-01-20' }, { today: TODAY });
    const prompt = timetableForPrompt(dates);
    expect(prompt).toContain('January 20, 2027');
    expect(prompt).not.toContain('Trial:');
  });
});

describe('docketing', () => {
  it('puts every supplied date on the docket', () => {
    const { dates } = validateTimetable(goodDates, { today: TODAY });
    const events = timetableTimelineEvents(dates);
    // Only the steps the lawyer actually dated are docketed.
    expect(events).toHaveLength(Object.keys(goodDates).length);
    expect(events.map(e => e.date)).toEqual([...events.map(e => e.date)].sort());
  });

  it('marks proposed dates as proposed, and NOT as court deadlines', () => {
    const { dates } = validateTimetable({ mediation: '2027-01-20' }, { today: TODAY });
    const [event] = timetableTimelineEvents(dates);
    expect(event.label).toMatch(/^Proposed: /);
    // A red court chip must mean a date a judge imposed, not one we suggested.
    expect(event.courtDeadline).toBe(false);
    expect(event.description).toMatch(/Confirm when the order is made/i);
  });

  it('marks ordered dates as real court deadlines', () => {
    const { dates } = validateTimetable({ mediation: '2027-01-20' }, { today: TODAY });
    const [event] = timetableTimelineEvents(dates, { proposed: false });
    expect(event.label).not.toMatch(/Proposed/);
    expect(event.courtDeadline).toBe(true);
  });
});
