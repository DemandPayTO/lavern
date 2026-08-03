/**
 * Document Review Lane — partner approval queue for generated documents.
 *
 * Ported from DemandPay's letter_reviews design: a submitter routes a
 * generated document for approval; a colleague at the same firm claims it,
 * then approves or requests changes; the submitter revises and resubmits.
 * The claim locks the review to one reviewer, and every transition is
 * guarded (the same discipline as the B2C flow).
 *
 * Tenancy: the review row carries everything the reviewer may see (document
 * versions, summary card, file number). Reviewer access NEVER reaches the
 * underlying matter; matter mutations on approval are performed by the
 * routes under the SUBMITTER's user id, so per-user matter scoping in the
 * database stays intact.
 *
 * All review operations are deterministic: no model calls, zero cost.
 */

import { randomUUID } from 'node:crypto';
import { getDb } from '../db/database.js';
import { createLogger } from '../utils/logger.js';
import { priorityBand, type DeadlineItem } from './deadlines.js';

const logger = createLogger('DOC-REVIEWS');

// ── Types ────────────────────────────────────────────────────────────────

export const REVIEW_STATUSES = ['pending', 'in_review', 'changes_requested', 'resubmitted', 'approved', 'withdrawn'] as const;
export type ReviewStatus = typeof REVIEW_STATUSES[number];

/** Statuses in which a review still blocks the document from being sent. */
export const OPEN_STATUSES: ReviewStatus[] = ['pending', 'in_review', 'changes_requested', 'resubmitted'];

export type VersionKind = 'submitted' | 'edit' | 'upload' | 'resubmitted';

export interface ReviewVersion {
  at: string;
  authorId: string;
  kind: VersionKind;
  html: string;
  /** Original uploaded Word file, when this version came from an upload. */
  docxB64?: string;
  filename?: string;
}

export interface ReviewSummary {
  matterLabel: string;
  damagesRange?: string;
  citationCount: number;
  reviewFlagCount: number;
  /** Count of unresolved [LAWYER: ...] markers in the submitted version. */
  unresolvedMarkers: number;
}

export interface DocumentReview {
  id: string;
  matterId: string;
  firmId: string;
  submitterId: string;
  reviewerId: string | null;
  docType: string;
  docTitle: string;
  fileNumber: string;
  status: ReviewStatus;
  versions: ReviewVersion[];
  summary: ReviewSummary;
  reviewedHtml: string | null;
  reviewNotes: string | null;
  changesDescription: string | null;
  submittedAt: string;
  claimedAt: string | null;
  decidedAt: string | null;
}

export interface TransitionResult {
  ok: boolean;
  /** HTTP-ish status for the route to relay: 403 forbidden, 409 wrong state. */
  code?: 403 | 404 | 409;
  error?: string;
  review?: DocumentReview;
}

const VERSION_CAP = 8;

// ── Row mapping ──────────────────────────────────────────────────────────

interface ReviewRow {
  id: string;
  matter_id: string;
  firm_id: string;
  submitter_id: string;
  reviewer_id: string | null;
  doc_type: string;
  doc_title: string;
  file_number: string;
  status: string;
  versions_json: string;
  summary_json: string;
  reviewed_html: string | null;
  review_notes: string | null;
  changes_description: string | null;
  submitted_at: string;
  claimed_at: string | null;
  decided_at: string | null;
}

function fromRow(row: ReviewRow): DocumentReview {
  let versions: ReviewVersion[] = [];
  let summary: ReviewSummary = { matterLabel: '', citationCount: 0, reviewFlagCount: 0, unresolvedMarkers: 0 };
  try { versions = JSON.parse(row.versions_json) as ReviewVersion[]; } catch { /* corrupted json reads as empty */ }
  try { summary = { ...summary, ...(JSON.parse(row.summary_json) as ReviewSummary) }; } catch { /* keep defaults */ }
  return {
    id: row.id,
    matterId: row.matter_id,
    firmId: row.firm_id,
    submitterId: row.submitter_id,
    reviewerId: row.reviewer_id,
    docType: row.doc_type,
    docTitle: row.doc_title,
    fileNumber: row.file_number,
    status: row.status as ReviewStatus,
    versions,
    summary,
    reviewedHtml: row.reviewed_html,
    reviewNotes: row.review_notes,
    changesDescription: row.changes_description,
    submittedAt: row.submitted_at,
    claimedAt: row.claimed_at,
    decidedAt: row.decided_at,
  };
}

