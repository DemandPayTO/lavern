/**
 * Unit Tests — extraction apply loop (Phase 1 slice 1) + the timeline
 * preservation fix it depends on, + quote grounding verification.
 *
 * See docs/specs/document-extraction-apply-2026-07.md.
 */

import { describe, it, expect } from 'vitest';
import {
  APPLYABLE_INTAKE_FIELDS, applyExtractionSelections, diffTimelines, resolveExtraction,
} from '../../src/employment/extraction-apply.js';
import { employmentIntakeSchema } from '../../src/types/employment-intake.js';
import type { DocumentExtractionResult, EmploymentIntakeData, TimelineEvent } from '../../src/types/employment-intake.js';
import { rebuildTimelinePreserving } from '../../src/employment/timeline-generator.js';
import { verifySourceQuotes, buildExtractionPrompt } from '../../src/api/briefing/employment-extractor.js';

function extraction(fields: DocumentExtractionResult['extractedFields']): DocumentExtractionResult {
  return {
    id: 'ext-1', documentType: 'termination_letter', filename: 'letter.pdf',
    extractedFields: fields, keyFindings: [], confirmed: false,
  };
}

const baseIntake = employmentIntakeSchema.parse({
  client_first_name: 'Ana',
  employer_legal_name: 'Beta Inc',
  annual_salary: 90000,
}) as EmploymentIntakeData;

describe('APPLYABLE_INTAKE_FIELDS whitelist', () => {
  it('every whitelisted field exists in the intake schema (drift guard)', () => {
    const shape = employmentIntakeSchema.shape as Record<string, unknown>;
    for (const key of APPLYABLE_INTAKE_FIELDS) {
      expect(shape[key], `whitelist key "${key}" missing from intake schema`).toBeDefined();
    }
  });
});

describe('offer-bearing document kinds ask for offers (drift guard)', () => {
  // The negotiation ledger fills from proposed offers. A demand letter's
  // own demand is the ledger's opening entry; the pilot uploaded one and
  // the ledger stayed empty because only other kinds asked for offers.
  it('the kinds that carry offers all instruct the reader to list them', () => {
    for (const kind of ['demand_letter', 'termination_letter', 'correspondence', 'other'] as const) {
      const prompt = buildExtractionPrompt(kind);
      expect(prompt, `${kind} prompt lacks the offers section`).toContain('OFFERS TO SETTLE');
    }
    expect(buildExtractionPrompt('demand_letter')).toContain('opening entry of the negotiation ledger');
  });
});

describe('every intake field tolerates null (drift guard)', () => {
  // The editor and the questionnaire send null to mean "cleared", and the
  // merge deletes the key. A field whose schema rejects null fails the
  // WHOLE save it rides in: the pilot lost an age to a blank email field
  // this way. No field may ever reject null again.
  it('a save of {field: null} parses for every field in the schema', () => {
    const shape = employmentIntakeSchema.shape as Record<string, unknown>;
    const offenders: string[] = [];
    for (const key of Object.keys(shape)) {
      const res = employmentIntakeSchema.safeParse({ [key]: null });
      if (!res.success) offenders.push(key);
    }
    expect(offenders, `null-intolerant fields: ${offenders.join(', ')}`).toEqual([]);
  });
});

