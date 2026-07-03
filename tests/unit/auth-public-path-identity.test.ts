/**
 * Regression Test — identity attachment on public paths.
 *
 * Public paths (e.g. DELETE /api/sessions/* for the QuickStart flow) skip
 * auth ENFORCEMENT, but must still attach the caller's identity when a
 * valid cookie is presented: routes under public wildcards run their own
 * checkSessionOwnership(), which needs request.userId.
 *
 * The original bug: the middleware returned early on public paths without
 * parsing the cookie, so authenticated users could not cancel their own
 * sessions — ownership saw session.userId set but request.userId undefined
 * and returned 404. Found by the 50-user load test.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { createAuthMiddleware, ClientRegistry } from '../../src/api/middleware/auth.js';
import { initDatabase, createUser, createAuthToken } from '../../src/db/database.js';
import { config } from '../../src/config.js';
import type { FastifyRequest, FastifyReply } from 'fastify';

let token: string;
let userId: string;

function fakeRequest(method: string, url: string, cookie?: string): FastifyRequest {
  return {
    method,
    url,
    headers: cookie ? { cookie } : {},
  } as unknown as FastifyRequest;
}

function fakeReply() {
  const state = { statusCode: 0, body: undefined as unknown };
  const reply = {
    status(code: number) { state.statusCode = code; return reply; },
    send(body: unknown) { state.body = body; return reply; },
  };
  return { reply: reply as unknown as FastifyReply, state };
}

beforeAll(() => {
  initDatabase(':memory:');
  (config as { authEnabled: boolean }).authEnabled = true;
  const user = createUser('public-path@example.com', 'hash', 'Public Path', 'Test Firm');
  userId = user.id;
  token = createAuthToken(user.id);
});

describe('auth middleware — public path identity attachment', () => {
  const middleware = createAuthMiddleware(new ClientRegistry(), [
    '/health',
    'DELETE /api/sessions/*',
    'GET /api/sessions/*',
  ]);

  it('attaches userId on a public path when a valid cookie is present', async () => {
    const req = fakeRequest('DELETE', '/api/sessions/shem-abc123', `starling_token=${token}`);
    const { reply, state } = fakeReply();
    await middleware(req, reply);
    expect((req as { userId?: string }).userId).toBe(userId);
    expect(state.statusCode).toBe(0); // no 401
  });

  it('allows anonymous callers on public paths (no 401, no identity)', async () => {
    const req = fakeRequest('GET', '/api/sessions/shem-abc123');
    const { reply, state } = fakeReply();
    await middleware(req, reply);
    expect((req as { userId?: string }).userId).toBeUndefined();
    expect(state.statusCode).toBe(0);
  });

  it('ignores an invalid cookie on public paths without rejecting', async () => {
    const req = fakeRequest('DELETE', '/api/sessions/shem-abc123', 'starling_token=not-a-real-token');
    const { reply, state } = fakeReply();
    await middleware(req, reply);
    expect((req as { userId?: string }).userId).toBeUndefined();
    expect(state.statusCode).toBe(0);
  });

  it('still 401s protected paths without credentials', async () => {
    const req = fakeRequest('POST', '/api/replay/something');
    const { reply, state } = fakeReply();
    await middleware(req, reply);
    expect(state.statusCode).toBe(401);
  });

  it('accepts the legacy lavern_token cookie name on public paths', async () => {
    const req = fakeRequest('DELETE', '/api/sessions/shem-abc123', `lavern_token=${token}`);
    const { reply, state } = fakeReply();
    await middleware(req, reply);
    expect((req as { userId?: string }).userId).toBe(userId);
  });
});