function persist(review: DocumentReview): void {
  const now = new Date().toISOString();
  getDb().prepare(`
    UPDATE document_reviews SET
      reviewer_id = ?, status = ?, versions_json = ?, reviewed_html = ?,
      review_notes = ?, changes_description = ?, claimed_at = ?, decided_at = ?, updated_at = ?
    WHERE id = ?
  `).run(
    review.reviewerId, review.status, JSON.stringify(review.versions), review.reviewedHtml,
    review.reviewNotes, review.changesDescription, review.claimedAt, review.decidedAt, now, review.id,
  );
}

// ── Queries ──────────────────────────────────────────────────────────────

export function getReviewById(id: string): DocumentReview | null {
  const row = getDb().prepare('SELECT * FROM document_reviews WHERE id = ?').get(id) as ReviewRow | undefined;
  return row ? fromRow(row) : null;
}

export function getOpenReviewForDoc(matterId: string, docType: string): DocumentReview | null {
  const row = getDb().prepare(`
    SELECT * FROM document_reviews
    WHERE matter_id = ? AND doc_type = ? AND status IN (${OPEN_STATUSES.map(() => '?').join(',')})
    ORDER BY submitted_at DESC LIMIT 1
  `).get(matterId, docType, ...OPEN_STATUSES) as ReviewRow | undefined;
  return row ? fromRow(row) : null;
}

/** Every review at the firm that is not withdrawn, newest first. */
export function listFirmReviews(firmId: string): DocumentReview[] {
  const rows = getDb().prepare(`
    SELECT * FROM document_reviews WHERE firm_id = ? AND status != 'withdrawn'
    ORDER BY submitted_at DESC LIMIT 200
  `).all(firmId) as ReviewRow[];
  return rows.map(fromRow);
}

/** Open reviews awaiting someone other than the given user (their approval queue). */
export function listActionableReviews(firmId: string, userId: string): DocumentReview[] {
  return listFirmReviews(firmId).filter(r =>
    (r.status === 'pending' || r.status === 'resubmitted') && r.submitterId !== userId
    || (r.status === 'in_review' && r.reviewerId === userId));
}

// ── Transitions ──────────────────────────────────────────────────────────

export function createReview(args: {
  matterId: string; firmId: string; submitterId: string; docType: string;
  docTitle: string; fileNumber: string; html: string; summary: ReviewSummary;
}): TransitionResult {
  if (getOpenReviewForDoc(args.matterId, args.docType)) {
    return { ok: false, code: 409, error: 'This document already has an open review.' };
  }
  const now = new Date().toISOString();
  const review: DocumentReview = {
    id: `rev-${randomUUID().slice(0, 18)}`,
    matterId: args.matterId,
    firmId: args.firmId,
    submitterId: args.submitterId,
    reviewerId: null,
    docType: args.docType,
    docTitle: args.docTitle,
    fileNumber: args.fileNumber,
    status: 'pending',
    versions: [{ at: now, authorId: args.submitterId, kind: 'submitted', html: args.html }],
    summary: args.summary,
    reviewedHtml: null,
    reviewNotes: null,
    changesDescription: null,
    submittedAt: now,
    claimedAt: null,
    decidedAt: null,
  };
  getDb().prepare(`
    INSERT INTO document_reviews (id, matter_id, firm_id, submitter_id, reviewer_id, doc_type, doc_title,
      file_number, status, versions_json, summary_json, submitted_at, created_at, updated_at)
    VALUES (?, ?, ?, ?, NULL, ?, ?, ?, 'pending', ?, ?, ?, ?, ?)
  `).run(
    review.id, review.matterId, review.firmId, review.submitterId, review.docType, review.docTitle,
    review.fileNumber, JSON.stringify(review.versions), JSON.stringify(review.summary),
    now, now, now,
  );
  logger.info('Review submitted', { reviewId: review.id, matterId: args.matterId, docType: args.docType });
  return { ok: true, review };
}

function loadForFirmUser(id: string, firmId: string): DocumentReview | TransitionResult {
  const review = getReviewById(id);
  if (!review || review.firmId !== firmId) return { ok: false, code: 404, error: 'Review not found.' };
  return review;
}

