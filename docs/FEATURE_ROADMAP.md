# DemandPay Starling — Feature Roadmap

**Last updated:** June 25, 2026

---

## Completed

| Feature | Status | Date | Notes |
|---------|--------|------|-------|
| Strip 35 unused agents | Done | Jun 25 | 32 agents retained (17 B2B + 7 orchestrators + 8 Founder) |
| Rewrite 17 B2B agent prompts for Ontario employment law | Done | Jun 25 | 33 damages heads in Employment Counsel |
| Tiered model assignments (5 Opus, 20 Sonnet) | Done | Jun 25 | Orchestrator on Sonnet to control costs |
| Web search domain allowlist | Done | Jun 25 | Canadian legal domains only |
| 8 verification passes | Done | Jun 25 | Ontario employment law specific |
| Employment law router (7 rules) | Done | Jun 25 | Routes to correct agent teams by task type |
| White-label branding (Lavern → DemandPay Starling) | Done | Jun 25 | All agent prompts + UI text + CSS tokens |
| UI overhaul Phase 2: Dashboard | Done | Jun 25 | Matter-centric dashboard with auto-status |
| UI overhaul Phases 3-4: New Matter, Matter Detail, Processing, Results | Done | Jun 25 | 5 React views matching approved mockups |
| Grounding verifier utility (DemandPay repo) | Done | Jun 24 | Ported from Lavern, zero LLM cost |
| Quality gate utility (DemandPay repo) | Done | Jun 24 | 5-dimension Sonnet quality scoring |
| Adversarial prompts library (DemandPay repo) | Done | Jun 24 | Ontario red-team + synthesis prompts |
| Vector search activation — migration + Edge Function (DemandPay repo) | Done | Jun 24 | legal_cases embedding column + generateCaseEmbeddings |
| Firm case library — migration + RPC (DemandPay repo) | Done | Jun 24 | firm_cases table + match_firm_cases() |
| Research endpoint (DemandPay repo) | Done | Jun 24 | researchMatterIssues Edge Function |

---

## In Progress

| Feature | Status | Blocked by | Notes |
|---------|--------|------------|-------|
| UI overhaul Phase 5: Status monitor + weekly digest | Planned | Phases 2-4 done | Auto-infer status from activity, limitation tracking, Monday email |
| Wire Starling views to real API (replace demo data) | Planned | UI views done | Connect dashboard to SQLite matters, processing to WebSocket events |
| Connect Starling to DemandPay (API integration) | Planned | Step 6 in plan | Edge Functions call Starling API, results to matter_generators |

---

## Planned — Near Term

### P0 — Required for pilot

| Feature | Description | Effort | Dependencies |
|---------|-------------|--------|-------------|
| **Wire views to real data** | Replace demo data in all 5 views with real API calls to Starling backend | 3-5 days | Views done |
| **Status monitor** | Auto-infer matter status from activity timestamps + limitation dates. No manual updates. | 2-3 days | Matter tracking in SQLite |
| **Weekly digest email** | Monday 9 AM summary of all matters with urgency flags. Uses existing notification system. | 1-2 days | Status monitor |
| **Document export (DOCX/PDF)** | Generate downloadable DOCX and PDF from Starling results. Lavern has format-converter.ts. | 1-2 days | Results view |
| **Prompt review by Jordan** | Jordan reviews Employment Counsel and Red Team prompts for legal accuracy | — | Prompts written |

### P1 — Important for pilot quality

| Feature | Description | Effort | Dependencies |
|---------|-------------|--------|-------------|
| **Upload and process real documents** | Wire file upload in New Matter to Starling's document parser | 2-3 days | New Matter view |
| **Institutional memory seeding** | Pre-seed with Ontario employment law patterns (Bardal ranges, Waksdale leverage, etc.) | 1-2 days | — |
| **Cornerstone case uploads** | Upload key Ontario cases to knowledge base for agent retrieval | Ongoing | Knowledge base system |
| **9 Founder agent prompt rewrites** | Adapt Founder agents for Canadian/DemandPay context | 2-3 days | — |

---

## Planned — Medium Term

### P2 — Usage-Based Pricing

| Feature | Description | Effort | Dependencies |
|---------|-------------|--------|-------------|
| **Usage aggregation service** | Sum API costs per user/firm per billing period from existing metering data | 2-3 days | Metering already built |
| **Pricing markup configuration** | Configure price = API cost × markup (3-5x). Per-matter and per-document rates. | 1 day | Usage aggregation |
| **Stripe metered billing (B2B)** | Connect Starling usage tracking to Stripe metered subscriptions for law firms | 3-5 days | Usage aggregation, Stripe |
| **Stripe usage billing (B2C)** | Connect DemandPay audit_logs usage data to Stripe for individual users | 3-5 days | Stripe integration exists |
| **Usage dashboard (B2B)** | Firm-facing view: matters this month, cost per matter, monthly total, billing history | 2-3 days | Usage aggregation |
| **Usage dashboard (B2C)** | User-facing view: actions taken, credits remaining, cost breakdown | 2-3 days | Usage aggregation |

**Pricing models under consideration:**

B2B (law firms):
- Subscription + per-matter overage: $299/mo includes 30 matters, $8/matter after
- Per-document: $10/demand letter, $15/SOC, $5/intake analysis
- Token pass-through + markup: API cost × 3-5x

B2C (individuals):
- Current: $389 flat package (keep as default)
- Future: lower base ($99) + per-document usage charges
- Usage tracking runs behind the scenes now to collect data before switching

