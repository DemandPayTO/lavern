/**
 * Integration Tests — firm collaboration on a shared matter (2026-08-04).
 *
 * Two lawyers at the same firm work one file. The properties pinned here:
 *   - a colleague reads the matter and its employment data end to end
 *   - the stale-write guard fires ONLY for a colleague's newer save; a
 *     lawyer's own quick writes never 409 their own edits
 *   - attribution flows through the API (openedBy, openedByMe, who wrote
 *     last), and a rival firm still sees nothing
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, saveMatter, createUser } from '../../src/db/database.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';

let app: FastifyInstance;

const OPENER: Record<string, string> = {};
const COLLEAGUE: Record<string, string> = {};
const RIVAL: Record<string, string> = {};
const MID = 'm-collab-1';

async function call(method: 'GET' | 'POST', url: string, headers: Record<string, string>, payload?: unknown) {
  const res = await app.inject({ method, url, headers, payload: payload as Record<string, unknown> | undefined });
  return { status: res.statusCode, body: res.json() as Record<string, unknown> };
}

beforeAll(async () => {
  initDatabase(':memory:');
  const opener = createUser('opener@evans.test', 'x', 'Jordan Haworth', 'Evans Law Firm');
  OPENER['x-test-user'] = opener.id;
  COLLEAGUE['x-test-user'] = createUser('partner@evans.test', 'x', 'Sam Partner', 'Evans Law Firm', opener.firm_id).id;
  RIVAL['x-test-user'] = createUser('rival@other.test', 'x', 'Rival', 'Other LLP').id;

  app = Fastify({ logger: false });
  app.addHook('preHandler', async (req) => {
    (req as { userId?: string }).userId = (req.headers['x-test-user'] as string) ?? 'local-user';
  });
  registerEmploymentIntakeRoutes(app);
  await app.ready();

  saveMatter(opener.id, MID, JSON.stringify({
    title: 'Osei v Brightpath',
    matterNumber: 'DP-2026-090',
    lawyerNotes: 'Call the client Tuesday.',
  }), 'active');
});

afterAll(async () => { await app.close(); });

describe('a colleague works the shared file', () => {
  it('reads the matter with attribution', async () => {
    const res = await call('GET', `/api/employment/${MID}`, COLLEAGUE);
    expect(res.status).toBe(200);
    expect(res.body.lawyerNotes).toBe('Call the client Tuesday.');
    expect(res.body.openedBy).toBe('Jordan Haworth');
    expect(res.body.openedByMe).toBe(false);
    expect(typeof res.body.updatedAt).toBe('string');
  });

  it('shows the opener their own file without a colleague label', async () => {
    const res = await call('GET', `/api/employment/${MID}`, OPENER);
    expect(res.body.openedByMe).toBe(true);
  });

  it('still shows a rival firm nothing', async () => {
    const res = await call('GET', `/api/employment/${MID}`, RIVAL);
    expect(res.status).toBe(404);
  });
});

describe('the stale-write guard', () => {
  it('refuses to overwrite a colleague’s newer save, naming them', async () => {
    // The opener loads the file, then the colleague saves.
    const loaded = await call('GET', `/api/employment/${MID}`, OPENER);
    const staleStamp = loaded.body.updatedAt as string;

    const colleagueSave = await call('POST', `/api/employment/${MID}/notes`, COLLEAGUE,
      { notes: 'Employer counsel called; offer coming Friday.' });
    expect(colleagueSave.status).toBe(200);

    // The opener saves on top of the stale load: refused, with the name.
    const staleWrite = await call('POST', `/api/employment/${MID}/notes`, OPENER,
      { notes: 'Call the client Tuesday. Draft the reply.', ifUpdatedAt: staleStamp });
    expect(staleWrite.status).toBe(409);
    expect(String(staleWrite.body.error)).toContain('Sam Partner');

    // The colleague's words survived.
    const after = await call('GET', `/api/employment/${MID}`, OPENER);
    expect(after.body.lawyerNotes).toContain('offer coming Friday');
  });

  it('never fires against the lawyer’s own writes', async () => {
    // The colleague loads, makes another quick write (bumping updated_at),
    // then saves notes with the now-stale stamp. Their own intervening
    // write must not block them.
    const loaded = await call('GET', `/api/employment/${MID}`, COLLEAGUE);
    const staleStamp = loaded.body.updatedAt as string;

    await call('POST', `/api/employment/${MID}/file-number`, COLLEAGUE, { firmFileNumber: 'EV-1044' });

    const save = await call('POST', `/api/employment/${MID}/notes`, COLLEAGUE,
      { notes: 'Reviewed the offer.', ifUpdatedAt: staleStamp });
    expect(save.status).toBe(200);
  });

  it('accepts a fresh save after reload', async () => {
    const reloaded = await call('GET', `/api/employment/${MID}`, OPENER);
    const save = await call('POST', `/api/employment/${MID}/notes`, OPENER,
      { notes: 'Merged: reply drafted, offer expected Friday.', ifUpdatedAt: reloaded.body.updatedAt as string });
    expect(save.status).toBe(200);
  });
});
