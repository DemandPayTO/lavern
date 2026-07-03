/**
 * Unit Tests — Deadline Docket aggregation (src/employment/deadlines.ts)
 */

import { describe, it, expect } from 'vitest';
import { collectDeadlines } from '../../src/employment/deadlines.js';

function iso(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
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
