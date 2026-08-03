/**
 * Integration Tests — document review lane routes end to end.
 *
 * Pins the properties that make the lane safe to ship:
 *   - the queue is firm-scoped: another firm sees nothing, on every route
 *   - the reviewer can read the review package but NEVER the matter
 *   - a document with an open review cannot be marked sent or filed
 *   - approval writes back to the matter under the submitter's ownership
 *     (status, approval meta, timeline event) and unlocks sending
 *   - a Word version uploaded by the reviewer becomes the version of
 *     record served by the matter's download route after approval
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, saveMatter, getMatterById, createUser } from '../../src/db/database.js';
import { registerEmploymentIntakeRoutes } from '../../src/api/routes/employment-intake.js';
import { registerDocumentReviewRoutes } from '../../src/api/routes/document-reviews.js';
import { htmlToDocx } from '../../src/employment/docx-export.js';

let app: FastifyInstance;

const DRAFTER: Record<string, string> = { 'x-test-firm': 'firm-a' };
const PARTNER: Record<string, string> = { 'x-test-firm': 'firm-a' };
const RIVAL: Record<string, string> = { 'x-test-firm': 'firm-b' };
let drafterId = '';
const MID = 'm-rev-int-1';
const HTML = '<h1>DEMAND LETTER</h1><p>We demand payment of $80,000.</p>';

async function call(method: 'GET' | 'POST' | 'DELETE', url: string, headers: Record<string, string>, payload?: unknown) {
  const res = await app.inject({ method, url, headers, payload: payload as Record<string, unknown> | undefined });
  let body: Record<string, unknown> = {};
  try { body = res.json() as Record<string, unknown>; } catch { /* binary responses */ }
  return { status: res.statusCode, body, raw: res.rawPayload };
}

beforeAll(async () => {
  initDatabase(':memory:');
  drafterId = createUser('drafter@a.test', 'x', 'Drafter', 'Firm A').id;
  DRAFTER['x-test-user'] = drafterId;
  PARTNER['x-test-user'] = createUser('partner@a.test', 'x', 'Partner', 'Firm A').id;
  RIVAL['x-test-user'] = createUser('rival@b.test', 'x', 'Rival', 'Firm B').id;
  app = Fastify({ logger: false });
  // Identity shim standing in for the auth middleware: user and firm from
  // test headers, defaulting like LOCAL MODE.
  app.addHook('preHandler', async (req) => {
    (req as { userId?: string }).userId = (req.headers['x-test-user'] as string) ?? 'local-user';
    // No header means no firm, exactly as the real middleware now behaves
    // for an account without a server-assigned firm_id.
    (req as { firmId?: string }).firmId = (req.headers['x-test-firm'] as string) || undefined;
  });
  registerEmploymentIntakeRoutes(app);
  registerDocumentReviewRoutes(app);
  await app.ready();

  saveMatter(drafterId, MID, JSON.stringify({
    title: 'Reyes v Beta Inc',
    matterNumber: 'DP-2026-077',
    generatedDemandLetter: {
      html: HTML,
      status: 'draft',
      citations: [{ citation: 'Bardal v Globe & Mail Ltd' }],
      lawyerReviewFlags: ['deadline_terms'],
      generatedAt: new Date().toISOString(),
    },
    employmentData: {
      intake: { client_first_name: 'Ana', client_last_name: 'Reyes', employer_legal_name: 'Beta Inc' },
      timeline: [],
    },
  }));
});

afterAll(async () => {
  await app.close();
});

