# DemandPay Starling — Complete Feature Reference

**Purpose of this file:** the authoritative map of every Starling feature: what it does, why it exists, where it lives, and how to change it safely. Written for LLM maintainers and for Jordan. Keep it current: when a feature changes, update its entry in the same commit.

**Product:** plaintiff-side Ontario employment law + union-side labour workflow platform. The thesis: Clio/iManage holds the documents, Westlaw/Lexis does the research; **Starling pushes matters forward from intake to settlement**. It is a workflow system, not a document management system and not a research tool.

**Deployment:** Fly.io app `demandpay-starling` (Toronto/yyz) at https://starling.demandpay.ca. Deploy with `fly deploy` from the repo root. Dashboard builds with `VITE_BASE_PATH=/dashboard/`. Prod runs `LAVERN_AUTH_ENABLED=true` (multi-user); local dev runs LOCAL MODE as the synthetic `local-user`.

**Design principles (apply to every change):**
1. **Deterministic first.** Gates, clocks, stages, next steps, court forms, worksheets, correspondence drafts are pure functions: $0, testable, no LLM. The LLM is reserved for substantive drafting.
2. **The lawyer decides.** Starling drafts and alerts; it never sends, files, or certifies. Every generated document carries reviewer flags; every client email is sent by the lawyer.
3. **Language rules.** No em-dashes anywhere in prompts, UI strings, or generated content (en-dashes allowed in numeric ranges). No contractions in user-facing text. Professional Ontario legal register. Both eval batteries enforce the em-dash rule on generated output.
4. **Testing discipline.** Every feature ships with unit + integration tests and, where it touches the live server, a $0 functional script in `scripts/feature-test-*.ts`. A change is done when the full suites and all functional scripts pass clean three consecutive times (`set -o pipefail` in loop harnesses).
5. **Tenant scoping.** Every matter access goes through `getMatterById(matterId, userId)`; every DB query on user data carries `AND user_id = ?`. Never query `session_archive` or `matters` unscoped (a security review caught exactly this once).

---

## 1. Matter intake

**What it does:** creates a matter and captures the structured facts everything else derives from.

- **Employment:** `viz/src/starling/NewMatterView.tsx` → `POST /api/matters` then `POST /api/employment/intake` (`src/api/routes/employment-intake.ts`). Schema in `src/types/employment-intake.ts` (client, employer, dates, salary, severance offer, discrimination flag, just-cause flag, wage details for worksheets).
- **Labour (grievance):** practice-area toggle on New Matter → `viz/src/starling/GrievanceNewMatter.tsx` → `POST /api/labour/intake` (`src/api/routes/labour.ts`). Schema in `src/types/labour-intake.ts` (grievor, employer, union, CA time limits: filing/advance/referral days, calendar vs working days, procedure steps).
- Saving intake recomputes gates (`evaluateGates` / labour `gate-evaluator`) and rebuilds the timeline (`buildTimelineFromIntake`).

## 2. Intake editing (merge, never clobber)

Intake tab on both matter views (`IntakeEditorPanel` in `viz/src/starling/shared.tsx`). Saving edits merges into the existing intake, recomputes gates and timeline, and preserves issue approvals/dismissals. Field lists: `EMPLOYMENT_INTAKE_FIELDS` in `MatterDetailView.tsx`, labour equivalent in `LabourMatterDetailView.tsx`.

## 3. Client intake portal (public, tokenized)

**What it does:** the client fills their own facts through a link; the lawyer reviews and applies.

- `POST /api/employment/:matterId/intake-link` issues a 192-bit token (sha256-hashed at rest in `portal_tokens`, 14-day TTL, one active per matter).
- Public `GET/POST /api/intake-portal/:token` (in `publicPaths`): GET reveals ONLY firm name + client first name; POST validates a strict zod subset and stores `matter.pendingClientIntake`.
- `POST /:matterId/apply-client-intake`: fill-blanks-only merge (lawyer entries never overwritten), recomputes gates/timeline, consumes the token.
- Files: `src/api/routes/intake-portal.ts`, `viz/src/starling/ClientIntakeView.tsx` (public page, outside `PROTECTED_VIEWS`, route `#/client-intake/<token>`), portal panel on the Intake tab.

## 4. Deterministic gates (issues)

