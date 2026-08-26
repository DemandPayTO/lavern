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
  validateCustomTimetable, customTimetableForPrompt, customTimetableEvents,
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
    expect(prompt).toContain('Reproduce EXACTLY');
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


describe("the lawyer's own steps", () => {
  // The pilot's real timetable: their wording, and mediation BEFORE
  // discovery, which the fixed step order would have rejected.
  const REAL = [
    { label: 'Defendants to deliver Affidavit of Documents', date: '2026-08-31' },
    { label: 'Mediation to be completed', date: '2026-10-16' },
    { label: 'Examination for Discovery to be completed', date: '2026-11-16' },
    { label: 'Undertakings, Under Advisements, and Refusals to be completed', date: '2027-01-18' },
    { label: 'Parties to advise whether they intend on bringing any Refusals motions', date: '2027-02-05' },
    { label: 'Parties to have scheduled any Refusals motions necessary', date: '2027-02-26' },
    { label: 'Serve Notice of Readiness for Pre-Trial Conference', date: '2027-03-31' },
  ];

  it('accepts the firm’s own wording and order, mediation before discovery included', () => {
    const result = validateCustomTimetable(REAL, { today: TODAY });
    expect(result.ok).toBe(true);
    expect(result.issues).toEqual([]);
    expect(result.rows).toHaveLength(7);
    expect(result.rows[1].label).toBe('Mediation to be completed');
  });

  it('reproduces the steps verbatim, in order, in long-form dates', () => {
    const { rows } = validateCustomTimetable(REAL, { today: TODAY });
    const prompt = customTimetableForPrompt(rows);
    expect(prompt).toContain('Defendants to deliver Affidavit of Documents: August 31, 2026');
    expect(prompt).toContain('Serve Notice of Readiness for Pre-Trial Conference: March 31, 2027');
    expect(prompt).toContain('reword a step');
  });

  it('catches a date that contradicts its own position in the list', () => {
    const out = validateCustomTimetable(
      [REAL[0], { label: 'Mediation to be completed', date: '2026-08-15' }],
      { today: TODAY },
    );
    expect(out.ok).toBe(false);
    expect(out.issues[0].message).toMatch(/falls earlier/);
  });

  it('still refuses past dates, ambiguous dates, and nameless rows', () => {
    expect(validateCustomTimetable([{ label: 'Mediation', date: '2020-01-01' }], { today: TODAY }).ok).toBe(false);
    expect(validateCustomTimetable([{ label: 'Mediation', date: '03/04/2027' }], { today: TODAY }).issues[0].message).toMatch(/two ways/);
    expect(validateCustomTimetable([{ label: '', date: '2027-01-01' }], { today: TODAY }).ok).toBe(false);
  });

  it('applies Rule 48.14 to whichever row is the setting down', () => {
    const out = validateCustomTimetable(
      [{ label: 'Action to be set down for trial', date: '2027-03-01' }],
      { today: TODAY, claimIssuedDate: '2021-06-01' },
    );
    expect(out.ok).toBe(true);
    expect(out.issues[0].severity).toBe('caution');
    expect(out.issues[0].message).toMatch(/48\.14/);
  });

  it('dockets the lawyer’s steps as proposals, not court deadlines', () => {
    const { rows } = validateCustomTimetable(REAL, { today: TODAY });
    const events = customTimetableEvents(rows);
    expect(events).toHaveLength(7);
    expect(events[0].label).toBe('Proposed: Defendants to deliver Affidavit of Documents');
    expect(events[0].courtDeadline).toBe(false);
  });
});


describe('affidavit furniture', () => {
  it('keeps the preamble out of the numbering and states the knowledge basis', async () => {
    const { buildAffidavitOpening } = await import('../../src/employment/affidavit-furniture.js');
    const opening = buildAffidavitOpening({
      deponentName: 'Jordan Haworth', deponentCity: 'Toronto', capacity: 'lawyer',
      knowledgeBasis: 'information_and_belief', informationSource: 'my firm file', sworn: 'sworn',
    });
    expect(opening.preamble).toContain('MAKE OATH AND SAY');
    expect(opening.numbered).toContain('my firm file');
    expect(opening.numbered).toContain('identified that source');

    const personal = buildAffidavitOpening({
      deponentName: 'A', capacity: 'plaintiff', knowledgeBasis: 'personal', sworn: 'affirmed',
    });
    expect(personal.preamble).toContain('AFFIRM AND SAY');
    expect(personal.numbered).toContain('personal knowledge');
    expect(personal.numbered).not.toContain('information');

    const noSource = buildAffidavitOpening({
      deponentName: 'A', capacity: 'lawyer', knowledgeBasis: 'information_and_belief', sworn: 'sworn',
    });
    expect(noSource.numbered).toContain('[LAWYER: name the source');
  });

  it('builds the jurat and exhibit blocks in fixed form', async () => {
    const { buildJurat, buildExhibitBlock, exhibitLetter } = await import('../../src/employment/affidavit-furniture.js');
    expect(buildJurat({ sworn: 'sworn', deponentName: 'Jordan Haworth' })).toContain('SWORN BEFORE ME');
    expect(buildJurat({ sworn: 'affirmed', deponentName: 'A' })).toContain('AFFIRMED BEFORE ME');
    const { index, stamps } = buildExhibitBlock(
      [{ description: 'Letter to counsel' }, { description: 'Reply from counsel' }], 'Jordan Haworth', 'sworn',
    );
    expect(index).toContain('Exhibit "A"');
    expect(index).toContain('Exhibit "B"');
    expect(stamps).toContain('This is Exhibit "A" referred to in the affidavit of Jordan Haworth');
    expect(exhibitLetter(0)).toBe('A');
    expect(exhibitLetter(25)).toBe('Z');
    expect(exhibitLetter(26)).toBe('AA');
  });

  it('scrubs a capacity paragraph the model wrote itself, but keeps later ones', async () => {
    const { scrubAffidavitBody } = await import('../../src/employment/affidavit-furniture.js');
    const body = [
      '<p>I am the solicitor for the plaintiff, and I have carriage of this action.</p>',
      '<p>This action is proceeding in Toronto.</p>',
      '<p>I am the lawyer who attended the mediation on October 16.</p>',
    ].join('');
    const out = scrubAffidavitBody(body);
    expect(out).not.toContain('carriage of this action');
    expect(out).toContain('proceeding in Toronto');
    expect(out).toContain('attended the mediation');
  });
});