describe('applyExtractionSelections', () => {
  it('fills blank fields, skips non-blank without overwrite, overwrites with opt-in', () => {
    const ext = extraction({
      termination_date: { value: '2026-05-15', confidence: 'high' },
      employer_legal_name: { value: 'Gamma Corp', confidence: 'high' },
      annual_salary: { value: 105000, confidence: 'medium' },
    });
    const out = applyExtractionSelections(
      baseIntake, ext,
      ['termination_date', 'employer_legal_name', 'annual_salary'],
      new Set(['annual_salary']),
    );
    if ('error' in out) throw new Error(out.error);
    expect(out.applied).toEqual(['termination_date']);            // blank → filled
    expect(out.skippedNotBlank).toEqual(['employer_legal_name']); // has value, no opt-in
    expect(out.overwritten).toEqual(['annual_salary']);           // explicit opt-in
    expect(out.intake.termination_date).toBe('2026-05-15');
    expect(out.intake.employer_legal_name).toBe('Beta Inc');      // untouched
    expect(out.intake.annual_salary).toBe(105000);
    expect(out.analysisStale).toBe(true);                         // salary + date feed the analysis
  });

  it('reports unmapped fields instead of silently dropping them', () => {
    const ext = extraction({
      probation_period: { value: '3 months', confidence: 'high' },
      termination_date: { value: '2026-05-15', confidence: 'high' },
    });
    const out = applyExtractionSelections(baseIntake, ext, ['probation_period', 'termination_date'], new Set());
    if ('error' in out) throw new Error(out.error);
    expect(out.unmapped).toEqual(['probation_period']);
    expect(out.applied).toEqual(['termination_date']);
  });

  it('rejects values the intake schema cannot store, naming the field', () => {
    const ext = extraction({
      termination_date: { value: 'sometime in May', confidence: 'low' }, // not YYYY-MM-DD
    });
    const out = applyExtractionSelections(baseIntake, ext, ['termination_date'], new Set());
    expect('error' in out).toBe(true);
    if ('error' in out) expect(out.invalidFields).toContain('termination_date');
  });

  it('null-valued extractions are never applied', () => {
    const ext = extraction({ termination_date: { value: null, confidence: 'low' } });
    const out = applyExtractionSelections(baseIntake, ext, ['termination_date'], new Set());
    if ('error' in out) throw new Error(out.error);
    expect(out.applied).toEqual([]);
  });

  it('the client age applies, whether the document gave a number or prose', () => {
    const ext = extraction({
      client_age: { value: '62 years of age', confidence: 'high' },
      client_date_of_birth: { value: 'March 2, 1964', confidence: 'high' },
      client_last_name: { value: 'Botsford', confidence: 'high' },
    });
    const out = applyExtractionSelections(baseIntake, ext, ['client_age', 'client_date_of_birth', 'client_last_name'], new Set());
    if ('error' in out) throw new Error(out.error);
    expect(out.applied.sort()).toEqual(['client_age', 'client_date_of_birth', 'client_last_name']);
    expect(out.intake.client_age).toBe(62);
    expect(out.intake.client_date_of_birth).toBe('1964-03-02');
    expect(out.intake.client_last_name).toBe('Botsford');
  });

  it('an age the parser cannot read is refused naming the field, not applied broken', () => {
    const ext = extraction({ client_age: { value: 'sixty-two', confidence: 'medium' } });
    const out = applyExtractionSelections(baseIntake, ext, ['client_age'], new Set());
    expect('error' in out).toBe(true);
    if ('error' in out) {
      expect(out.error).toContain('client_age');
      expect(out.invalidFields).toContain('client_age');
    }
  });

  it('the contact block lands: addresses feed the HRTO form and court forms', () => {
    const ext = extraction({
      client_address: { value: '12 Elm Street', confidence: 'high' },
      client_city: { value: 'Hamilton', confidence: 'high' },
      client_postal_code: { value: 'L8P 1A1', confidence: 'high' },
      employer_address: { value: '100 Bay Street, Toronto ON', confidence: 'high' },
    });
    const out = applyExtractionSelections(baseIntake, ext, ['client_address', 'client_city', 'client_postal_code', 'employer_address'], new Set());
    if ('error' in out) throw new Error(out.error);
    expect(out.unmapped).toEqual([]);
    expect(out.intake.client_address).toBe('12 Elm Street');
    expect(out.intake.employer_address).toBe('100 Bay Street, Toronto ON');
  });

  it('commission and workplace location now land instead of surfacing as unmapped', () => {
    const ext = extraction({
      commission_amount: { value: '$18,500', confidence: 'high' },
      workplace_location: { value: 'Mississauga, Ontario', confidence: 'high' },
    });
    const out = applyExtractionSelections(baseIntake, ext, ['commission_amount', 'workplace_location'], new Set());
    if ('error' in out) throw new Error(out.error);
    expect(out.unmapped).toEqual([]);
    expect(out.intake.commission_amount).toBe(18500);
    expect(out.intake.workplace_location).toBe('Mississauga, Ontario');
  });
});

describe('resolveExtraction', () => {
  it('resolves by id and falls back to idx-N for legacy records', () => {
    const legacy = { ...extraction({}), id: undefined };
    const modern = extraction({});
    expect(resolveExtraction([legacy, modern], 'ext-1')).toBe(modern);
    expect(resolveExtraction([legacy, modern], 'idx-0')).toBe(legacy);
    expect(resolveExtraction([legacy, modern], 'nope')).toBeUndefined();
  });
});

describe('diffTimelines (consequence diff)', () => {
  it('reports a moved deadline as removed + added under the same label', () => {
    const before: TimelineEvent[] = [
      { date: '2028-01-01', label: 'Limitation period expires', category: 'legal', source: 'system' },
    ];
    const after: TimelineEvent[] = [
      { date: '2028-05-15', label: 'Limitation period expires', category: 'legal', source: 'system' },
    ];
    const diff = diffTimelines(before, after);
    expect(diff.removed).toEqual([{ date: '2028-01-01', label: 'Limitation period expires' }]);
    expect(diff.added).toEqual([{ date: '2028-05-15', label: 'Limitation period expires' }]);
  });
});

