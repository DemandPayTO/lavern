# Spec — Unified Task Inbox ("Tasks" tab)

**Status:** drafted 2026-07-20 for Jordan's approval. Spec-first; no code until signed off.
**Problem:** tasks live per matter (debrief action items) and deadlines live in the docket. To see everything owed, the lawyer walks every file. Calls and emails generate to-dos that get hand-organized. This does not scale past a handful of matters.

## Goal

One dedicated **Tasks** tab that aggregates every open item across every matter the lawyer owns, sorted by when it is due, that updates itself as things go overdue, feeds one subscribable calendar, and keeps the dashboard uncluttered.

## Principles (inherited, non-negotiable)

- **Deterministic.** No LLM in the inbox. It reads and aggregates existing stored state. (The LLM already ran once, at debrief time, to propose the items.)
- **Per-user tenant scoping.** Every query is `getMattersByUser(userId)`. A lawyer sees only their own matters' tasks.
- **The lawyer decides.** The inbox never sends, files, or auto-completes anything. Overdue is surfaced, not actioned.
- **Red stays sacred.** Court-imposed hard deadlines (limitation, SOD/SOC, mediation brief, settlement conference) are the only red. Action items are neutral tasks. Same colour language as the dashboard triage.

## What already exists (reused, not rebuilt)

- **Action items** (`src/employment/debrief.ts`): `ActionItem { id, title, kind (task|email|call|filing|document), dueDate, status (open|done) }`, stored on `matter.debriefs`. `openDatedActionItems()` already filters open + dated.
- **Deadlines** (`src/employment/deadlines.ts`): `DeadlineItem { label, dueDate, band (critical|attention|planned), isCourt }`.
- **Calendar** (`src/employment/docket-ics.ts`): `buildDocketIcs(items)` emits VEVENTs; already has an `action_item` label. Today it is fed per matter.
- **Cross-matter pattern**: `getMattersByUser(userId)` (used by the matter list and usage rollup).

## What is new (the actual build)

### 1. Backend — aggregation

- **`GET /api/tasks`** — returns every open item across the user's matters, from two sources:
  1. Debrief action items (`open` status) from each matter's `matter.debriefs`.
  2. Docket deadlines from each matter (the same computation the matter view uses).
  Each row is normalized to a `TaskRow`:
  ```
  TaskRow {
    id, matterId, matterLabel,
    title,
    source: 'action' | 'deadline',
    kind: 'task'|'email'|'call'|'filing'|'document'|'deadline',
    dueDate: string | null,
    isCourt: boolean,            // deadlines only; drives red
    band: 'overdue'|'today'|'week'|'later'|'none',   // derived from dueDate vs today
    status: 'open'|'done',
    // email-kind action items carry the draft so the lawyer can act inline
    emailSubject?, emailBody?
  }
  ```
- **Overdue is derived, never stored.** `band` is computed at read time from `dueDate` vs the current date. "Updates as things are missed" needs no writes or cron — an open item with a past due date reads as `overdue` the next time the tab loads. (Deterministic and resume-safe.)
- **`POST /api/tasks` (quick-add)** — a manual task not tied to a call: `{ matterId, title, dueDate?, kind? }`. Stored as an `ActionItem` on that matter's debrief store (a synthetic "manual" debrief entry) so it flows through the same pipeline.
- **`PATCH /api/tasks/:matterId/:itemId`** — flip `status` open↔done, or edit `dueDate` (reschedule/snooze). Deadlines are read-only here (they derive from matter facts; you change them by changing the underlying date on the matter).
- **`GET /api/tasks/calendar/:token.ics`** — one unified subscribable feed across all the user's matters: every dated, open item (action items + deadlines) as VEVENTs, reusing `buildDocketIcs`.
  - **Must be a token feed, not a cookie route.** A calendar app re-fetches on its own schedule with no browser cookie, so a cookie-authed URL 401s (this is exactly why the current `/api/employment/deadlines.ics` "subscribe" does nothing — it is also served as `attachment`, i.e. a one-time download). The fix mirrors the intake-portal pattern: a per-user, unguessable, **revocable** feed token in the path; the route is registered **public** and authorizes via the token → the user's matters only.
  - Served as `text/calendar` **without** `Content-Disposition: attachment` (a feed, not a download).
  - UI: a `webcal://…/api/tasks/calendar/<token>.ics` link (one click opens the OS "Subscribe to calendar" dialog) plus a copy-URL affordance for Google Calendar. A "regenerate feed URL" control revokes the old token.
  - **Privacy minimization:** event summary/description use the **DP- file number**, not the client name, so a leaked feed URL (or the calendar provider) sees as little client-identifying data as possible. Note for the lawyer: subscribing from their own Outlook/M365 keeps the data inside the firm's existing tenant; a personal Google/Apple calendar sends it to that provider.
  - Fold the existing `/api/employment/deadlines.ics` into this (or redirect it): one correct feed, not two.

