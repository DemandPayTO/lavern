# Spec — Matter Debrief (call notes → action items → docket → draft emails)

Status: DRAFT FOR JORDAN'S APPROVAL. No code written yet.
Target: Starling employment vertical, v1. Built on `feature/matter-debrief`,
tested to 3 clean passes, merged to `demandpay-config`.

## Problem

Current workflow: call with client/lawyer → deliverables with dates and
background discussed verbally → notes, deadlines, and deliverables get lost.
There is no fast path from "what we just discussed" to "it is on my calendar
and the emails are drafted."

## Solution in one line

A Debrief panel on the matter: paste notes → the system proposes a summary
and a dated action-item list → the lawyer reviews and edits → on approval,
dated items join the matter docket (and the ICS calendar feed) and any email
items are pre-drafted. Nothing reaches the calendar or an outbox without the
lawyer's approval.

## Why this is small (what already exists)

Only the notes-to-structure extraction is new. Everything downstream is reuse:

- Docket + deadlines: `src/employment/deadlines.ts`, `collectDeadlines`,
  `DeadlineItem` (already has kinds incl. `client_email`). Add an
  `action_item` kind.
- Calendar: `GET /api/employment/deadlines.ics` already emits the docket as a
  subscribable ICS feed with stable UIDs. Action items with dates appear
  automatically once they are DeadlineItems. No new calendar integration.
- Weekly digest + next-step engine: both already read `collectDeadlines`, so
  action items surface there for free.
- Email drafts: the correspondence engine (`src/employment/correspondence.ts`)
  already drafts deterministically, adds `[LAWYER: ...]` markers, and never
  sends (copy/mailto + mark-sent → timeline event).
- Review-before-apply gate: mirror the intake-approval pattern
  (merge-not-clobber, lawyer confirms).

## Data model (on the matter record, like `negotiation` / `correspondence`)

```
matter.debriefs: DebriefEntry[]

DebriefEntry {
  id: string
  createdAt: ISO
  callType: 'client' | 'opposing' | 'internal' | 'other'
  summary: string                 // lawyer-reviewed
  actionItems: ActionItem[]
  // rawNotes intentionally NOT persisted by default (privacy); optional toggle
}

ActionItem {
  id: string
  task: string
  owner: 'lawyer' | 'client' | 'other'
  dueDate?: ISO                    // optional; only dated items hit the docket
  kind: 'task' | 'email' | 'call' | 'filing' | 'document'
  context: string                 // the background/why, from the notes
  status: 'open' | 'done'
  emailDraftDocKey?: string       // set when an email draft was generated
}
```

## Backend

1. `POST /api/employment/:matterId/debrief/analyze`
   - Body: `{ rawNotes: string (<= 20k), callType }`.
   - One LLM call (sonnet tier, ~$0.02-0.05). Structured output via a strict
     Zod schema: `{ summary, actionItems: [{task, owner, dueDate?, kind,
     context}] }`. Dates parsed to ISO and validated; the model is instructed
     to leave `dueDate` null when the notes do not state one (never invent a
     date).
   - Anonymization: notes carry client detail → pass matter party names as
     `definedTerms` (same posture as every generator; rides the no-training /
     ZDR commitment). See the anonymizer note below.
   - Returns the proposed debrief WITHOUT persisting. This is the review gate:
     the lawyer edits before anything is saved.

2. `POST /api/employment/:matterId/debrief`
   - Body: the reviewed `{ summary, actionItems, callType }`.
   - Deterministic from here:
     - Append the DebriefEntry to `matter.debriefs`.
     - Each `actionItem` with a `dueDate` becomes a docket DeadlineItem
       (kind `action_item`, label = task, stable UID) → flows to ICS +
       digest + next-step engine automatically.
     - Each `actionItem` with `kind: 'email'` generates a draft via the
       correspondence engine (deterministic where possible; a light LLM draft
       only if the task requires prose), stored as a matter document with
       `[LAWYER: ...]` markers. Never sent.
     - Timeline event recorded ("Debrief captured: N action items").
   - Returns the saved debrief + created deadline ids + email draft keys.

3. `POST /api/employment/:matterId/debrief/:itemId/done` (and undo)
   - Deterministic status toggle; resolves the docket item.

No changes to `deadlines.ics` beyond the new kind flowing through
`collectDeadlines`. No new calendar integration.

## Frontend

- New "Debrief" panel on `MatterDetailView` (employment). Sections:
  1. Notes textarea + call-type selector + "Summarize" button.
  2. Review card: editable summary; action-item list with, per row, an
     editable task, owner selector, date picker (clearable), kind selector,
     context, and delete. "Add item" for anything the model missed.
  3. "Approve and schedule" → POST /debrief. Confirmation shows what landed on
     the docket and which emails were drafted (with jump links to the Client
     tab / docket).
- Approved action items also appear in the existing docket panel and
  next-steps, tagged as debrief items.

## Deterministic-first boundary (the safety story)

- LLM proposes only: summary + candidate action items + candidate dates. This
  is an inherent language task.
- The lawyer edits and approves every item. Nothing is scheduled or drafted
  from the raw model output.
- Post-approval, everything is deterministic and reproducible: date math,
  docket insertion, ICS UIDs, email templating.
- Nothing is ever sent. Emails are drafts the lawyer copies/sends manually
  (Starling core rule).

## LSO compliance

- The summary and action items are analysis of the lawyer's OWN notes for the
  lawyer's OWN use, not legal content generated for and delivered to a client.
- Email drafts pass the same human-review-before-send gate as all Starling
  correspondence. Compliant with the A2I position.

## Privacy / anonymization

- Notes are the most client-detail-heavy input in the app. They go to the LLM
  under the same posture as every generator: no-training commitment + ZDR,
  with the anonymizer as defense-in-depth.
- KNOWN GAP surfaced 2026-07-15: the Starling anonymizer leaks corporate names
  ending in punctuation ("Acme Widgets Inc.") because it uses `\b` boundaries;
  the B2C anonymizer already fixed this with lookarounds. Decision for Jordan
  (independent of this feature): fix the Starling anonymizer (10-min port),
  keep-as-is, or disable anonymization and rely on no-training/ZDR. This spec
  works under any of the three.

## Testing

- Unit: action-item Zod schema (reject invented dates, clamp counts); date
  parsing; deterministic docket wiring; ICS inclusion of `action_item` kind.
- Feature test `scripts/feature-test-debrief.ts`: create matter → post notes →
  analyze → approve → assert (a) dated items on the docket, (b) they appear in
  deadlines.ics, (c) an email item produced a draft doc, (d) no em-dashes,
  (e) the model left an undated task undated. 3 consecutive clean passes.
- Live smoke against local server; deploy to Fly after merge.

## Out of scope for v1 (noted, not built)

- Labour vertical (mirror after employment proves out).
- Dictation/audio notes (plugs into the separately-discussed transcription
  feature; this feature takes text).
- Direct Google Calendar write (ICS subscription is the robust default;
  connector write can be added later if wanted).
- A personal / non-matter task tool (this is matter-scoped; a standalone
  personal version is a separate decision).

## Effort

~2-3 days including the test loop. Branch `feature/matter-debrief` → test →
merge `demandpay-config` → `fly deploy`.