**What it does:** rule-based legal issue spotting from intake facts. $0, explainable, every finding cites its trigger.

- **Employment:** `src/employment/gate-evaluator.ts` — termination-clause exposure, discrimination/HRTO overlay, severance-offer adequacy signals, limitation warnings, and structural gates (no issue codes) shown as footnotes.
- **Labour:** `src/labour/gate-evaluator.ts` — 11 gates: Wm Scott (discharge), CA clocks (with s. 48(16) relief flag when limits missed), Weber (forum), DFR s. 74 exposure, human-rights overlay (Parry Sound), KVP (rules), Millhaven (off-duty), sunset clauses, procedural defects, OHSA s. 50 reprisal forum, reinstatement.
- Issues tab: approve/dismiss per gate (`GateApprovalPanel`); approvals feed generation prompts.

## 5. Analysis (employment)

`POST /api/employment/:matterId/analyze` — LLM-backed damages estimate (ESA minimums vs common-law Bardal range, low/high), limitation deadline derivation, summary. Stored on `employment.analysis`. The predicted range is snapshotted at outcome time (feature 12) for calibration.

## 6. Document generation suite

**What it does:** drafts the full lifecycle of documents, grounded in intake facts, approved issues, and the citation canon. LLM-generated documents cost $0.02-0.40; deterministic ones cost $0.

