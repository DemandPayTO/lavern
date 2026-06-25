# DemandPay Starling — Architecture Overview

**Version:** 1.0
**Last updated:** 2026-06-16

---

## 1. System Diagram

```
                     ┌──────────────────────────────────────────────┐
                     │              LAWYER (Browser)                │
                     │                                              │
                     │   Task Selection → Upload → Processing →    │
                     │   Results → Export                           │
                     └───────────────────┬──────────────────────────┘
                                         │ HTTPS / WebSocket
                                         ▼
                     ┌──────────────────────────────────────────────┐
                     │         STARLING DASHBOARD (React SPA)       │
                     │                                              │
                     │   viz/src/  — React + Vite + TypeScript      │
                     │   DemandPay brand (navy/orange/cream)        │
                     │   Task-card UI, real-time progress,          │
                     │   tabbed results with source attribution     │
                     └───────────────────┬──────────────────────────┘
                                         │ REST API + WebSocket events
                                         ▼
┌────────────────────────────────────────────────────────────────────────────┐
│                         STARLING API (Fastify)                            │
│                                                                           │
│   src/api/        — 27 route modules, Zod validation                      │
│   src/router/     — LLM-based request router + deterministic fallback     │
│   src/dispatch.ts — Session dispatch (workflow selection, budget)          │
│   src/orchestrator.ts — Core orchestration loop                           │
│                                                                           │
│   ┌─────────────┐  ┌─────────────┐  ┌──────────────┐  ┌──────────────┐   │
│   │   Router     │  │ Orchestrator│  │  Specialist  │  │  Evaluator   │   │
│   │  (Sonnet)    │→ │  (4 types)  │→ │   Agents     │→ │    Gate      │   │
│   │             │  │             │  │  (25 agents) │  │   (Opus)     │   │
│   └─────────────┘  └─────────────┘  └──────────────┘  └──────────────┘   │
│         │                │                  │                 │            │
│         ▼                ▼                  ▼                 ▼            │
│   ┌──────────────────────────────────────────────────────────────────┐    │
│   │                    MCP Tool Layer (21 modules)                    │    │
│   │                                                                  │    │
│   │  Debate Board  │  Scoring Engine  │  Verification Engine         │    │
│   │  Memory System │  Knowledge Base  │  Risk Pricing                │    │
│   │  Report Cards  │  Quality Checks  │  Handoffs                    │    │
│   │  Feedback Loop │  Document Reader │  Grounding Verifier          │    │
│   └──────────────────────────────────────────────────────────────────┘    │
│         │                                                                 │
│         ▼                                                                 │
│   ┌──────────────────────────────────────────────────────────────────┐    │
│   │                     Data Layer                                    │    │
│   │                                                                  │    │
│   │  SQLite DB         │  Knowledge Base (FTS5)  │  Audit Logs       │    │
│   │  (sessions,        │  (statutes, precedents, │  (append-only     │    │
│   │   memory, auth)    │   institutional memory) │   JSON lines)     │    │
│   └──────────────────────────────────────────────────────────────────┘    │
│         │                                                                 │
│         ▼                                                                 │
│   ┌──────────────────────────────────────────────────────────────────┐    │
│   │                  Claude API (Anthropic)                           │    │
│   │                                                                  │    │
│   │  Opus agents: employment-counsel, litigation-partner, red-team,  │    │
│   │               synthesis-editor, evaluator                        │    │
│   │  Sonnet agents: 20 specialist + support agents                   │    │
│   │  Sonnet router: request classification + workflow selection       │    │
│   └──────────────────────────────────────────────────────────────────┘    │
└────────────────────────────────────────────────────────────────────────────┘
```

---

## 2. Technology Stack

| Layer | Technology | Purpose |
|-------|-----------|---------|
| **Frontend** | React 18 + TypeScript + Vite | Single-page dashboard |
| **Styling** | CSS (editorial design language) | DemandPay brand: Inter + Georgia, navy/orange/cream |
| **Backend** | Fastify (Node.js) | REST API + WebSocket event streaming |
| **LLM Provider** | Anthropic Claude (Opus + Sonnet) | Multi-agent pipeline |
| **Alt Provider** | Mistral AI | EU-sovereign alternative |
| **Local Provider** | Ollama (gemma3:4b) | Zero-egress confidential document path |
| **Database** | SQLite | Sessions, user auth, matter storage, session archive |
| **Search** | SQLite FTS5 | Knowledge base full-text search |
| **Document Parsing** | Custom parser | PDF, DOCX, Markdown, plain text |
| **Document Assembly** | Custom assembler | HTML, DOCX output |
| **Real-time** | WebSocket (Fastify) | Event streaming to dashboard |
| **Validation** | Zod | Request/response schema validation |
| **Auth** | Cookie-based (gated) | Multi-user auth when `LAVERN_AUTH_ENABLED=true` |
| **Monitoring** | Plausible Analytics | Privacy-respecting usage analytics |
| **Error Tracking** | Sentry | Production error monitoring |
| **Testing** | Vitest | 1,677 tests across 109 files |

