/**
 * Unit Tests — deadline triage classification (src/employment/deadlines.ts)
 *
 * Red (critical) is reserved for court-imposed and statutory deadlines within
 * a business week or overdue. Negotiation timing is never red. This truth
 * table is the contract for that rule (Jordan, 2026-07-17).
 */

import { describe, it, expect } from 'vitest';
import { isCourtDeadline, priorityBand, collectDeadlines } from '../../src/employment/deadlines.js';

describe('isCourtDeadline', () => {
  it('statute of limitations is a court deadline', () => {
    expect(isCourtDeadline('limitation', 'Limitation period expires')).toBe(true);
  });

  it('labour grievance clocks are court deadlines', () => {
    expect(isCourtDeadline('grievance_filing', 'Grievance filing deadline')).toBe(true);
    expect(isCourtDeadline('grievance_referral', 'Referral to arbitration')).toBe(true);
    expect(isCourtDeadline('grievance_step', 'Step 2 deadline')).toBe(true);
  });

  it('system litigation ticklers are matched by label', () => {
    expect(isCourtDeadline('timeline', 'Statement of Defence due')).toBe(true);
    expect(isCourtDeadline('timeline', 'Statement of Claim (Form 14D) due')).toBe(true);
    expect(isCourtDeadline('timeline', 'Mediation brief due')).toBe(true);
    expect(isCourtDeadline('timeline', 'Settlement conference')).toBe(true);
  });

  it('negotiation timing is NEVER a court deadline', () => {
    expect(isCourtDeadline('severance_offer', 'Severance offer acceptance deadline')).toBe(false);
    expect(isCourtDeadline('demand_response', 'Demand letter response due')).toBe(false);
    expect(isCourtDeadline('client_email', 'Client email due: mitigation reminder')).toBe(false);
    expect(isCourtDeadline('action_item', 'Action: send the counter-offer')).toBe(false);
  });

  it('a generic lawyer note is not court unless flagged', () => {
    expect(isCourtDeadline('timeline', 'Call the client back')).toBe(false);
    expect(isCourtDeadline('timeline', 'Call the client back', true)).toBe(true); // explicit flag wins
  });
});

describe('priorityBand', () => {
  it('court deadline overdue or within 5 days = critical (red)', () => {
    expect(priorityBand(true, -3)).toBe('critical');
    expect(priorityBand(true, 0)).toBe('critical');
    expect(priorityBand(true, 5)).toBe('critical');
  });

  it('court deadline 6-21 days = attention (amber)', () => {
    expect(priorityBand(true, 6)).toBe('attention');
    expect(priorityBand(true, 21)).toBe('attention');
  });

  it('court deadline beyond 21 days = planned (quiet)', () => {
    expect(priorityBand(true, 22)).toBe('planned');
    expect(priorityBand(true, 60)).toBe('planned');
  });

  it('non-court item is never critical — amber at most', () => {
    expect(priorityBand(false, -10)).toBe('attention'); // overdue offer expiry: amber, not red
    expect(priorityBand(false, 2)).toBe('attention');   // counter-offer due in 2 days: amber
    expect(priorityBand(false, 7)).toBe('attention');
    expect(priorityBand(false, 8)).toBe('planned');
    expect(priorityBand(false, 30)).toBe('planned');
  });
});

describe('collectDeadlines assigns bands end to end', () => {
  const future = (days: number) => {
    const d = new Date();
    d.setDate(d.getDate() + days);
    return d.toISOString().slice(0, 10);
  };

  it('a SOD tickler in 4 days is red; an offer expiry tomorrow is amber', () => {
    const row = {
      id: 'm1',
      data_json: JSON.stringify({
        employmentData: {
          intake: { client_first_name: 'D', client_last_name: 'W', employer_legal_name: 'E Inc', received_severance_offer: true, severance_deadline: future(1) },
          timeline: [{ date: future(4), label: 'Statement of Defence due', category: 'legal', source: 'system' }],
        },
      }),
    };
    const items = collectDeadlines([row]);
    const sod = items.find(i => i.label === 'Statement of Defence due');
    const offer = items.find(i => i.kind === 'severance_offer');
    expect(sod?.band).toBe('critical');
    expect(sod?.isCourt).toBe(true);
    expect(offer?.band).toBe('attention');
    expect(offer?.isCourt).toBe(false);
  });
});
