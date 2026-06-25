# DemandPay Starling — Platform Rules

**Version:** 1.0
**Last updated:** 2026-06-16

Non-negotiable rules for Starling development and operation. Extracted from CLAUDE.md, agent prompts, and system configuration. Violations of any rule marked HARD are system failures.

---

## Rules Table

| # | Rule | Summary | Why | Applies To | Severity |
|---|------|---------|-----|-----------|----------|
| 1 | **Cite evidence for every finding** | Every finding posted to the debate board must cite specific text as evidence with a `source_type` tag (statute, case_db, firm_case, ai_knowledge, web_search) | Unsourced assertions are unverifiable and potentially fabricated | All specialist agents | HARD |
| 2 | **Never fabricate case citations** | Only cite cases provided in retrieved context or verified via web search. If a case cannot be verified, do not cite it. | Fabricated citations destroy lawyer credibility and may constitute professional misconduct | All agents | HARD |
| 3 | **Ontario law only** | Never reference American statutes, agencies, courts, or procedures. No EEOC, no FLSA, no at-will employment, no Title VII. | Starling operates in Ontario. American law does not apply and would mislead the lawyer. | All agents | HARD |
| 4 | **Canadian spelling** | Use "licenced" not "licensed", "analyse" not "analyze" in formal documents. Reference Ontario courts by correct name. | Professional correspondence in Ontario uses Canadian English. American spelling signals carelessness. | All agents, UI copy | SOFT |
| 5 | **Human gates mandatory** | Human review is required before every delivery. Never skip, bypass, or auto-approve a human gate. | The lawyer must review AI output before it reaches the client or the court. This is a professional responsibility requirement. | System architecture | HARD |
| 6 | **All 8 verification passes must run** | Every deliverable must pass through all 8 evaluation dimensions: factual correctness, legal accuracy, completeness, internal consistency, procedural compliance, source attribution, formal tone, client alignment. | Partial verification misses categories of error. The 8-pass system was designed to catch correlated failures. | Evaluator agent, verification workflow | HARD |
| 7 | **Evaluator uses different model tier** | The Evaluator (Opus) must use a different model than the specialist it evaluates (typically Sonnet) to prevent correlated errors. | Two instances of the same model make the same mistakes. Model diversity is the primary defence against correlated failures. | Evaluator agent | HARD |
| 8 | **Web search restricted to allowlist** | Web search only queries allowlisted Canadian legal domains (canlii.org, ontario.ca, scc-csc.ca, etc.). All other domains are blocked. | Unrestricted web search introduces unreliable sources, American law, and potential prompt injection via web content. | Legal Researcher, all web-search-enabled agents | HARD |
| 9 | **Budget cap enforced per session** | Each session has a budget cap (default $5 USD). Agents cannot exceed it. Daily platform spend cap ($500 USD) blocks new sessions when reached. | Runaway agent loops can consume unbounded API credits. Budget caps are the safety net. | Orchestrator, dispatch | HARD |
| 10 | **Institutional memory must not leak PII** | Client data in institutional memory is isolated per matter. Precedents saved to the precedent board must be anonymised. No client names, amounts, or identifying details in cross-matter memory. | Law firms have ethical obligations to maintain client confidentiality across matters. PII leakage is a regulatory violation. | Memory system, all agents that write to memory | HARD |
| 11 | **Legal effect must remain identical** | When transforming, redesigning, or summarising a legal document, the legal effect must be preserved exactly. Monetary amounts, time periods, jurisdiction, termination triggers, and defined terms cannot be altered. | Changing legal effect through transformation is malpractice. A "simplified" contract that changes the deal is worse than the original. | All agents, synthesis editor | HARD |
| 12 | **Debate is a feature** | Agents should challenge each other's findings. Disagreement is expected and valuable. The debate board exists to surface genuine conflicts, not to rubber-stamp the first analysis. | Consensus without challenge produces correlated errors. Multi-agent value comes from genuine disagreement that forces stronger reasoning. | All specialist agents | DESIGN |
| 13 | **Decline rather than guess** | When an agent cannot make a confident determination (confidence < 0.5), it must use `decline_to_find` instead of posting a low-confidence finding. | A declined finding triggers human review. A wrong finding causes harm. Honesty about uncertainty is a feature. | All specialist agents | HARD |
| 14 | **ESA calculations independently verified** | Every ESA notice (s. 57-58) and severance (s. 64) calculation in a deliverable must be independently recalculated by the Evaluator. Arithmetic errors are an auto-fail. | ESA calculations are the most common source of error. An incorrect calculation in a demand letter undermines the entire claim. | Evaluator agent | HARD |
| 15 | **Limitation periods always flagged** | Every case assessment and deliverable must identify relevant limitation periods (2 years Limitations Act, 1 year HRTO, 90 days CLC). Missing a limitation period is a critical failure. | A missed limitation period can extinguish the client's claim entirely. This is the most consequential error a lawyer can make. | Employment Counsel, Paralegal, Evaluator | HARD |
| 16 | **Correct court or tribunal** | Documents must reference the correct forum (Superior Court of Justice for wrongful dismissal, HRTO for human rights, OLRB for labour relations). Wrong forum is an auto-fail. | Filing in the wrong court wastes time and money. HRTO for wrongful dismissal or Superior Court for an ESA complaint are fundamental errors. | All agents, Evaluator | HARD |
| 17 | **Cost tracking transparent** | Every session logs cumulative API cost. The cost is visible to the lawyer in real-time during processing. Cost logs are part of the audit bundle. | Lawyers need to know what they are spending. Hidden costs erode trust. | Hooks, session state, UI | DESIGN |
| 18 | **Audit bundle ships with every deliverable** | Every engagement produces an audit bundle: structured findings, debate resolutions, verification results, cost log. This is separate from the deliverable itself. | The audit trail is the lawyer's evidence that AI-assisted work was properly supervised and verified. | Synthesis editor, delivery | HARD |
| 19 | **Agent maxTurns enforced** | Each agent has a hard cap on turns (6-12 depending on role) to prevent runaway costs from compound failure rates. | Long agent loops compound errors. A 10-turn agent that fails on turn 3 wastes 7 turns of budget. Short tasks with clear exit conditions are safer. | All agents | HARD |
| 20 | **Employee-side advocacy** | Starling represents employees, not employers. Every contract clause is read for enforceability gaps favouring the employee. Every termination letter is tested against both statutory minimums and common law maximums. | DemandPay is an employee-side platform. Employer-side analysis would create conflicts and confuse the product positioning. | Employment Counsel, all employment law agents | DESIGN |

