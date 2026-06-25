# DemandPay Starling — Agent Reference

**Version:** 1.0
**Last updated:** 2026-06-16

---

## 1. Agent Registry (25 Defined Agents)

### B2B Agents (17) — Configured for Ontario Employment Law

| # | Agent | Role | Model Tier | Category | One-line Description |
|---|-------|------|-----------|----------|---------------------|
| 1 | `employment-counsel` | Lead analyst | **Opus** | Lawyer — Specialist | Ontario employment law lead. Termination analysis, damages assessment (33 heads), issue identification. Employee-side advocacy. |
| 2 | `litigation-partner` | Senior strategist | **Opus** | Lawyer — Litigation | Adversarial, relentless. Finds every weakness. Thinks like opposing counsel to stress-test positions. |
| 3 | `litigation-associate` | Case builder | Sonnet | Lawyer — Litigation | Research, discovery analysis, motion drafting, evidence review. Builds cases brick by brick. |
| 4 | `contract-reviewer` | First-pass reviewer | Sonnet | Lawyer — Corporate | Employment agreement breadth scan with risk scoring. Refers to Contract Specialist for deep analysis. |
| 5 | `contract-specialist` | Drafting/redlining | Sonnet | Lawyer — Corporate | Contract drafting, redlining, clause-by-clause analysis. Every word deliberate, zero tolerance for ambiguity. |
| 6 | `dispute-resolution` | Settlement pathways | Sonnet | Lawyer — Litigation | Mediation and creative dispute resolution. Finds settlement pathways. Communication-focused. |
| 7 | `junior-associate` | Research support | Sonnet | Lawyer — Junior | Fact extraction, ESA calculations, case summaries, timeline construction. |
| 8 | `paralegal` | Procedural compliance | Sonnet | Lawyer — Junior | Limitation periods, service rules, filing requirements, RoCP compliance, proper parties. |
| 9 | `legal-researcher` | Statute research | Sonnet | Lawyer — Core | Ontario statute search via training knowledge and web. Verifies section numbers. NOT for in-depth case law. |
| 10 | `red-team` | Adversarial tester | **Opus** | Quality | Attacks deliverables from hostile counterparty perspective. Finds vulnerabilities, edge cases, ambiguities. |
| 11 | `synthesis-editor` | Final assembly | **Opus** | Quality | Resolves debate board findings into coherent documents. Preserves source attribution. Maintains consistent voice. |
| 12 | `evaluator` | Quality gate | **Opus** | Quality | 8-dimension rubric evaluation. Different model from specialist to prevent correlated errors. |
| 13 | `design-reviewer` | Document scoring | Sonnet | Quality | Scores documents across readability, findability, clarity, visual design, ethics. Calculates Complexity Tax. |
| 14 | `plain-language-specialist` | Language clarity | Sonnet | Expert — Research | Cognitive load, sentence structure, word choice, readability metrics. Produces rewrite suggestions. |
| 15 | `service-designer` | User journey | Sonnet | Expert — Research | Full user journey analysis: touchpoints, tasks, emotional state, pain points, opportunities. |
| 16 | `ethics-reviewer` | Ethical review | Sonnet | Governance | Evaluates professional responsibility, proportionality, mass-action concerns. Raises concerns, does not block. |
| 17 | `client-relations-partner` | Client comms | Sonnet | Lawyer — Leadership | Generates client updates, drafts status emails, tracks client instructions. |

### Founder Agents (9) — Kept but Not Configured for Ontario Law

These agents exist in the codebase from Lavern's original multi-practice design. They are functional but their prompts are not tuned for Ontario employment law. They may be activated for future practice area expansion.

| # | Agent | Role | Model Tier | Category | One-line Description |
|---|-------|------|-----------|----------|---------------------|
| 18 | `arbitration-specialist` | ADR specialist | Sonnet | Lawyer — Litigation | International arbitration and ADR. ICC/LCIA/UNCITRAL expertise. Diplomatic. |
| 19 | `privacy-counsel` | Data protection | Sonnet | Lawyer — Specialist | GDPR, CCPA, PIPL, cross-border data transfers. Chapter-and-verse regulatory knowledge. |
| 20 | `startup-counsel` | Venture/startup | Sonnet | Lawyer — Corporate | SAFE/convertible note analysis, cap table verification, founder agreement review. |
| 21 | `accessibility-specialist` | WCAG compliance | Sonnet | Expert — Research | Screen reader testing, cognitive load, inclusive design. |
| 22 | `user-researcher` | Usability | Sonnet | Expert — Research | Interview insights, usability findings, comprehension testing, behavioural analysis. |
| 23 | `behavioral-scientist` | Choice architecture | Sonnet | Expert — Research | Cognitive biases, nudge design, decision-making analysis. |
| 24 | `legal-engineer` | Legal tech | Sonnet | Expert — Technology | Automation, document assembly, legal tech integration, computational law. |
| 25 | `ai-ethics-specialist` | AI governance | Sonnet | Expert — Technology | AI regulation, algorithmic bias, model governance, responsible AI. |

---

## 2. Orchestrators (7)

Orchestrators coordinate agents but are not counted in the 25 specialist agents above. They have their own prompt files.

