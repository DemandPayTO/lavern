/**
 * Document Review Lane routes — the partner approval queue.
 *
 * Security contract (the first deliberate cross-user surface in Starling):
 * a reviewer sees ONLY what the review row carries (document versions,
 * summary card, file number, title). No route here returns intake, notes,
 * timeline, or other documents from the underlying matter. Matter reads
 * and writes stay keyed to the SUBMITTER's user id, so database-level
 * per-user scoping is untouched; the review row is the narrow capability
 * that authorizes the approval write-back.
 *
 * Every operation is deterministic: no model calls, zero cost.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import mammoth from 'mammoth';
import { createLogger } from '../../utils/logger.js';
import { getMatterById, logAuditEvent } from '../../db/database.js';
import { htmlToDocx } from '../../employment/docx-export.js';
import {
  createReview, getReviewById, getOpenReviewForDoc, listFirmReviews, listActionableReviews,
  claimReview, approveReview, requestChanges, addVersion, resubmitReview, withdrawReview,
  currentVersion, diffParagraphs, addBusinessDays,
  type DocumentReview, type TransitionResult,
} from '../../employment/document-reviews.js';
import {
  loadEmploymentData, saveEmploymentData, findGeneratedDocKey, collectGeneratedDocuments,
} from './employment-intake.js';

const logger = createLogger('REVIEW-ROUTES');

const MAX_DOCX_B64 = 7_000_000; // ~5 MB file

/**
 * The caller's identity for the review lane.
 *
 * firmId is undefined when the account has no server-assigned firm; every
 * route here then denies. Falling back to a shared default would put
 * unrelated accounts into one queue, which is exactly the cross-tenant
 * exposure this lane must not have. LOCAL MODE supplies 'local-firm' from
 * the middleware, so single-user local development is unaffected.
 */
function identity(req: FastifyRequest): { userId: string; firmId: string | undefined } {
  const r = req as { userId?: string; firmId?: string };
  const firmId = r.firmId && r.firmId.trim() ? r.firmId : undefined;
  return { userId: r.userId ?? 'local-user', firmId };
}

const NO_FIRM = { ok: false as const, error: 'No firm is associated with this account.' };

/** Queue-safe projection: everything except the document contents. */
function toQueueRow(review: DocumentReview) {
  return {
    id: review.id,
    matterId: review.matterId,
    docType: review.docType,
    docTitle: review.docTitle,
    fileNumber: review.fileNumber,
    status: review.status,
    submitterId: review.submitterId,
    reviewerId: review.reviewerId,
    submittedAt: review.submittedAt,
    decidedAt: review.decidedAt,
    dueDate: addBusinessDays(review.submittedAt.slice(0, 10), 3),
    summary: review.summary,
    changesDescription: review.changesDescription,
    versionCount: review.versions.length,
  };
}

function sendTransition(reply: FastifyReply, result: TransitionResult) {
  if (!result.ok) return reply.status(result.code ?? 400).send({ ok: false, error: result.error });
  return reply.send({ ok: true, review: toQueueRow(result.review!) });
}

function audit(req: FastifyRequest, userId: string, action: string, reviewId: string): void {
  try {
    logAuditEvent({ userId, action, resource: `document_review:${reviewId}`, ip: req.ip, userAgent: req.headers['user-agent'] });
  } catch { /* audit must never fail the operation */ }
}

/** Write a system timeline event onto the matter, under the OWNER's id. */
async function matterTimelineEvent(ownerId: string, matterId: string, label: string, description: string): Promise<void> {
  const row = getMatterById(matterId, ownerId);
  if (!row) return;
  const { matter, employment } = loadEmploymentData(row.data_json);
  employment.timeline = [
    ...employment.timeline,
    { date: new Date().toISOString().slice(0, 10), label, description, category: 'legal' as const, source: 'system' as const },
  ].sort((a, b) => a.date.localeCompare(b.date));
  await saveEmploymentData(ownerId, matterId, matter, employment);
}

