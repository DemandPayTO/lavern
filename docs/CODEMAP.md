# Starling Code Map

The "where does everything live" index for DemandPay Starling. Read this
before diving in — it tells a human reviewer or an AI agent which files hold
which feature, so you can go straight to the two or three files that matter
instead of searching. Keep it current when features move.

For the architectural narrative see [CLAUDE.md](../CLAUDE.md); for the feature
catalogue see [docs/STARLING-FEATURES.md](./STARLING-FEATURES.md); for how work
flows through the system see [docs/STARLING-WORKFLOWS.md](./STARLING-WORKFLOWS.md).

---

## 1. Top-level layout

```
src/            server + engine (Fastify, tsx, no build step)
  api/          HTTP + WebSocket surface
    server.ts   the server: helmet/CSP, CORS, rate limit, static, deploy guard
    routes/     one module per route group (see §3)
    middleware/ auth, validation, x402 payment
  employment/   Starling's deterministic engine (60 files — see §2)
  labour/       union-side grievance engine (parallel to employment/)
  documents/    parsing, OCR, SMAC-L1 sanitisation
  providers/    LLM abstraction (cross-provider-chat, mistral, tool-converter)
  assembly/     format conversion (docx, html, pdf via puppeteer)
  db/           SQLite (database.ts), backup, offsite-backup
  claw/         autonomous document pipeline (Clawern — separate product)
  agents/       67 agent prompts + profiles (the Lavern engine)
  mcp/          MCP tools + the managed-agents remote bridge
  types/        Zod schemas + TS types (the data model's one home)
  workflows/    9 workflow templates + executor
  gates/ hooks/ human-gate resolvers + enforcement
  starling/     server-side Starling runners (digest, status monitor)
viz/            React SPA (Vite → /dashboard/)
  src/starling/ the Starling lawyer UI (see §4)
  src/<feature>/ landing, briefing, staffing, working, delivery, my-page, ...
docs/           architecture, features, workflows, security/, specs/, ops/
tests/          unit/ + integration/ (~2,580 backend, ~106 frontend)
scripts/        seed, load-test, tenant-isolation probe, property fuzz, ops
```

**Convention:** the code runs via `tsx` (no compile step); imports use the
`.js` extension on `.ts` files. Tests live in `tests/`, not co-located.

---

## 2. Where each Starling FEATURE lives (cross-cutting)

A feature usually spans a server generator, its deterministic parts, the
route, and the client workspace. This table is the fast path.