| Orchestrator | Codename | Model Tier | Workflows | Coordination Style |
|-------------|----------|-----------|-----------|-------------------|
| `orchestrator-conductor` | The Conductor | Opus | full-bench, legal-design | Parallel fan-out, debate rounds, multidisciplinary synthesis |
| `orchestrator-closer` | The Closer | Opus | review, pre-engagement | Sequential pipeline, quality gates, linear handoff chains |
| `orchestrator-professor` | The Professor | Opus | adversarial | Stress-testing, citation validation, adversarial challenge-response |
| `orchestrator-fixer` | The Fixer | Opus | counsel | Rapid triage, single-specialist dispatch, minimal overhead |
| `orchestrator-tabulate` | Tabulate | Sonnet | tabulate | Single-pass structured extraction |
| `orchestrator-verification` | Verification | Sonnet | verification | Sequential 8-pass verification pipeline |
| `orchestrator` | Generic | Opus | fallback | Default for unmapped workflows |

---

## 3. Model Tier Summary

| Tier | Agents | Count | Rationale |
|------|--------|-------|-----------|
| **Opus** | employment-counsel, litigation-partner, red-team, synthesis-editor, evaluator | 5 | Lead analysis, adversarial testing, final synthesis, quality gate |
| **Sonnet** | All other specialists | 20 | Structured work, support roles, breadth scans |

---

## 4. Review Chain Flow

How agents run at each step of a typical Review workflow:

```
Step 1: INTAKE
├── Router (Sonnet) — classify request, select workflow
└── Orchestrator (The Closer) — begin coordination

Step 2: FIRST PASS
└── Contract Reviewer (Sonnet) — breadth scan, risk scoring
    ├── Posts findings to debate board
    └── Flags high-risk clauses for deep analysis

Step 3: DEEP ANALYSIS
├── Employment Counsel (Opus) — lead employment law analysis
│   ├── Termination clause analysis (Waksdale)
│   ├── ESA entitlement calculation
│   ├── Bardal factor assessment
│   ├── All 33 damages heads
│   └── Posts findings to debate board
├── Legal Researcher (Sonnet) — statute verification
│   └── Verifies section numbers via web search
└── Paralegal (Sonnet) — procedural compliance
    └── Limitation periods, correct forum

Step 4: ADVERSARIAL TEST
└── Red Team (Opus) — attack from employer's perspective
    ├── Posts challenges to debate board
    ├── Tests exploitable weaknesses
    └── Proposes defence arguments

Step 5: SYNTHESIS
└── Synthesis Editor (Opus) — resolve debates, assemble deliverable
    ├── Resolves debate board conflicts
    ├── Preserves source attribution
    └── Produces final document + audit bundle

Step 6: EVALUATOR GATE
└── Evaluator (Opus) — 8-dimension quality check
    ├── PASS → continue to human gate
    ├── FAIL → return to specialist (max 2 revisions)
    └── FAIL after 2 revisions → escalate to human

Step 7: HUMAN GATE
└── Lawyer reviews output (mandatory, never skipped)

Step 8: DELIVERED
└── Document + audit bundle delivered to lawyer
```

---

## 5. Adversarial (Drafting) Chain Flow

How agents run when drafting a document:

```
Step 1: INTAKE
├── Router (Sonnet) — select adversarial workflow
└── Orchestrator (The Professor) — begin coordination

Step 2: DRAFTING
├── Employment Counsel (Opus) — draft document
│   ├── Issue identification from intake data
│   ├── Entitlement calculation (ESA + Bardal)
│   ├── Demand positioning
│   └── Source attribution throughout
└── Junior Associate (Sonnet) — fact extraction, timeline

Step 3: ADVERSARIAL ATTACK
├── Red Team (Opus) — attack the draft
│   ├── Tests from employer counsel perspective
│   └── Posts challenges to debate board
└── Litigation Partner (Opus) — strategic stress-test
    ├── Forum selection logic
    ├── Settlement range analysis
    └── Posts findings to debate board

Step 4: STRENGTHENING
└── Employment Counsel (Opus) — respond to challenges
    ├── Strengthens weak points
    ├── Addresses defence arguments
    └── Posts responses to debate board

Step 5: SYNTHESIS
└── Synthesis Editor (Opus) — final assembly

Step 6: EVALUATOR GATE
└── Evaluator (Opus) — 8-dimension check

Step 7: HUMAN GATE
└── Lawyer reviews

Step 8: DELIVERED
```

---

## 6. Tool Access Matrix

Which tool categories each agent can use:

| Agent | Debate Board | Scoring | Verification | Memory (Read) | Memory (Write) | Web Search | Learning |
|-------|:----------:|:-------:|:----------:|:------------:|:-------------:|:---------:|:-------:|
| employment-counsel | Yes | -- | -- | Yes | Yes | -- | -- |
| litigation-partner | Yes | -- | -- | Yes | Yes | -- | -- |
| litigation-associate | Yes | -- | -- | Yes | -- | -- | -- |
| contract-reviewer | Yes | Yes | -- | Yes | -- | -- | -- |
| contract-specialist | Yes | Yes | -- | Yes | -- | -- | -- |
| dispute-resolution | Yes | -- | -- | Yes | -- | -- | -- |
| junior-associate | Yes | -- | -- | Yes | -- | -- | -- |
| paralegal | -- | Yes | -- | Yes | -- | -- | -- |
| legal-researcher | Yes | -- | -- | Yes | Yes | **Yes** | -- |
| red-team | Yes | -- | -- | Yes | -- | -- | -- |
| synthesis-editor | Yes | -- | -- | Yes | Yes | -- | Yes |
| evaluator | -- | -- | -- | Yes | -- | -- | -- |
| design-reviewer | Yes | Yes | -- | Yes | -- | -- | -- |
| plain-language-specialist | Yes | Yes | -- | Yes | -- | -- | -- |
| service-designer | Yes | -- | -- | Yes | -- | -- | -- |
| ethics-reviewer | Yes | -- | -- | Yes | -- | -- | -- |
| client-relations-partner | Yes | -- | -- | Yes | Yes | -- | -- |