### P3 — Pricing & Billing

**Pilot phase (first 3 months): free.** Firm is beta testing. Track all usage data.

**Post-pilot pricing tiers:**

| Component | Monthly | What's included |
|-----------|---------|-----------------|
| **Firm Base** | $249 | Platform access, 1 lawyer seat, 5 documents/month, unlimited assessments, institutional memory, matter management, weekly digest |
| **Additional seat** | $199/lawyer | Unlimited case assessments, intake analysis, document review, shared document pool |
| **Extra documents** | $29/document | Demand letters, SOCs, mediation briefs, motion materials beyond monthly allocation |

**Revenue examples:**

| Firm size | Subscription | Seats | Documents (~8/mo) | Total |
|-----------|-------------|-------|-------------------|-------|
| Solo | $249 | Included | 3 extra × $29 | ~$336/mo |
| 2-person | $249 | + $199 | 3 extra × $29 | ~$535/mo |
| 2-person (heavy) | $249 | + $199 | 10 extra × $29 | ~$738/mo |
| 5-person | $249 | + 4 × $199 | 15 extra × $29 | ~$1,480/mo |

**Margins:**

| Action | API cost | Charged | Margin |
|--------|----------|---------|--------|
| Case assessment | $0.30-$0.40 | Included in seat | Bundled |
| Intake analysis | $0.50-$1.00 | Included in seat | Bundled |
| Document review | $1-$2 | Included in seat | Bundled |
| Demand letter generation | $3-$5 | $29/document | 6-10x |
| SOC generation | $5-$8 | $29/document | 4-6x |

**Target:** ~$300 average revenue per lawyer per month.

**Implementation:**

| Feature | Description | Effort | Dependencies |
|---------|-------------|--------|-------------|
| **Usage metering** | Track actions per user per billing period from existing spend tracker | 2-3 days | Spend tracker (built-in) |
| **Stripe metered billing** | Connect usage data to Stripe metered subscriptions | 3-5 days | Stripe account |
| **Firm billing dashboard** | Firm admin sees: matters this month, documents generated, cost, invoice | 2-3 days | Usage metering |
| **Document quota enforcement** | Track included vs overage documents per billing period | 1-2 days | Usage metering |

**Pricing data to collect during pilot:**
- Average matters per lawyer per month
- Average documents generated per matter
- Average assessments/reviews per lawyer per month
- Which features drive the most usage
- Total API cost per firm per month

### P4 — Document Management Integration

| Feature | Description | Effort | Dependencies |
|---------|-------------|--------|-------------|
| **SharePoint connector** | Browse firm's SharePoint folders from Starling, pull documents in | 5-7 days | Microsoft Graph API, OAuth2 |
| **SharePoint two-way sync** | Generated documents (demand letters, SOCs) auto-appear in firm's SharePoint matter folder | 3-5 days | SharePoint connector |
| **Supabase Storage backend** | Move file storage from local disk to Supabase Storage (ca-central-1) for multi-user | 3-5 days | Supabase infrastructure |
| **Clio connector** | Integration with Clio practice management (common for Ontario firms) | 5-7 days | Clio API |
| **iManage connector** | Integration for large firms using iManage DMS | 7-10 days | iManage API license |

### P5 — Advanced Features

| Feature | Description | Effort | Dependencies |
|---------|-------------|--------|-------------|
| **RoCP full statute integration** | Searchable Ontario Rules of Civil Procedure database | 5-7 days | Jordan provides RoCP text |
| **Key ESA/HRC section uploads** | Upload repeatable statute sections as reference documents | 1-2 days | Jordan provides content |
| **Cross-matter learning** | Institutional memory learns patterns across matters within a firm | Built-in | Usage over time |
| **Precedent board** | Successful patterns confirmed/deprecated across engagements | Built-in | Usage over time |
| **Multi-user support** | Multiple lawyers at same firm using Starling with shared matters | 5-7 days | Auth system, Supabase Storage |
| **Custom agent builder** | Firm creates their own specialist agents (already in Lavern, hidden) | 1-2 days (unhide) | — |

---

## Not Planned (Removed)

| Feature | Reason |
|---------|--------|
| In-depth case law research | Lawyer handles via Westlaw. Starling does statute-based research only. |
| Case matching / research memos | Removed from scope — lawyer does their own research. |
| Analyze Settlement (standalone) | Merged into matter actions — not a separate workflow. |
| Generic legal platform features (NDA review, ToS analysis, etc.) | Starling is Ontario employment law only. |
| Clawern background daemon | Not relevant for B2B employment law use case. |
| Lavern Challenge | Marketing feature, removed. |

---

## Infrastructure (Both Repos)

| Item | Repo | Status | Notes |
|------|------|--------|-------|
| legal_cases embedding column | demand-pay-app | On branch | Migration ready, needs deploy |
| firm_cases table + RPC | demand-pay-app | On branch | Migration ready, needs deploy |
| generateCaseEmbeddings Edge Function | demand-pay-app | On branch | Admin batch job ready |
| researchMatterIssues Edge Function | demand-pay-app | On branch | Combined research endpoint ready |
| groundingVerifier.ts | demand-pay-app | On branch | Zero LLM cost citation verification |
| qualityGate.ts | demand-pay-app | On branch | 5-dimension Sonnet quality scoring |
| adversarialPrompts.ts | demand-pay-app | On branch | Ontario red-team + synthesis prompts |