| Feature | Deterministic core | Generator / prompt | Route (in employment-intake.ts) | Client |
|---------|--------------------|--------------------|-----------|--------|
| **Intake** | `types/employment-intake.ts` (schema), `employment/intake-questionnaire.*` | — | `POST /intake`, `/analyze` | `viz/src/starling/shared.tsx` (IntakeEditorPanel), `QuestionnairePanel.tsx` |
| **Demand letter** | `employment/demand-letter-parts.ts` (table, furniture) | `employment/demand-letter-generator.ts` | `POST /:m/demand-letter`, `/demand-readiness` | `MatterDetailView.tsx` (demand workspace) |
| **Statement of Claim** | `employment/soc-nodes.ts`, `soc-shell.ts`, `soc-slot-fill.ts`, `soc-nodes-data.json` | `employment/soc-generator.ts` | `POST /:m/statement-of-claim`, `/soc-nodes`, `/soc-node-library/*` | `MatterDetailView.tsx` (claim workspace + pleading picker) |
| **SJ Factum + argument library** | `employment/factum-nodes.ts`, `factum-nodes-data.json`, `factum-teach.ts` (firm Part III argument sections, selected by approved issues; guides the model) | `employment/litigation-documents.ts` (`sj_factum`) | `/litigation-document`, `/factum-nodes`, `/factum-node-library/*` | `matter/workspaces/FactumArgumentOptions.tsx` (picker) + `FactumArgumentLanguageOptions.tsx` (teacher) |
| **SJ Factum section-by-section** | `employment/factum-outline.ts` (outline model: Overview, Facts, arguments, Order + draft status), `factum-section-generator.ts` (draft one section), `factum-assemble.ts` (assemble approved sections into the numbered factum + Schedules A/B), `routes/employment/factum-selection.ts` (shared argument selection) | `routes/employment/generators.ts` (`sj_factum` assembles from approved sections, else whole-doc) | `/factum-outline`, `/factum-section/draft`, `/factum-section` (approve/save/clear) | `matter/workspaces/FactumOutlinePanel.tsx` (draft / read / edit / Approve / Discard per section) |
| **Mediation brief** | `employment/mediation-brief-tables.ts`, `brief-sources.ts`, `brief-readiness.ts`, `case-comparables.ts` | `employment/litigation-documents.ts` (mediation_brief) | `POST /:m/litigation-document`, `/brief-readiness`, `/brief-sources/*` | `MatterDetailView.tsx` (mediation workspace) |
| **Reply (Form 25A)** | `employment/reply-shell.ts`, `reply-comparison.ts` | `employment/litigation-documents.ts` (reply) | `/litigation-document`, `/reply-comparison`, `/defence-source`, `/claim-source` | `MatterDetailView.tsx` (reply workspace) |
| **Rebuttal letter** | — | `employment/litigation-documents.ts` (rebuttal_letter) | `/litigation-document`, `/rebuttal-source`, `/rebuttal-feedback` | `MatterDetailView.tsx` |
| **Negotiation ledger** | `employment/negotiation.ts` | — | `GET/POST/DELETE /:m/negotiation` | `MatterDetailView.tsx` |
| **Document extraction** | `api/briefing/employment-extractor.ts`, `employment/extraction-apply.ts` | (LLM extractor) | `POST /classify`, `/extract`, `/apply-extraction`, `/doc-analysis` | `MatterDetailView.tsx` (drop zone), `ExtractionReviewPanel.tsx`, `DocAnalysisPanel.tsx` |
| **Revision / feedback loop** | `employment/revision-loop.ts` | — | `/revision/plan`, `/revision/apply`, `/revision/upload`, `/draft/review`, `/draft/replace` | `RevisionPanel.tsx` |
| **Firm style profiles** | `employment/style-profile.ts`, `house-style.ts` | `analyseStyle` | `/style-profiles/*` | `StyleProfilePanel.tsx` |
| **Firm templates** | `employment/firm-templates.ts`, `template-injector.ts`, `docx-splice.ts` | — | `/templates/*`, `/templates/align/*` | `MatterDetailView.tsx` (template card) |
| **Precedent reading** | `employment/precedent-read.ts` (byte-sniffing) | — | (used by teach/align/style routes) | `PrecedentAlignPanel.tsx` |
| **Debrief** | `employment/debrief.ts` | — | `/debrief`, `/debrief/analyze` | `MatterDetailView.tsx` |
| **Deadlines / docket** | `employment/deadlines.ts`, `docket-ics.ts` | — | `/deadlines`, `/deadlines.ics` | dashboard worklist |
| **Word export** | `employment/docx-export.ts` | — | `GET /:m/download/:docType` | download links |
| **Worklist / next steps** | `employment/worklist.ts`, `next-steps.ts`, `stage-model.ts` | — | (surfaced in `GET /:m` and dashboard) | `StarlingDashboard.tsx`, `MattersFilesView.tsx` |

**Rule of thumb:** the numbers a lawyer relies on (damages, deadlines,
pleading structure, tables) are computed in the deterministic `*-parts.ts` /
`*-tables.ts` / `*-nodes.ts` files and MUST NOT be written by the model. The
generator files write only narrative prose around them.

---

## 3. `src/api/routes/` — the route modules

