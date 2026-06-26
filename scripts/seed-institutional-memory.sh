#!/usr/bin/env bash
# ============================================================
# Seed institutional memory for DemandPay Starling
# ============================================================
# Run this after starting the Starling server to pre-populate
# institutional memory with Ontario employment law patterns.
#
# Usage:
#   ./scripts/seed-institutional-memory.sh
#   ./scripts/seed-institutional-memory.sh /path/to/memory/dir
#
# The memory directory defaults to .shem/memory (Lavern default).
# ============================================================

set -euo pipefail

MEMORY_DIR="${1:-.shem/memory}"
MEMORY_FILE="$MEMORY_DIR/institutional.json"

mkdir -p "$MEMORY_DIR"

echo "Seeding institutional memory to $MEMORY_FILE..."

cat > "$MEMORY_FILE" << 'ENDJSON'
[
  {
    "id": "IM-seed-bardal-ranges",
    "category": "pattern",
    "content": "Bardal reasonable notice ranges by seniority level in Ontario wrongful dismissal cases. These are typical ranges, not caps. Executive/C-suite: 18-26 months. Senior management (VP, Director): 15-24 months. Middle management (Manager): 12-20 months. Professional (accountant, engineer, IT): 10-18 months. Clerical/administrative: 6-14 months. Skilled trades: 6-12 months. Labour/entry-level: 4-10 months. Long service (20+ years) pushes toward upper range regardless of seniority. Young employees (under 35) with short tenure rarely exceed 6-8 months. The 24-month soft cap from Lowndes v. Summit Ford Sales is not absolute — exceptional circumstances (age 60+, 30+ years, senior executive, specialised industry) can justify exceeding it.",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.9,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "employment-counsel", "engagementType": "counsel", "documentType": "demand_letter", "jurisdiction": "ON", "custom": ["bardal", "reasonable-notice", "damages"] }
  },
  {
    "id": "IM-seed-bardal-age-factor",
    "category": "pattern",
    "content": "Age as a Bardal factor in Ontario: Courts consistently award longer notice periods to older employees because they face greater difficulty finding comparable re-employment. The inflection point is around age 50 — employees over 50 typically receive notice periods at the upper end of the range for their seniority level. Employees over 55 frequently receive 18-24 months. Employees over 60 with long tenure are the strongest candidates for exceeding the 24-month soft cap. Young employees (under 35) receive shorter notice but are expected to mitigate more aggressively.",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.9,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "employment-counsel", "engagementType": "counsel", "jurisdiction": "ON", "custom": ["bardal", "age", "reasonable-notice"] }
  },
  {
    "id": "IM-seed-waksdale-leverage",
    "category": "pattern",
    "content": "Waksdale v. Swegon (2020 ONCA 391) leverage strategy: A termination clause that violates the ESA in ANY part (including the for-cause provision) renders the ENTIRE termination clause void, even if the without-cause provision standing alone would comply. Post-Waksdale, look for: (1) for-cause clauses that say 'cause' instead of 'wilful misconduct', (2) clauses that don't expressly reference ESA minimums, (3) clauses that cap benefits continuation below ESA requirements, (4) clauses drafted before 2020 that haven't been updated. Dufault v. The Corporation of the Town of Prescott (2024 ONSC 1029) extended Waksdale to temporary layoff provisions.",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.95,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "contract-specialist", "engagementType": "counsel", "documentType": "demand_letter", "jurisdiction": "ON", "custom": ["waksdale", "termination-clause", "leverage"] }
  },
  {
    "id": "IM-seed-esa-notice-calculation",
    "category": "rule",
    "content": "ESA minimum notice period calculation (s. 57): Less than 1 year = 1 week. 1-3 years = 2 weeks. 3-4 = 3 weeks. 4-5 = 4 weeks. 5-6 = 5 weeks. 6-7 = 6 weeks. 7-8 = 7 weeks. 8+ years = 8 weeks (maximum). ESA severance pay (s. 64): Requires BOTH 5+ years of service AND employer payroll exceeds $2.5 million OR employer severed 50+ employees in 6-month period. Amount = 1 week per year of service, maximum 26 weeks. Severance pay is SEPARATE from and IN ADDITION TO notice/termination pay.",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.95,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "employment-counsel", "engagementType": "counsel", "jurisdiction": "ON", "custom": ["esa", "notice-period", "severance-pay", "calculation"] }
  },
  {
    "id": "IM-seed-esa-severance-trap",
    "category": "warning",
    "content": "Common ESA severance pay error: Demanding severance pay without verifying the employer's payroll exceeds $2.5 million. If payroll is under threshold, claiming severance undermines the entire demand letter's credibility. Always verify or qualify: 'Subject to confirmation that the Employer's payroll exceeds the threshold prescribed by s. 64(1)(b) of the Employment Standards Act, 2000.'",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.95,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "red-team", "engagementType": "adversarial", "documentType": "demand_letter", "jurisdiction": "ON", "custom": ["esa", "severance-pay", "common-error"] }
  },
  {
    "id": "IM-seed-mitigation-defence",
    "category": "pattern",
    "content": "Mitigation failure is the employer's strongest defence. The employer bears the burden of proving: (1) the employee failed to make reasonable efforts to find comparable employment, AND (2) comparable employment was available. Employees should begin job search immediately — delay of more than 2-4 weeks is exploitable. Comparable means similar role, compensation, and location. Rejecting an offer of re-employment from the terminating employer is very risky unless the employment relationship was poisoned (Evans v. Teamsters).",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.9,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "red-team", "engagementType": "adversarial", "jurisdiction": "ON", "custom": ["mitigation", "employer-defence"] }
  },
  {
    "id": "IM-seed-bad-faith-damages",
    "category": "pattern",
    "content": "Bad faith damages in manner of dismissal (Honda Canada Inc. v. Keays, 2008 SCC 39): Available when the employer's conduct during the termination process was unfair or in bad faith. Post-Keays, damages are compensatory (not punitive) and require proof of: (1) unfair/bad faith conduct in the manner of dismissal, and (2) compensable damages as a result. Common triggers: fabricating just cause, humiliating termination, cutting off benefits below ESA minimums, refusing ROE. Typical range: $15,000 to $100,000.",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.9,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "employment-counsel", "engagementType": "counsel", "documentType": "demand_letter", "jurisdiction": "ON", "custom": ["bad-faith", "honda-keays", "damages"] }
  },
  {
    "id": "IM-seed-constructive-dismissal",
    "category": "pattern",
    "content": "Constructive dismissal two-branch test from Potter v. New Brunswick Legal Aid Services Commission (2015 SCC 10): Branch 1 (single act): a single unilateral act breaching an essential contract term. Branch 2 (course of conduct): a series of acts showing the employer no longer intends to be bound. Common triggers: significant pay reduction (>10-15%), demotion, forced relocation. Critical: employee must act promptly — continuing to work after the change risks condoning the breach.",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.9,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "employment-counsel", "engagementType": "counsel", "jurisdiction": "ON", "custom": ["constructive-dismissal", "potter-test"] }
  },
  {
    "id": "IM-seed-limitation-periods",
    "category": "rule",
    "content": "Ontario limitation periods: Wrongful dismissal (Superior Court): 2 years from dismissal (Limitations Act, 2002, s. 4). HRTO complaint: 1 year from last incident (Human Rights Code, s. 34(1)). MOL complaint (ESA violations): 2 years from violation (ESA s. 96(3)). Small Claims Court: same 2-year limitation, $50,000 monetary jurisdiction (increased January 2025). Constructive dismissal: runs from resignation date, not from employer's breach.",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.95,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "paralegal", "engagementType": "counsel", "jurisdiction": "ON", "custom": ["limitation-periods", "deadlines"] }
  },
  {
    "id": "IM-seed-non-compete-esa672",
    "category": "rule",
    "content": "ESA s. 67.2 non-competition agreements: Effective December 2, 2021, non-compete agreements with employees are void unless: (1) the employee is a C-suite executive, OR (2) the agreement predates December 2, 2021, OR (3) the restriction arises from a business sale. Non-solicitation agreements are NOT affected by s. 67.2 and remain enforceable if reasonable at common law.",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.95,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "contract-specialist", "engagementType": "counsel", "jurisdiction": "ON", "custom": ["non-compete", "esa-67-2"] }
  },
  {
    "id": "IM-seed-demand-letter-tone",
    "category": "lesson",
    "content": "Demand letter tone: firm but professional. Avoid emotional language, threats, hyperbole. DO: state facts clearly, cite specific legal authorities, present specific demand with calculation methodology, set 14-21 day deadline, reference litigation alternative without threatening. DON'T: use ALL CAPS, exclamation marks, words like 'outrageous', threaten media exposure, demand amounts wildly above precedent. The best demand letters read like they were written by a litigation partner.",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.85,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "synthesis-editor", "engagementType": "counsel", "documentType": "demand_letter", "jurisdiction": "ON", "custom": ["tone", "drafting"] }
  },
  {
    "id": "IM-seed-fixed-term-ceccol",
    "category": "pattern",
    "content": "Fixed-term contract analysis (Ceccol v. Ontario Gymnastic Federation, 2001 CanLII 8589 (ON CA)): Employee on a true fixed-term contract terminated without cause before the end of the term is generally entitled to compensation for the entire remaining term, NOT just reasonable notice. Courts scrutinise whether the contract is genuinely fixed-term: multiple renewals may indicate indefinite relationship, nature of work and parties' conduct matter more than the label.",
    "source": "seed:ontario-employment-law",
    "addedAt": "2026-06-26T00:00:00.000Z",
    "usageCount": 0,
    "effectiveness": 0.9,
    "usedInSessions": [],
    "outcomes": [],
    "tags": { "agentRole": "employment-counsel", "engagementType": "counsel", "jurisdiction": "ON", "custom": ["fixed-term", "ceccol"] }
  }
]
ENDJSON

echo "Done. Seeded $(grep -c '"id"' "$MEMORY_FILE") entries."