---

## 3. Multi-Agent Pipeline Flow

Every request follows this pipeline:

```
REQUEST IN
    │
    ▼
┌─────────┐
│  ROUTER  │  Classify request → select workflow → select minimum viable pipeline
│ (Sonnet) │  Budget: $0.01
└────┬─────┘
     │
     ▼
┌──────────────┐
│ ORCHESTRATOR  │  Coordinate agents, manage turns, enforce step order
│  (4 types)    │  Selected by workflow type (see Orchestrator Mapping)
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ SPECIALIST(S) │  Execute analysis, drafting, research, review
│              │  Post findings to debate board
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ DEBATE BOARD  │  Agents challenge each other's findings
│              │  Post challenges, responses, rebuttals
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  SYNTHESIS    │  Resolve debates, assemble final deliverable
│  EDITOR       │  Preserve source attribution, consistent voice
│  (Opus)       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│  EVALUATOR    │  8-dimension quality gate (different model tier)
│    GATE       │  PASS → deliver | FAIL → revise (max 2x) → escalate
│  (Opus)       │
└──────┬───────┘
       │
       ▼
┌──────────────┐
│ HUMAN GATE    │  Mandatory lawyer review before delivery
│              │  Never skipped — enforced by architecture
└──────┬───────┘
       │
       ▼
   DELIVERY
```

---

## 4. Orchestrator Mapping

Four orchestrator types, each specialised for a coordination pattern:

| Orchestrator | Codename | Workflows | Coordination Pattern |
|-------------|----------|-----------|---------------------|
| The Conductor | `orchestrator-conductor` | `full-bench`, `legal-design` | Multidisciplinary synthesis, parallel fan-out, debate rounds |
| The Closer | `orchestrator-closer` | `review`, `pre-engagement` | Sequential pipeline with quality gates, linear handoff chains |
| The Professor | `orchestrator-professor` | `adversarial` | Stress-testing, citation validation, adversarial challenge-response |
| The Fixer | `orchestrator-fixer` | `counsel` | Rapid triage, single-specialist dispatch, minimal overhead |

Additional single-purpose orchestrators: `orchestrator-tabulate`, `orchestrator-verification`.

---

## 5. Model Tier Strategy

| Tier | Model | Cost | Used By | Rationale |
|------|-------|------|---------|-----------|
| **Opus** | claude-opus-4-8 | Higher | employment-counsel, litigation-partner, red-team, synthesis-editor, evaluator | Lead analysts, adversarial testing, final synthesis, quality gate — need strongest reasoning |
| **Sonnet** | claude-sonnet-4-5 | Lower | 20 remaining specialist + support agents, router | Breadth scans, procedural compliance, research, support roles — structured work, Sonnet sufficient |

**Key design rule:** The Evaluator always uses a different model tier than the specialist it evaluates to prevent correlated errors (where two instances of the same model make the same mistake).

---

## 6. Workflow-to-Agent Team Routing

| Workflow | Template ID | Steps | Required Agents |
|----------|------------|-------|-----------------|
| Counsel | `counsel` | intake → specialist_execution → delivered | employment-counsel |
| Review | `review` | intake → first_pass → deep_analysis → adversarial_test → synthesis → evaluator_gate → human_gate → delivered | contract-reviewer, employment-counsel, red-team, synthesis-editor, evaluator |
| Adversarial | `adversarial` | intake → drafting → adversarial_attack → strengthening → synthesis → evaluator_gate → human_gate → delivered | employment-counsel, litigation-partner, red-team, synthesis-editor, evaluator |
| Full Bench | `full-bench` | intake → parallel_analysis → debate → synthesis → evaluator_gate → human_gate → delivered | Multiple specialists in parallel + synthesis-editor + evaluator |
| Tabulate | `tabulate` | intake → specialist_execution → delivered | Tabulate orchestrator |
| Verification | `verification` | intake → verification_pipeline → report_compilation → final_gate → delivered | Evaluator, multiple verification passes |

