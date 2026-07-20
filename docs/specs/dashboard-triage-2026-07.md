# Spec — Dashboard Triage Pass

Status: DRAFT FOR JORDAN'S APPROVAL. No code written yet.
Target: Starling dashboard (StarlingDashboard.tsx) + the deadline/urgency
model. Built on `feature/matter-debrief`, tested, merged to
`demandpay-config`.

## Problem

At pilot scale the dashboard reads fine. At a principal's real load (~200
active matters) it fails in three ways:

1. **Colour inflation.** Urgency maps overdue AND anything within 14 days to
   the same red, and treats a limitation period the same as a follow-up
   email. At 200 matters "something due within two weeks" is the baseline
   state of nearly every file, so red describes the normal case instead of
   the exception. When everything is red, nothing is.
2. **The matter list does not scale.** `My Matters` renders every filtered
   matter as a tall card row, with no search and no pagination. 200 rows is
   unusable.
3. **No triage.** The lawyer sees an enumeration of everything, not a short
   answer to "what needs me right now." Undated debrief action items are not
   surfaced here at all.

## Design principle

**Salience is a scarce resource. Spend it only on the rare thing that
genuinely needs the lawyer today.** Most matters, most days, are fine and
should look calm. Colour, weight, and position at the top of the page are
reserved for real exceptions. Triage (a short prioritized worklist) beats
enumeration (a coloured list of everything).

## The four workstreams

### A. Recalibrate the urgency model (the highest-leverage change)

Red is reserved for **court-imposed and statutory deadlines only** — the ones
where missing them fails the client and prejudices their rights. Negotiation
timing (offer expiries, replies to opposing counsel, demand responses) is
work, not an emergency, and never turns red. Jordan's rule, verbatim: "red to
only really be court-imposed deadlines... just hard deadlines that if we miss
we fail and prejudice our clients."

