/**
 * Unit + route tests — case synthesis memo (Phase 3 slice 2).
 *
 * The memo is built from structured extractions, stored and metered like
 * any generated document, and carries review flags. Provider mocked.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const chatMock = vi.fn();
vi.mock('../../src/providers/cross-provider-chat.js', () => ({
  crossProviderChat: (...args: unknown[]) => chatMock(...args),
}));

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { generateCaseSynthesis } from '../../src/employment/case-synthesis.js';
import { initDatabase, saveMatter, getMatterById, getDb } from '../../src/db/database.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';
import type { DocumentExtractionResult, EmploymentIntakeData } from '../../src/types/employment-intake.js';

const EXTRACTION: DocumentExtractionResult = {
  id: 'e1', filename: 'letter.pdf', documentType: 'termination_letter',
  extractedFields: {
    termination_date: { value: '2026-05-15', confidence: 'high', verified: true },
    severance_weeks_offered: { value: 8, confidence: 'medium' },
  },
  keyFindings: ['Release required as condition of severance'],
  confirmed: false,
};

describe('generateCaseSynthesis', () => {
  it('feeds the structured digest to the model and returns flagged HTML', async () => {
    chatMock.mockResolvedValueOnce({ text: '<h2>Overview</h2><p>The client was dismissed (letter.pdf).</p>', cost: 0.12 });
    const result = await generateCaseSynthesis({
      intake: { client_first_name: 'Ana', employer_legal_name: 'Beta Inc' } as unknown as EmploymentIntakeData,
      extractions: [EXTRACTION],
      chronology: [{ date: '2026-05-15', field: 'termination_date', label: 'Employment terminated', category: 'termination', sources: [{ filename: 'letter.pdf', extractionId: 'e1', confidence: 'high', verified: true }], onTimeline: false }],
      conflicts: [],
    });
    expect(result.html).toContain('letter.pdf');
    expect(result.costUsd).toBeCloseTo(0.12);
    expect(result.lawyerReviewFlags.length).toBeGreaterThanOrEqual(2);

    const [{ system, user }] = chatMock.mock.calls[0] as [{ system: string; user: string }];
    expect(system).toContain('cite');
    expect(user).toContain('termination_date: "2026-05-15" [high, verified]'); // structured digest, not raw docs
    expect(user).toContain('Release required');
  });
});

describe('POST /api/employment/:matterId/case-synthesis', () => {
  let app: FastifyInstance;
  const USER = 'local-user';

  beforeAll(async () => {
    initDatabase(':memory:');
    saveMatter(USER, 'm-syn-1', JSON.stringify({
      title: 'm-syn-1',
      employmentData: {
        intake: { client_first_name: 'Ana', client_last_name: 'Reyes', employer_legal_name: 'Beta Inc' },
        timeline: [], gates: [],
        documentExtractions: [EXTRACTION],
      },
    }), 'active');
    saveMatter(USER, 'm-syn-empty', JSON.stringify({ title: 'empty', employmentData: { intake: {}, timeline: [], gates: [], documentExtractions: [] } }), 'active');
    app = Fastify({ logger: false });
    registerEmploymentIntakeRoutes(app);
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it('generates, sanitises, stores, and meters the memo', async () => {
    chatMock.mockResolvedValueOnce({ text: '<h2>Overview</h2><p>Dismissal (letter.pdf).</p><script>alert(1)</script>', cost: 0.15 });
    const res = await app.inject({ method: 'POST', url: '/api/employment/m-syn-1/case-synthesis' });
    expect(res.statusCode).toBe(200);
    const doc = (res.json() as { document: { html: string; documentTitle: string; status: string } }).document;
    expect(doc.documentTitle).toBe('Case File Review Memo');
    expect(doc.html).toContain('letter.pdf');
    expect(doc.html).not.toContain('<script>');            // sanitised

    const row = getMatterById('m-syn-1', USER)!;
    const m = JSON.parse(row.data_json) as Record<string, unknown>;
    expect(m.generated_case_synthesis).toBeDefined();
    const history = m.draftHistory as Array<{ docType: string }>;
    expect(history[0].docType).toBe('case_synthesis');

    const usage = getDb().prepare("SELECT kind, cost_usd FROM usage_events WHERE doc_type = 'case_synthesis'").all() as Array<{ kind: string; cost_usd: number }>;
    expect(usage).toHaveLength(1);
    expect(usage[0].kind).toBe('generation');
    expect(usage[0].cost_usd).toBeCloseTo(0.15);
  });

  it('400s with no extractions and 502s cleanly on provider failure', async () => {
    const empty = await app.inject({ method: 'POST', url: '/api/employment/m-syn-empty/case-synthesis' });
    expect(empty.statusCode).toBe(400);

    chatMock.mockRejectedValueOnce(new Error('api down'));
    const fail = await app.inject({ method: 'POST', url: '/api/employment/m-syn-1/case-synthesis' });
    expect(fail.statusCode).toBe(502);
  });
});
