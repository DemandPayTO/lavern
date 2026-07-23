/**
 * Unit + route tests — document auto-classification (Phase 2).
 *
 * The classifier is advisory: the lawyer confirms the type before
 * extraction, so these tests pin the safety property that FAILURE NEVER
 * BLOCKS — bad JSON, unknown kinds, and provider errors all degrade to
 * {other, low, fallback:true}.
 */

import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest';

const chatMock = vi.fn();
vi.mock('../../src/providers/cross-provider-chat.js', () => ({
  crossProviderChat: (...args: unknown[]) => chatMock(...args),
}));

import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { classifyEmploymentDocument } from '../../src/api/briefing/document-classifier.js';
import { initDatabase, saveMatter, getDb } from '../../src/db/database.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';

describe('classifyEmploymentDocument', () => {
  it('returns the detected kind and confidence from clean JSON', async () => {
    chatMock.mockResolvedValueOnce({ text: '{"kind":"termination_letter","confidence":"high"}', cost: 0.001 });
    const r = await classifyEmploymentDocument('Your employment will terminate...', 'letter.pdf');
    expect(r).toMatchObject({ kind: 'termination_letter', confidence: 'high', fallback: false });
  });

  it('tolerates commentary around the JSON object', async () => {
    chatMock.mockResolvedValueOnce({ text: 'Sure! {"kind":"pay_stub","confidence":"medium"} hope that helps', cost: 0.001 });
    const r = await classifyEmploymentDocument('Earnings statement...', 'stub.pdf');
    expect(r.kind).toBe('pay_stub');
    expect(r.fallback).toBe(false);
  });

  it('falls back to other/low on an unknown kind', async () => {
    chatMock.mockResolvedValueOnce({ text: '{"kind":"grocery_list","confidence":"high"}', cost: 0.001 });
    const r = await classifyEmploymentDocument('milk, eggs', 'list.txt');
    expect(r).toMatchObject({ kind: 'other', confidence: 'low', fallback: true });
  });

  it('falls back to other/low when the provider throws', async () => {
    chatMock.mockRejectedValueOnce(new Error('api down'));
    const r = await classifyEmploymentDocument('anything', 'x.pdf');
    expect(r).toMatchObject({ kind: 'other', confidence: 'low', fallback: true, costUsd: 0 });
  });
});

describe('POST /api/employment/classify', () => {
  let app: FastifyInstance;
  const USER = 'local-user';

  beforeAll(async () => {
    initDatabase(':memory:');
    saveMatter(USER, 'm-cls-1', JSON.stringify({ title: 'm-cls-1' }), 'active');
    app = Fastify({ logger: false });
    registerEmploymentIntakeRoutes(app);
    await app.ready();
  });

  afterAll(async () => { await app.close(); });

  it('classifies, meters the cost, and scopes by matter ownership', async () => {
    chatMock.mockResolvedValueOnce({ text: '{"kind":"employment_agreement","confidence":"high"}', cost: 0.002 });
    const res = await app.inject({
      method: 'POST', url: '/api/employment/classify',
      payload: { matterId: 'm-cls-1', documentContent: 'This Employment Agreement...', documentName: 'contract.pdf' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json()).toMatchObject({ ok: true, kind: 'employment_agreement', confidence: 'high', fallback: false });
    const usage = getDb().prepare("SELECT kind, doc_type, cost_usd FROM usage_events WHERE doc_type = 'classification'").all() as Array<{ kind: string; cost_usd: number }>;
    expect(usage).toHaveLength(1);
    expect(usage[0].kind).toBe('analysis');       // never inflates generation counts
    expect(usage[0].cost_usd).toBeCloseTo(0.002);

    const foreign = await app.inject({
      method: 'POST', url: '/api/employment/classify',
      payload: { matterId: 'm-not-mine', documentContent: 'x', documentName: 'x.pdf' },
    });
    expect(foreign.statusCode).toBe(404);
  });
});