---

## 7. Web Search Allowlist

Web search is restricted to allowlisted Canadian legal domains only. All other domains are blocked at the API call level.

| Category | Domains |
|----------|---------|
| **Courts & Tribunals** | canlii.org, ontariocourts.ca, scc-csc.ca, tribunalsontario.ca |
| **Government** | ontario.ca, canada.ca, laws-lois.justice.gc.ca |
| **Law Society** | lso.ca |
| **Legal Publishers** | lexisnexis.ca, thecourt.ca, mondaq.com, slaw.ca |
| **Reputable Firm Blogs** | hicksmorley.com, sherrardkuzz.com, stringerllp.com, mccarthy.ca, torys.com, blg.com, fasken.com, osler.com, ogilvyrenault.com, dentons.com |

---

## 8. Knowledge Base System

| Component | Technology | Purpose |
|-----------|-----------|---------|
| **Full-Text Search** | SQLite FTS5 | Fast retrieval of statutes, cases, and institutional memory |
| **Institutional Memory** | SQLite + MCP tools | Cross-matter learnings, firm rules, preferences (PII-isolated per matter) |
| **Precedent Board** | SQLite | Cross-document finding persistence, O(1) dedup, relevance search, decay + compaction |
| **Matter Memory** | SQLite | Per-session state, findings, debate history |
| **Baselines** | File system | Quality baselines for regression testing |
| **Report Cards** | File system | Agent performance tracking |
| **Legal Datasets** | Seeder script | CUAD, MAUD, ACORD, UNFAIR-ToS, LEDGAR (all CC BY or CC BY-SA) |

---

## 9. MCP Tool Architecture

21 MCP tool modules exposed to agents via the `mcp__shem__` namespace:

| Module | Tools | Used By |
|--------|-------|---------|
| `debate-board` | post_finding, decline_to_find, post_challenge, post_response, get_findings, get_challenges, get_debate_summary, get_unresolved_debates | All specialists |
| `scoring-engine` | calculate_complexity_tax, calculate_readability_score, calculate_findability_score, compare_before_after | Design reviewer, contract reviewer, paralegal |
| `verification-engine` | run_self_verification, run_cross_verification, run_score_verification, get_verification_summary | Evaluator, verification workflow |
| `memory-system` | query_institutional_memory, load_matter_memory, query_precedents, add_institutional_memory, save_matter_memory, save_precedent | All agents (read), orchestrators + synthesis-editor (write) |
| `knowledge-base` | FTS5 search, retrieval | All agents |
| `risk-pricing` | request_risk_assessment, record_risk_assessment | Verification workflow |
| `report-card` | get_report_card, get_quality_trend | Synthesis editor |
| `quality-check` | check_against_baseline, run_regression_test | Synthesis editor |
| `handoff` | submit_handoff, get_handoffs | Orchestrators |
| `feedback-loop` | get_legal_md, query_anti_patterns | Synthesis editor |
| `document-reader` | read_document_section, search_document | All agents |
| `grounding-verifier` | Ground-truth verification | Evaluator |

---

## 10. Budget and Cost Controls

| Control | Default | Configurable Via |
|---------|---------|-----------------|
| **Per-session budget** | $5.00 USD | `SHEM_DEFAULT_BUDGET` |
| **Router budget** | $0.01 USD | Hardcoded |
| **Daily spend cap** | $500.00 USD | `LAVERN_DAILY_SPEND_CAP_USD` |
| **Max turns per session** | 80 | `SHEM_MAX_TURNS` |
| **Max agent turns** | 6-12 (varies by agent) | Per-agent `maxTurns` in definitions |
| **Owner alert** | At 80% of daily cap | `LAVERN_OWNER_WEBHOOK` |
| **Session TTL** | 4 hours | `SHEM_SESSION_TTL_MS` |
| **Max concurrent sessions** | 100 | `SHEM_MAX_SESSIONS` |

---

## 11. Future: DemandPay Integration

Starling will connect to the DemandPay platform (Supabase) via:

| Integration Point | Direction | Purpose |
|-------------------|-----------|---------|
| `matter_generators` table | Starling → DemandPay | Link Starling analyses to DemandPay matter records |
| Case intake data | DemandPay → Starling | Pre-populate Starling tasks with B2C intake data |
| Deliverable export | Starling → DemandPay | Push drafted documents to the lawyer's DemandPay dashboard |
| Billing | Starling → DemandPay | Per-use charges aggregated on the firm's DemandPay invoice |
