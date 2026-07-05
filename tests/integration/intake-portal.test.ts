/**
 * Integration Tests — client intake portal (src/api/routes/intake-portal.ts)
 *
 * The token is the capability: hashed at rest, expiring, one per matter,
 * revealing only the firm name. Applying a submission fills blank intake
 * fields only and never overwrites the lawyer's entries.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, saveMatter, getMatterById } from '../../src/db/database.js';
import { registerIntakePortalRoutes } from '../../src/api/routes/intake-portal.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';

let app: FastifyInstance;
const USER = 'local-user';

async function post(url: string, payload?: unknown) {
  const res = await app.inject({ method: 'POST', url, payload: payload as Record<string, unknown> | undefined });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}
async function get(url: string) {
  const res = await app.inject({ method: 'GET', url });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  initDatabase(':memory:');
  app = Fastify({ logger: false });
  registerIntakePortalRoutes(app);
  registerEmploymentIntakeRoutes(app);
  await app.ready();
});

afterAll(async () => {
  await app.close();
});

describe('client intake portal', () => {
  it('runs the full flow: link → public form → submission → fill-blanks-only apply', async () => {
    saveMatter(USER, 'm-portal', JSON.stringify({
      title: 'm-portal',
      employmentData: {
        intake: { client_first_name: 'Iris', employer_legal_name: 'Lawyer Entered Corp' },
        gates: [], approvedIssues: [], dismissedIssues: [], documentExtractions: [],
        timeline: [], analysis: null,
        selectedTone: 'professional', selectedProcedure: null, selectedDocumentType: null, demandAmount: null,
      },
    }), 'active');

    const link = await post('/api/employment/m-portal/intake-link');
    expect(link.status).toBe(200);
    const token = String(link.body.path).match(/client-intake\/([A-Za-z0-9_-]+)/)?.[1];
    expect(token).toBeTruthy();

    // Public validity check reveals the first name and nothing else
    const check = await get(`/api/intake-portal/${token}`);
    expect(check.status).toBe(200);
    expect(check.body.clientFirstName).toBe('Iris');
    expect(Object.keys(check.body).sort()).toEqual(['clientFirstName', 'firmName', 'ok']);

    // Bad token is rejected
    expect((await get('/api/intake-portal/not-a-real-token')).status).toBe(404);

    // Submission: strict schema rejects unknown keys
    const badSubmit = await post(`/api/intake-portal/${token}`, { employer_legal_name: 'X', evil_field: 'y' });
    expect(badSubmit.status).toBe(400);

    const submit = await post(`/api/intake-portal/${token}`, {
      client_last_name: 'Valdez',
      employer_legal_name: 'Client Typed Corp',
      annual_salary: 71000,
      termination_date: '2026-06-20',
      client_narrative: 'They let me go the day after I asked about my schedule.',
    });
    expect(submit.status).toBe(200);

    // Apply: blanks fill, the lawyer's employer name survives
    const apply = await post('/api/employment/m-portal/apply-client-intake');
    expect(apply.status).toBe(200);
    expect(apply.body.appliedFields).toContain('client_last_name');
    expect(apply.body.appliedFields).toContain('annual_salary');
    expect(apply.body.appliedFields).not.toContain('employer_legal_name');
    expect(String(apply.body.narrative)).toContain('schedule');

    const row = await getMatterById('m-portal', USER);
    const matter = JSON.parse(row!.data_json) as Record<string, Record<string, Record<string, unknown>>>;
    expect(matter.employmentData.intake.employer_legal_name).toBe('Lawyer Entered Corp');
    expect(matter.employmentData.intake.client_last_name).toBe('Valdez');

    // The token is consumed on apply
    expect((await get(`/api/intake-portal/${token}`)).status).toBe(404);

    // Nothing further pending
    const again = await post('/api/employment/m-portal/apply-client-intake');
    expect(again.status).toBe(400);
  });

  it('discard clears the pending submission and the link', async () => {
    saveMatter(USER, 'm-portal2', JSON.stringify({ title: 'm-portal2' }), 'active');
    const link = await post('/api/employment/m-portal2/intake-link');
    const token = String(link.body.path).match(/client-intake\/([A-Za-z0-9_-]+)/)?.[1];
    await post(`/api/intake-portal/${token}`, { client_last_name: 'Ng' });

    const del = await app.inject({ method: 'DELETE', url: '/api/employment/m-portal2/client-intake' });
    expect(del.statusCode).toBe(200);
    const pending = await get('/api/employment/m-portal2/client-intake');
    expect(pending.body.pending).toBeNull();
    expect((await get(`/api/intake-portal/${token}`)).status).toBe(404);
  });
});