export function claimReview(id: string, firmId: string, userId: string): TransitionResult {
  const loaded = loadForFirmUser(id, firmId);
  if ('ok' in loaded) return loaded;
  const review = loaded;
  if (review.submitterId === userId) return { ok: false, code: 403, error: 'You cannot review your own submission.' };
  if (review.reviewerId && review.reviewerId !== userId) return { ok: false, code: 403, error: 'This review is claimed by another reviewer.' };
  if (review.status !== 'pending' && review.status !== 'resubmitted') {
    return { ok: false, code: 409, error: 'Only a pending or resubmitted review can be claimed.' };
  }
  review.reviewerId = userId;
  review.status = 'in_review';
  review.claimedAt = new Date().toISOString();
  persist(review);
  return { ok: true, review };
}

export function approveReview(id: string, firmId: string, userId: string, notes?: string): TransitionResult {
  const loaded = loadForFirmUser(id, firmId);
  if ('ok' in loaded) return loaded;
  const review = loaded;
  if (review.reviewerId !== userId) return { ok: false, code: 403, error: 'Only the claiming reviewer can approve.' };
  if (review.status !== 'in_review') return { ok: false, code: 409, error: 'A review must be in review to approve.' };
  review.status = 'approved';
  review.reviewNotes = notes?.trim() || review.reviewNotes;
  review.decidedAt = new Date().toISOString();
  review.reviewedHtml = currentVersion(review).html;
  persist(review);
  logger.info('Review approved', { reviewId: id });
  return { ok: true, review };
}

export function requestChanges(id: string, firmId: string, userId: string, changesDescription: string, notes?: string): TransitionResult {
  const loaded = loadForFirmUser(id, firmId);
  if ('ok' in loaded) return loaded;
  const review = loaded;
  if (review.reviewerId !== userId) return { ok: false, code: 403, error: 'Only the claiming reviewer can request changes.' };
  if (review.status !== 'in_review') return { ok: false, code: 409, error: 'A review must be in review to request changes.' };
  if (!changesDescription.trim()) return { ok: false, code: 409, error: 'Describe the changes you need.' };
  review.status = 'changes_requested';
  review.changesDescription = changesDescription.trim();
  review.reviewNotes = notes?.trim() || review.reviewNotes;
  review.reviewedHtml = currentVersion(review).html;
  review.decidedAt = new Date().toISOString();
  persist(review);
  return { ok: true, review };
}

/** Reviewer edits or uploads while in review; submitter revises while changes are requested. */
export function addVersion(id: string, firmId: string, userId: string, version: Omit<ReviewVersion, 'at' | 'authorId'>): TransitionResult {
  const loaded = loadForFirmUser(id, firmId);
  if ('ok' in loaded) return loaded;
  const review = loaded;
  const reviewerActing = review.reviewerId === userId && review.status === 'in_review';
  const submitterActing = review.submitterId === userId && review.status === 'changes_requested';
  if (!reviewerActing && !submitterActing) {
    return { ok: false, code: 403, error: 'Versions can be added by the reviewer while in review, or by the submitter while changes are requested.' };
  }
  if (!version.html.trim()) return { ok: false, code: 409, error: 'The new version is empty.' };
  review.versions.push({ ...version, at: new Date().toISOString(), authorId: userId });
  review.versions = review.versions.slice(-VERSION_CAP);
  persist(review);
  return { ok: true, review };
}

export function resubmitReview(id: string, firmId: string, userId: string, html?: string): TransitionResult {
  const loaded = loadForFirmUser(id, firmId);
  if ('ok' in loaded) return loaded;
  const review = loaded;
  if (review.submitterId !== userId) return { ok: false, code: 403, error: 'Only the submitter can resubmit.' };
  if (review.status !== 'changes_requested') return { ok: false, code: 409, error: 'Only a review with changes requested can be resubmitted.' };
  const now = new Date().toISOString();
  if (html && html.trim() && html !== currentVersion(review).html) {
    review.versions.push({ at: now, authorId: userId, kind: 'resubmitted', html });
    review.versions = review.versions.slice(-VERSION_CAP);
  }
  review.status = 'resubmitted';
  persist(review);
  return { ok: true, review };
}

