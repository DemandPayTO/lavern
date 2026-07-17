/**
 * Integration Test — digest feature disable switch.
 *
 * With STARLING_DIGEST_ENABLED off (the pilot default), the admin HTTP send
 * route POST /api/starling/digest must not exist (404) even with a correct
 * admin key, so a firm-wide docket can never be directed to an arbitrary
 * recipient. The GET /api/starling/status endpoint (used by the dashboard)
 * must keep working.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify, { type FastifyInstance } from 'fastify';
import { initDatabase } from '../../src/db/database.js';
import { registerStarlingDigestRoutes } from '../../src/api/routes/starling-digest.js';
import { config } from '../../src/config.js';

describe('digest disabled (pilot default)', () => {
  let app: FastifyInstance;
  const prevEnabled = config.starling.digestEnabled;

  beforeAll(async () => {
    initDatabase(':memory:');
    // Force the pilot default regardless of the runner's environment.
    (config.starling as { digestEnabled: boolean }).digestEnabled = false;
    app = Fastify({ logger: false });
    // A minimal auth shim so GET status has a userId (LOCAL MODE behaviour).
    app.addHook('preHandler', async (req) => { (req as { userId?: string }).userId = 'local-user'; });
    registerStarlingDigestRoutes(app);
    await app.ready();
  });

  afterAll(async () => {
    (config.starling as { digestEnabled: boolean }).digestEnabled = prevEnabled;
    await app.close();
  });

  it('POST /api/starling/digest is 404 even with an admin key', async () => {
    const res = await app.inject({
      method: 'POST',
      url: '/api/starling/digest?email=attacker@evil.test',
      headers: { 'x-admin-key': 'any-key-should-not-matter' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('POST /api/starling/digest is 404 without a key too', async () => {
    const res = await app.inject({ method: 'POST', url: '/api/starling/digest?email=x@y.test' });
    expect(res.statusCode).toBe(404);
  });

  it('GET /api/starling/status still works (dashboard dependency)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/starling/status' });
    expect(res.statusCode).toBe(200);
    const body = JSON.parse(res.body);
    expect(body.ok).toBe(true);
    expect(Array.isArray(body.matters)).toBe(true);
  });
});