- **Employment Draft tab** (~22 types, 5 sections in `DRAFT_SECTIONS`, `MatterDetailView.tsx`): retainer agreement (O. Reg. 563/20 standard-form; refuses bespoke CFA), severance offer assessment, counter-offer letter, demand letter (tone + amount controls), client update, Statement of Claim (Form 14A), Notice of Action (14C with the official notice text pinned in `src/assets/forms/form-14c-notice.txt` and injected deterministically), HRTO application + Schedule A, ESA claim narrative, reply (25A), Rule 49 offer (49A; uses the lawyer's exact figure), Rule 20 summary judgment package (37A + 4D affidavit + factum with Hryniak/Bardal/Waksdale set law), mediation brief, settlement conference/pre-trial brief (forum-adaptive), minutes of settlement + release, mitigation log (deterministic), court forms 16B/49B/49C/57B (deterministic, `src/employment/court-forms.ts`), ESA + Small Claims filing sheets.
- **Labour Draft tab** (12 types): grievance filing, referral to arbitration, arbitration brief, DFR response, merits assessment memo, decline-to-advance letter, grievor status update, particulars request, production request, Memorandum of Settlement, OHSA s. 50 reprisal narrative, remedy/back-pay worksheet (deterministic, `src/labour/remedy-worksheet.ts`).
- Generators: `src/employment/demand-letter-generator.ts`, `soc-generator.ts`, `application-generator.ts`, `litigation-documents.ts`; labour in `src/labour/grievance-documents.ts`. All flow through `crossProviderChat` (anonymisation built in) and store to `matter.generated_<type>` (legacy camelCase for the original three) plus `draftHistory` (cap 10).
- DOCX export: `src/employment/docx-export.ts` (court-format numbered paragraphs). Firm letterhead templates: `src/employment/firm-templates.ts` + template routes (placeholder injection into firm DOCX).

## 7. Citation canon + verification (integrity layer)

- `src/employment/citation-canon.ts` — the case canon both verticals cite (Bardal, Waksdale, Hryniak, McKinley, Honda, Wm Scott, KVP, Weber, Parry Sound, Millhaven, Vavilov, and 2025-26 additions). Unknown case names and mismatched citations become lawyer-review flags on every generator.
- `src/employment/canon-store.ts` — full case texts with provenance under `data/canon-cases/`; `canon-verifier.ts` deterministically verifies quotes and pinpoints in generated documents against the stored texts. `POST /api/employment/verify-citations` is the paste-checker.
- Import real texts one at a time: `npx tsx scripts/import-canon-case.ts` (CanLII, no bulk scraping).
- **Open canon watch:** the ONCA "at any time" termination-clause appeal (Dufault/Baker line) is reserved; update canon + prompts the day it releases.

## 8. Government form population (XFA datasets)

HRTO Form 1 and OLRB A-30/A-53 are locked dynamic XFA PDFs that pdf-lib cannot fill. Starling generates a pre-filled `<xfa:datasets>` XML the lawyer imports into the pristine official form (Acrobat: Prepare Form → Import Data). Shared helpers in `src/documents/xfa-datasets.ts`; mappers in `src/employment/hrto-form1-data.ts` and `src/labour/olrb-form-data.ts`; blank data models in `src/assets/forms/` refreshed by `scripts/fetch-official-forms.sh` / `fetch-olrb-forms.sh`. Form inventory + statuses: `docs/form-catalogue.md`. OLRB numbers verified: DFR = A-29/A-30, s. 50 = A-53/A-54.

## 9. Document lifecycle + ticklers

Every generated document has a status: draft → reviewed → sent or filed, with history (`document-status` route, `GeneratedDocsPanel`). Status changes drive deterministic ticklers: demand letter SENT → response due (per deadline set at generation); SOC SENT → Statement of Defence due +20 days; Notice of Action FILED → Form 14D (Statement of Claim) due +30 days.

## 10. Docket, calendar, weekly digest

- `src/employment/deadlines.ts` `collectDeadlines()` — one docket across both verticals: limitation deadlines, severance offer deadlines, tickler timeline events, grievance clocks (filing/advance/referral, with s. 48(16) escalation when passed), and due client correspondence. Kinds: `limitation | demand_response | severance_offer | timeline | grievance_* | client_email`.
- `GET /api/employment/deadlines` feeds the dashboard docket panel; `GET /api/employment/deadlines.ics` (`docket-ics.ts`, stable UIDs) feeds calendar subscriptions.
- Weekly digest: `src/starling/digest-runner.ts` builds stats (`status-monitor.ts`, per-user scoped; `ALL_USERS` sentinel only behind the admin key) + the firm-wide docket, emails both every Monday 08:00 America/Toronto when `STARLING_DIGEST_EMAIL` is set (in-app scheduler in `server.ts`, marker-file dedup on the data volume). Manual trigger: `POST /api/starling/digest?email=...` with `X-Admin-Key`.

## 11. Stage model + next-step engine (the workflow spine)

- `src/employment/stage-model.ts` — the matter's lifecycle stage, **derived, never stored**, with evidence: employment intake→assessment→demand→negotiation→proceedings→resolution; labour intake→assessment→grievance→procedure→arbitration→resolution.
- `src/employment/next-steps.ts` — consequence-ranked recommendations (max 3, urgency urgent/now/soon) returned on both matter GET routes and rendered above the tabs (`NextStepsPanel`, actions jump to tabs). Rules include: limitation ≤60 days without an issued claim, undecided gates, unassessed severance offers with deadlines, drafted-but-unsent demands, passed response dates, defence expiry (noting default), 14D due, labour clock jeopardy, deemed-denial checks, DFR exposure without a merits memo, and due client correspondence.

## 12. Outcome capture (calibration)

`POST /api/employment/:matterId/outcome` — resolution type (settled/judgment/tribunal decision/discontinued/abandoned/grievance dispositions/other), amount, date, notes. Snapshots the predicted damages range at close (the calibration record that will sharpen assessments over time), adds a timeline event, sets status closed. `DELETE` reopens. UI: `CloseMatterPanel` in the action bar of both views.

## 13. Client correspondence engine

**What it does:** scheduled, auto-drafted client emails; the lawyer reviews and sends. **Starling never sends mail.**

- First sequence: the mitigation series. `POST /api/employment/:matterId/correspondence/start` (window 6-8 weeks) schedules step 1 (duty-to-mitigate advice, due now) and step 2 (follow-up + Mitigation Log tracker, due at the window from termination date, never in the past).
- Drafts are deterministic merges (`src/employment/correspondence.ts`): client/firm/window fields, `[LAWYER: ...]` markers at every judgment point, no em-dashes.
- Due items flow into the docket (`client_email` kind), the digest, and next steps (goTo `client`). Marking sent records a timeline event. UI: Client tab (`CorrespondencePanel` in `shared.tsx`) — draft, edit, copy, mailto, mark sent, skip.
- Adding a sequence = new template + trigger in `correspondence.ts`; the routes and UI are generic.

## 14. Usage ledger + pricing knobs

Every generation (both verticals) writes to `usage_events` (durable; `draftHistory` caps at 10). `GET /api/usage/summary?month=YYYY-MM` returns the per-matter rollup (labels, generation counts, LLM cost, billable CAD); `&format=csv` is the invoice export with a TOTAL row. Pricing knobs (CAD, env): `STARLING_PRICE_PER_GENERATION_CAD`, `STARLING_PRICE_PER_MATTER_MONTHLY_CAD`; zero = unpriced (counts + cost only). Hook points: `recordDraftHistory(..., { userId, matterId })` in `employment-intake.ts`; inline in `labour.ts`. Metering never fails a generation.

## 15. CA library + step clocks (labour)

- `ca_profiles` table + CRUD at `/api/labour/ca-profiles`: one collective agreement profile per bargaining unit (time limits, procedure steps), selected at grievance intake to prefill clocks, saved back from a matter's Docs tab.
- Step clocks: `procedure_steps` + `step_events` drive employer-response/advance/referral clocks; the gates distinguish employer lateness (deemed denial) from a missed union limit (s. 48(16) exposure).
- CA upload → `collective_agreement` extraction (`src/labour/ca-extraction.ts`) fills blanks only, never overwrites reviewer values, recomputes gates/clocks.

## 16. Deep Analysis (agent workflows)

Action bar on the matter view launches multi-agent second opinions using the underlying Lavern engine: Second Opinion (counsel), Moot Employer's Response (adversarial), Full Case Assessment (review), Settlement Valuation (roundtable). A briefing memo is auto-built from intake + gates + approvals + damages + timeline. Results land in My Cases; launches are logged to the matter timeline.

## 17. Auth, security, tenancy

- LOCAL MODE (default, OSS): synthetic `local-user`, auth routes unregistered. Prod: `LAVERN_AUTH_ENABLED=true` — cookie/Bearer auth, public signup (waitlist off), email verification enforcement on paid mutations.
- `publicPaths` in `server.ts` is the auth bypass list; entries self-guard (capability tokens, X-Admin-Key, or Stripe signatures). Public wildcards still get best-effort identity attachment for in-route ownership checks.
- Admin surface: `X-Admin-Key` (`LAVERN_ADMIN_KEY` secret) guards digest, spend, billing credit, backup-now.
- Rate limits: 300/min/IP in prod (fly.toml), tighter on auth; local `.env` (gitignored) raises limits for test loops.
- Email: Resend (`src/email/send.ts`), graceful no-op without the key. **Sender domain must be verified at resend.com/domains or nothing delivers.**

## 18. Backups (three layers)

1. Fly volume snapshots (daily, 30-day retention, yyz).
2. In-app SQLite online backup to `/data/backups` daily, 14-day retention (`src/db/backup.ts`).
3. Off-site: layer-2 file uploaded to the Tigris bucket (`fly storage create`, creds as app secrets), 30-day retention with pruning (`src/db/offsite-backup.ts`). No-op locally without `BUCKET_NAME`.
- On-demand verification: `POST /api/admin/backup-now` with `X-Admin-Key`.

## 19. Evaluation + functional testing

- Eval batteries (real LLM spend, budget-guarded): `scripts/eval-battery.ts` (employment fact patterns) and `scripts/grievance-eval-battery.ts` (labour). Outputs in `eval-results/` for Jordan's reviewer scoring. Both enforce the no-em-dash rule per document.
- $0 functional scripts (live local server): `feature-test-correspondence.ts`, `feature-test-intake-lifecycle.ts` (intake edit, lifecycle, stage, next steps, outcome, ICS, portal, usage), `feature-test-forms.ts`, `feature-test-canon.ts`.
- Suites: `npx vitest run` (backend) and `cd viz && npx vitest run`. The bar: 3 consecutive clean passes of everything before deploy.

## 20. Related but separate: the DemandPay B2C site

The consumer product (severance calculator, $389 package, blog) lives in `~/demand-pay-app` (Vercel + Supabase) — a different repo with its own conventions (`frontend/AGENTS.md`). Blog publishing runs through Jordan's Cowork content machine (iCloud: `Cowork OS/DemandPay Cowork/content-machine/`, contract in its `07-CLAUDE-CODE-PUBLISH-HANDOFF.md`). Do not conflate the two products.