### 2. Frontend — the Tasks tab

- New top-level route/tab **`Tasks`** in the Starling header nav (beside My Cases / New Matter), with an **overdue count badge**.
- **Grouped list**, in this order: **Overdue** → **Today** → **This week** → **Later** → **No date**. Within a group, court deadlines pinned to top, then by due date.
- Each row: title, matter label (click through to the matter), due date, a source/kind chip, and a checkbox to mark done. Court deadlines render red; action items neutral.
- **Filters**: by matter, by kind, by source (tasks vs deadlines), and a "show done" toggle (done items collapse into an archive view — progress is visible without clogging the list).
- **Quick-add** row at the top: title + optional date + matter picker → `POST /api/tasks`.
- **"Add to calendar"** button = copy the `webcal://…/api/tasks/calendar.ics` subscription URL, with a one-time "how to subscribe" hint for Outlook/Google/Apple Calendar.

### 3. Dashboard relationship (a lightweight daily glance)

The dashboard stops trying to be the task list and becomes a fast daily glance:
- **Today** — up to 5 items due today or overdue, court deadlines prioritized. Any court/statutory deadline within 5 days always surfaces here regardless of the count (the can't-miss safety net is never crowded out).
- **Recent matters** — the 3–5 most recently opened/updated files, for fast re-entry.
- Everything else — the full cross-matter list, filters, archive — lives in the Tasks tab.

### 4. Overdue handling

- **In-app (primary):** overdue items float to the top **Overdue** group; the Tasks tab badge counts them.
- **Reschedule ("move to…"):** overdue items get a prominent one-click reschedule to a new date, which re-slots them into the list and the calendar feed immediately. (v2: smart slotting — Starling suggests a date from current load. Reassigning to another *lawyer* is part of the deferred firm-roles build, not this.)
- **Weekly per-lawyer digest (opt-in):** one email a week to the lawyer's **own verified inbox** with their **own** outstanding items + the week ahead. This is deliberately distinct from the disabled firm-wide digest (which broadcast client matter labels across the firm): per-user, own-data-only, opt-in, off by default. Uses the already-configured Resend key.

## Explicitly out of scope (this build)

- Email auto-ingestion (forward-to-Starling / Outlook read). Interim: paste an email into Matter Debrief to extract its tasks.
- Firm-wide push / the old firm digest (broadcast client labels across the firm) — stays off. The only notification here is the opt-in, per-lawyer, own-data-only weekly digest above.
- Smart date-slotting for overdue items (v2) and reassigning tasks to another lawyer (deferred firm-roles build).
- Cross-lawyer / firm-wide task views (per-user only for now).
- Recurring tasks.

## Testing discipline

Unit: aggregation across ≥2 matters with mixed sources; overdue/today/week banding at date boundaries; per-user scoping (user B's tasks never appear for user A); quick-add round-trips as an ActionItem; PATCH open↔done; ICS emits one VEVENT per dated open item and none for done/undated. Component: tab renders groups, badge counts overdue, checkbox flips status, filters narrow the list. 3 consecutive clean passes + browser check before deploy.

## Decisions (locked 2026-07-20)

1. **Dashboard** — becomes a glance: a **Today** widget (up to 5 items due today/overdue, court deadlines prioritized + always-surface the ≤5-day hard-stops) and **Recent matters** (3–5). Full management in the Tasks tab.
2. **Inbox contents** — unified: court/statutory deadlines *and* action items in one list, sorted by due date.
3. **Overdue** — in-app Overdue group + tab badge; one-click reschedule ("move to…"); plus an **opt-in, per-lawyer, own-data-only weekly digest** (distinct from the disabled firm digest).
