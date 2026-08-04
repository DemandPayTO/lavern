/**
 * Integration Tests — the approval lane can be switched off.
 *
 * A firm with one provisioned lawyer cannot use it (nobody may review their
 * own submission), and a document accidentally sent for approval would then
 * block itself from being marked sent or filed. Off is therefore the
 * default, and "off" has to mean genuinely inert: routes refuse, the docket
 * carries nothing, and the sent/filed guard cannot strand a document.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, createUser, saveMatter } from '../../src/db/database.js';
import { registerDocumentReviewRoutes } from '../../src/api/routes/document-reviews.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';
import { reviewDeadlineItems, createReview } from '../../src/employment/document-reviews.js';
import { config } from '../../src/config.js';

let app: FastifyInstance;
let userId = '';
const MID = 'm-approvals-off';

beforeAll(async () => {
  initDatabase(':memory:');
  userId = createUser('off@evans.test', 'x', 'Jordan Haworth', 'Evans Law Firm').id;
  app = Fastify({ logger: false });
  app.addHook('preHandler', async (req) => {
    (req as { userId?: string }).userId = userId;
    (req as { firmId?: string }).firmId = 'firm-off';
  });
  registerEmploymentIntakeRoutes(app);
  registerDocumentReviewRoutes(app);
  await app.ready();

  saveMatter(userId, MID, JSON.stringify({
    title: 'Off Matter',
    generatedSOC: { html: '<p>Claim.</p>', documentTitle: 'Statement of Claim', status: 'draft', generatedAt: new Date().toISOString() },
    employmentData: { intake: {}, timeline: [] },
  }));
});

afterAll(async () => { await app.close(); });

describe('with the approval lane off (the default)', () => {
  it('is off by default', () => {
    expect(config.starling?.approvalsEnabled).toBe(false);
  });

  it('refuses every approval route', async () => {
    for (const [method, url] of [
      ['GET', '/api/reviews'],
      ['POST', `/api/employment/${MID}/reviews`],
      ['POST', '/api/reviews/rev-1/claim'],
      ['POST', '/api/reviews/rev-1/approve'],
      ['GET', '/api/reviews/rev-1'],
    ] as Array<['GET' | 'POST', string]>) {
      const res = await app.inject({ method, url, payload: { docType: 'statement_of_claim' } });
      expect(res.statusCode).toBe(404);
      expect(res.json().error).toMatch(/turned off/i);
    }
  });

  it('puts nothing in the docket, tasks or calendar feed', () => {
    // Even with a review row already in the database from before it was
    // switched off, nothing surfaces.
    createReview({
      matterId: MID, firmId: 'firm-off', submitterId: 'someone-else', docType: 'statement_of_claim',
      docTitle: 'Statement of Claim', fileNumber: 'DP-2026-1', html: '<p>x</p>',
      summary: { matterLabel: 'DP-2026-1', citationCount: 0, reviewFlagCount: 0, unresolvedMarkers: 0 },
    });
    expect(reviewDeadlineItems('firm-off', userId)).toEqual([]);
  });

  it('never strands a document: sent and filed stay available', async () => {
    // A review left open before the switch was flipped must not block the
    // document forever, since there is no queue in the UI to withdraw from.
    for (const status of ['sent', 'filed']) {
      const res = await app.inject({
        method: 'POST', url: `/api/employment/${MID}/document-status`,
        payload: { docType: 'statement_of_claim', status },
      });
      expect(res.statusCode).toBe(200);
    }
  });
});