Most are single-purpose and easy to navigate. The employment surface (85 route
handlers) used to be one 5,629-line `employment-intake.ts`; it is now a thin
**barrel** that composes 13 per-domain modules under `routes/employment/`.
`employment-intake.ts` keeps its name and public exports so every importer
(`registerEmploymentIntakeRoutes`, `sanitiseHtml`, and the other re-exported
helpers) is unchanged.

| Module (`routes/employment/`) | `register…Routes` | Routes | Lines |
|--------|--------|--------|-------|
| `intake.ts` | `registerIntakeRoutes` | `/intake`, `/analyze`, `/deadlines`(+`.ics`), `/:m` (GET), `/file-number`, `/issues`, `/timeline`, `/questionnaire` | 406 |
| `negotiation.ts` | `registerNegotiationRoutes` | `/:m/negotiation` (×3), `/net-settlement` (×3), `/comparables` | 252 |
| `debrief.ts` | `registerDebriefRoutes` | `/:m/debrief`, `/debrief/analyze`, `/debrief/:item/status` | 346 |
| `case-analysis.ts` | `registerCaseAnalysisRoutes` | `/case-review` (×2), `/case-synthesis`, `/doc-analysis` (×3) | 327 |
| `extraction.ts` | `registerExtractionRoutes` | `/classify`, `/extract`, `/apply-extraction` | 438 |
| `generators.ts` | `registerGeneratorRoutes` | `/demand-letter`, `/statement-of-claim`, `/application`, `/litigation-document` | 1115 |
| `drafts.ts` | `registerDraftRoutes` | `/draft/replace`, `/draft/review`, `/drafts`, `/client-update`, `/document-status`, `/timetable-package` | 694 |
| `sources.ts` | `registerSourceRoutes` | `/brief-sources` (×2), `/rebuttal-*` (×4), `/soc-source` (×2), `/defence-source` (×2), `/claim-source` (×2), `/reply-comparison`, `/direction` (×3) | 441 |
| `soc-nodes.ts` | `registerSocNodeRoutes` | `/soc-nodes` (×2), `/soc-node-library/*` (×5) | 286 |
| `readiness.ts` | `registerReadinessRoutes` | `/demand-readiness`, `/brief-readiness`, `/download/:docType` | 343 |
| `style-templates.ts` | `registerStyleTemplateRoutes` | `/style-profiles/*` (×5), `/templates/*` (×6) | 568 |
| `revision.ts` | `registerRevisionRoutes` | `/revision/upload`, `/revision/plan`, `/revision/apply` | 442 |
| `misc.ts` | `registerMiscRoutes` | `/form/hrto-form1-data`, `/canon-texts` (×2), `/verify-citations`, `/:m/outcome` (×2), `/notes` | 303 |

**Shared helpers** live in `routes/employment/shared.ts` (587 lines):
`resolveFirmId`, `sanitiseHtml`, `loadEmploymentData`, `saveEmploymentData`,
`backfillIntakeIdentity`, `recordDraftHistory`, `findGeneratedDocKey`,
`titleForDoc`, `collectGeneratedDocuments`, `loadStyleForGeneration`,
`directionForGeneration`, `applyDirectionAftermath`, `directionDepartureFlags`,
`styleReviewFlags`, `diffUnlockedCauses`, `buildAdditionalHeads`,
`recomputeAnalysis`, `ensureAnalysisFresh`, `fromParagraphsSafe`,
`extractBodySchema`, `logAuditForm1`, plus `DOCUMENT_STATUSES` /
`REVISION_KIND_VALUES` / `LEGACY_DOC_KEYS` and the `logger`. Each domain module
imports what it needs from `./shared.js`; the barrel re-exports the public
subset. **Route registration order does not affect Fastify routing** (paths are
matched, not ordered), so grouping handlers by domain is behaviour-preserving.

Other notable route modules: `sessions.ts` (Lavern engine, 1,805 lines),
`matters.ts`, `labour.ts`, `auth-routes.ts` (gated), `well-known.ts`,
`documents.ts`, `intake-portal.ts`, `tasks.ts`, `starling-digest.ts`.

