/**
 * Gate Evaluator — 16-gate legal issue identification for Ontario employment law.
 *
 * Ported from DemandPay B2C (intakeEvalFlags.ts + assembleDemandLetter gate logic).
 * Takes structured intake data and determines which legal gates (G1–G16) are
 * triggered, meaning which legal issues are relevant to the client's case.
 *
 * The lawyer reviews the triggered gates and approves/dismisses each one
 * before any document is generated (Rule 26 — human confirmation).
 *
 * Gates:
 *   G1  — Worker classification (employee vs. contractor)
 *   G2  — Fixed-term / probationary employment
 *   G3  — Termination clause validity (Waksdale, Machtinger, Dufault)
 *   G4  — Just cause (McKinley proportionality)
 *   G5  — Constructive dismissal (Potter test)
 *   G6  — Reasonable notice entitlement (Bardal factors)
 *   G7  — Inducement from prior employment (Wallace)
 *   G8  — Successor employer (Manthadi, Addison)
 *   G9  — ESA statutory entitlements (notice, severance, benefits, overtime)
 *   G10 — Human rights (discrimination, harassment, accommodation, reprisal)
 *   G11 — Bad faith / punitive damages (Honda v Keays)
 *   G12 — Compensation claims (Matthews bonus/RSU recovery)
 *   G13 — Restrictive covenants (non-compete / non-solicitation)
 *   G14 — OHSA reprisal
 *   G15 — Special circumstances (reserved)
 *   G16 — Document closing (procedural — auto-fires when G5 or G6 fires)
 */

import type { EmploymentIntakeData, GateResult } from '../types/employment-intake.js';

// ── Issue → Gate mapping ─────────────────────────────────────────────────
// Maps issue codes to their parent gate. A gate fires if ANY of its issues
// are identified as relevant based on the intake data.

export const ISSUE_TO_GATE: Record<string, string> = {
  // G1 — Worker Classification
  worker_misclassification:      'G1',
  dependent_contractor:          'G1',

  // G2 — Contract Type
  fixed_term_contract:           'G2',
  probationary_employment:       'G2',

  // G3 — Termination Clause
  termination_clause_invalidity: 'G3',
  waksdale_at_any_time:          'G3',
  machtinger_below_esa:          'G3',
  no_fresh_consideration:        'G3',
  dufault_language:              'G3',

  // G4 — Cause
  termination_for_cause:         'G4',
  near_cause:                    'G4',

  // G5 — Constructive Dismissal
  constructive_dismissal:        'G5',

  // G6 — Reasonable Notice
  wrongful_dismissal:            'G6',
  age_elongation:                'G6',

  // G7 — Inducement
  inducement:                    'G7',
  negligent_misrepresentation:   'G7',

  // G8 — Successor Employer
  successor_employer:            'G8',

  // G9 — ESA Statutory Entitlements
  esa_severance:                 'G9',
  esa_mass_termination:          'G9',
  esa_reprisal:                  'G9',
  esa_overtime:                  'G9',
  esa_vacation:                  'G9',

  // G10 — Human Rights
  human_rights_overlay:          'G10',
  disability_accommodation:      'G10',
  workplace_harassment:          'G10',
  pregnancy_discrimination:      'G10',

  // G11 — Bad Faith / Punitive
  bad_faith_dismissal:           'G11',
  roe_bad_faith:                 'G11',
  punitive_damages:              'G11',

  // G12 — Compensation
  matthews_bonus_rsu:            'G12',
  commission_through_notice:     'G12',

  // G13 — Restrictive Covenants
  non_compete_void:              'G13',
  non_solicitation_unenforceable: 'G13',

  // G14 — OHSA Reprisal
  ohsa_reprisal:                 'G14',
};

// ── Gate descriptions ────────────────────────────────────────────────────
// Human-readable descriptions for each gate, shown to the lawyer.

