/**
 * Unit Tests — document review lane (partner approval queue).
 *
 * The state machine ported from DemandPay's letter_reviews: claim lock,
 * transition guards, firm scoping, version rights, diff, and the docket
 * items. The queue is Starling's first cross-user surface, so the firm
 * isolation cases here are the security contract.
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { initDatabase } from '../../src/db/database.js';
import { config } from '../../src/config.js';
import {
  createReview, claimReview, approveReview, requestChanges, addVersion,
  resubmitReview, withdrawReview, getOpenReviewForDoc, getReviewById,
  listActionableReviews, reviewDeadlineItems, currentVersion,
  diffParagraphs, htmlToParagraphs, addBusinessDays,
} from '../../src/employment/document-reviews.js';

const FIRM_A = 'firm-alpha';
const FIRM_B = 'firm-beta';
const DRAFTER = 'user-drafter';
const PARTNER = 'user-partner';
const OUTSIDER = 'user-outsider';

const HTML_V1 = '<h1>DEMAND LETTER</h1><p>We demand payment of $80,000.</p><p>Respond within 14 days.</p>';
const HTML_V2 = '<h1>DEMAND LETTER</h1><p>We demand payment of $95,000.</p><p>Respond within 14 days.</p>';

function makeReview(matterId: string, docType = 'demand_letter') {
  const result = createReview({
    matterId, firmId: FIRM_A, submitterId: DRAFTER, docType,
    docTitle: 'Demand Letter', fileNumber: 'DP-2026-042', html: HTML_V1,
    summary: { matterLabel: 'DP-2026-042', citationCount: 2, reviewFlagCount: 1, unresolvedMarkers: 0 },
  });
  expect(result.ok).toBe(true);
  return result.review!;
}

beforeAll(() => {
  // The approval lane ships OFF; this suite tests the lane itself.
  config.starling = { ...(config.starling ?? {}), approvalsEnabled: true } as typeof config.starling;
  initDatabase(':memory:');
});

describe('review lifecycle', () => {
  it('submits as pending with the document as version 1', () => {
    const review = makeReview('m-lc-1');
    expect(review.status).toBe('pending');
    expect(review.versions).toHaveLength(1);
    expect(review.versions[0].kind).toBe('submitted');
    expect(getOpenReviewForDoc('m-lc-1', 'demand_letter')?.id).toBe(review.id);
  });

  it('rejects a second open review for the same document', () => {
    makeReview('m-lc-2');
    const dup = createReview({
      matterId: 'm-lc-2', firmId: FIRM_A, submitterId: DRAFTER, docType: 'demand_letter',
      docTitle: 'Demand Letter', fileNumber: 'DP-2026-042', html: HTML_V1,
      summary: { matterLabel: 'DP-2026-042', citationCount: 0, reviewFlagCount: 0, unresolvedMarkers: 0 },
    });
    expect(dup.ok).toBe(false);
    expect(dup.code).toBe(409);
  });

  it('walks the happy path: claim, request changes, revise, resubmit, approve', () => {
    const review = makeReview('m-lc-3');

    const claimed = claimReview(review.id, FIRM_A, PARTNER);
    expect(claimed.ok).toBe(true);
    expect(claimed.review!.status).toBe('in_review');
    expect(claimed.review!.reviewerId).toBe(PARTNER);

    const changes = requestChanges(review.id, FIRM_A, PARTNER, 'Raise the demand to $95,000.');
    expect(changes.ok).toBe(true);
    expect(changes.review!.status).toBe('changes_requested');
    expect(changes.review!.reviewedHtml).toBe(HTML_V1);

    const revised = addVersion(review.id, FIRM_A, DRAFTER, { kind: 'edit', html: HTML_V2 });
    expect(revised.ok).toBe(true);

    const resubmitted = resubmitReview(review.id, FIRM_A, DRAFTER);
    expect(resubmitted.ok).toBe(true);
    expect(resubmitted.review!.status).toBe('resubmitted');

    const reclaimed = claimReview(review.id, FIRM_A, PARTNER);
    expect(reclaimed.ok).toBe(true);

    const approved = approveReview(review.id, FIRM_A, PARTNER, 'Good to go.');
    expect(approved.ok).toBe(true);
    expect(approved.review!.status).toBe('approved');
    expect(currentVersion(approved.review!).html).toBe(HTML_V2);
    expect(getOpenReviewForDoc('m-lc-3', 'demand_letter')).toBeNull();
  });
});

describe('claim lock and role guards', () => {
  it('refuses the submitter claiming their own review', () => {
    const review = makeReview('m-guard-1');
    const result = claimReview(review.id, FIRM_A, DRAFTER);
    expect(result.ok).toBe(false);
    expect(result.code).toBe(403);
  });

  it('locks a claimed review to its reviewer', () => {
    const review = makeReview('m-guard-2');
    claimReview(review.id, FIRM_A, PARTNER);
    const other = claimReview(review.id, FIRM_A, OUTSIDER);
    expect(other.ok).toBe(false);
    expect(other.code).toBe(403);
  });

  it('refuses approval from anyone but the claiming reviewer, and before claiming', () => {
    const review = makeReview('m-guard-3');
    expect(approveReview(review.id, FIRM_A, PARTNER).ok).toBe(false);
    claimReview(review.id, FIRM_A, PARTNER);
    const wrong = approveReview(review.id, FIRM_A, OUTSIDER);
    expect(wrong.ok).toBe(false);
    expect(wrong.code).toBe(403);
  });

  it('requires a changes description', () => {
    const review = makeReview('m-guard-4');
    claimReview(review.id, FIRM_A, PARTNER);
    const empty = requestChanges(review.id, FIRM_A, PARTNER, '   ');
    expect(empty.ok).toBe(false);
    expect(empty.code).toBe(409);
  });

  it('grants version rights by role and state only', () => {
    const review = makeReview('m-guard-5');
    // Nobody edits a pending review.
    expect(addVersion(review.id, FIRM_A, PARTNER, { kind: 'edit', html: HTML_V2 }).ok).toBe(false);
    claimReview(review.id, FIRM_A, PARTNER);
    // Reviewer edits while in review; the submitter does not.
    expect(addVersion(review.id, FIRM_A, DRAFTER, { kind: 'edit', html: HTML_V2 }).ok).toBe(false);
    expect(addVersion(review.id, FIRM_A, PARTNER, { kind: 'upload', html: HTML_V2, docxB64: 'AAAA', filename: 'edit.docx' }).ok).toBe(true);
    requestChanges(review.id, FIRM_A, PARTNER, 'Tighten the facts.');
    // Submitter revises while changes are requested; the reviewer does not.
    expect(addVersion(review.id, FIRM_A, PARTNER, { kind: 'edit', html: HTML_V1 }).ok).toBe(false);
    expect(addVersion(review.id, FIRM_A, DRAFTER, { kind: 'edit', html: HTML_V1 }).ok).toBe(true);
  });

  it('withdraws only for the submitter, and never after approval', () => {
    const review = makeReview('m-guard-6');
    expect(withdrawReview(review.id, FIRM_A, PARTNER).ok).toBe(false);
    claimReview(review.id, FIRM_A, PARTNER);
    approveReview(review.id, FIRM_A, PARTNER);
    const late = withdrawReview(review.id, FIRM_A, DRAFTER);
    expect(late.ok).toBe(false);
    expect(late.code).toBe(409);

    const second = makeReview('m-guard-6', 'statement_of_claim');
    expect(withdrawReview(second.id, FIRM_A, DRAFTER).ok).toBe(true);
    expect(getOpenReviewForDoc('m-guard-6', 'statement_of_claim')).toBeNull();
  });
});

describe('firm isolation (the security contract)', () => {
  it('hides another firm\'s reviews from every operation', () => {
    const review = makeReview('m-iso-1');
    expect(claimReview(review.id, FIRM_B, OUTSIDER).code).toBe(404);
    expect(approveReview(review.id, FIRM_B, OUTSIDER).code).toBe(404);
    expect(requestChanges(review.id, FIRM_B, OUTSIDER, 'x').code).toBe(404);
    expect(addVersion(review.id, FIRM_B, OUTSIDER, { kind: 'edit', html: HTML_V2 }).code).toBe(404);
    expect(withdrawReview(review.id, FIRM_B, DRAFTER).code).toBe(404);
    expect(listActionableReviews(FIRM_B, OUTSIDER).find(r => r.id === review.id)).toBeUndefined();
  });

  it('excludes the submitter from their own actionable queue', () => {
    const review = makeReview('m-iso-2');
    const forPartner = listActionableReviews(FIRM_A, PARTNER).map(r => r.id);
    const forDrafter = listActionableReviews(FIRM_A, DRAFTER).map(r => r.id);
    expect(forPartner).toContain(review.id);
    expect(forDrafter).not.toContain(review.id);
  });
});

describe('docket items', () => {
  it('gives the reviewer an approve item and the submitter a revise item', () => {
    const review = makeReview('m-docket-1');
    const partnerItems = reviewDeadlineItems(FIRM_A, PARTNER);
    const approveItem = partnerItems.find(i => i.matterId === 'm-docket-1');
    expect(approveItem).toBeDefined();
    expect(approveItem!.kind).toBe('approval');
    expect(approveItem!.isCourt).toBe(false);
    // File numbers only in the label; never a client name.
    expect(approveItem!.matterLabel).toBe('DP-2026-042');

    claimReview(review.id, FIRM_A, PARTNER);
    requestChanges(review.id, FIRM_A, PARTNER, 'Shorten it.');
    const drafterItems = reviewDeadlineItems(FIRM_A, DRAFTER);
    expect(drafterItems.find(i => i.matterId === 'm-docket-1')?.label).toContain('Revise and resubmit');
  });
});

describe('diff and dates', () => {
  it('diffs paragraphs deterministically', () => {
    const diff = diffParagraphs(HTML_V1, HTML_V2);
    expect(diff.filter(s => s.type === 'removed').map(s => s.text)).toEqual(['We demand payment of $80,000.']);
    expect(diff.filter(s => s.type === 'added').map(s => s.text)).toEqual(['We demand payment of $95,000.']);
    expect(diff.filter(s => s.type === 'same')).toHaveLength(2);
  });

  it('strips markup into clean paragraphs', () => {
    expect(htmlToParagraphs('<p>One&nbsp;two</p><p><strong>Three</strong> four</p>'))
      .toEqual(['One two', 'Three four']);
  });

  it('skips weekends when computing the approval due date', () => {
    // Friday 2026-07-24 plus 3 business days lands Wednesday 2026-07-29.
    expect(addBusinessDays('2026-07-24', 3)).toBe('2026-07-29');
  });
});

describe('security regressions (2026-08-03 review)', () => {
  it('strips active content from review versions (stored XSS fix)', () => {
    const review = makeReview('m-sec-1');
    claimReview(review.id, FIRM_A, PARTNER);
    const attack = '<p>Fine text.</p><img src=x onerror="fetch(\'/api/tasks\')"><script>alert(1)</script>'
      + '<a href="javascript:alert(2)">click</a><iframe src="//evil.tld"></iframe>';
    const added = addVersion(review.id, FIRM_A, PARTNER, { kind: 'edit', html: attack });
    expect(added.ok).toBe(true);
    const stored = currentVersion(added.review!).html;
    expect(stored).toContain('Fine text.');
    for (const vector of ['onerror', '<script', '<iframe', 'javascript:']) {
      expect(stored.toLowerCase()).not.toContain(vector);
    }
  });

  it('sanitises the submitted and resubmitted versions too', () => {
    const submitted = createReview({
      matterId: 'm-sec-2', firmId: FIRM_A, submitterId: DRAFTER, docType: 'demand_letter',
      docTitle: 'Demand Letter', fileNumber: 'DP-2026-099',
      html: '<p>Body</p><script>alert(1)</script>',
      summary: { matterLabel: 'DP-2026-099', citationCount: 0, reviewFlagCount: 0, unresolvedMarkers: 0 },
    });
    expect(currentVersion(submitted.review!).html).not.toContain('<script');

    claimReview(submitted.review!.id, FIRM_A, PARTNER);
    requestChanges(submitted.review!.id, FIRM_A, PARTNER, 'Revise.');
    const re = resubmitReview(submitted.review!.id, FIRM_A, DRAFTER, '<p>New</p><img src=x onerror=alert(1)>');
    expect(currentVersion(re.review!).html).not.toContain('onerror');
  });

  it('rejects a version that is only active content', () => {
    const review = makeReview('m-sec-3');
    claimReview(review.id, FIRM_A, PARTNER);
    const result = addVersion(review.id, FIRM_A, PARTNER, { kind: 'edit', html: '<script>alert(1)</script>' });
    expect(result.ok).toBe(false);
    expect(result.code).toBe(409);
  });
});