export function registerDocumentReviewRoutes(fastify: FastifyInstance): void {

  // ── POST /api/employment/:matterId/reviews — submit for approval ───────
  const submitSchema = z.object({ docType: z.string().regex(/^[a-z0-9_]{1,60}$/) });

  fastify.post('/api/employment/:matterId/reviews', async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, firmId } = identity(req);
    if (!firmId) return reply.status(403).send(NO_FIRM);
    const { matterId } = req.params as { matterId: string };
    const parsed = submitSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter } = loadEmploymentData(row.data_json);
    const key = findGeneratedDocKey(matter, parsed.data.docType);
    if (!key) return reply.status(404).send({ ok: false, error: 'No generated document of that type on this matter.' });
    const doc = matter[key] as Record<string, unknown>;
    const html = typeof doc.html === 'string' ? doc.html : '';
    if (!html) return reply.status(409).send({ ok: false, error: 'This document has no content to review.' });

    const docSummary = collectGeneratedDocuments(matter).find(d => d.docType === parsed.data.docType);
    const fileNumber = String((matter.firmFileNumber as string) || (matter.matterNumber as string) || matterId);

    const result = createReview({
      matterId, firmId, submitterId: userId,
      docType: parsed.data.docType,
      docTitle: docSummary?.title ?? parsed.data.docType.replace(/_/g, ' '),
      fileNumber,
      html,
      summary: {
        matterLabel: fileNumber,
        citationCount: Array.isArray(doc.citations) ? doc.citations.length : 0,
        reviewFlagCount: Array.isArray(doc.lawyerReviewFlags) ? doc.lawyerReviewFlags.length : 0,
        unresolvedMarkers: (html.match(/\[LAWYER/g) ?? []).length,
      },
    });
    if (!result.ok) return sendTransition(reply, result);

    audit(req, userId, 'review_submitted', result.review!.id);
    await matterTimelineEvent(userId, matterId, 'Sent for approval',
      `${result.review!.docTitle} routed to the firm approval queue.`);
    return reply.send({ ok: true, review: toQueueRow(result.review!) });
  });

  // ── GET /api/reviews — the firm queue, split for the caller ────────────
  fastify.get('/api/reviews', async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, firmId } = identity(req);
    if (!firmId) return reply.status(403).send(NO_FIRM);
    const all = listFirmReviews(firmId);
    return reply.send({
      ok: true,
      toReview: listActionableReviews(firmId, userId).map(toQueueRow),
      mine: all.filter(r => r.submitterId === userId).map(toQueueRow),
    });
  });

  // ── GET /api/reviews/:id — the one-screen approval package ────────────
  fastify.get('/api/reviews/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { firmId } = identity(req);
    if (!firmId) return reply.status(403).send(NO_FIRM);
    const { id } = req.params as { id: string };
    const review = getReviewById(id);
    if (!review || review.firmId !== firmId) return reply.status(404).send({ ok: false, error: 'Review not found' });

    const current = currentVersion(review);
    const diff = review.reviewedHtml && review.reviewedHtml !== current.html
      ? diffParagraphs(review.reviewedHtml, current.html)
      : null;
    return reply.send({
      ok: true,
      review: {
        ...toQueueRow(review),
        html: current.html,
        currentVersionKind: current.kind,
        currentVersionHasDocx: Boolean(current.docxB64),
        reviewNotes: review.reviewNotes,
        versions: review.versions.map(v => ({ at: v.at, authorId: v.authorId, kind: v.kind, filename: v.filename ?? null })),
        diff,
      },
    });
  });

  // ── Transitions ────────────────────────────────────────────────────────
  fastify.post('/api/reviews/:id/claim', async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, firmId } = identity(req);
    if (!firmId) return reply.status(403).send(NO_FIRM);
    const { id } = req.params as { id: string };
    const result = claimReview(id, firmId, userId);
    if (result.ok) audit(req, userId, 'review_claimed', id);
    return sendTransition(reply, result);
  });

  const decisionSchema = z.object({
    notes: z.string().trim().max(5000).optional(),
    changesDescription: z.string().trim().max(5000).optional(),
  });

  fastify.post('/api/reviews/:id/approve', async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, firmId } = identity(req);
    if (!firmId) return reply.status(403).send(NO_FIRM);
    const { id } = req.params as { id: string };
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const result = approveReview(id, firmId, userId, parsed.data.notes);
    if (!result.ok) return sendTransition(reply, result);
    const review = result.review!;

    // Apply the approved version back onto the matter, under the owner's id.
    const row = getMatterById(review.matterId, review.submitterId);
    if (row) {
      const { matter, employment } = loadEmploymentData(row.data_json);
      const key = findGeneratedDocKey(matter, review.docType);
      if (key) {
        const doc = matter[key] as Record<string, unknown>;
        const final = currentVersion(review);
        doc.html = final.html;
        if (final.docxB64) {
          doc.uploadedDocx = { b64: final.docxB64, filename: final.filename ?? 'approved-version.docx', at: final.at };
        }
        doc.approval = { reviewId: review.id, approvedBy: userId, approvedAt: review.decidedAt, notes: review.reviewNotes ?? null };
        if (doc.status === 'draft' || doc.status === undefined) {
          doc.status = 'reviewed';
          doc.statusDate = new Date().toISOString().slice(0, 10);
          const history = Array.isArray(doc.statusHistory) ? doc.statusHistory as Array<Record<string, unknown>> : [];
          history.push({ status: 'reviewed', date: doc.statusDate, recordedAt: new Date().toISOString(), via: 'review_lane' });
          doc.statusHistory = history.slice(-20);
        }
        const drafts = Array.isArray(matter.draftHistory) ? matter.draftHistory as Array<Record<string, unknown>> : [];
        drafts.unshift({ docType: review.docType, title: review.docTitle, html: final.html, costUsd: 0, meta: { source: 'review_approval', reviewId: review.id }, generatedAt: new Date().toISOString() });
        matter.draftHistory = drafts.slice(0, 10);
        employment.timeline = [
          ...employment.timeline,
          { date: new Date().toISOString().slice(0, 10), label: 'Approved for sending', description: `${review.docTitle} approved in the firm review queue.`, category: 'legal' as const, source: 'system' as const },
        ].sort((a, b) => a.date.localeCompare(b.date));
        await saveEmploymentData(review.submitterId, review.matterId, matter, employment);
      }
    }
    audit(req, userId, 'review_approved', id);
    return reply.send({ ok: true, review: toQueueRow(review) });
  });

  fastify.post('/api/reviews/:id/request-changes', async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, firmId } = identity(req);
    if (!firmId) return reply.status(403).send(NO_FIRM);
    const { id } = req.params as { id: string };
    const parsed = decisionSchema.safeParse(req.body ?? {});
    if (!parsed.success || !parsed.data.changesDescription) {
      return reply.status(400).send({ ok: false, error: 'Describe the changes you need.' });
    }
    const result = requestChanges(id, firmId, userId, parsed.data.changesDescription, parsed.data.notes);
    if (result.ok) {
      audit(req, userId, 'review_changes_requested', id);
      await matterTimelineEvent(result.review!.submitterId, result.review!.matterId, 'Changes requested',
        `${result.review!.docTitle}: the reviewer requested changes.`);
    }
    return sendTransition(reply, result);
  });

  // ── POST /api/reviews/:id/version — inline edit or Word re-upload ─────
  const versionSchema = z.object({
    html: z.string().max(2_000_000).optional(),
    docxBase64: z.string().max(MAX_DOCX_B64).optional(),
    filename: z.string().trim().max(300).optional(),
  }).refine(b => Boolean(b.html?.trim()) !== Boolean(b.docxBase64), {
    message: 'Provide either edited html or an uploaded Word file',
  });

  fastify.post('/api/reviews/:id/version', async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, firmId } = identity(req);
    if (!firmId) return reply.status(403).send(NO_FIRM);
    const { id } = req.params as { id: string };
    const parsed = versionSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid version upload' });

    let result: TransitionResult;
    if (parsed.data.docxBase64) {
      let html = '';
      try {
        const buffer = Buffer.from(parsed.data.docxBase64, 'base64');
        const converted = await mammoth.convertToHtml({ buffer });
        html = converted.value;
      } catch {
        return reply.status(400).send({ ok: false, error: 'Could not read that file as a Word document.' });
      }
      if (!html.trim()) return reply.status(400).send({ ok: false, error: 'The uploaded document appears to be empty.' });
      result = addVersion(id, firmId, userId, { kind: 'upload', html, docxB64: parsed.data.docxBase64, filename: parsed.data.filename });
    } else {
      result = addVersion(id, firmId, userId, { kind: 'edit', html: parsed.data.html! });
    }
    if (result.ok) audit(req, userId, 'review_version_added', id);
    return sendTransition(reply, result);
  });

  fastify.post('/api/reviews/:id/resubmit', async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, firmId } = identity(req);
    if (!firmId) return reply.status(403).send(NO_FIRM);
    const { id } = req.params as { id: string };
    const review = getReviewById(id);
    if (!review || review.firmId !== firmId) return reply.status(404).send({ ok: false, error: 'Review not found' });

    // Pull the matter's current document so a regenerated draft flows in as
    // the resubmitted version (owner-scoped read: only the submitter passes).
    let latestHtml: string | undefined;
    const row = getMatterById(review.matterId, userId);
    if (row) {
      const { matter } = loadEmploymentData(row.data_json);
      const key = findGeneratedDocKey(matter, review.docType);
      const html = key ? (matter[key] as Record<string, unknown>).html : undefined;
      if (typeof html === 'string' && html.trim()) latestHtml = html;
    }
    const result = resubmitReview(id, firmId, userId, latestHtml);
    if (result.ok) audit(req, userId, 'review_resubmitted', id);
    return sendTransition(reply, result);
  });

  fastify.delete('/api/reviews/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const { userId, firmId } = identity(req);
    if (!firmId) return reply.status(403).send(NO_FIRM);
    const { id } = req.params as { id: string };
    const result = withdrawReview(id, firmId, userId);
    if (result.ok) audit(req, userId, 'review_withdrawn', id);
    return sendTransition(reply, result);
  });

  // ── GET /api/reviews/:id/download — Word copy of the current version ──
  fastify.get('/api/reviews/:id/download', async (req: FastifyRequest, reply: FastifyReply) => {
    const { firmId } = identity(req);
    if (!firmId) return reply.status(403).send(NO_FIRM);
    const { id } = req.params as { id: string };
    const review = getReviewById(id);
    if (!review || review.firmId !== firmId) return reply.status(404).send({ ok: false, error: 'Review not found' });

    const current = currentVersion(review);
    const safeName = `${review.fileNumber}-${review.docType}`.replace(/[^\w.-]+/g, '-');
    if (current.docxB64) {
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${safeName}.docx"`)
        .send(Buffer.from(current.docxB64, 'base64'));
    }
    try {
      const buffer = await htmlToDocx(current.html, { title: review.docTitle });
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${safeName}.docx"`)
        .send(buffer);
    } catch (err) {
      logger.error('Review download failed', { reviewId: id, error: String(err) });
      return reply.status(500).send({ ok: false, error: 'Could not build the Word document.' });
    }
  });
}