**Critical (red-eligible) deadlines** — a curated, court/statutory set:
- `limitation` (statute of limitations).
- Court litigation deadlines: Statement of Claim, Statement of Defence, reply,
  factum, affidavit of documents / discovery, notice of motion, mediation
  brief, settlement conference / pre-trial, and any court-form filing
  deadline. These are currently stored as `timeline` ticklers, so they are
  identified two ways:
  1. **System-generated ticklers** (the litigation event chains, e.g. "SOC
     sent → Statement of Defence due +20d") carry known labels and are matched
     by a curated `COURT_DEADLINE_LABELS` pattern set.
  2. **Lawyer-entered timeline events** get a new **"court deadline"
     checkbox** on the add-event form, so the lawyer marks their own hard
     dates explicitly rather than relying on text matching.
- Labour: `grievance_filing`, `grievance_referral`, `grievance_step` — the CA
  and tribunal time limits whose miss forecloses the grievance. CONFIRMED
  red-eligible (Jordan, 2026-07-17): the labour-side equivalent of court
  deadlines.

**Never red** (attention at most): `demand_response`, `severance_offer` (offer
expiry), `client_email`, `action_item` (debrief tasks), and generic
`timeline` events not marked as court deadlines.

New bands (replacing overdue/critical/soon/upcoming as the colour driver):

| Band | Colour | Condition |
|------|--------|-----------|
| **Critical** | Red (rare) | A court/statutory deadline overdue, or due within **5 days** (one business week) |
| **Attention** | Amber | A court/statutory deadline in 6-21 days; OR any non-critical item overdue or due within ~7 days |
| **Planned** | Neutral / quiet | Everything else on the horizon |

Consequence: a matter whose only upcoming item is a counter-offer to send or a
reply from opposing counsel is **never red**, no matter how close. Red appears
only when a court or statutory clock is inside a business week or already
blown. The raw `daysRemaining` still shows; only the colour/priority changes.

`deadlines.ts` gains pure helpers: `isCourtDeadline(item)` (kind + label
pattern + the explicit flag) and `priorityBand(item, days)`; `docket-ics.ts`
and the dashboard consume the band. Fully unit-testable, no behaviour hidden
in the UI. The `courtDeadline` flag is added to the timeline-event shape and
the add-event form (workstream folds into A).

### B. Triage worklist: "Needs you now" (incorporates the cross-matter tasks view)

A new section at the very top of the dashboard (above Quick Actions): a short,
prioritized list of the items in the **Critical** band plus overdue soft
items, across every matter, capped (e.g. top 12) with a count of the rest.
Each row: the item, its matter, its date, and a one-click jump to the matter.
Open debrief **action items** (dated and overdue) appear here too, checkable
in place. This is the lawyer's daily answer to "what do I work on," and it is
where the cross-matter tasks view lives — not a separate enumerating tab.

If nothing is critical, the section says so plainly ("Nothing urgent today")
rather than showing an empty red box.

### C. Make the matter list work at 200

- **Search box**: filters by client name, employer, file number, and matter
  number (client-side over the loaded list; the list is already fetched).
- **Compact density**: one line per matter (name, client v employer, one
  status chip, nearest hard deadline date) instead of the tall card. Colour
  on the row only when the matter is Critical.
- **Pagination**: 25 per page (or a "show more" cap). Deterministic ordering:
  Critical matters first, then by nearest hard deadline, then by recency.
- Keep the existing status filters; recompute matter-level status from the
  recalibrated bands so "Urgent" filter means Critical, not "anything <=14d".

### E. Practice mode — hide the vertical the firm does not use

Most lawyers do employment OR labour, not both, so showing both verticals is
clutter for everyone. Add a **practice mode** setting: `employment` (default),
`labour`, or `both`. Backed by config (`STARLING_PRACTICE_MODE`) for the
single-firm deployment; it can graduate to a per-user My Page preference later
without rework.

In `employment` mode:
- New Matter drops the employment/labour practice-area toggle and opens
  straight into the employment intake (no grievance path shown).
- The dashboard shows only employment matters; labour matters are hidden, not
  deleted (a mode flip brings them back).
- Labour-specific navigation is hidden.

The labour code, routes, and the grievance deadline kinds stay in place and
tested — only the surfacing is gated (same approach as the legacy-route gate).

IMPORTANT distinction: hiding the **labour vertical** (grievances, collective
agreements, union-side workflow) does NOT remove arbitration from employment.
Employment matters can still involve arbitration (arbitration clauses,
statutory or contractual arbitration of a wrongful dismissal); those live in
the employment vertical and are untouched. Only the union/grievance vertical
is gated.

### D. Surface a matter's open action items in its Next Steps

`recommendEmploymentNextSteps` also reads `matter.debriefs`: open action items
appear in the per-matter Next Steps banner (overdue = urgent, dated-soon =
now, undated = soft), so a file's outstanding tasks show at the top of the
matter, not buried in the Debrief tab. Undated items finally have a home
outside the tab.

## What changes visually

- Far less red. Most of the 200 rows read as calm/neutral; a handful are red.
- A short "Needs you now" list is the first thing the lawyer sees.
- `My Matters` becomes a searchable, paginated, one-line-per-matter list.
- Each matter's own outstanding tasks show in its Next Steps.

## What does NOT change

- The data model. This is display and classification logic over data already
  stored (deadlines, debriefs, matters). No migrations.
- The ICS feed keeps every dated item (a calendar is an enumeration by
  design); only the dashboard triages. The band can drive VALARM/priority in
  the ICS later if wanted, out of scope here.
- Tenant scoping, routes, and the debrief/file-number work already on the
  branch.

## Deterministic-first / risk

- All classification is pure functions (`severityFor`, `priorityBand`,
  matter-status derivation) with unit tests. No LLM.
- Additive and display-only: it reads the same endpoints. The main behavioural
  change is which colour/priority an item gets, which is fully tested.
- Search/pagination are client-side over the already-loaded list, so no new
  load patterns.

## Testing

- Unit: `isCourtDeadline` / `priorityBand` truth table — statute of
  limitations overdue = Critical; SOC due in 4 days = Critical; SOD due in 12
  days = Attention; a counter-offer expiry in 2 days = Attention (never red);
  a follow-up email in 10 days = Planned; a lawyer event flagged court-deadline
  in 3 days = Critical. Matter-status derivation; next-steps includes debrief
  items with correct urgency.
- Component: dashboard renders the worklist, search filters the list,
  pagination bounds the render, Critical rows are the only coloured ones.
- Live: 3 clean passes of a dashboard feature check against a seeded set of
  matters spanning all bands; visual confirmation via the browser.

## Rollout (reviewable pieces, in order)

1. **A — urgency recalibration** (backend helpers + court-deadline flag +
   tests). Self-contained, highest impact; you react to "less red" first.
2. **E — practice mode** (hide labour by default). Small, immediate declutter.
3. **D — next-steps surfacing** (small).
4. **C — matter list search + density + pagination.**
5. **B — the "Needs you now" triage worklist.**

Each lands as its own commit on `feature/matter-debrief` with its test loop,
so you can eyeball each step before the next.

## Effort

~2-2.5 days across the five pieces including the test loops.
