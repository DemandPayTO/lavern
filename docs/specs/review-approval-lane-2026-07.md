# Review and Approval Lane — Spec (approved 2026-07-31, built same day)

Jordan's bottleneck: drafts (demand letters, SOCs, notices of application,
notices of arbitration) go to the client by email, then to the main partner
for approval, where they sit. The lane replaces the partner leg with an
in-product queue, porting DemandPay's proven `letter_reviews` design
(statuses, claim lock, transition guards) onto Starling's stack.

Decisions from Jordan: partner may edit the document in the review screen
AND download the Word version, then re-upload it as a new version; queue
visibility is firm-wide (the less-code option; no approver targeting).
Email nudge ships dark behind `STARLING_REVIEW_EMAILS_ENABLED` (not yet
implemented; in-app queue, tasks, docket, and calendar feed cover alerting
for v1).

## State machine (ported from letter_reviews)

`pending → in_review → approved | changes_requested`;
`changes_requested → resubmitted → in_review → ...`; submitter may withdraw
any time before approval. Guards: a reviewer must claim before acting; a
claimed review is locked to that reviewer; nobody reviews their own
submission; changes require a description. New rule Starling adds: a
document with an open review cannot be marked sent or filed.

## Data model

One table, `document_reviews` (src/db/database.ts): review id, matter id,
firm id, submitter, reviewer (null until claimed), doc type/title, file
number, status, versions (JSON, capped 8: submitted / edit / upload /
resubmitted, each with html and optionally the original DOCX base64),
summary card JSON, reviewed_html (diff base: what the reviewer last acted
on), reviewer notes (internal), changes description (shown to submitter),
timestamps. Existing document lifecycle statuses are untouched; the review
state is a parallel additive layer.

## Security contract

The queue is Starling's first deliberate cross-user surface. A reviewer
sees ONLY what the review row carries; no review route returns intake,
notes, timeline, or other documents. Matter reads and writes stay keyed to
the submitter's user id (the review row is the capability that authorizes
the approval write-back). Every route firm-scoped; every transition audit
logged; feed and task labels carry file numbers only. Integration tests pin:
rival firm sees nothing on any route; the reviewer cannot fetch the matter.

## Surfaces

- `src/employment/document-reviews.ts` — domain: state machine, versions,
  paragraph LCS diff, business-day due dates, docket items.
- `src/api/routes/document-reviews.ts` — submit, queue, package (with
  diff), claim, approve, request changes, add version (inline edit or DOCX
  upload via mammoth), resubmit, withdraw, Word download.
- `employment-intake.ts` — sent/filed guard; matter download route serves a
  reviewer-uploaded DOCX as the version of record after approval.
- Tasks + calendar feed — approval items (due 3 business days after
  submission) for reviewers, revise items for submitters.
- `viz` — ApprovalsView (#/approvals: queue, package, diff, actions),
  Approvals nav link on dashboard/tasks/files views, ReviewLaneControls on
  the matter Draft tab (send for approval, feedback, resubmit, withdraw).

## Out of scope v1

Client review portal (next build; reuses the portal-token pattern), email
nudge implementation, full matter co-counsel or oversight, DOCX redline
export, labour vertical UI wiring.

## Tests

tests/unit/document-reviews.test.ts (state machine truth table, firm
isolation, version rights, diff, business days) and
tests/integration/document-reviews-routes.test.ts (route scoping, the
matter boundary, sent/filed guard, upload-approve-download round trip).
