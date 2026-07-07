/**
 * Integration Tests — correspondence routes (src/api/routes/correspondence.ts)
 *
 * Start → draft → edit → mark sent → timeline event; double-start refused;
 * docket picks up the scheduled item.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, saveMatter, getMatterById } from '../../src/db/database.js';
import { registerCorrespondenceRoutes } from '../../src/api/routes/correspondence.js';
import { collectDeadlines } from '../../src/employment/deadlines.js';

let app: FastifyInstance;
const USER = 'local-user';

async function req(method: 'POST' | 'GET' | 'PUT', url: string, payload?: unknown) {
  const res = await app.inject({ method, url, payload: payload as Record<string, unknown> | undefined });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  initDatabase(':memory:');
  app = Fastify({ logger: false });
  registerCorrespondenceRoutes(app);
  await app.ready();

  saveMatter(USER, 'm-corr', JSON.stringify({
    title: 'm-corr',
    employmentData: {
      intake: { client_first_name: 'Iris', client_last_name: 'Ng', employer_legal_name: 'Acme Corp', termination_date: '2026-06-15', client_email: 'iris@example.com' },
      gates: [], approvedIssues: [], dismissedIssues: [], documentExtractions: [],
      timeline: [], analysis: null,
      selectedTone: 'professional', selectedProcedure: null, selectedDocumentType: null, demandAmount: null,
    },
  }), 'active');
});

afterAll(async () => {
  await app.close();
});

describe('correspondence routes', () => {
  it('start creates the two-step series and refuses a restart', async () => {
    const start = await req('POST', '/api/employment/m-corr/correspondence/start', { sequence: 'mitigation', followUpWeeks: 6 });
    expect(start.status).toBe(200);
    expect((start.body.correspondence as unknown[]).length).toBe(2);

    const again = await req('POST', '/api/employment/m-corr/correspondence/start', { sequence: 'mitigation', followUpWeeks: 6 });
    expect(again.status).toBe(409);
  });

  it('scheduled items surface on the docket as client_email deadlines', async () => {
    const row = await getMatterById('m-corr', USER);
    const deadlines = collectDeadlines([{ id: 'm-corr', data_json: row!.data_json }]);
    const emails = deadlines.filter(d => d.kind === 'client_email');
    expect(emails.length).toBeGreaterThanOrEqual(1);
    expect(emails[0].label).toContain('Client email due');
    expect(emails[0].matterLabel).toBe('Iris Ng v Acme Corp');
  });

  it('draft builds deterministically and sets status drafted', async () => {
    const res = await req('POST', '/api/employment/m-corr/correspondence/mitigation-1/draft');
    expect(res.status).toBe(200);
    const item = res.body.item as { status: string; draft: { subject: string; body: string } };
    expect(item.status).toBe('drafted');
    expect(item.draft.body).toContain('Dear Iris');
  });

  it('the lawyer can edit the draft', async () => {
    const res = await req('PUT', '/api/employment/m-corr/correspondence/mitigation-1/draft', {
      subject: 'Edited subject', body: 'Edited body per the firm style.',
    });
    expect(res.status).toBe(200);
    expect((res.body.item as { draft: { subject: string } }).draft.subject).toBe('Edited subject');
  });

  it('mark sent records history and a timeline event, then blocks re-draft', async () => {
    const res = await req('POST', '/api/employment/m-corr/correspondence/mitigation-1/status', { status: 'sent' });
    expect(res.status).toBe(200);

    const row = await getMatterById('m-corr', USER);
    const matter = JSON.parse(row!.data_json) as Record<string, unknown>;
    const timeline = (matter.employmentData as { timeline: Array<{ label: string }> }).timeline;
    expect(timeline.some(t => t.label.startsWith('Client email sent:'))).toBe(true);

    const redraft = await req('POST', '/api/employment/m-corr/correspondence/mitigation-1/draft');
    expect(redraft.status).toBe(400);
  });

  it('unknown item and unknown matter 404', async () => {
    expect((await req('POST', '/api/employment/m-corr/correspondence/nope/draft')).status).toBe(404);
    expect((await req('GET', '/api/employment/no-such-matter/correspondence')).status).toBe(404);
  });
});
