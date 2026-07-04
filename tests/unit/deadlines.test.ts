/**
 * Unit Tests — Deadline Docket aggregation (src/employment/deadlines.ts)
 */

import { describe, it, expect } from 'vitest';
import { collectDeadlines } from '../../src/employment/deadlines.js';

function iso(daysFromNow: number): string {
  // Local-date ISO string: toISOString() is UTC and drifts a day ahead of
  // the docket's local-midnight arithmetic during the evening (UTC-5/4).
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

function matterRow(id: string, employment: Record<string, unknown>): { id: string; data_json: string } {
  return { id, data_json: JSON.stringify({ employmentData: employment }) };
}

const baseIntake = {
  client_first_name: 'Priya', client_last_name: 'Sharma',
  employer_legal_name: 'Northline Logistics Inc',
};

describe('collectDeadlines', () => {
  it('collects limitation, severance, and demand-response deadlines with urgency', () => {
    const rows = [matterRow('m1', {
      intake: { ...baseIntake, received_severance_offer: true, severance_deadline: iso(10) },
      analysis: { limitationDeadline: { date: iso(40) } },
      timeline: [
        { date: iso(7), label: 'Demand letter response due', category: 'legal', source: 'system' },
        { date: iso(-100), label: 'Terminated', category: 'termination', source: 'intake_form' },
      ],
    })];

    const items = collectDeadlines(rows);
    expect(items.map(i => i.kind).sort()).toEqual(['demand_response', 'limitation', 'severance_offer']);

    const demand = items.find(i => i.kind === 'demand_response')!;
    expect(demand.urgency).toBe('critical');   // 7 days
    expect(items.find(i => i.kind === 'severance_offer')!.urgency).toBe('critical'); // 10 days
    expect(items.find(i => i.kind === 'limitation')!.urgency).toBe('soon');          // 40 days
    expect(demand.matterLabel).toBe('Priya Sharma v Northline Logistics Inc');
    // Sorted ascending by date
    expect(items[0].kind).toBe('demand_response');
  });

  it('marks past deadlines overdue but drops ancient ones', () => {
    const rows = [matterRow('m2', {
      intake: baseIntake,
      analysis: { limitationDeadline: { date: iso(-5) } },
      timeline: [],
    }), matterRow('m3', {
      intake: baseIntake,
      analysis: { limitationDeadline: { date: iso(-90) } },
      timeline: [],
    })];

    const items = collectDeadlines(rows);
    expect(items).toHaveLength(1);
    expect(items[0].urgency).toBe('overdue');
  });

  it('ignores far-future deadlines beyond the horizon', () => {
    const rows = [matterRow('m4', {
      intake: baseIntake,
      analysis: { limitationDeadline: { date: iso(400) } },
      timeline: [],
    })];
    expect(collectDeadlines(rows)).toHaveLength(0);
  });

  it('skips corrupt rows and matters without employment data', () => {
    const rows = [
      { id: 'bad', data_json: 'not json{{' },
      { id: 'empty', data_json: '{}' },
      matterRow('ok', { intake: baseIntake, analysis: { limitationDeadline: { date: iso(30) } }, timeline: [] }),
    ];
    const items = collectDeadlines(rows);
    expect(items).toHaveLength(1);
    expect(items[0].matterId).toBe('ok');
  });

  it('includes grievance CA clocks from labour matters alongside employment deadlines', () => {
    const labourRow = {
      id: 'g1',
      data_json: JSON.stringify({
        labourData: {
          intake: {
            grievor_first_name: 'Rosa', grievor_last_name: 'Delgado',
            grievance_number: '2026-014',
            employer_name: 'Lakeview Care Homes',
            incident_date: iso(-5),
            filing_deadline_days: 15, filing_deadline_kind: 'calendar',
            grievance_filed: false,
          },
        },
      }),
    };
    const employmentRow = matterRow('m6', {
      intake: baseIntake,
      analysis: { limitationDeadline: { date: iso(30) } },
      timeline: [],
    });

    const items = collectDeadlines([labourRow, employmentRow]);
    expect(items.map(i => i.kind).sort()).toEqual(['grievance_filing', 'limitation']);

    const filing = items.find(i => i.kind === 'grievance_filing')!;
    expect(filing.daysRemaining).toBe(10);
    expect(filing.urgency).toBe('critical');
    expect(filing.matterLabel).toBe('Rosa Delgado (#2026-014) v Lakeview Care Homes');
  });

  it('drops the grievance filing clock once the grievance is filed, keeps the referral clock', () => {
    const row = {
      id: 'g2',
      data_json: JSON.stringify({
        labourData: {
          intake: {
            grievor_first_name: 'Sam', grievor_last_name: 'Odogwu',
            employer_name: 'Metro Transit',
            incident_date: iso(-40),
            filing_deadline_days: 10, filing_deadline_kind: 'calendar',
            grievance_filed: true,
            last_step_response_date: iso(-10),
            referral_deadline_days: 30, referral_deadline_kind: 'calendar',
          },
        },
      }),
    };
    const items = collectDeadlines([row]);
    expect(items).toHaveLength(1);
    expect(items[0].kind).toBe('grievance_referral');
    expect(items[0].daysRemaining).toBe(20);
  });

  it('does not duplicate the limitation date from the timeline event', () => {
    const rows = [matterRow('m5', {
      intake: baseIntake,
      analysis: { limitationDeadline: { date: iso(60) } },
      timeline: [
        { date: iso(60), label: 'Limitation period expires', category: 'legal', source: 'system' },
      ],
    })];
    const items = collectDeadlines(rows);
    expect(items.filter(i => /limitation/i.test(i.label))).toHaveLength(1);
  });
});
