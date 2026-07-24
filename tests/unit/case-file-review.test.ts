/**
 * Unit + route tests — case file review aggregation (Phase 3 slice 1).
 *
 * Deterministic cross-document intelligence: the chronology cites every
 * source, conflicts are surfaced (never silently first-wins), and applying
 * approved entries dedups and survives intake rebuilds.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { buildChronology, findConflicts } from '../../src/employment/case-file-review.js';
import { initDatabase, saveMatter, getMatterById } from '../../src/db/database.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';
import type { DocumentExtractionResult, EmploymentIntakeData } from '../../src/types/employment-intake.js';

function ext(id: string, filename: string, fields: Record<string, { value: string | number | boolean | null; confidence?: 'high' | 'medium' | 'low'; verified?: boolean }>): DocumentExtractionResult {
  return {
    id, filename, documentType: 'other',
    extractedFields: Object.fromEntries(Object.entries(fields).map(([k, f]) => [k, { value: f.value, confidence: f.confidence ?? 'high', verified: f.verified }])),
    keyFindings: [], confirmed: false,
  };
}

describe('buildChronology', () => {
  it('collects dated fields across documents, merging corroborating sources', () => {
    const chron = buildChronology([
      ext('e1', 'contract.pdf', { hire_date: { value: '2016-03-01' }, annual_salary: { value: 95000 } }),
      ext('e2', 'letter.pdf', { termination_date: { value: '2026-05-15', verified: true }, hire_date: { value: '2016-03-01' } }),
    ], []);
    expect(chron.map(c => c.label)).toEqual(['Hire date', 'Employment terminated']);
    const hire = chron[0];
    expect(hire.sources.map(s => s.filename).sort()).toEqual(['contract.pdf', 'letter.pdf']); // corroboration
    expect(chron[1].category).toBe('termination');
    expect(chron[1].sources[0].verified).toBe(true);
  });

  it('flags entries already on the timeline and ignores non-date values', () => {
    const chron = buildChronology(
      [ext('e1', 'letter.pdf', { termination_date: { value: '2026-05-15' }, termination_reasons: { value: 'restructuring' } })],
      [{ date: '2026-05-15', label: 'Employment terminated', category: 'termination', source: 'intake_form' }],
    );
    expect(chron).toHaveLength(1);
    expect(chron[0].onTimeline).toBe(true);
  });
});

describe('findConflicts', () => {
  const intake = { annual_salary: 95000 } as unknown as EmploymentIntakeData;

  it('surfaces cross-document disagreement with all candidates', () => {
    const conflicts = findConflicts([
      ext('e1', 'contract.pdf', { annual_salary: { value: 95000 } }),
      ext('e2', 'stub.pdf', { annual_salary: { value: 98000, confidence: 'medium' } }),
    ], intake);
    expect(conflicts).toHaveLength(1);
    expect(conflicts[0].field).toBe('annual_salary');
    expect(conflicts[0].current).toBe(95000);
    expect(conflicts[0].candidates.map(c => c.value).sort()).toEqual([95000, 98000]);
  });

  it('flags a single extracted value that contradicts the intake', () => {
    const conflicts = findConflicts([
      ext('e1', 'stub.pdf', { annual_salary: { value: 98000 } }),
    ], intake);
    expect(conflicts).toHaveLength(1);
  });

  it('treats agreement as no conflict, ignores unmapped fields', () => {
    const conflicts = findConflicts([
      ext('e1', 'contract.pdf', { annual_salary: { value: 95000 }, tone_assessment: { value: 'hostile' } }),
      ext('e2', 'stub.pdf', { annual_salary: { value: 95000 } }),
    ], intake);
    expect(conflicts).toHaveLength(0);
  });
});

describe('case-review routes', () => {
  let app: FastifyInstance;
  const USER = 'local-user';

  beforeAll(async () => {
    initDatabase(':memory:');
    saveMatter(USER, 'm-cfr-1', JSON.stringify({
      title: 'm-cfr-1',
      employmentData: {
        intake: { client_first_name: 'Ana', annual_salary: 95000 },
        timeline: [{ date: '2026-01-10', label: 'Court date: settlement conference', category: 'legal', source: 'lawyer_entry', courtDeadline: true }],
        gates: [],
        documentExtractions: [
          ext('e1', 'contract.pdf', { hire_date: { value: '2016-03-01' }, annual_salary: { value: 98000 } }),
          ext('e2', 'letter.pdf', { termination_date: { value: '2026-05-15' } }),
        ],
      },
    }), 'active');
    app = Fastify({ logger: false });
    registerEmploymentIntakeRoutes(app);
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it('GET returns chronology + conflicts, scoped to the owner', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/employment/m-cfr-1/case-review' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { extractionCount: number; chronology: Array<{ label: string }>; conflicts: Array<{ field: string }> };
    expect(body.extractionCount).toBe(2);
    expect(body.chronology.map(c => c.label)).toEqual(['Hire date', 'Employment terminated']);
    expect(body.conflicts.map(c => c.field)).toEqual(['annual_salary']);

    const foreign = await app.inject({ method: 'GET', url: '/api/employment/m-notmine/case-review' });
    expect(foreign.statusCode).toBe(404);
  });

  it('POST applies approved entries, dedups, cites sources, and preserves lawyer events', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/employment/m-cfr-1/case-review/timeline',
      payload: {
        events: [
          { date: '2016-03-01', label: 'Hire date', category: 'employment', sourceDoc: 'contract.pdf' },
          { date: '2026-05-15', label: 'Employment terminated', category: 'termination', sourceDoc: 'letter.pdf' },
        ],
      },
    });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { added: unknown[] }).added).toHaveLength(2);

    // Re-apply: full dedup.
    const again = await app.inject({
      method: 'POST', url: '/api/employment/m-cfr-1/case-review/timeline',
      payload: { events: [{ date: '2016-03-01', label: 'Hire date', category: 'employment', sourceDoc: 'contract.pdf' }] },
    });
    expect((again.json() as { added: unknown[]; skippedExisting: number }).added).toHaveLength(0);
    expect((again.json() as { skippedExisting: number }).skippedExisting).toBe(1);

    const row = getMatterById('m-cfr-1', USER)!;
    const emp = (JSON.parse(row.data_json) as { employmentData: { timeline: Array<{ label: string; source: string; description?: string }> } }).employmentData;
    const applied = emp.timeline.filter(e => e.source === 'document_extraction');
    expect(applied).toHaveLength(2);
    expect(applied[0].description).toContain('contract.pdf');
    // The lawyer's court date survived.
    expect(emp.timeline.some(e => e.label.startsWith('Court date'))).toBe(true);

    // Chronology now reports both entries as on the timeline.
    const review = await app.inject({ method: 'GET', url: '/api/employment/m-cfr-1/case-review' });
    const chron = (review.json() as { chronology: Array<{ onTimeline: boolean }> }).chronology;
    expect(chron.every(c => c.onTimeline)).toBe(true);
  });
});
