/**
 * Unit Tests — Matter Debrief (src/employment/debrief.ts + deadlines wiring)
 *
 * The load-bearing properties: the analysis schema never lets an invented or
 * malformed date through, stored items are normalized correctly, and open
 * dated action items flow into the docket (and therefore the ICS feed).
 */

import { describe, it, expect } from 'vitest';
import {
  debriefAnalysisSchema,
  toStoredActionItems,
  openDatedActionItems,
} from '../../src/employment/debrief.js';
import { collectDeadlines } from '../../src/employment/deadlines.js';
import { buildDocketIcs } from '../../src/employment/docket-ics.js';

describe('debriefAnalysisSchema', () => {
  it('accepts a well-formed analysis and applies defaults', () => {
    const parsed = debriefAnalysisSchema.parse({
      summary: 'Client wants to counter the offer and needs a reference letter.',
      actionItems: [
        { task: 'Draft counter-offer', dueDate: '2026-07-20', kind: 'document', context: 'Employer offered 12 weeks' },
        { task: 'Email client the mitigation log', kind: 'email', emailSubject: 'Your job search log', emailBody: 'Hi [LAWYER: name]...' },
      ],
    });
    expect(parsed.actionItems[0].owner).toBe('lawyer'); // default
    expect(parsed.actionItems[1].dueDate).toBeNull(); // default
    expect(parsed.actionItems[1].kind).toBe('email');
  });

  it('rejects a malformed date (guards against invented dates)', () => {
    const r = debriefAnalysisSchema.safeParse({
      summary: 'x',
      actionItems: [{ task: 'do a thing', dueDate: 'next Friday' }],
    });
    expect(r.success).toBe(false);
  });

  it('accepts null dueDate (notes with no date)', () => {
    const parsed = debriefAnalysisSchema.parse({
      summary: 'General catch-up, nothing scheduled.',
      actionItems: [{ task: 'Follow up eventually', dueDate: null }],
    });
    expect(parsed.actionItems[0].dueDate).toBeNull();
  });
});

describe('toStoredActionItems', () => {
  it('assigns ids, defaults status to open, and keeps email fields only on email items', () => {
    const stored = toStoredActionItems([
      { task: 'Call client', owner: 'lawyer', dueDate: null, kind: 'call', context: '', emailSubject: 'x', emailBody: 'y' },
      { task: 'Email opposing counsel', owner: 'lawyer', dueDate: '2026-08-01', kind: 'email', context: '', emailSubject: 'Re: settlement', emailBody: 'Dear counsel' },
    ]);
    expect(stored[0].id).toBeTruthy();
    expect(stored[0].status).toBe('open');
    expect(stored[0].emailSubject).toBeUndefined(); // dropped on non-email
    expect(stored[1].emailSubject).toBe('Re: settlement');
    expect(stored[0].id).not.toBe(stored[1].id);
  });
});

describe('openDatedActionItems', () => {
  it('returns only open, dated items', () => {
    const out = openDatedActionItems([
      {
        id: 'd1', createdAt: '2026-07-15T00:00:00Z', callType: 'client', summary: '',
        actionItems: [
          { id: 'a', task: 'dated open', owner: 'lawyer', dueDate: '2026-08-01', kind: 'task', context: '', status: 'open' },
          { id: 'b', task: 'dated done', owner: 'lawyer', dueDate: '2026-08-02', kind: 'task', context: '', status: 'done' },
          { id: 'c', task: 'undated open', owner: 'lawyer', dueDate: null, kind: 'task', context: '', status: 'open' },
        ],
      },
    ]);
    expect(out).toHaveLength(1);
    expect(out[0].label).toContain('dated open');
  });
});

describe('debrief action items in the docket + ICS', () => {
  const future = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  const matterRow = {
    id: 'matter-1',
    data_json: JSON.stringify({
      employmentData: { intake: { client_first_name: 'Dana', client_last_name: 'Woo', employer_legal_name: 'Meridian Logistics Inc.' } },
      debriefs: [
        {
          id: 'd1', createdAt: '2026-07-15T00:00:00Z', callType: 'client', summary: '',
          actionItems: [
            { id: 'a', task: 'Send counter-offer', owner: 'lawyer', dueDate: future(10), kind: 'document', context: '', status: 'open' },
            { id: 'b', task: 'Already handled', owner: 'lawyer', dueDate: future(5), kind: 'task', context: '', status: 'done' },
          ],
        },
      ],
    }),
  };

  it('surfaces open dated action items on the docket, hides done ones', () => {
    const items = collectDeadlines([matterRow]);
    const actionItems = items.filter((i) => i.kind === 'action_item');
    expect(actionItems).toHaveLength(1);
    expect(actionItems[0].label).toBe('Action: Send counter-offer');
    expect(actionItems[0].matterLabel).toBe('Dana Woo v Meridian Logistics Inc.');
  });

  it('includes the action item in the ICS feed with a stable UID and label', () => {
    const items = collectDeadlines([matterRow]);
    const ics = buildDocketIcs(items, '2026-07-15T12:00:00Z');
    expect(ics).toContain('SUMMARY:Action item: Dana Woo v Meridian Logistics Inc.');
    expect(ics).toContain('matter-1-action_item-');
  });
});

describe('the ESA wage claims reach the call notes lane', () => {
  it('the prompt offers every ESA pleading field, under the quote rule', async () => {
    const { DEBRIEF_SYSTEM_PROMPT } = await import('../../src/employment/debrief.js');
    for (const field of [
      'vacation_unpaid', 'vacation_underpaid_rate', 'vacation_excluded_variable_comp',
      'holiday_pay_unpaid', 'unpaid_overtime', 'unpaid_commission',
      'unauthorized_deductions', 'expenses_unreimbursed',
      'esa_term_shortfall', 'esa_sev_shortfall',
    ]) {
      expect(DEBRIEF_SYSTEM_PROMPT, `${field} missing from the debrief prompt`).toContain(`${field} (boolean) [PLEADING]`);
    }
  });

  it('the prompt carries the paid-on-vacation-taken caution', async () => {
    const { DEBRIEF_SYSTEM_PROMPT } = await import('../../src/employment/debrief.js');
    expect(DEBRIEF_SYSTEM_PROMPT).toContain('only when vacation time is taken');
  });
});
