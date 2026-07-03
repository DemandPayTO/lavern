/**
 * Unit Tests — CA extraction → grievance intake mapping (src/labour/ca-extraction.ts)
 */

import { describe, it, expect } from 'vitest';
import { applyCaExtraction } from '../../src/labour/ca-extraction.js';
import type { ExtractedField } from '../../src/labour/ca-extraction.js';
import type { GrievanceIntakeData } from '../../src/types/labour-intake.js';

function fields(map: Record<string, string | number | boolean | null>): Record<string, ExtractedField> {
  return Object.fromEntries(
    Object.entries(map).map(([k, value]) => [k, { value, confidence: 'high' as const }]),
  );
}

describe('applyCaExtraction', () => {
  it('fills blank CA fields and reports what was filled', () => {
    const { intake, filled } = applyCaExtraction({} as GrievanceIntakeData, fields({
      ca_title: '2024–2027 Collective Agreement',
      ca_expiry_date: '2027-03-31',
      union_name: 'USW Local 1998',
      employer_name: 'Cadence Manufacturing Ltd',
      grievance_procedure_article: 'Article 8',
      just_cause_article: 'Article 7.01',
      filing_deadline_days: 10,
      filing_deadline_kind: 'working',
      referral_deadline_days: 30,
      referral_deadline_kind: 'calendar',
      time_limits_mandatory: true,
      sunset_clause_months: 24,
    }));

    expect(intake.filing_deadline_days).toBe(10);
    expect(intake.filing_deadline_kind).toBe('working');
    expect(intake.referral_deadline_days).toBe(30);
    expect(intake.referral_deadline_kind).toBe('calendar');
    expect(intake.time_limits_mandatory).toBe(true);
    expect(intake.sunset_clause_months).toBe(24);
    expect(intake.grievance_procedure_article).toBe('Article 8');
    expect(filled).toContain('filing_deadline_days');
    expect(filled).toContain('time_limits_mandatory');
  });

  it('never overwrites reviewer-entered values', () => {
    const existing = {
      filing_deadline_days: 5,
      grievance_procedure_article: 'Article 12',
    } as GrievanceIntakeData;

    const { intake, filled } = applyCaExtraction(existing, fields({
      filing_deadline_days: 10,
      grievance_procedure_article: 'Article 8',
      referral_deadline_days: 30,
    }));

    expect(intake.filing_deadline_days).toBe(5);
    expect(intake.grievance_procedure_article).toBe('Article 12');
    expect(intake.referral_deadline_days).toBe(30);
    expect(filled).toEqual(['referral_deadline_days']);
  });

  it('rejects invalid values instead of corrupting the clocks', () => {
    const { intake, filled } = applyCaExtraction({} as GrievanceIntakeData, fields({
      filing_deadline_days: -3,
      referral_deadline_days: 'thirty',
      filing_deadline_kind: 'lunar',
      ca_expiry_date: 'March 31, 2027',
      time_limits_mandatory: 'yes',
      sunset_clause_months: 0,
    }));

    expect(filled).toEqual([]);
    expect(intake.filing_deadline_days).toBeUndefined();
    expect(intake.filing_deadline_kind).toBeUndefined();
    expect(intake.ca_expiry_date).toBeUndefined();
    expect(intake.time_limits_mandatory).toBeUndefined();
  });

  it('normalises day-kind wording ("business days" → working)', () => {
    const { intake } = applyCaExtraction({} as GrievanceIntakeData, fields({
      filing_deadline_days: 10,
      filing_deadline_kind: 'business days',
    }));
    expect(intake.filing_deadline_kind).toBe('working');
  });

  it('routes arbitration article and step summary into ca_notes without clobbering existing notes', () => {
    const first = applyCaExtraction({} as GrievanceIntakeData, fields({
      arbitration_article: 'Article 9',
      grievance_steps: 'Step 1: 10 working days; Step 2: 5 days; arbitration within 30 days',
    }));
    expect(first.intake.ca_notes).toContain('Arbitration article: Article 9');
    expect(first.intake.ca_notes).toContain('Step 1');
    expect(first.filled).toContain('ca_notes');

    const second = applyCaExtraction({ ca_notes: 'reviewer note' } as GrievanceIntakeData, fields({
      arbitration_article: 'Article 9',
    }));
    expect(second.intake.ca_notes).toBe('reviewer note');
    expect(second.filled).toEqual([]);
  });

  it('parses structured procedure steps from procedure_steps_json', () => {
    const { intake, filled } = applyCaExtraction({} as GrievanceIntakeData, fields({
      procedure_steps_json: JSON.stringify([
        { label: 'Step 1', employer_response_days: 5, advance_days: 5, day_kind: 'working' },
        { label: 'Step 2', employer_response_days: 10, advance_days: null, day_kind: 'calendar' },
        { label: '', employer_response_days: 3 },           // dropped: no label
        { label: 'Step X', employer_response_days: -4, advance_days: 'soon', day_kind: 'lunar' },
      ]),
    }));

    expect(filled).toContain('procedure_steps');
    expect(intake.procedure_steps).toHaveLength(3);
    expect(intake.procedure_steps![0]).toEqual({ label: 'Step 1', employer_response_days: 5, advance_days: 5, day_kind: 'working' });
    expect(intake.procedure_steps![2]).toEqual({ label: 'Step X', employer_response_days: null, advance_days: null, day_kind: null });
  });

  it('ignores malformed procedure_steps_json and existing steps', () => {
    const none = applyCaExtraction({} as GrievanceIntakeData, fields({ procedure_steps_json: 'not json' }));
    expect(none.filled).not.toContain('procedure_steps');

    const existing = { procedure_steps: [{ label: 'Step 1' }] } as GrievanceIntakeData;
    const kept = applyCaExtraction(existing, fields({
      procedure_steps_json: JSON.stringify([{ label: 'Step 9', employer_response_days: 5 }]),
    }));
    expect(kept.intake.procedure_steps![0].label).toBe('Step 1');
    expect(kept.filled).not.toContain('procedure_steps');
  });

  it('rounds fractional day counts', () => {
    const { intake } = applyCaExtraction({} as GrievanceIntakeData, fields({
      filing_deadline_days: 10.4,
    }));
    expect(intake.filing_deadline_days).toBe(10);
  });
});
