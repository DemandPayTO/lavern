/**
 * Unit Tests — docket iCalendar export (src/employment/docket-ics.ts)
 */

import { describe, it, expect } from 'vitest';
import { buildDocketIcs } from '../../src/employment/docket-ics.js';
import type { DeadlineItem } from '../../src/employment/deadlines.js';

const items: DeadlineItem[] = [
  {
    matterId: 'm1', matterLabel: 'Kovacs v Stellar, Freight Inc',
    date: '2026-08-14', label: 'Limitation period expires',
    daysRemaining: 40, urgency: 'soon', kind: 'limitation',
  },
  {
    matterId: 'g1', matterLabel: 'Okonkwo v Durham Metal',
    date: '2026-07-13', label: 'Grievance filing deadline (10 working days)',
    daysRemaining: 8, urgency: 'critical', kind: 'grievance_filing',
  },
];

describe('buildDocketIcs', () => {
  it('produces a valid calendar with one all-day event per deadline', () => {
    const ics = buildDocketIcs(items, '2026-07-05T12:00:00.000Z');
    expect(ics.startsWith('BEGIN:VCALENDAR')).toBe(true);
    expect(ics.trim().endsWith('END:VCALENDAR')).toBe(true);
    expect((ics.match(/BEGIN:VEVENT/g) ?? [])).toHaveLength(2);
    expect(ics).toContain('DTSTART;VALUE=DATE:20260814');
    expect(ics).toContain('DTEND;VALUE=DATE:20260815'); // all-day: end is the next day
    expect(ics).toContain('DTSTAMP:20260705T120000Z');
  });

  it('uses stable UIDs so re-imports update rather than duplicate', () => {
    const a = buildDocketIcs(items, '2026-07-05T12:00:00.000Z');
    const b = buildDocketIcs(items, '2026-07-06T12:00:00.000Z');
    const uid = /UID:[^\r\n]+/g;
    expect(a.match(uid)).toEqual(b.match(uid));
    expect(a).toContain('UID:m1-limitation-2026-08-14@starling.demandpay.ca');
  });

  it('escapes commas in summaries per RFC 5545', () => {
    const ics = buildDocketIcs(items, '2026-07-05T12:00:00.000Z');
    expect(ics).toContain('Stellar\\, Freight Inc');
  });
});
