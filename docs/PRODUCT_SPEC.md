# DemandPay Starling — Product Specification

**Version:** 1.0
**Last updated:** 2026-06-16
**Status:** Active development

---

## 1. What Is Starling?

Starling is DemandPay's white-labeled fork of Lavern, purpose-built for Ontario employment law. It is the B2B arm of the DemandPay platform.

| Dimension | DemandPay (B2C) | Starling (B2B) |
|-----------|----------------|----------------|
| **Audience** | Individual employees | Law firms |
| **Focus** | Self-service wrongful dismissal claims | AI-assisted legal analysis for lawyers |
| **Interface** | Consumer web app | Professional dashboard |
| **Codebase** | DemandPay (Next.js + Supabase) | Lavern fork (React + Fastify + SQLite) |
| **Branding** | DemandPay consumer brand | DemandPay professional brand (navy/orange/cream) |
| **Revenue** | Contingency / subscription | Per-use billing to law firms |

Starling is not a law firm and does not provide legal advice. It is a tool that assists licenced Ontario lawyers with employment law analysis, drafting, and research.

---

## 2. Design Principles

1. **Task-first, not agent-first.** The lawyer thinks "I need to draft a demand letter", not "I need to configure an adversarial workflow with 5 agents."
2. **Employment law vocabulary.** Every label, button, and description uses terms an Ontario employment lawyer would use. No generic AI platform jargon.
3. **Progressive disclosure.** Show the simple action first. The agent pipeline, debate board, and verification passes are visible during processing, not before.
4. **Cost transparency without anxiety.** Show estimated cost after the user selects a task, not as the primary UI element.
5. **Ontario-only.** Every statute, case, procedure, and spelling is Ontario/Canadian. No American references ever.

---

## 3. The 6 Core Features

### 3.1 Complete Intake

| Field | Detail |
|-------|--------|
| **Purpose** | Process intake transcript or notes into structured issue identification |
| **Workflow** | `counsel` (intake_analysis) |
| **Orchestrator** | The Fixer (rapid triage, single-specialist dispatch) |
| **Inputs** | Intake transcript, client notes, uploaded documents (employment agreement, termination letter, ROE, pay stubs) |
| **Outputs** | Structured issue list, missing document checklist, follow-up questions, preliminary entitlement range |
| **Primary agents** | Employment Counsel (Opus), Junior Associate (Sonnet) |
| **Supporting agents** | Paralegal (Sonnet), Legal Researcher (Sonnet) |
| **Estimated cost** | $1-3 |
| **Estimated time** | 2-4 minutes |

**What it does:** Upload a raw intake transcript or meeting notes. Starling identifies all employment law issues (wrongful dismissal, ESA violations, human rights, constructive dismissal, etc.), flags missing documents, generates follow-up questions for the client, and provides a preliminary entitlement range.

---

### 3.2 Review a Document

| Field | Detail |
|-------|--------|
| **Purpose** | Analyse an employment agreement, termination letter, or other document for risks and issues |
| **Workflow** | `review` (employment_agreement) |
| **Orchestrator** | The Closer (sequential pipeline with quality gates) |
| **Inputs** | Employment agreement, termination letter, severance package, non-compete, or other employment document |
| **Outputs** | Clause-by-clause risk analysis, enforceability assessment, Waksdale termination clause analysis, recommended changes |
| **Primary agents** | Contract Reviewer (Sonnet), Employment Counsel (Opus), Contract Specialist (Sonnet) |
| **Supporting agents** | Red Team (Opus), Evaluator (Opus), Synthesis Editor (Opus) |
| **Estimated cost** | $3-8 |
| **Estimated time** | 5-10 minutes |

**What it does:** Upload an employment agreement or termination package. Starling performs a breadth scan (Contract Reviewer), deep employment law analysis (Employment Counsel), adversarial stress-testing (Red Team), and produces a risk-scored clause-by-clause report with specific recommendations.

---

### 3.3 Draft a Document