describe('rebuildTimelinePreserving (the wipe fix)', () => {
  it('keeps lawyer court dates and route-added ticklers across an intake rebuild', () => {
    const intake = employmentIntakeSchema.parse({ termination_date: '2026-05-15' }) as EmploymentIntakeData;
    const existing: TimelineEvent[] = [
      { date: '2026-09-01', label: 'Settlement conference', category: 'legal', source: 'lawyer_entry', courtDeadline: true } as TimelineEvent,
      { date: '2026-08-01', label: 'Statement of Defence due', category: 'legal', source: 'system' },
      { date: '2026-07-20', label: 'Debrief captured: 3 action items', category: 'other', source: 'system' },
      // Generator-owned system event at a stale date: must be regenerated, not duplicated
      { date: '2027-01-01', label: 'Limitation period expires', category: 'legal', source: 'system' },
    ];
    const rebuilt = rebuildTimelinePreserving(existing, intake);
    const labels = rebuilt.map(e => `${e.date}|${e.label}`);
    expect(labels).toContain('2026-09-01|Settlement conference');
    expect(labels).toContain('2026-08-01|Statement of Defence due');
    expect(labels).toContain('2026-07-20|Debrief captured: 3 action items');
    // Limitation regenerated from the intake's termination date (2026-05-15 + 2y), stale copy gone
    expect(labels).toContain('2028-05-15|Limitation period expires');
    expect(labels).not.toContain('2027-01-01|Limitation period expires');
    expect(rebuilt.filter(e => e.label === 'Limitation period expires')).toHaveLength(1);
  });
});

describe('verifySourceQuotes (quote grounding)', () => {
  const doc = 'The Employee’s employment will terminate   effective May 15, 2026.\nSeverance of eight (8) weeks is offered.';

  it('verifies quotes found verbatim (whitespace/case tolerant) and flags fabricated ones', () => {
    const fields = verifySourceQuotes({
      termination_date: { value: '2026-05-15', confidence: 'high' as const, sourceQuote: 'employment will terminate effective May 15, 2026' },
      severance_weeks_offered: { value: 12, confidence: 'high' as const, sourceQuote: 'Severance of twelve (12) weeks is offered.' },
      last_day_worked: { value: null, confidence: 'low' as const }, // no quote → untouched
    }, doc);
    expect(fields.termination_date.verified).toBe(true);
    expect(fields.severance_weeks_offered.verified).toBe(false); // the tripwire
    expect(fields.last_day_worked.verified).toBeUndefined();
  });
});

describe('dates as documents write them (2026-08-04)', () => {
  const baseIntake = { client_first_name: 'Vera' } as never;
  const extraction = (fields: Record<string, unknown>) => ({
    id: 'x', documentName: 'SOC.pdf', documentKind: 'pleading',
    extractedFields: Object.fromEntries(
      Object.entries(fields).map(([k, v]) => [k, { value: v, confidence: 'high', sourceQuote: 'q' }]),
    ),
  }) as never;

  it('reads a long-form date out of a pleading', () => {
    const out = applyExtractionSelections(
      baseIntake, extraction({ termination_date: 'January 15, 2026' }), ['termination_date'], new Set(),
    );
    expect('intake' in out).toBe(true);
    if ('intake' in out) {
      expect(out.intake.termination_date).toBe('2026-01-15');
      expect(out.applied).toContain('termination_date');
    }
  });

  it('strips a time component rather than rejecting', () => {
    const out = applyExtractionSelections(
      baseIntake, extraction({ hire_date: '2012-04-02T00:00:00Z' }), ['hire_date'], new Set(),
    );
    if ('intake' in out) expect(out.intake.hire_date).toBe('2012-04-02');
    else throw new Error('should have applied');
  });

  it('refuses an ambiguous date and says why, naming the field', () => {
    const out = applyExtractionSelections(
      baseIntake, extraction({ termination_date: '03/04/2026' }), ['termination_date'], new Set(),
    );
    expect('error' in out).toBe(true);
    if ('error' in out) {
      expect(out.error).toMatch(/two ways/i);
      expect(out.invalidFields).toContain('termination_date');
    }
  });

  it('names the value and the rule when the schema still rejects', () => {
    // salary_period is an enum; "fortnightly" is not one of its values.
    const out = applyExtractionSelections(
      baseIntake, extraction({ salary_period: 'fortnightly' }), ['salary_period'], new Set(),
    );
    expect('error' in out).toBe(true);
    if ('error' in out) {
      // The lawyer must be able to see WHAT was wrong, not just which field.
      expect(out.error).toContain('salary_period');
      expect(out.error).toContain('fortnightly');
      expect(out.error).toMatch(/nothing was changed/i);
    }
  });
});