---

## 4. `viz/src/starling/` — the lawyer UI

| File | Role |
|------|------|
| `MatterDetailView.tsx` (~3,040 lines) | The matter workspace shell: setup/state, header, tab bar, the draft-tab shell (picker, direction, generate, preview, history) that composes the workspace components, the action bar. |
| `matter/tokens.ts` · `matter/types.ts` | Design tokens; shared row/data shapes |
| `matter/presentational.tsx` | Pure pieces: MatterDetailTopBar, FactItem, DocRow, ActionButton, StatusDot, SourceTag, TriagedFlags, renderBoldText |
| `matter/review-lane.tsx` | ReviewLaneControls (the submitter's approval-queue side) |
| `matter/constants.ts` | Draft catalogue (DEMO_DRAFT_TYPES), the draft-id↔docType↔download maps, court-form field defs, direction shapes |
| `matter/tabs/` | IssuesTab (owns gate decisions + analysis-run state), TimelineTab, IntakeTab (owns EMPLOYMENT_INTAKE_FIELDS), NotesTab |
| `matter/workspaces/` (13) | Every per-document draft-tab option panel, prop-fed (state + runGeneration stay in the parent): RebuttalOptions, DemandFiguresOptions, DemandSourcesOptions, TimetablePackageOptions, TemplateStyleOptions, ReplyOptions, SocPleadingOptions, SocPleadingLanguageOptions, MediationSourcesOptions, CourtFormOptions, GenerationOptions, ReadinessNotice, ScheduleAOptions |
| `hooks/useStarlingApi.ts` (2,213) | The API client hook for the workspace |
| `shared.tsx` (1,767) | Shared components incl. IntakeEditorPanel, GateApprovalPanel, NextStepsPanel |
| `RevisionPanel.tsx` | Feedback loop + "Ask Starling to review it" |
| `ExtractionReviewPanel.tsx` | Approve extracted facts |
| `DocAnalysisPanel.tsx` | Saved deep reads |
| `StyleProfilePanel.tsx` | Learn/edit firm style |
| `PrecedentAlignPanel.tsx` | Template alignment |
| `CaseFileDropPanel.tsx` | The single document drop zone |
| `StarlingDashboard.tsx`, `MattersFilesView.tsx` | Dashboard + matter list |
| `NewMatterView.tsx`, `ClientIntakeView.tsx` | Matter creation + intake |

---

## 5. Structure work in progress

1. **`routes/employment-intake.ts` → `routes/employment/` folder.** **Done.**
   The 5,629-line monolith is now a 58-line barrel composing 13 per-domain
   modules plus `shared.ts` (see §3). `registerEmploymentIntakeRoutes` and the
   re-exported helpers are unchanged, so no importer broke.
2. **`viz/src/starling/MatterDetailView.tsx` → `viz/src/starling/matter/`.**
   **Done** (each step verified with tsc, the viz suite, and a live browser
   pass): tokens, types, the pure presentational components, and
   ReviewLaneControls; the Issues/Timeline/Intake/Notes tab panels
   (`matter/tabs/`); the draft-tab data maps (`matter/constants.ts`, which also
   let four dead constants be dropped); and **all 13 per-document draft-tab
   option panels** (`matter/workspaces/`), extracted Option-A style — verbatim
   JSX, state and `runGeneration` untouched in the parent, passed down as props,
   so document generation is provably unchanged. The view is down from 5,527 to
   ~3,040 lines (-45%); the draft tab is now a shell that composes the workspace
   components. **Remaining (optional, deferred):** the Docs tab still lives in
   the parent, and the draft tab's ~169-identifier coupling means the fully
   *clean* end state is the generation-hook refactor (consolidate that state),
   which wants generation-flow test coverage first — the current per-panel
   Option-A route threads props. The three thin wrapper tabs (Client/
   Negotiation/Debrief) stay inline by design.
