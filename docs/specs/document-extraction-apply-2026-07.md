# Spec — Document Intelligence: Apply Loop, Auto-Classification, Bulk Case File Drop

**Status:** approved by Jordan 2026-07-21 (three phases; Phase 1 building). Phase 1 = the apply loop below. Phases 2 and 3 follow, each shipping with its own click-through.
**Problem:** Starling already extracts facts from uploaded documents (POST /api/employment/extract, per-field confidence, stored on matter.documentExtractions) but the results are display-only on the Docs tab. The lawyer still re-keys the termination letter's numbers into the intake by hand, which is the workflow pain this feature kills: drop the document on the matter, approve the extracted facts, and the drafts draw on them.

## What already exists (reused, NOT rebuilt)

- **Extraction**: `extractEmploymentDocument` (src/api/briefing/employment-extractor.ts) — per-document-kind prompts, `extractedFields: Record<name, {value, confidence}>`, `keyFindings`. Stored via POST /api/employment/extract. This build adds NO new LLM surface.
- **Apply patterns (both blanks-only, both proven)**: `applyCaExtraction` (labour CA auto-fill) and POST /:matterId/apply-client-intake (intake portal: fills blank fields only, never overwrites the lawyer, recomputes gates + timeline).
- **Recompute path**: the intake-save flow already recomputes gates and timeline. The apply endpoint calls the SAME code path — no parallel recompute logic.
- **Downstream derivations** (all read intake at request time, so they update for free once intake changes): gates, deadlines/docket, task inbox + calendar feed + digest, next steps, stage model, comparables, negotiation summary, all generators, matter labels.

## The build (4 slices, each tested before the next)

### Slice 1 — Apply endpoint (deterministic, $0)
`POST /api/employment/:matterId/apply-extraction`
Body: `{ extractionId, fields: { <intakeKey>: true, ... }, overwrite: { <intakeKey>: true, ... } }`
- The lawyer picks WHICH fields apply; nothing is all-or-nothing.
- Default semantics = fills-blanks-only (portal pattern). A non-blank intake field is only changed when it is explicitly listed in `overwrite` (per-field opt-in; the UI shows current vs extracted side by side).
- Whitelist mapping `EXTRACTOR_TO_INTAKE` (extractor field name → intake schema key). Unknown/unwhitelisted fields are ignored and reported back, never silently dropped. A unit test asserts every whitelisted target exists in the intake schema (catches schema drift at test time).
- After merge: recompute gates + timeline via the existing intake-save path; record a timeline event ("Applied N fields from <document>: field, field, ...") and mark the extraction applied (audit: which fields, when, from which doc).
- Response includes a **consequence diff**: any deadline that moved (e.g. termination_date changed → limitation date moved from X to Y), so the lawyer sees the downstream effect immediately.
- Analysis is NOT auto-re-run (LLM cost; lawyer decides). Response flags `analysisStale: true` when applied fields feed the analysis; UI surfaces "Re-run analysis".
- Extraction records gain an `id` at creation; legacy records without ids get index-based ids on read (backfill-on-read, no migration).
- `collective_agreement` extractions are EXCLUDED (they already auto-apply; a second manual path could overwrite the auto-applied values).

### Slice 2 — Review & apply UI (Docs tab)
On each stored extraction card: "Review and apply" opens a table — extracted field | extracted value | confidence chip | current intake value | checkbox. Pre-checked: blank-intake fields only (any confidence; the lawyer is the gate, confidence informs). Non-blank fields render an explicit "replace current value" checkbox, unchecked. Apply button calls slice 1; the applied state then shows what was applied and the consequence diff (moved deadlines). Nothing applies without a click.

### Slice 3 — Draft staleness signal (deterministic)
Stamp `intakeRevisedAt` on every intake mutation (manual save, portal apply, extraction apply). Any stored generated draft whose `createdAt` predates `intakeRevisedAt` renders a banner: "Facts on this matter changed after this draft was generated — regenerate before relying on it." Applies to the draft preview and the Documents tab list. NO auto-regeneration (cost + the-lawyer-decides rule).

### Slice 4 — Tests + walkthrough (the maintenance guarantee)
- Unit: merge semantics (blank fill, overwrite opt-in, unknown-field rejection, CA exclusion, audit event, consequence diff), whitelist↔schema consistency, staleness stamping.
- Integration: seed matter → stub extraction → apply → assert gates recomputed, timeline event present, /api/tasks and the calendar feed reflect a moved date, matter label updates when name fields change (task inbox + Files room labels derive from intake).
- Component: review table renders values/confidence, pre-check rules, apply POSTs the right shape, staleness banner shows/hides.
- Browser walkthrough on the branch + 3 consecutive clean full passes before deploy. Jordan click-through before merge.

## How existing functionality is protected