export function withdrawReview(id: string, firmId: string, userId: string): TransitionResult {
  const loaded = loadForFirmUser(id, firmId);
  if ('ok' in loaded) return loaded;
  const review = loaded;
  if (review.submitterId !== userId) return { ok: false, code: 403, error: 'Only the submitter can withdraw.' };
  if (review.status === 'approved') return { ok: false, code: 409, error: 'An approved review cannot be withdrawn.' };
  review.status = 'withdrawn';
  review.decidedAt = new Date().toISOString();
  persist(review);
  return { ok: true, review };
}

export function currentVersion(review: DocumentReview): ReviewVersion {
  return review.versions[review.versions.length - 1];
}

// ── Docket integration ───────────────────────────────────────────────────

/** Approval items for a user's docket, tasks list, and calendar feed:
 *  reviews awaiting their action, plus their own submissions needing
 *  revision. Labels carry file numbers only (feed discipline). */
export function reviewDeadlineItems(firmId: string, userId: string): DeadlineItem[] {
  const out: DeadlineItem[] = [];
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const push = (r: DocumentReview, label: string, dueDate: string) => {
    const days = Math.round((new Date(`${dueDate}T00:00:00`).getTime() - today.getTime()) / 86_400_000);
    out.push({
      matterId: r.matterId,
      matterLabel: r.fileNumber,
      date: dueDate,
      label,
      daysRemaining: days,
      urgency: days < 0 ? 'overdue' : days <= 14 ? 'critical' : days <= 45 ? 'soon' : 'upcoming',
      band: priorityBand(false, days),
      isCourt: false,
      kind: 'approval',
    });
  };
  for (const r of listActionableReviews(firmId, userId)) {
    push(r, `Approve: ${r.docTitle} (${r.fileNumber})`, addBusinessDays(r.submittedAt.slice(0, 10), 3));
  }
  for (const r of listFirmReviews(firmId)) {
    if (r.submitterId === userId && r.status === 'changes_requested') {
      push(r, `Revise and resubmit: ${r.docTitle} (${r.fileNumber})`, addBusinessDays((r.decidedAt ?? r.submittedAt).slice(0, 10), 3));
    }
  }
  return out;
}

/** The approval "due date": N business days after submission (the aging
 *  threshold that escalates a sitting review into the docket and feed). */
export function addBusinessDays(isoDate: string, days: number): string {
  const d = new Date(`${isoDate}T00:00:00`);
  let remaining = days;
  while (remaining > 0) {
    d.setDate(d.getDate() + 1);
    const day = d.getDay();
    if (day !== 0 && day !== 6) remaining--;
  }
  return d.toISOString().slice(0, 10);
}

// ── Diff ─────────────────────────────────────────────────────────────────

export interface DiffSegment {
  type: 'same' | 'added' | 'removed';
  text: string;
}

/** Strip markup into trimmed paragraphs for diffing. */
export function htmlToParagraphs(html: string): string[] {
  return html
    .replace(/<(li|p|h1|h2|h3|tr|br)[^>]*>/gi, '\n')
    .replace(/<[^>]+>/g, ' ')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>')
    .replace(/&#?\w+;/g, ' ')
    .split('\n')
    .map(p => p.replace(/\s+/g, ' ').trim())
    .filter(Boolean);
}

/** Paragraph-level LCS diff: what changed between the version the reviewer
 *  last acted on and the current version. Deterministic, no dependencies. */
export function diffParagraphs(beforeHtml: string, afterHtml: string): DiffSegment[] {
  const a = htmlToParagraphs(beforeHtml);
  const b = htmlToParagraphs(afterHtml);
  const m = a.length, n = b.length;
  // LCS table (paragraph counts are small: bounded by document length)
  const lcs: number[][] = Array.from({ length: m + 1 }, () => new Array<number>(n + 1).fill(0));
  for (let i = m - 1; i >= 0; i--) {
    for (let j = n - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  const out: DiffSegment[] = [];
  let i = 0, j = 0;
  while (i < m && j < n) {
    if (a[i] === b[j]) { out.push({ type: 'same', text: a[i] }); i++; j++; }
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) { out.push({ type: 'removed', text: a[i] }); i++; }
    else { out.push({ type: 'added', text: b[j] }); j++; }
  }
  while (i < m) { out.push({ type: 'removed', text: a[i] }); i++; }
  while (j < n) { out.push({ type: 'added', text: b[j] }); j++; }
  return out;
}
