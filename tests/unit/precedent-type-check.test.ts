/**
 * Unit Tests — does this precedent match the document being taught?
 *
 * The pilot's timetable materials are three documents in one folder: the
 * notice of motion, the consent order, the draft order. The check must
 * tell them apart, and must stay QUIET when it cannot classify something,
 * because a warning the lawyer learns to ignore is worse than none.
 */

import { describe, it, expect } from 'vitest';
import { checkPrecedentTypes } from '../../src/employment/precedent-type-check.js';

const MOTION = `ONTARIO SUPERIOR COURT OF JUSTICE
NOTICE OF MOTION
The Plaintiff will make a motion to the court on a date to be fixed.
THE MOTION IS FOR an order fixing a timetable for the remaining steps.
THE GROUNDS FOR THE MOTION ARE that the action proceeds under the simplified procedure.`;

const CONSENT = `ONTARIO SUPERIOR COURT OF JUSTICE
CONSENT ORDER (TIMETABLE)
THIS MOTION, made by the Plaintiff on consent of all parties, was read this day.
ON READING the consent of the parties filed,
1. THIS COURT ORDERS that the timetable set out in Schedule "A" is fixed.
THE PARTIES CONSENT TO THE TERMS OF THIS ORDER.`;

const ORDER = `ONTARIO SUPERIOR COURT OF JUSTICE
ORDER (TIMETABLE)
THIS MOTION, made by the Plaintiff, was heard this day at Toronto.
ON HEARING the submissions of counsel for the parties,
1. THIS COURT ORDERS that the timetable set out below is fixed.`;

const AFFIDAVIT = `ONTARIO SUPERIOR COURT OF JUSTICE
AFFIDAVIT
I, Jordan Haworth, of the City of Toronto, MAKE OATH AND SAY:
1. I am the lawyer with carriage of this action.`;

const named = (text: string, name: string) => [{ name, text }];

describe('checkPrecedentTypes', () => {
  it('passes precedents that match the document being taught', () => {
    expect(checkPrecedentTypes(named(MOTION, 'motion.docx'), 'sp_timetable_motion')).toEqual([]);
    expect(checkPrecedentTypes(named(CONSENT, 'consent.docx'), 'consent_timetable_order')).toEqual([]);
    expect(checkPrecedentTypes(named(ORDER, 'order.docx'), 'timetable_order')).toEqual([]);
    expect(checkPrecedentTypes(named(AFFIDAVIT, 'aff.docx'), 'motion_affidavit')).toEqual([]);
  });

  it('catches the mistake the pilot described: consent orders taught as the motion', () => {
    const issues = checkPrecedentTypes(named(CONSENT, 'consent-order-1.docx'), 'sp_timetable_motion');
    expect(issues).toHaveLength(1);
    expect(issues[0].message).toContain('consent-order-1.docx');
    expect(issues[0].message).toContain('a consent order');
    expect(issues[0].message).toContain('a notice of motion');
  });

  it('tells the consent order and the contested order apart, both ways', () => {
    // A consent order taught as the draft order.
    expect(checkPrecedentTypes(named(CONSENT, 'c.docx'), 'timetable_order')[0].message).toContain('a consent order');
    // The contested order taught as the consent order.
    expect(checkPrecedentTypes(named(ORDER, 'o.docx'), 'consent_timetable_order')[0].message).toContain('an order');
  });

  it('names every offending file, and only those', () => {
    const issues = checkPrecedentTypes([
      { name: 'good.docx', text: MOTION },
      { name: 'wrong-1.docx', text: CONSENT },
      { name: 'wrong-2.docx', text: AFFIDAVIT },
    ], 'sp_timetable_motion');
    expect(issues.map(i => i.name)).toEqual(['wrong-1.docx', 'wrong-2.docx']);
  });

  it('stays quiet on a document it cannot classify', () => {
    const vague = 'Schedule of dates for the remaining steps in this proceeding. Dates to be confirmed.';
    expect(checkPrecedentTypes(named(vague, 'unclear.docx'), 'sp_timetable_motion')).toEqual([]);
  });

  it('says nothing for document types it has no signature for', () => {
    expect(checkPrecedentTypes(named(CONSENT, 'c.docx'), 'discovery_plan')).toEqual([]);
  });
});
