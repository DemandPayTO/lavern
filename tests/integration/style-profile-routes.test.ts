/**
 * Integration Tests — style profile read, tweak, and tenancy.
 *
 * The property the pilot cares about: a tweak SAVES. The lawyer edits the
 * guide once and every later draft uses it; a broken edit is refused with
 * the reason rather than silently stored. And profiles are firm property:
 * another firm can neither read nor edit them.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, createUser, saveStyleProfile } from '../../src/db/database.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';

let app: FastifyInstance;
const OWNER: Record<string, string> = {};
const RIVAL: Record<string, string> = {};
const PID = 'style-test-1';

const GUIDE = {
  flow: [{ heading: 'Why We Are Here', purpose: 'State the value of the case plainly.' }],
  voice: 'Blunt and economical.',
  recurringLanguage: ['We say this plainly:'],
  factWeaving: 'Facts inside argument.',
  notes: [],
  typicalWords: 6500,
  profileTableRows: ['Name of Employee', 'Age at Dismissal'],
};

async function call(method: 'GET' | 'PUT' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) {
  const res = await app.inject({ method, url, headers, payload: payload as Record<string, unknown> | undefined });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  initDatabase(':memory:');
  const owner = createUser('style@evans.test', 'x', 'Jordan', 'Evans Law Firm');
  const rival = createUser('style@rival.test', 'x', 'Rival', 'Rival LLP');
  OWNER['x-test-user'] = owner.id;
  OWNER['x-test-firm'] = owner.firm_id!;
  RIVAL['x-test-user'] = rival.id;
  RIVAL['x-test-firm'] = rival.firm_id!;

  app = Fastify({ logger: false });
  app.addHook('preHandler', async (req) => {
    (req as { userId?: string }).userId = (req.headers['x-test-user'] as string) ?? 'local-user';
    (req as { firmId?: string }).firmId = (req.headers['x-test-firm'] as string) || undefined;
  });
  registerEmploymentIntakeRoutes(app);
  await app.ready();

  saveStyleProfile({
    id: PID, firm_id: owner.firm_id!, document_type: 'mediation_brief',
    label: 'Termination on medical leave', guide_json: JSON.stringify(GUIDE),
    identifiers_json: '["Marta Kowalczyk"]', source_count: 3, source_names: '[]', cost_usd: 0.02,
  });
});

afterAll(async () => { await app.close(); });

describe('the tweak that persists', () => {
  it('reads the full guide for the editor', async () => {
    const res = await call('GET', `/api/employment/style-profiles/${PID}`, OWNER);
    expect(res.status).toBe(200);
    const profile = res.body.profile as { label: string; guide: typeof GUIDE };
    expect(profile.label).toBe('Termination on medical leave');
    expect(profile.guide.typicalWords).toBe(6500);
  });

  it('saves an edit and serves it back on the next read', async () => {
    const edited = { ...GUIDE, voice: 'Blunt, economical, and never more than six pages.', typicalWords: 7000 };
    const put = await call('PUT', `/api/employment/style-profiles/${PID}`, OWNER,
      { label: 'Medical leave terminations', guide: edited });
    expect(put.status).toBe(200);

    const back = await call('GET', `/api/employment/style-profiles/${PID}`, OWNER);
    const profile = back.body.profile as { label: string; guide: typeof GUIDE };
    expect(profile.label).toBe('Medical leave terminations');
    expect(profile.guide.voice).toContain('six pages');
    expect(profile.guide.typicalWords).toBe(7000);
  });

  it('refuses a broken edit with the reason instead of storing it', async () => {
    const res = await call('PUT', `/api/employment/style-profiles/${PID}`, OWNER,
      { label: 'x', guide: { ...GUIDE, flow: [] } });
    expect(res.status).toBe(400);
    expect(String(res.body.error)).toContain('flow');
  });
});

describe('firm tenancy', () => {
  it('another firm can neither read nor edit the profile', async () => {
    expect((await call('GET', `/api/employment/style-profiles/${PID}`, RIVAL)).status).toBe(404);
    expect((await call('PUT', `/api/employment/style-profiles/${PID}`, RIVAL,
      { label: 'stolen', guide: GUIDE })).status).toBe(404);
    // Untouched for the owner.
    const back = await call('GET', `/api/employment/style-profiles/${PID}`, OWNER);
    expect((back.body.profile as { label: string }).label).toBe('Medical leave terminations');
  });
});