1. **One write path.** Apply reuses the exact intake-save + recompute code the portal apply uses. Docket, tasks, feed, digest, gates, stage, next steps all derive at read time — no new sync logic to break.
2. **No generator changes.** Drafts already read intake at generation time. Slice 3 only ADDS a banner.
3. **No new LLM surface, no new cost.** Extraction already exists; apply is deterministic.
4. **No schema migration.** Extraction ids backfill on read; intakeRevisedAt is an additive optional field.
5. **Existing tests as the regression net** (1991 backend + 83 viz at head) plus the new suites; 3-clean-pass discipline.

## Risks (and mitigations)

- **R1 — Wrong fact enters a legal document (the real risk).** Extraction is LLM output; a wrong salary or date could flow into an SOC. Mitigations: per-field human gate (nothing applies unchecked), confidence chips, side-by-side current-vs-extracted, consequence diff for dates, provenance recorded, existing generation-time lawyer-review flags, staleness banner. Residual risk is the lawyer approving a wrong value — same residual as any assistant-prepared input, and the audit trail records what came from where.
- **R2 — Overwriting lawyer-entered data.** Mitigated structurally: blanks-only by default, per-field explicit overwrite, audit event, portal precedent.
- **R3 — Deadline shifts.** Changing termination_date silently moves the limitation clock. Mitigated: the recompute is the existing tested path, and the consequence diff makes the shift explicit instead of silent.
- **R4 — Schema drift between extractor names and intake keys.** Mitigated: whitelist + unit test asserting the mapping targets exist; unknown fields reported, not dropped.
- **R5 — Labour CA double-apply.** Excluded kind.
- **R6 — Stale extraction applied over newer facts.** Side-by-side current values + extraction date shown.
- **R7 — Privacy.** No change: the document already goes to Anthropic (ZDR) at extraction time; apply is local and deterministic.
- **R8 — Regression surface.** Touches employment-intake.ts (one new route), MatterDetailView (one panel), types. Dashboard/tasks/labour untouched except via derivations, which the integration tests pin.

## Quote grounding (added 2026-07-21, part of Phase 1 slices 1-2)

The extractor already covers Jordan's per-type asks (employment_agreement: probation_period, verbatim termination_clause_text, verbatim non-compete/non-solicit; termination_letter: dates, just-cause allegations, offer terms; correspondence: key dates, admissions, tone). Accuracy upgrade at the extraction step:
- Extractor returns an optional `sourceQuote` per field: the verbatim sentence the value came from.
- A DETERMINISTIC check at extract time verifies the quote appears in the document text (normalized whitespace); stores `verified: true|false` per field. An LLM can invent a value; it cannot make a string search find a sentence that is not there.
- The review UI shows the quote and a "verified in document" mark, or a warning when unverified — the hallucination tripwire.
- Backward compatible: sourceQuote/verified optional; old stored extractions render without them.

## Phase 2 — Auto-classification (small build, after Phase 1)

Today the lawyer picks the document kind from a dropdown. Upgrade: on upload, a cheap fast-tier call reads the first ~2 pages and returns `{kind, confidence}`; the kind chip arrives pre-selected with a confidence marker and one-click override BEFORE extraction runs. Wrong classification is low-stakes (worst case: wrong prompt ran; re-run with the right kind). Clawern's src/claw/inference.ts is the in-repo precedent. Cost: ~fraction of a cent per doc, metered to usage_events like everything else.

## Phase 3 — Bulk Case File Drop (the headline; depends on Phases 1-2)

Upload up to ~30 documents at once ("drop the file on Starling"):
1. **Classify + extract in parallel** — each doc through its type prompt; progress UI per doc; failures isolated (one bad scan never sinks the batch).
2. **Deterministic master chronology** — every dated fact across all docs merged into one proposed timeline, EACH entry citing its source document; lands behind an approve gate (same as everything).
3. **Conflict surfacing** — when two documents disagree on a field (salary, termination date), the conflict is shown side by side with both sources; the lawyer picks. Never silently first-wins.
4. **Case synthesis memo** — ONE LLM pass over the structured extractions (not the raw pile): narrative of what happened, strengths, contradictions (admission email vs just-cause letter), gaps to fill. Every claim cites its source document. Stored as a generated document with the usual review flags.
5. **Generators draw on the matter, never the pile.** The demand letter / case assessment generates from approved intake + timeline exactly as today. Documents feed the matter through the lawyer's approval; the letter is built from approved facts only.

Pricing note (Jordan): a 30-doc run is roughly $1.50-3 USD real cost -> ~$100-200 CAD billed at the standard multiplier. Decide deliberately whether bulk analysis bills at standard 32x or its own rate before enabling for the pilot firm.

## Out of scope

Auto-regeneration of drafts; auto-apply without review (even high-confidence); labour-side apply beyond the existing CA flow; B2C. Phase 3 explicitly excludes generating any outbound document directly from unreviewed extractions.
