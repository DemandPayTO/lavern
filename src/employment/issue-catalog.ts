/**
 * The legal-issue catalogue — every issue the gates can raise, with a
 * lawyer-facing label, grouped by gate.
 *
 * The analysis raises the issues the facts trigger; the lawyer approves them
 * on the Issues tab. But the lawyer must also be able to add an issue the
 * analysis did not raise (a claim the facts understate, or one to plead in the
 * alternative) and to remove one that is wrong. This catalogue is the source
 * of the labels and the "add an issue" list. Every code here is a real gate
 * issue, so approving it drives the factum and pleading node selection exactly
 * as an analysis-raised issue does.
 */

import { ISSUE_TO_GATE, gateName } from './gate-evaluator.js';

/** Lawyer-facing label for each issue code the gates can raise. */
export const ISSUE_LABELS: Record<string, string> = {
  // G1 — Worker Classification
  worker_misclassification: 'Worker misclassified as a contractor',
  dependent_contractor: 'Dependent contractor entitlement',
  // G2 — Contract Type
  fixed_term_contract: 'Fixed-term contract (wages to the end of term)',
  probationary_employment: 'Probationary period dispute',
  // G3 — Termination Clause
  termination_clause_invalidity: 'Termination clause unenforceable',
  waksdale_at_any_time: 'Termination clause void (Waksdale)',
  machtinger_below_esa: 'Termination clause falls below the ESA (Machtinger)',
  no_fresh_consideration: 'No fresh consideration for the clause',
  dufault_language: 'Termination clause void (Dufault)',
  // G4 — Cause
  termination_for_cause: 'Just cause not established',
  near_cause: 'No near cause',
  // G5 — Constructive Dismissal
  constructive_dismissal: 'Constructive dismissal',
  // G6 — Reasonable Notice
  wrongful_dismissal: 'Wrongful dismissal (reasonable notice)',
  age_elongation: 'Age lengthens the notice period',
  // G7 — Inducement
  inducement: 'Induced from secure employment',
  negligent_misrepresentation: 'Negligent misrepresentation',
  // G8 — Successor Employer
  successor_employer: 'Successor employer (tenure carries over)',
  // G9 — ESA Statutory Entitlements
  esa_severance: 'ESA severance pay',
  esa_mass_termination: 'ESA mass-termination entitlement',
  esa_reprisal: 'ESA reprisal',
  esa_overtime: 'Unpaid overtime (ESA)',
  esa_vacation: 'Unpaid vacation pay (ESA)',
  // G10 — Human Rights
  human_rights_overlay: 'Human Rights Code damages',
  disability_accommodation: 'Failure to accommodate a disability',
  workplace_harassment: 'Workplace harassment',
  pregnancy_discrimination: 'Pregnancy or family-status discrimination',
  // G11 — Bad Faith / Punitive
  bad_faith_dismissal: 'Bad faith in the manner of dismissal (moral damages)',
  roe_bad_faith: 'False or late Record of Employment',
  punitive_damages: 'Punitive damages',
  // G12 — Compensation
  matthews_bonus_rsu: 'Bonus, commission or equity through the notice period',
  commission_through_notice: 'Commissions through the notice period',
  // G13 — Restrictive Covenants
  non_compete_void: 'Non-compete void',
  non_solicitation_unenforceable: 'Non-solicitation unenforceable',
  // G14 — OHSA Reprisal
  ohsa_reprisal: 'OHSA reprisal',
};

/** The label for an issue code, falling back to the de-slugged code. */
export function issueLabel(code: string): string {
  return ISSUE_LABELS[code] ?? code.replace(/_/g, ' ');
}

export interface IssueCatalogGate {
  gate: string;
  gateName: string;
  issues: Array<{ code: string; label: string }>;
}

/** The catalogue grouped by gate, in gate order (G1, G2, ...). */
export function buildIssueCatalog(): IssueCatalogGate[] {
  const byGate = new Map<string, Array<{ code: string; label: string }>>();
  for (const [code, gate] of Object.entries(ISSUE_TO_GATE)) {
    if (!byGate.has(gate)) byGate.set(gate, []);
    byGate.get(gate)!.push({ code, label: issueLabel(code) });
  }
  return [...byGate.entries()]
    .sort((a, b) => parseInt(a[0].slice(1), 10) - parseInt(b[0].slice(1), 10))
    .map(([gate, issues]) => ({ gate, gateName: gateName(gate), issues }));
}
