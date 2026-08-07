/**
 * The gate every node-language change passes before it binds.
 *
 * Three doors lead here: the firm editing a node by hand, a spreadsheet
 * re-import, and the teaching flow proposing wording learned from the
 * firm's own claims. All three produce a candidate body; none of them
 * saves without this check, because language edits break function in
 * specific, checkable ways:
 *
 * An unbalanced conditional swallows the rest of the block. A condition
 * naming a field the evaluator cannot supply fails SILENTLY: the ground
 * simply never fires, on every claim, forever, which is the worst failure
 * a pleading system can have. An unknown placeholder is visible (it
 * renders as a [LAWYER: ...] marker) so it is a warning rather than an
 * error. And a body with no {{para}} markers escapes paragraph numbering.
 *
 * The test render is the real proof. Static checks cannot tell whether the
 * rendered paragraphs read as a pleading, so the candidate is rendered
 * twice against a synthetic matter, all conditionals on and all off, and
 * the caller shows both to the lawyer before saving.
 *
 * Deterministic: no model call.
 */

import {
  buildSocEvalContext, renderNode, numberSocParagraphs, type SocNode,
} from './soc-nodes.js';

// ── The known vocabulary ─────────────────────────────────────────────────

/**
 * A synthetic matter rich enough that every field the evaluator can
 * supply is present. Its keys ARE the known vocabulary: a condition or
 * placeholder outside them is one the engine can never fill.
 */
export function syntheticContext(allOn: boolean): Record<string, unknown> {
  const intake = {
    client_first_name: 'Jane', client_last_name: 'Sample',
    employer_legal_name: 'Example Employer Inc',
    job_title: 'Manager', job_duties: 'managing the example department',
    annual_salary: 100000, client_age: 45, client_city: 'Toronto',
    workplace_location: 'Toronto',
    hire_date: '2018-01-15', termination_date: '2026-01-15', contract_date: '2018-01-02',
    was_terminated: true, client_pronouns: 'she',
    termination_clause_text: allOn ? 'The employer may terminate at any time.' : undefined,
    has_written_contract: allOn || undefined,
    clause_cause_broader: allOn || undefined, clause_no_benefits: allOn || undefined,
    clause_limits_below_esa: allOn || undefined, employer_breached_clause: allOn || undefined,
    false_cause_alleged: allOn || undefined,
    employer_alleged_just_cause: allOn || undefined, cause_allegations: allOn ? 'poor performance' : undefined,
    is_constructive_dismissal: false, resigned: false,
    constructive_dismissal_details: allOn ? 'pay reduced by a third' : undefined,
    bad_faith_details: allOn ? 'misled about the reason' : undefined,
    employer_initiated_recruitment: allOn || undefined, had_prior_secure_employment: allOn || undefined,
    recruiter_name_and_title: allOn ? 'A. Recruiter, VP' : undefined,
    inducement_representations: allOn ? 'promises of tenure' : undefined,
    promises_not_fulfilled: allOn || undefined, promises_known_false: allOn || undefined,
    common_employer: allOn || undefined, common_employer_documentation: allOn ? 'shared letterhead' : undefined,
    shared_management: allOn || undefined, shared_payroll: allOn || undefined, shared_branding: allOn || undefined,
    defamatory_statements: allOn || undefined, defamation_recipients: allOn ? 'industry contacts' : undefined,
    defamation_malicious: allOn || undefined,
    privacy_breach: allOn || undefined, privacy_breach_description: allOn ? 'read personal email' : undefined,
    iims: allOn || undefined, iims_conduct_description: allOn ? 'sustained campaign' : undefined,
    iims_illness_description: allOn ? 'diagnosed anxiety' : undefined,
    mental_distress_symptoms: allOn ? 'sleeplessness' : undefined,
    unjust_enrichment: allOn || undefined, unjust_enrichment_benefit: allOn ? 'unpaid work product' : undefined,
    breach_express_term: allOn || undefined, express_term_description: allOn ? 'guaranteed bonus' : undefined,
    express_term_obligation: allOn ? 'pay the bonus' : undefined,
    breach_implied_term: allOn || undefined, implied_term_conduct: allOn ? 'good faith dealing' : undefined,
    has_non_compete: allOn || undefined, has_non_solicitation: allOn || undefined,
    noncompete_post_oct2021: allOn || undefined, covenant_enforcement_threat: allOn || undefined,
    has_bonus: allOn || undefined, bonus_amount: allOn ? 10000 : undefined,
    equity_types: allOn ? ['rsus'] : undefined,
    has_benefits: allOn || undefined, has_rrsp: allOn || undefined, has_car_allowance: allOn || undefined,
    unpaid_commission: allOn || undefined, unpaid_overtime: allOn || undefined,
    vacation_unpaid: allOn || undefined, unauthorized_deductions: allOn || undefined,
    vacation_underpaid_rate: allOn || undefined, vacation_excluded_variable_comp: allOn || undefined,
    holiday_pay_unpaid: allOn || undefined, expenses_unreimbursed: allOn || undefined,
    other_compensation_details: allOn ? 'gym allowance' : undefined,
    benefits_not_continued: allOn || undefined,
    esa_shortfall: allOn || undefined, esa_term_shortfall: allOn || undefined, esa_sev_shortfall: allOn || undefined,
    hrc_protected_ground: allOn ? 'disability' : undefined,
    hrc_complaint_made: allOn || undefined, hrc_conduct_description: allOn ? 'mocked the restriction' : undefined,
    sexual_harassment: allOn || undefined,
    positive_performance: allOn || undefined,
    discrimination_details: allOn ? 'excluded after disclosure' : undefined,
    prior_employer_name: allOn ? 'Prior Employer Ltd' : undefined,
    prior_employer_tenure: allOn ? '8 years' : undefined,
  } as never;

  const analysis = {
    damagesEstimate: {
      esaNoticeWeeks: 8, esaNoticePay: 15384, esaSeverancePay: 8000,
      commonLawLowMonths: 8, commonLawHighMonths: 12,
      commonLawLowAmount: 66666, commonLawHighAmount: 100000,
      totalEstimateLow: 66666, totalEstimateHigh: 120000,
    },
    bardalFactors: { age: 45, tenureYears: 8.0 },
  } as never;

  return buildSocEvalContext({
    intake, analysis,
    gates: [{ gate: 'G9', triggered: allOn }, { gate: 'G10', triggered: allOn }] as never,
    approvedIssues: [],
    claimAmount: 150000,
  });
}