const GATE_INFO: Record<string, { name: string; description: string }> = {
  G1:  { name: 'Worker Classification',          description: 'Whether the client is an employee, dependent contractor, or independent contractor (Sagaz test).' },
  G2:  { name: 'Fixed-Term / Probationary',       description: 'Whether the employment was fixed-term or subject to a probationary period.' },
  G3:  { name: 'Termination Clause Validity',     description: 'Whether the termination clause is enforceable under Waksdale, Machtinger, and Dufault.' },
  G4:  { name: 'Just Cause',                      description: 'Whether the employer\'s just cause allegation meets the McKinley proportionality standard.' },
  G5:  { name: 'Constructive Dismissal',          description: 'Whether the employer\'s conduct constitutes constructive dismissal under the Potter test.' },
  G6:  { name: 'Reasonable Notice',               description: 'Common law reasonable notice entitlement based on Bardal factors (age, tenure, character of employment, availability of similar employment).' },
  G7:  { name: 'Inducement',                      description: 'Whether the client was induced to leave secure employment (Wallace factor) or subject to negligent misrepresentation (Queen v Cognos).' },
  G8:  { name: 'Successor Employer',              description: 'Whether the employer changed through acquisition or restructuring, extending the client\'s tenure (Manthadi, Addison).' },
  G9:  { name: 'ESA Statutory Entitlements',       description: 'Employment Standards Act minimums: termination pay, severance pay, vacation pay, overtime, public holidays, ROE.' },
  G10: { name: 'Human Rights',                    description: 'Human Rights Code claims: discrimination, harassment, failure to accommodate, reprisal (s. 8).' },
  G11: { name: 'Bad Faith / Punitive Damages',    description: 'Bad faith in the manner of dismissal (Honda v Keays), false ROE, aggravated or punitive damages (Whiten).' },
  G12: { name: 'Compensation Claims',             description: 'Bonus, commission, equity (RSUs/options) recovery through the reasonable notice period (Matthews).' },
  G13: { name: 'Restrictive Covenants',           description: 'Non-compete (void under ESA s. 67.2 for most employees) and non-solicitation (Shafron test) enforceability.' },
  G14: { name: 'OHSA Reprisal',                   description: 'Occupational Health and Safety Act reprisal (s. 50) with reverse onus on employer.' },
  G15: { name: 'Special Circumstances',           description: 'Reserved for case-specific issues not covered by other gates.' },
  G16: { name: 'Document Closing',                description: 'Procedural gate that controls the closing and signature block of the generated document.' },
};

// ── Gate evaluation ──────────────────────────────────────────────────────

/**
 * Evaluate all 16 gates against the intake data.
 *
 * Returns an array of GateResult objects indicating which gates are
 * triggered and why. The lawyer reviews these and approves/dismisses
 * each one before document generation.
 *
 * @param intake Structured intake data from the form or AI extraction.
 * @returns Array of GateResult for all 16 gates.
 */