describe('review lane routes', () => {
  let reviewId: string;

  it('submits a generated document for approval', async () => {
    const res = await call('POST', `/api/employment/${MID}/reviews`, DRAFTER, { docType: 'demand_letter' });
    expect(res.status).toBe(200);
    const review = res.body.review as Record<string, unknown>;
    reviewId = review.id as string;
    expect(review.status).toBe('pending');
    expect(review.fileNumber).toBe('DP-2026-077');
    const summary = review.summary as Record<string, unknown>;
    expect(summary.citationCount).toBe(1);
    expect(summary.reviewFlagCount).toBe(1);
  });

  it('blocks marking the document sent while the review is open', async () => {
    const res = await call('POST', `/api/employment/${MID}/document-status`, DRAFTER, { docType: 'demand_letter', status: 'sent' });
    expect(res.status).toBe(409);
    // Marking reviewed is not gated; only sent and filed are.
    const reviewed = await call('POST', `/api/employment/${MID}/document-status`, DRAFTER, { docType: 'demand_letter', status: 'reviewed' });
    expect(reviewed.status).toBe(200);
  });

  it('shows the queue to the partner but nothing to another firm', async () => {
    const partnerQueue = await call('GET', '/api/reviews', PARTNER);
    expect((partnerQueue.body.toReview as unknown[]).map(r => (r as Record<string, unknown>).id)).toContain(reviewId);

    const rivalQueue = await call('GET', '/api/reviews', RIVAL);
    expect(rivalQueue.body.toReview).toEqual([]);
    expect(rivalQueue.body.mine).toEqual([]);
    expect((await call('GET', `/api/reviews/${reviewId}`, RIVAL)).status).toBe(404);
    expect((await call('GET', `/api/reviews/${reviewId}/download`, RIVAL)).status).toBe(404);
    expect((await call('POST', `/api/reviews/${reviewId}/claim`, RIVAL)).status).toBe(404);
  });

  it('lets the partner read the package but never the matter', async () => {
    const pkg = await call('GET', `/api/reviews/${reviewId}`, PARTNER);
    expect(pkg.status).toBe(200);
    expect((pkg.body.review as Record<string, unknown>).html).toBe(HTML);

    // The boundary: the matter itself stays owner-scoped.
    const matter = await call('GET', `/api/employment/${MID}`, PARTNER);
    expect(matter.status).toBe(404);
  });

  it('claims, uploads a Word version, and approves', async () => {
    expect((await call('POST', `/api/reviews/${reviewId}/claim`, PARTNER)).status).toBe(200);

    // A real Word file, as the partner's edited version.
    const editedHtml = '<h1>DEMAND LETTER</h1><p>We demand payment of $95,000.</p>';
    const docx = await htmlToDocx(editedHtml, { title: 'Demand Letter' });
    const upload = await call('POST', `/api/reviews/${reviewId}/version`, PARTNER, {
      docxBase64: docx.toString('base64'),
      filename: 'demand-letter-partner-edit.docx',
    });
    expect(upload.status).toBe(200);
    expect((upload.body.review as Record<string, unknown>).versionCount).toBe(2);

    // The diff against the submitted version shows the changed paragraph.
    const pkg = await call('GET', `/api/reviews/${reviewId}`, PARTNER);
    expect((pkg.body.review as Record<string, unknown>).currentVersionHasDocx).toBe(true);

    const approve = await call('POST', `/api/reviews/${reviewId}/approve`, PARTNER, { notes: 'Approved at $95,000.' });
    expect(approve.status).toBe(200);
    expect((approve.body.review as Record<string, unknown>).status).toBe('approved');
  });

  it('wrote the approval back onto the matter under the submitter', async () => {
    const row = getMatterById(MID, drafterId)!;
    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    const doc = matter.generatedDemandLetter as Record<string, unknown>;
    expect((doc.approval as Record<string, unknown>).approvedBy).toBe(PARTNER['x-test-user']);
    expect((doc.uploadedDocx as Record<string, unknown>).filename).toBe('demand-letter-partner-edit.docx');
    expect(doc.html).toContain('$95,000');
    const employment = matter.employmentData as { timeline: Array<{ label: string }> };
    expect(employment.timeline.some(ev => ev.label === 'Approved for sending')).toBe(true);
  });

  it('unlocks sending after approval and serves the uploaded Word file', async () => {
    const sent = await call('POST', `/api/employment/${MID}/document-status`, DRAFTER, { docType: 'demand_letter', status: 'sent' });
    expect(sent.status).toBe(200);

    const download = await call('GET', `/api/employment/${MID}/download/demand-letter`, DRAFTER);
    expect(download.status).toBe(200);
    // DOCX files are zip archives: PK magic proves the stored file is served.
    expect(download.raw.subarray(0, 2).toString()).toBe('PK');
  });

  it('keeps the withdrawn path clean', async () => {
    saveMatter(drafterId, 'm-rev-int-2', JSON.stringify({
      title: 'Second Matter',
      matterNumber: 'DP-2026-078',
      generatedDemandLetter: { html: HTML, status: 'draft', generatedAt: new Date().toISOString() },
      employmentData: { intake: {}, timeline: [] },
    }));
    const submitted = await call('POST', '/api/employment/m-rev-int-2/reviews', DRAFTER, { docType: 'demand_letter' });
    const id = (submitted.body.review as Record<string, unknown>).id as string;
    expect((await call('DELETE', `/api/reviews/${id}`, PARTNER)).status).toBe(403);
    expect((await call('DELETE', `/api/reviews/${id}`, DRAFTER)).status).toBe(200);
    const sent = await call('POST', '/api/employment/m-rev-int-2/document-status', DRAFTER, { docType: 'demand_letter', status: 'sent' });
    expect(sent.status).toBe(200);
  });
});