| Field | Detail |
|-------|--------|
| **Purpose** | Generate demand letters, statements of claim, mediation briefs, or motion materials |
| **Workflow** | `adversarial` (demand_letter / statement_of_claim) |
| **Orchestrator** | The Professor (adversarial testing, intellectual honesty) |
| **Inputs** | Intake data, supporting documents, document type selection (demand letter, SOC, mediation brief, motion materials, counter-offer, settlement conference brief) |
| **Outputs** | Complete drafted document with source attribution, adversarial stress-test results, verification report |
| **Primary agents** | Employment Counsel (Opus), Litigation Partner (Opus), Red Team (Opus) |
| **Supporting agents** | Junior Associate (Sonnet), Legal Researcher (Sonnet), Paralegal (Sonnet), Synthesis Editor (Opus), Evaluator (Opus) |
| **Estimated cost** | $3-8 |
| **Estimated time** | 3-8 minutes |

**What it does:** Select a document type and provide case details. Starling drafts the document (Employment Counsel), stress-tests it from the employer's perspective (Red Team / Litigation Partner), strengthens weak points, runs 8 verification passes, and delivers a court-ready draft with inline source attribution.

---

### 3.4 Assess a Case

| Field | Detail |
|-------|--------|
| **Purpose** | Quick assessment of case merits, risks, and recommended approach |
| **Workflow** | `counsel` (case_assessment) |
| **Orchestrator** | The Fixer (rapid triage, single-specialist dispatch) |
| **Inputs** | Case summary (free text), supporting documents (optional) |
| **Outputs** | Merits assessment, risk analysis, recommended approach, estimated entitlement range, limitation period warnings |
| **Primary agents** | Employment Counsel (Opus) |
| **Supporting agents** | Legal Researcher (Sonnet), Paralegal (Sonnet) |
| **Estimated cost** | $1-3 |
| **Estimated time** | 2-4 minutes |

**What it does:** Describe the situation briefly. Starling assesses the merits (strong/moderate/weak), identifies all potential claims, estimates entitlement ranges (ESA statutory + Bardal common law), flags limitation period risks, and recommends an approach (demand letter, mediation, litigation, settlement).

---

### 3.5 Analyse Settlement

| Field | Detail |
|-------|--------|
| **Purpose** | Review a settlement offer, calculate net recovery, assess whether to accept or counter |
| **Workflow** | `counsel` (settlement) |
| **Orchestrator** | The Fixer (rapid triage, single-specialist dispatch) |
| **Inputs** | Settlement offer details, employment data, any prior correspondence |
| **Outputs** | Net recovery calculation, comparison to entitlement range, accept/counter recommendation, counter-offer strategy |
| **Primary agents** | Employment Counsel (Opus), Dispute Resolution (Sonnet) |
| **Supporting agents** | Litigation Partner (Opus) |
| **Estimated cost** | $2-4 |
| **Estimated time** | 2-5 minutes |

**What it does:** Upload or describe a settlement offer. Starling calculates net recovery after tax and deductions, compares it to the estimated entitlement range, assesses litigation risk vs. settlement value, and recommends whether to accept, counter, or litigate. If countering, provides a counter-offer strategy with supporting rationale.

---

### 3.6 Extract Data

| Field | Detail |
|-------|--------|
| **Purpose** | Pull key facts, dates, and amounts from documents into structured tabular format |
| **Workflow** | `tabulate` |
| **Orchestrator** | Tabulate orchestrator (single-pass extraction) |
| **Inputs** | One or more documents (employment agreements, termination letters, pay records, benefits summaries) |
| **Outputs** | Structured tables (CSV, DOCX, HTML, JSON) with per-cell source citations and confidence ratings |
| **Primary agents** | Tabulate orchestrator, Junior Associate (Sonnet) |
| **Supporting agents** | Paralegal (Sonnet) |
| **Estimated cost** | $1-3 |
| **Estimated time** | 1-3 minutes |

**What it does:** Upload one or more documents. Starling extracts key data points (employment dates, salary, benefits, termination details, notice period, severance amounts) into structured tables. Every cell includes a source citation back to the original document. Useful for multi-document matters where the lawyer needs facts organised before analysis.

---

## 4. Source Attribution System

Every finding in Starling must cite evidence with a `source_type` tag. There are 5 source types, ranked by trust level:

| Source Type | Trust Level | Description | Example |
|-------------|-------------|-------------|---------|
| `statute` | Highest | Direct statutory reference with section number | ESA s. 57(1) — notice of termination |
| `case_db` | High | Case law from training data or knowledge base | Bardal v Globe & Mail Co, 1960 CanLII 855 (ON SC) |
| `firm_case` | High | Precedent from the firm's institutional memory | Similar outcome in Smith v Acme Corp (firm matter #2024-089) |
| `web_search` | Medium | Result from allowlisted legal domains | CanLII search result, verified |
| `ai_knowledge` | Lowest | Model training knowledge, not independently verified | General legal principle, verify before relying |

**Rules:**
- Every legal proposition must have a source_type tag
- `ai_knowledge` findings must be flagged for lawyer verification
- `web_search` results are restricted to allowlisted Canadian legal domains (see Architecture)
- Fabricated case citations are an auto-fail in the evaluator gate
- More than 30% of citations missing source_type tags triggers an auto-fail

---

## 5. Verification Pipeline

Every deliverable passes through 8 verification dimensions, each weighted:

| Pass | Dimension | Weight | What It Checks | Auto-Fail Triggers |
|------|-----------|--------|----------------|-------------------|
| 1 | Factual Correctness | 0.15 | Names, dates, salary, ESA calculations match intake data | Fabricated case citation |
| 2 | Legal Accuracy | 0.20 | ESA sections correct, Bardal factors applied, case citations accurate, Waksdale analysis correct | ESA calculation error |
| 3 | Completeness | 0.15 | All issues addressed, all damages heads identified, limitation periods noted | Missing demand section in demand letter |
| 4 | Internal Consistency | 0.10 | Salary/service/amounts consistent across document, debate board findings match text | None |
| 5 | Procedural Compliance | 0.15 | Rules of Civil Procedure correct, limitation periods accurate, correct court/tribunal | Wrong court or tribunal |
| 6 | Source Attribution | 0.10 | Every citation tagged with source_type, web sources flagged, unverified assertions marked | >30% citations missing tags |
| 7 | Formal Tone | 0.10 | Professional language, correct legal terms, no emotional appeals or threats | None |
| 8 | Client Alignment | 0.05 | Client objectives reflected, names correct, strategy matches instructions | Client/employer name mismatch |

**Scoring:**
- Each dimension scored 0.0 - 1.0
- Weighted total produces overall score
- Verdict: PASS (score >= 0.8), CONDITIONAL_PASS (0.6-0.8), FAIL (< 0.6)
- Any auto-fail trigger forces dimension score to 0.0 regardless of other factors
- The Evaluator uses Opus model tier, different from most specialists (Sonnet), to prevent correlated errors

---

## 6. Ontario Employment Law Focus

Starling operates exclusively within Ontario and Canadian employment law. Key legal frameworks:

| Framework | Abbreviation | Application |
|-----------|-------------|-------------|
| Employment Standards Act, 2000 | ESA | Statutory minimums (notice, severance, vacation, overtime) |
| Human Rights Code | HRC | Discrimination, harassment, duty to accommodate |
| Rules of Civil Procedure | RoCP | Court procedures, pleadings, motions, mandatory mediation (Rule 24.1) |
| Bardal factors | Bardal | Common law reasonable notice (age, length of service, character of employment, availability of similar employment) |
| Waksdale v Swegon (2020 ONCA 391) | Waksdale | Termination clause invalidity (if any part of termination clause violates ESA, entire clause void) |
| Sagaz Industries (2001 SCC 59) | Sagaz | Employee vs. independent contractor classification (4-factor test) |
| Limitations Act, 2002 | LA | 2-year limitation period for wrongful dismissal claims |
| Canada Labour Code | CLC | Federal jurisdiction employees (banking, telecom, transport) |
| Occupational Health and Safety Act | OHSA | Workplace safety, reprisal protection |
| Pay Equity Act | PEA | Gender-based pay discrimination |

**Spelling convention:** Canadian English throughout. "Licenced" not "licensed". "Analyse" not "analyze" in formal documents. Reference Ontario courts (Superior Court of Justice, Ontario Court of Appeal), the Supreme Court of Canada, the Human Rights Tribunal of Ontario, and the Ontario Labour Relations Board.
