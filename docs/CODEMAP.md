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

35 route modules. Most are single-purpose and easy to navigate. The one
exception is `employment-intake.ts` (5,629 lines, 85 handlers), which is being
split by domain into `routes/employment/` (in progress — see §5). Until that
completes, use this index into the current file:

| Domain | Routes | Lines (approx) |
|--------|--------|-----------|
| Intake & analysis | `/intake`, `/analyze`, `/:m` (GET), `/file-number`, `/issues`, `/timeline`, `/questionnaire` | 580–1370 |
| Negotiation & settlement | `/:m/negotiation` (×3), `/net-settlement` (×3), `/comparables` | 757–1205 |
| Debrief | `/:m/debrief`, `/debrief/analyze`, `/debrief/:item/status` | 842–1113 |
| Case review & doc analysis | `/case-review`, `/case-synthesis`, `/doc-analysis` (×3) | 1389–1646 |
| Extraction | `/classify`, `/extract`, `/apply-extraction` | 1648–1935 |
| Demand letter | `/:m/demand-letter`, `/demand-readiness` | 1936, 4068 |
| Statement of Claim | `/:m/statement-of-claim`, `/soc-nodes` (×2), `/soc-node-library/*` (×5) | 2247, 3851–4067 |
| Applications & litigation | `/application`, `/litigation-document` | 2391–2962 |
| Mediation brief | `/brief-readiness`, `/brief-sources/*` | 3394–3446, 4111 |
| Draft lifecycle | `/draft/replace`, `/draft/review`, `/drafts`, `/document-status`, `/client-update` | 2963–3210, 4880–5082 |
| Source slots | `/rebuttal-source`, `/rebuttal-feedback`, `/soc-source`, `/defence-source`, `/claim-source`, `/reply-comparison` | 3447–3694 |
| Direction | `/direction` (×2), `/direction/extract` | 3695–3850 |
| Revision loop | `/revision/upload`, `/revision/plan`, `/revision/apply` | 5083–5444 |
| Style & templates | `/style-profiles/*` (×5), `/templates/*` (×6) | 4383–4839 |
| Timetable | `/timetable-package` | 3211 |
| Forms | `/form/hrto-form1-data` | 4840 |
| Canon & citations | `/canon-texts` (×2), `/verify-citations` | 5445–5524 |
| Outcome & notes | `/:m/outcome` (×2), `/notes` | 5525–5620 |
| Download | `/:m/download/:docType` | 4142 |

**Shared helpers** used across handlers (lines 47–578, being extracted to
`routes/employment/shared.ts`): `resolveFirmId`, `sanitiseHtml`,
`loadEmploymentData`, `saveEmploymentData`, `backfillIntakeIdentity`,
`recordDraftHistory`, `findGeneratedDocKey`, `collectGeneratedDocuments`,
`loadStyleForGeneration`, `directionForGeneration`, `applyDirectionAftermath`,
`recomputeAnalysis`, `buildAdditionalHeads`, `ensureAnalysisFresh`.

Other notable route modules: `sessions.ts` (Lavern engine, 1,805 lines),
`matters.ts`, `labour.ts`, `auth-routes.ts` (gated), `well-known.ts`,
`documents.ts`, `intake-portal.ts`, `tasks.ts`, `starling-digest.ts`.

---

## 4. `viz/src/starling/` — the lawyer UI

| File | Role |
|------|------|
| `MatterDetailView.tsx` (5,527 lines) | The matter workspace: every tab and every draft workspace. **Being decomposed** (see §5). |
| `hooks/useStarlingApi.ts` (2,213) | The API client hook for the workspace |
| `shared.tsx` (1,767) | Shared components incl. IntakeEditorPanel, DocRow, TriagedFlags |
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

Two files concentrate most of the review friction and are being restructured:

1. **`routes/employment-intake.ts` → `routes/employment/` folder.** Split by
   the domains in §3, each a `register<Domain>Routes(fastify)` importing from
   `routes/employment/shared.ts`; `employment-intake.ts` becomes a thin barrel
   that composes them and re-exports the helpers (so no importer breaks). Done
   incrementally, full suite green after each domain.
2. **`viz/src/starling/MatterDetailView.tsx` → `viz/src/starling/matter/`.**
   Extract each draft workspace and the pleading picker into their own
   components, shared state lifted to a hook. Larger; scheduled after #1.

Update this map as each domain moves.