export function evaluateGates(intake: EmploymentIntakeData): GateResult[] {
  const results: GateResult[] = [];

  // ── G1: Worker Classification ──────────────────────────────────────────
  // Currently not auto-triggered from intake (requires explicit lawyer selection).
  // Future: detect from contract language analysis.
  results.push({
    gate: 'G1',
    triggered: false,
    reason: 'Worker classification requires explicit analysis. Select this gate if the client may be a dependent contractor.',
    issueCodes: ['worker_misclassification', 'dependent_contractor'],
    requiresLawyerReview: true,
  });

  // ── G2: Fixed-Term / Probationary ──────────────────────────────────────
  const isFixedTerm = intake.termination_clause_text?.toLowerCase().includes('fixed term') ||
                      intake.termination_clause_text?.toLowerCase().includes('fixed-term');
  results.push({
    gate: 'G2',
    triggered: !!isFixedTerm,
    reason: isFixedTerm
      ? 'The termination clause text suggests a fixed-term contract.'
      : 'No fixed-term or probationary indicators were detected.',
    issueCodes: ['fixed_term_contract', 'probationary_employment'],
    requiresLawyerReview: true,
  });

  // ── G3: Termination Clause Validity ────────────────────────────────────
  const hasClause = !!intake.termination_clause_exists || (intake.termination_clause_text?.trim().length ?? 0) > 0;
  const clauseText = (intake.termination_clause_text ?? '').toLowerCase();
  const atAnyTime = clauseText.includes('at any time') || clauseText.includes('at its sole discretion');
  const addedMid = !!intake.clause_added_mid_employment;
  const issues3: string[] = [];
  if (hasClause) issues3.push('termination_clause_invalidity');
  if (atAnyTime) issues3.push('waksdale_at_any_time');
  if (addedMid && !intake.fresh_consideration_provided) issues3.push('no_fresh_consideration');

  results.push({
    gate: 'G3',
    triggered: hasClause,
    reason: hasClause
      ? `A termination clause was detected${atAnyTime ? ' with "at any time" language (Waksdale/Dufault risk)' : ''}${addedMid ? ', added mid-employment' : ''}.`
      : 'No termination clause was detected.',
    issueCodes: issues3,
    requiresLawyerReview: true,
  });

  // ── G4: Just Cause ─────────────────────────────────────────────────────
  const causeAlleged = !!intake.employer_alleged_just_cause;
  results.push({
    gate: 'G4',
    triggered: causeAlleged,
    reason: causeAlleged
      ? 'The employer has alleged just cause for termination.'
      : 'No just cause has been alleged.',
    issueCodes: ['termination_for_cause'],
    requiresLawyerReview: true,
  });

  // ── G5: Constructive Dismissal ─────────────────────────────────────────
  const cdGrounds = intake.constructive_dismissal_grounds ?? [];
  const isConstructive = !!intake.is_constructive_dismissal || cdGrounds.length > 0;
  results.push({
    gate: 'G5',
    triggered: isConstructive,
    reason: isConstructive
      ? `Constructive dismissal is indicated${cdGrounds.length > 0 ? ` (${cdGrounds.length} ground${cdGrounds.length > 1 ? 's' : ''})` : ''}.`
      : 'No constructive dismissal indicators are present.',
    issueCodes: ['constructive_dismissal'],
    requiresLawyerReview: true,
  });

  // ── G6: Reasonable Notice (Bardal) ─────────────────────────────────────
  const terminated = !!intake.was_terminated || isConstructive;
  results.push({
    gate: 'G6',
    triggered: terminated,
    reason: terminated
      ? 'The employment has ended. A Bardal factor analysis is required to assess common law reasonable notice.'
      : 'The employment has not ended.',
    issueCodes: ['wrongful_dismissal'],
    requiresLawyerReview: false,
  });

  // ── G7: Inducement ─────────────────────────────────────────────────────
  const induced = !!intake.left_secure_employment;
  results.push({
    gate: 'G7',
    triggered: induced,
    reason: induced
      ? 'The client left secure prior employment; the inducement (Wallace) factor applies.'
      : 'No inducement from prior employment is indicated.',
    issueCodes: induced ? ['inducement'] : [],
    requiresLawyerReview: true,
  });

  // ── G8: Successor Employer ─────────────────────────────────────────────
  const successor = !!intake.employer_changed_through_acquisition;
  results.push({
    gate: 'G8',
    triggered: successor,
    reason: successor
      ? `The employer changed through acquisition or restructuring${intake.predecessor_employer_name ? ` (prior employer: ${intake.predecessor_employer_name})` : ''}.`
      : 'No successor employer issue arises.',
    issueCodes: successor ? ['successor_employer'] : [],
    requiresLawyerReview: true,
  });

  // ── G9: ESA Statutory Entitlements ─────────────────────────────────────
  // Always triggered when employment ended (ESA minimums always apply).
  results.push({
    gate: 'G9',
    triggered: terminated,
    reason: terminated
      ? 'The employment has ended. ESA statutory entitlements (notice, severance, vacation, overtime) must be calculated.'
      : 'The employment has not ended.',
    issueCodes: ['esa_severance'],
    requiresLawyerReview: false,
  });

  // ── G10: Human Rights ──────────────────────────────────────────────────
  const discrimGrounds = intake.discrimination_grounds ?? [];
  const hasHR = !!intake.believes_discriminatory_termination ||
                discrimGrounds.length > 0 ||
                !!intake.has_known_medical_condition ||
                !!intake.was_on_medical_leave ||
                !!intake.accommodation_denied ||
                !!intake.experienced_harassment;
  const issues10: string[] = [];
  if (discrimGrounds.length > 0 || intake.believes_discriminatory_termination) issues10.push('human_rights_overlay');
  if (intake.has_known_medical_condition || intake.was_on_medical_leave || intake.accommodation_denied) issues10.push('disability_accommodation');
  if (intake.experienced_harassment) issues10.push('workplace_harassment');

  results.push({
    gate: 'G10',
    triggered: hasHR,
    reason: hasHR
      ? `Human rights issues were identified${discrimGrounds.length > 0 ? ` (grounds: ${discrimGrounds.join(', ')})` : ''}${intake.accommodation_denied ? '; accommodation was denied' : ''}${intake.experienced_harassment ? '; harassment was reported' : ''}.`
      : 'No human rights issues were detected.',
    issueCodes: issues10,
    requiresLawyerReview: true,
  });

  // ── G11: Bad Faith / Punitive Damages ──────────────────────────────────
  const bfConduct = intake.bad_faith_conduct ?? [];
  const hasBF = bfConduct.length > 0 ||
                !!intake.humiliating_termination ||
                !!intake.roe_wrong_or_missing;
  const issues11: string[] = [];
  if (bfConduct.length > 0 || intake.humiliating_termination) issues11.push('bad_faith_dismissal');
  if (intake.roe_wrong_or_missing) issues11.push('roe_bad_faith');

  results.push({
    gate: 'G11',
    triggered: hasBF,
    reason: hasBF
      ? `Bad faith indicators were identified${bfConduct.length > 0 ? ` (${bfConduct.join(', ')})` : ''}${intake.humiliating_termination ? '; the manner of termination was humiliating' : ''}${intake.roe_wrong_or_missing ? '; the ROE is incorrect or missing' : ''}.`
      : 'No bad faith indicators were identified.',
    issueCodes: issues11,
    requiresLawyerReview: true,
  });

  // ── G12: Compensation Claims ───────────────────────────────────────────
  const hasComp = !!intake.has_bonus || !!intake.has_commissions || !!intake.has_equity;
  results.push({
    gate: 'G12',
    triggered: hasComp && terminated,
    reason: hasComp && terminated
      ? `Variable compensation was identified (${[intake.has_bonus && 'bonus', intake.has_commissions && 'commissions', intake.has_equity && 'equity'].filter(Boolean).join(', ')}); Matthews supports recovery through the reasonable notice period.`
      : 'No variable compensation claims arise.',
    issueCodes: hasComp && terminated ? ['matthews_bonus_rsu'] : [],
    requiresLawyerReview: true,
  });

  // ── G13: Restrictive Covenants ─────────────────────────────────────────
  const hasRC = !!intake.has_non_compete || !!intake.has_non_solicitation;
  const issues13: string[] = [];
  if (intake.has_non_compete) issues13.push('non_compete_void');
  if (intake.has_non_solicitation) issues13.push('non_solicitation_unenforceable');

  results.push({
    gate: 'G13',
    triggered: hasRC,
    reason: hasRC
      ? `Restrictive covenants were detected (${[intake.has_non_compete && 'non-compete', intake.has_non_solicitation && 'non-solicitation'].filter(Boolean).join(', ')}). Non-competition provisions are void under ESA s. 67.2 for most employees.`
      : 'No restrictive covenants were identified.',
    issueCodes: issues13,
    requiresLawyerReview: true,
  });

  // ── G14: OHSA Reprisal ─────────────────────────────────────────────────
  const ohsa = intake.reprisal_type === 'ohsa' ||
               (!!intake.experienced_reprisal && !!intake.reprisal_details?.toLowerCase().includes('safety'));
  results.push({
    gate: 'G14',
    triggered: ohsa,
    reason: ohsa
      ? 'OHSA reprisal is indicated; s. 50 places a reverse onus on the employer.'
      : 'No OHSA reprisal is indicated.',
    issueCodes: ohsa ? ['ohsa_reprisal'] : [],
    requiresLawyerReview: true,
  });

  // ── G15: Special Circumstances ─────────────────────────────────────────
  results.push({
    gate: 'G15',
    triggered: false,
    reason: 'Reserved for case-specific issues. Select this gate if applicable.',
    issueCodes: [],
    requiresLawyerReview: true,
  });

  // ── G16: Document Closing ──────────────────────────────────────────────
  // Auto-fires when G5 or G6 fires (employment ended → document needs a closer).
  const needsCloser = terminated;
  results.push({
    gate: 'G16',
    triggered: needsCloser,
    reason: needsCloser ? 'A document closing block is required.' : 'No document closing block is required.',
    issueCodes: [],
    requiresLawyerReview: false,
  });

  return results;
}

/**
 * Get all triggered issue codes from the gate evaluation.
 * Used to pre-populate the lawyer's issue approval checklist.
 */
export function getTriggeredIssueCodes(gates: GateResult[]): string[] {
  return gates
    .filter(g => g.triggered)
    .flatMap(g => g.issueCodes);
}

/**
 * Get human-readable gate information.
 */
export function getGateInfo(gate: string): { name: string; description: string } | undefined {
  return GATE_INFO[gate];
}

/**
 * Get the gate that an issue code belongs to.
 */
export function getGateForIssue(issueCode: string): string | undefined {
  return ISSUE_TO_GATE[issueCode];
}

/** The lawyer-facing name of a gate (for the issues catalogue). */
export function gateName(gate: string): string {
  return GATE_INFO[gate]?.name ?? gate;
}