let knownCache: Set<string> | null = null;

/** Every field name the evaluator can supply. */
export function knownFields(): Set<string> {
  if (!knownCache) knownCache = new Set(Object.keys(syntheticContext(true)));
  return knownCache;
}

// ── The gate ─────────────────────────────────────────────────────────────

export interface NodeValidation {
  ok: boolean;
  errors: string[];
  warnings: string[];
  /** The candidate rendered against the synthetic matter. */
  renderAllOn: string;
  renderAllOff: string;
}

export function validateNodeContent(blockId: string, content: string): NodeValidation {
  const errors: string[] = [];
  const warnings: string[] = [];
  const known = knownFields();

  if (!content.trim()) {
    return { ok: false, errors: ['The body is empty.'], warnings: [], renderAllOn: '', renderAllOff: '' };
  }

  // Balanced conditionals: {{#if}} and {{#unless}} each need their close,
  // in order, and {{else}} must sit inside one.
  const tokens = [...content.matchAll(/\{\{(#if\s+[\w_]+|#unless\s+[\w_]+|else|\/if(?:\s+[\w_]+)?|\/unless(?:\s+[\w_]+)?)\}\}/g)];
  const stack: string[] = [];
  for (const t of tokens) {
    const tok = t[1];
    if (tok.startsWith('#if')) stack.push('if');
    else if (tok.startsWith('#unless')) stack.push('unless');
    else if (tok === 'else') {
      if (stack[stack.length - 1] !== 'if') errors.push('An {{else}} sits outside any {{#if}} block.');
    } else if (tok.startsWith('/if')) {
      if (stack.pop() !== 'if') errors.push('An {{/if}} has no matching {{#if}}.');
    } else if (tok.startsWith('/unless')) {
      if (stack.pop() !== 'unless') errors.push('An {{/unless}} has no matching {{#unless}}.');
    }
  }
  for (const open of stack) {
    errors.push(`An {{#${open}}} block is never closed. Everything after it would be swallowed.`);
  }

  // Condition fields the engine can never supply fail SILENTLY: the ground
  // never fires, on every claim. That is an error, not a warning.
  for (const m of content.matchAll(/\{\{#(?:if|unless)\s+([\w_]+)\}\}/g)) {
    if (!known.has(m[1])) {
      errors.push(`The condition "${m[1]}" is not a field the engine can supply, so that ground would never appear on any claim. Known fields are on the intake and the analysis.`);
    }
  }

  // Unknown placeholders are visible, so they warn rather than fail.
  for (const m of content.matchAll(/\{\{([a-z_][a-z_0-9]*)\}\}/g)) {
    const name = m[1];
    if (name === 'para' || name === 'else') continue;
    if (!known.has(name)) {
      warnings.push(`The placeholder "{{${name}}}" has no source on the matter. It will render as [LAWYER: ${name.replace(/_/g, ' ')}] on every claim until the intake supplies it.`);
    }
  }

  if (!content.includes('{{para}}')) {
    warnings.push('No {{para}} markers: none of these paragraphs will receive a number. If that is not deliberate, start each numbered paragraph with {{para}}. ');
  }

  // The proof: render it, both ways.
  const probe: SocNode = {
    blockId, tier: 2, sectionHeader: 'PREVIEW', triggerCondition: 'ALWAYS',
    assemblyOrder: 1, lawyerReview: false, content,
  };
  let renderAllOn = '';
  let renderAllOff = '';
  try {
    renderAllOn = numberSocParagraphs(renderNode(probe, syntheticContext(true)).html);
    renderAllOff = numberSocParagraphs(renderNode(probe, syntheticContext(false)).html);
  } catch (err) {
    errors.push(`The body does not render: ${err instanceof Error ? err.message : String(err)}`);
  }
  if (!renderAllOff.replace(/<[^>]+>/g, '').trim() && errors.length === 0) {
    warnings.push('With every optional ground off, this section renders empty. Confirm that is intended.');
  }

  return { ok: errors.length === 0, errors, warnings, renderAllOn, renderAllOff };
}
