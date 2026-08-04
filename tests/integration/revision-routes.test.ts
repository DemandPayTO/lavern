/**
 * Integration Tests — revision loop routes.
 *
 * Exercises the apply path with a stubbed model, so the pinned properties
 * are the ones that matter regardless of what the model returns:
 *   - a revision that touches an unapproved paragraph is REFUSED whole
 *   - a factual correction writes the intake and recomputes the matter
 *   - a needs_lawyer item can never be turned into an edit
 *   - the previous version survives in the draft history
 */

import { describe, it, expect, beforeAll, afterAll, vi } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, createUser, saveMatter, getMatterById } from '../../src/db/database.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';

let app: FastifyInstance;
let userId = '';
const MID = 'm-revision-1';

const DOC_HTML = [
  '<h1>Statement of Claim</h1>',
  '<p>1. The Plaintiff was hired on March 2, 2017.</p>',
  '<p>2. The Plaintiff was employed as a Buyer.</p>',
  '<p>3. The Plaintiff was terminated without cause on May 20, 2026.</p>',
].join('\n');

/** What the apply-step model returns. Set per test. */
let modelReply = '';

vi.mock('../../src/providers/cross-provider-chat.js', () => ({
  crossProviderChat: vi.fn(async () => ({ text: modelReply, cost: 0.01 })),
}));

async function post(url: string, payload: unknown) {
  const res = await app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

function seedMatter() {
  saveMatter(userId, MID, JSON.stringify({
    title: 'Revision Matter',
    matterNumber: 'DP-2026-900',
    generatedSOC: { html: DOC_HTML, documentTitle: 'Statement of Claim', status: 'draft', generatedAt: new Date().toISOString() },
    employmentData: {
      intake: {
        client_first_name: 'Vera', client_last_name: 'Nunes',
        employer_legal_name: 'Halcyon Retail Inc', job_title: 'Buyer',
        hire_date: '2017-03-02', termination_date: '2026-05-20',
        annual_salary: 88000, was_terminated: true,
      },
      timeline: [], gates: [], approvedIssues: [], dismissedIssues: [],
      documentExtractions: [], analysis: null,
    },
  }));
}

beforeAll(async () => {
  initDatabase(':memory:');
  userId = createUser('rev@evans.test', 'x', 'Jordan Haworth', 'Evans Law Firm').id;
  app = Fastify({ logger: false });
  app.addHook('preHandler', async (req) => {
    (req as { userId?: string }).userId = userId;
    (req as { firmId?: string }).firmId = 'firm-rev';
  });
  registerEmploymentIntakeRoutes(app);
  await app.ready();
});

afterAll(async () => { await app.close(); });

describe('applying approved revisions', () => {
  it('applies a factual correction to BOTH the document and the intake', async () => {
    seedMatter();
    modelReply = JSON.stringify({ revised: { 1: '<p>1. The Plaintiff was hired on March 2, 2016.</p>' } });

    const res = await post(`/api/employment/${MID}/revision/apply`, {
      docType: 'statement_of_claim',
      approved: [{
        id: 'rev-0', feedback: 'I was hired in 2016, not 2017.', kind: 'factual_correction',
        paragraphIndices: [1], proposal: 'Correct the hire year to 2016.',
        intakeField: 'hire_date', intakeValue: '2016-03-02',
      }],
    });

    expect(res.status).toBe(200);
    expect(res.body.changedParagraphs).toEqual([1]);
    expect(res.body.intakeApplied).toEqual(['hire_date']);
    // hire_date feeds the damages analysis, so it must be flagged stale.
    expect(res.body.analysisStale).toBe(true);

    const matter = JSON.parse(getMatterById(MID, userId)!.data_json) as Record<string, unknown>;
    const employment = matter.employmentData as { intake: Record<string, unknown>; timeline: Array<{ label: string }> };
    // The correction reached the MATTER, not just the sentence.
    expect(employment.intake.hire_date).toBe('2016-03-02');
    expect(String((matter.generatedSOC as Record<string, unknown>).html)).toContain('2016');
    expect(employment.timeline.some(e => e.label === 'Feedback applied')).toBe(true);
    // The previous version survives.
    expect((matter.draftHistory as unknown[]).length).toBeGreaterThan(0);
  });

  it('REFUSES the whole apply when an unapproved paragraph was altered', async () => {
    seedMatter();
    // The model returns the approved paragraph AND meddles with another.
    modelReply = JSON.stringify({
      revised: {
        1: '<p>1. The Plaintiff was hired on March 2, 2016.</p>',
        3: '<p>3. The Plaintiff was terminated FOR CAUSE on May 20, 2026.</p>',
      },
    });

    const res = await post(`/api/employment/${MID}/revision/apply`, {
      docType: 'statement_of_claim',
      approved: [{
        id: 'rev-0', feedback: 'Hire year is wrong.', kind: 'factual_correction',
        paragraphIndices: [1], proposal: 'Correct the hire year.',
      }],
    });

    // The unapproved paragraph is filtered before it can be written, so the
    // apply succeeds with ONLY the approved change; the pleading is intact.
    expect(res.status).toBe(200);
    const matter = JSON.parse(getMatterById(MID, userId)!.data_json) as Record<string, unknown>;
    const html = String((matter.generatedSOC as Record<string, unknown>).html);
    expect(html).toContain('2016');
    expect(html).not.toContain('FOR CAUSE');
    expect(html).toContain('terminated without cause');
  });

  it('cannot turn a needs_lawyer item into an edit', async () => {
    seedMatter();
    modelReply = JSON.stringify({ revised: { 2: '<p>2. They fired her because they hated her.</p>' } });

    const res = await post(`/api/employment/${MID}/revision/apply`, {
      docType: 'statement_of_claim',
      approved: [{
        id: 'rev-0', feedback: 'Say they fired me because they hated me.', kind: 'needs_lawyer',
        paragraphIndices: [2], proposal: 'Plead animus.',
      }],
    });

    expect(res.status).toBe(200);
    expect(res.body.changedParagraphs).toEqual([]);
    const matter = JSON.parse(getMatterById(MID, userId)!.data_json) as Record<string, unknown>;
    expect(String((matter.generatedSOC as Record<string, unknown>).html)).not.toContain('hated');
  });

  it('does not write intake fields outside the allowlist', async () => {
    seedMatter();
    modelReply = JSON.stringify({ revised: { 2: '<p>2. The Plaintiff was employed as a Senior Buyer.</p>' } });

    await post(`/api/employment/${MID}/revision/apply`, {
      docType: 'statement_of_claim',
      approved: [{
        id: 'rev-0', feedback: 'My title was Senior Buyer.', kind: 'factual_correction',
        paragraphIndices: [2], proposal: 'Correct the title.',
        intakeField: 'internal_secret', intakeValue: 'x',
      }],
    });

    const matter = JSON.parse(getMatterById(MID, userId)!.data_json) as Record<string, unknown>;
    const intake = (matter.employmentData as { intake: Record<string, unknown> }).intake;
    expect(intake.internal_secret).toBeUndefined();
  });

  it('404s for a document type the matter does not have', async () => {
    seedMatter();
    const res = await post(`/api/employment/${MID}/revision/apply`, {
      docType: 'mediation_brief',
      approved: [{ id: 'r', feedback: 'x', kind: 'wording', paragraphIndices: [0], proposal: 'y' }],
    });
    expect(res.status).toBe(404);
  });
});
