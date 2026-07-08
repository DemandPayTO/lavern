# DemandPay Starling — Workflow Overview

**Purpose:** how work actually flows through Starling, end to end, for each vertical — the operating picture behind the feature reference (`STARLING-FEATURES.md`). Written for Jordan and for LLM maintainers deciding where a change belongs.

The organizing idea: **a matter should carry its own momentum.** At every moment, Starling knows what stage a matter is in (derived from evidence, never hand-set), what should happen next (ranked by consequence), and what dates matter (one docket, everywhere). The lawyer supplies judgment; the system supplies memory and momentum.

---

## Workflow 1 — Employment matter, intake to settlement

1. **Intake.** Lawyer creates the matter (New Matter) or sends the client the tokenized portal link and applies the client's answers (fill-blanks-only). Stage: *intake*.
2. **Issue spotting.** Deterministic gates fire from the facts: termination-clause exposure, discrimination overlay (starts the HRTO 1-year clock on the docket), severance-offer signals, limitation warnings. Lawyer approves or dismisses each on the Issues tab. Stage: *assessment*.
3. **Analysis.** One click produces the damages estimate (ESA floor vs common-law Bardal range) and the limitation deadline, which docket themselves.
4. **Client correspondence begins.** Start the mitigation series on the Client tab: the duty-to-mitigate advice email drafts immediately; the 6-8-week follow-up (with the Mitigation Log tracker) schedules itself from the termination date. Due emails alert through docket, digest, and next steps; the lawyer sends from their own email and marks sent.
5. **Demand.** Generate the demand letter (tone + amount controls, canon-cited, reviewer-flagged), review, mark SENT — the response deadline ticklers itself. Stage: *demand* → *negotiation*.
6. **Escalation, if needed.** Statement of Claim or Notice of Action (14C official text injected; filing it ticklers the 14D deadline), HRTO application + Schedule A or ESA claim narrative (ss. 97/98 election flagged), service documents (16B affidavit), Rule 49 offers (49A/49B/49C), Rule 20 summary judgment package, mediation/pre-trial briefs. Court forms are deterministic; XFA government forms ship as import-ready data files. Stage: *proceedings*.
7. **Resolution.** Minutes of settlement + release, costs outline (57B). Close with the outcome (type, amount, date) — the predicted range is snapshotted for calibration. Stage: *resolution*. Reopen cleanly if it revives.

**Throughout:** the stage chip and the top-3 next steps sit above the tabs; every deadline (limitation, offers, ticklers, client emails) lives in one docket, one calendar feed, and the Monday digest; every generation is metered in the usage ledger.

## Workflow 2 — Grievance (union side), filing to award

1. **Intake.** Practice-area toggle → grievance intake; selecting a CA profile from the library prefills time limits and procedure steps. Filing deadline previews live. Stage: *intake*.
2. **Gates.** The 11 labour gates fire: Wm Scott framing for discharge, clock jeopardy (with s. 48(16) when a union limit is missed vs deemed denial when the employer is late), Weber forum, DFR s. 74 exposure, human-rights overlay, KVP, Millhaven, procedural defects. Stage: *assessment*.
3. **CA intelligence.** Upload the collective agreement → extraction fills blank limits/steps (never overwrites the reviewer); save the profile back to the library for the next grievance in that unit.
4. **Filing + procedure.** Generate the grievance filing; record step events as the procedure advances — each step's response/advance clocks docket themselves. Deemed-denial and referral windows are watched. Stage: *grievance* → *procedure*.
5. **DFR protection.** Before declining or abandoning: merits assessment memo (the s. 74 shield), decline-to-advance letter, grievor status update.
6. **Arbitration.** Referral to arbitration (LRA s. 48 route), particulars request, production request, remedy/back-pay worksheet (deterministic math from wage inputs), arbitration brief. OLRB matters: A-29/A-30 (DFR) and A-53/A-54 (s. 50) data files. Stage: *arbitration*.
7. **Resolution.** Memorandum of Settlement or award; close with the grievance disposition. Stage: *resolution*.

## Workflow 3 — The firm's week (ambient)

- **Monday 08:00:** the digest lands — week's stats plus every deadline across every matter, both verticals.
- **Any morning:** the dashboard docket shows what is due (overdue/critical/soon), including client emails waiting to be sent; the calendar feed mirrors it in Outlook/Google.
- **Any matter opened:** stage + next steps say where it is and what moves it.
- **Month end:** `GET /api/usage/summary?format=csv` produces the invoice-ready usage rollup per matter.

## Workflow 4 — Making changes to Starling (for LLM maintainers)

1. Read `CLAUDE.md`, this file, and `STARLING-FEATURES.md` (find the feature's entry: files, routes, UI).
2. Prefer the deterministic layer; reach for the LLM only for substantive drafting. Respect the language rules (no em-dashes, no contractions, legal register) in any prompt or user-facing string.
3. Follow the established pattern: backend module → route (zod-validated, user-scoped) → shared UI component (`viz/src/starling/shared.tsx`) → unit + integration tests → extend or add a `scripts/feature-test-*.ts` functional script.
4. Verify: full backend suite, viz suite, and ALL functional scripts against a running local server (`preview_start` name `starling-api` / `npm run serve`), clean **three consecutive times** with `set -o pipefail`.
5. Deploy: `fly deploy` from repo root; verify `https://starling.demandpay.ca/health` and the changed surface live. Commit with clear messages; never push unreviewed legal-content changes.
6. Local dev cautions learned the hard way: read `.env` before writing it (it holds `SHEM_DB_PATH` and the API key); `tsx` scripts run from the repo root; the local server must be restarted to pick up backend changes.

## Standing operational facts

- Weekly digest recipient: `STARLING_DIGEST_EMAIL` (fly.toml).
- Pricing knobs: `STARLING_PRICE_PER_GENERATION_CAD`, `STARLING_PRICE_PER_MATTER_MONTHLY_CAD` (unset = metering only).
- Backups: three layers, off-site to Tigris; `POST /api/admin/backup-now` verifies the chain.
- Admin key: `LAVERN_ADMIN_KEY` (Fly secret) — digest, spend, backup-now.
- Email delivery requires the sender domain verified in Resend.
- Canon watch: ONCA "at any time" clause appeal (Dufault/Baker) — same-day canon + prompt update when released.
