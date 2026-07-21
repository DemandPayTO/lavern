# DemandPay Starling — Build Roadmap by Vertical

**Status:** drafted 2026-07-07 for Jordan's prioritization. Everything below is *proposed*, ordered by value within each vertical. The bar for inclusion: it pushes matters forward (workflow), it is not document storage (Clio's job) and not research (Westlaw's job).

---

## Employment side (plaintiff)

1. **Negotiation ledger.** Track every offer and counter on the matter (amount, date, terms, who moved) with the live delta against the assessed entitlement range. The negotiation IS the product's core moment and today it lives in the lawyer's head. Deterministic, feeds stage/next-steps, and gives outcome capture richer calibration data.
2. **Net-settlement calculator.** Deterministic after-tax comparison of settlement structures: lump sum vs salary continuance, retiring-allowance RRSP eligibility, EI repayment interaction, legal-fee deductibility. The single most-asked client question at resolution; pairs with the minutes of settlement generator. (Flag outputs for accountant confirmation.)
3. **More correspondence sequences.** The engine is generic; add: retainer welcome + expectations, settlement-instructions confirmation, and the closing letter with file-retention notice. Each is a template plus a trigger.
4. **Small Claims completion.** Default judgment (11B) narrative + data sheet, settlement conference memo tailored to the SCC form, trial-ready checklist. The 7A filing sheet and pre-trial brief already exist.
5. **Discovery slice (Simplified Procedure).** Affidavit of documents (30A/30B) built from the matter's document extractions, undertakings/refusals tracker with docketed follow-ups. This is the biggest post-pleadings workflow gap.
6. **Outcome intelligence.** Once outcome capture accumulates (~20+ closed matters): "matters like this settled at X% of assessed range in Y weeks" on the matter view. The data pipeline already exists; this is a query + panel.

## Labour side (union-side firms)

1. **Hearing bundle.** Will-say statements per witness, agreed-statement-of-facts skeleton, book-of-documents index, closing-argument skeleton keyed to the Wm Scott/KVP framework already in the gates. Deferred from Phase C; the most-requested arbitration prep artifact.
2. **Award + settlement tracking per CA.** Record arbitration outcomes against the bargaining-unit profile (ca_profiles) so the next grievance under the same CA shows what this employer/arbitrator history looks like. Institutional memory, not research.
3. **Bargaining clocks.** Notice to bargain (LRA s. 16/59), conciliation, no-board report + 17-day countdown, strike/lockout vote timing. Same deterministic clock engine as grievance steps; unions live and die by these dates.
4. **OLRB expansion.** Certification and ULP data files on the proven XFA pattern; the A-29/A-30 and A-53/A-54 pipelines are the template.
5. **Group/policy grievance handling.** One issue, many grievors: shared facts with per-grievor remedy lines feeding the remedy worksheet.

## Union side (unions as direct clients / in-house)

1. **Steward intake portal.** The client-intake-portal pattern pointed at stewards: a tokenized first-report form (who, what, when, article) that lands as a pending grievance for counsel review. Gets facts in while they are fresh, from the people who have them.
2. **Roles.** Steward (submit + view own unit), union officer (unit dashboards), counsel (everything). The auth layer supports it; this is a permissions + view-filtering feature. Prerequisite for selling to unions rather than firms.
3. **Bargaining-unit dashboard.** Per-unit grievance metrics from data Starling already holds: volume by article, stage distribution, time-to-resolution, win/settle rates, upcoming clock jeopardy. Union executives report to members; give them the report.
4. **Per-unit pricing.** The usage ledger already meters per matter; unit-level rollups make per-bargaining-unit pricing (the model the CA library shape suggests) invoiceable.
5. **Duty-of-fair-representation file discipline.** The DFR trio exists; add a per-decision DFR checklist record (considered, communicated, documented) so every declined grievance carries its own s. 74 defence file.

## Cross-cutting (all verticals)

- **SharePoint document save** (Microsoft Graph, deferred to post-pilot). Auto-save generated documents into the firm's SharePoint / OneDrive so lawyers skip the download-then-upload step. Build: register a multi-tenant Entra ID app; per-firm OAuth admin-consent flow; store the refresh token per firm (tenant-scoped); on "mark reviewed/filed", write the DOCX to a configured SharePoint library path. Scope is **write-only of Starling's own outputs** — never read the firm's whole document store (that is Clio/iManage's job) and never send or file anything (Starling's standing rule). Privacy note: generated docs already exist in Starling; pushing them to SharePoint adds no new client-data exposure to Anthropic. Prerequisite: the firm's M365 admin consents once. Not for the pilot — the manual download→SharePoint flow is fine for two lawyers; revisit when a firm asks or the doc volume makes the manual step a real cost.
- **Matter file export** (approved low priority): one-click bundle of everything Starling holds on a matter — the exit guarantee.
- **Multi-lawyer visibility** within a firm (assignment, per-lawyer docket filters) once the pilot adds a second lawyer.
- **Pricing activation:** set the two usage knobs after the pilot month's ledger data is in.

## Explicitly out of scope (decided)

Document management (Clio/iManage), legal research (Westlaw/Lexis), employer-side employment defence, Clio integration, conflicts checking, auto-sending anything to clients or tribunals.