---

## Auto-Fail Triggers (Evaluator Gate)

These conditions force a dimension score to 0.0 in the evaluator gate, regardless of other factors:

| Trigger | Affected Dimension | Consequence |
|---------|-------------------|-------------|
| Fabricated case citation | Factual Correctness (0.15) | Score 0.0, likely overall FAIL |
| ESA calculation error | Legal Accuracy (0.20) | Score 0.0, likely overall FAIL |
| Missing demand section in demand letter | Completeness (0.15) | Score 0.0 |
| Wrong court or tribunal | Procedural Compliance (0.15) | Score 0.0, likely overall FAIL |
| >30% citations missing source_type | Source Attribution (0.10) | Score 0.0 |
| Client/employer name mismatch | Client Alignment (0.05) | Score 0.0 |

---

## Non-Negotiable Preservation Categories

When transforming or redesigning any legal document, these categories must be preserved exactly:

| Category | Examples |
|----------|---------|
| Monetary amounts | Salary, damages, liability caps, penalties, severance amounts |
| Time periods | Notice periods, cure periods, limitation dates, probationary periods |
| Jurisdiction | Governing law, venue, tribunal selection |
| Dispute resolution | Arbitration clauses, mediation requirements, grievance procedures |
| Defined terms | Terms with specific legal scope that affect interpretation |
| Insurance | Coverage requirements, indemnification obligations |
| Regulatory compliance | Statutory language that must remain verbatim |
| Termination triggers | Cause definitions, without-cause provisions, resignation notice |