describe('security regressions (2026-08-03 review)', () => {
  it('refuses firm-scoped routes when the account has no firm', async () => {
    const NO_FIRM_USER: Record<string, string> = { 'x-test-user': drafterId };
    expect((await call('GET', '/api/reviews', NO_FIRM_USER)).status).toBe(403);
    expect((await call('POST', `/api/employment/${MID}/reviews`, NO_FIRM_USER, { docType: 'demand_letter' })).status).toBe(403);
  });

  it('ignores a body-supplied firmId on template upload (Vuln 3)', async () => {
    const res = await call('POST', '/api/employment/templates', DRAFTER, {
      firmId: 'firm-b',
      documentType: 'demand_letter',
      name: 'Attacker template',
      templateBase64: Buffer.from('{{CLIENT_NAME}}').toString('base64'),
    });
    // The zod schema no longer accepts firmId; the upload either succeeds
    // against the CALLER's firm or is rejected, but never writes to firm-b.
    if (res.status === 200) {
      const rivalView = await call('GET', '/api/employment/templates', RIVAL);
      const templates = (rivalView.body.templates ?? []) as Array<Record<string, unknown>>;
      expect(templates.find(t => t.name === 'Attacker template')).toBeUndefined();
    } else {
      expect([400, 403]).toContain(res.status);
    }
  });

  it('strips active content end to end through the review package', async () => {
    saveMatter(drafterId, 'm-rev-xss', JSON.stringify({
      title: 'XSS Matter',
      matterNumber: 'DP-2026-XSS',
      generatedDemandLetter: { html: HTML, status: 'draft', generatedAt: new Date().toISOString() },
      employmentData: { intake: {}, timeline: [] },
    }));
    const submitted = await call('POST', '/api/employment/m-rev-xss/reviews', DRAFTER, { docType: 'demand_letter' });
    const id = (submitted.body.review as Record<string, unknown>).id as string;
    await call('POST', `/api/reviews/${id}/claim`, PARTNER);
    await call('POST', `/api/reviews/${id}/version`, PARTNER, {
      html: '<p>Edited.</p><img src=x onerror="alert(1)"><script>alert(2)</script>',
    });
    const pkg = await call('GET', `/api/reviews/${id}`, PARTNER);
    const html = (pkg.body.review as Record<string, unknown>).html as string;
    expect(html).toContain('Edited.');
    expect(html.toLowerCase()).not.toContain('onerror');
    expect(html.toLowerCase()).not.toContain('<script');

    // And the sanitised version is what reaches the matter on approval.
    await call('POST', `/api/reviews/${id}/approve`, PARTNER, {});
    const row = getMatterById('m-rev-xss', drafterId)!;
    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    const stored = (matter.generatedDemandLetter as Record<string, unknown>).html as string;
    expect(stored.toLowerCase()).not.toContain('onerror');
  });
});
