/**
 * Extraction apply — move lawyer-approved extracted facts onto the intake.
 *
 * Deterministic by design: once the lawyer ticks a field in the review
 * table, this module copies the exact approved value into the named intake
 * slot. No LLM touches this step, so what was approved on screen is
 * byte-for-byte what is stored. The LLM half (reading the document) already
 * happened at extraction time.
 *
 * Semantics mirror the intake portal's apply: fill blanks by default; a
 * non-blank intake field changes only when the lawyer explicitly opts into
 * overwriting that specific field. Unknown or unmapped extractor fields are
 * reported back, never silently dropped.
 *
 * See docs/specs/document-extraction-apply-2026-07.md (Phase 1).
 */

import { employmentIntakeSchema } from '../types/employment-intake.js';
import { normaliseDate, DATE_FIELDS } from './date-normalise.js';
import type { DocumentExtractionResult, EmploymentIntakeData, TimelineEvent } from '../types/employment-intake.js';

/**
 * Intake fields the apply loop may write. Every extractor prompt field that
 * has a same-named intake column is listed; extractor-only observations
 * (key_dates, tone_assessment, probation_period and similar) have no intake
 * slot and surface as unmapped rows in the review UI instead.
 * tests/unit/extraction-apply.test.ts asserts every entry exists in the
 * intake schema, so drift between this list and the schema fails the build.
 */
export const APPLYABLE_INTAKE_FIELDS: ReadonlySet<string> = new Set([
  // Parties + role
  'employer_legal_name', 'employer_operating_name', 'job_title',
  // Dates
  'hire_date', 'contract_signed_date', 'first_day_of_work', 'years_of_service_estimate',
  'termination_date', 'last_day_worked',
  // Compensation
  'annual_salary', 'salary_period', 'hours_per_week',
  'has_bonus', 'bonus_amount',
  // ESA wage claims (pleading fields: quote-verified, arrive unticked)
  'vacation_unpaid', 'vacation_underpaid_rate', 'vacation_excluded_variable_comp',
  'holiday_pay_unpaid', 'unpaid_overtime', 'unpaid_commission',
  'unauthorized_deductions', 'expenses_unreimbursed',
  'esa_term_shortfall', 'esa_sev_shortfall',
  'has_commissions', 'commission_structure',
  'has_equity', 'has_pension', 'has_health_benefits',
  // Contract clauses
  'termination_clause_exists', 'termination_clause_text', 'termination_notice_period',
  'has_non_compete', 'non_compete_text',
  'has_non_solicitation', 'non_solicitation_text',
  // Termination
  'termination_reasons', 'employer_alleged_just_cause', 'cause_allegations',
  // Severance offer
  'severance_weeks_offered', 'severance_payment_type', 'severance_deadline',
  'signed_release', 'severance_offer_details',
  // ROE
  'roe_issued', 'roe_reason_code',
  // Pleading fields: the facts that make causes of action pleadable, held
  // to the quote-or-discard standard at extraction time. Their names
  // follow the DemandPay schema, same as the intake columns they fill.
  'has_written_contract', 'contract_date',
  'clause_cause_broader', 'clause_no_benefits', 'clause_limits_below_esa',
  'noncompete_post_oct2021', 'is_executive_noncompete',
  'has_benefits', 'has_rrsp', 'has_car_allowance',
  'false_cause_alleged', 'benefits_not_continued',
  'bad_faith_details',
  'defamatory_statements', 'defamation_recipients',
  'common_employer', 'common_employer_documentation',
  'employer_initiated_recruitment', 'had_prior_secure_employment',
  'prior_employer_name', 'prior_employer_tenure', 'inducement_representations',
  'promises_not_fulfilled',
  'privacy_breach', 'privacy_breach_description',
  'unjust_enrichment', 'unjust_enrichment_benefit',
  'iims', 'iims_conduct_description',
  'hrc_protected_ground', 'hrc_conduct_description',
  // Mitigation and release: call facts with direct docket and damages
  // consequences, proposable from a debrief.
  'new_employment_found', 'new_employment_start_date', 'new_employment_salary',
  'signed_release',
]);

/**
 * Applied fields that feed the damages/limitation analysis: applying any of
 * them makes a previously run analysis stale (the lawyer re-runs it
 * deliberately — analysis is an LLM cost).
 */
const ANALYSIS_INPUT_FIELDS: ReadonlySet<string> = new Set([
  'hire_date', 'termination_date', 'annual_salary', 'salary_period',
  'employer_alleged_just_cause', 'severance_weeks_offered', 'job_title',
]);

function isBlank(v: unknown): boolean {
  return v === undefined || v === null || v === '';
}

export interface ApplyOutcome {
  /** The merged intake (validated). */
  intake: EmploymentIntakeData;
  /** Fields written into blank slots. */
  applied: string[];
  /** Fields that replaced an existing value (explicit opt-in only). */
  overwritten: string[];
  /** Selected fields skipped because the intake already had a value and no overwrite was requested. */
  skippedNotBlank: string[];
  /** Selected fields with no intake mapping (informational in the extraction, never stored on intake). */
  unmapped: string[];
  /** True when an applied field feeds the analysis (lawyer should re-run it). */
  analysisStale: boolean;
}

/**
 * Merge the lawyer's selected extraction fields into the intake.
 * Pure: returns a new intake; throws only via the returned error string.
 */
export function applyExtractionSelections(
  intake: EmploymentIntakeData,
  extraction: DocumentExtractionResult,
  selectedFields: string[],
  overwriteFields: ReadonlySet<string>,
): ApplyOutcome | { error: string; invalidFields?: string[] } {
  const next: Record<string, unknown> = { ...(intake as Record<string, unknown>) };
  const applied: string[] = [];
  const overwritten: string[] = [];
  const skippedNotBlank: string[] = [];
  const unmapped: string[] = [];

  const unreadableDates: string[] = [];

  for (const name of selectedFields) {
    const field = extraction.extractedFields[name];
    if (!field || isBlank(field.value)) continue; // nothing extracted → nothing to apply
    if (!APPLYABLE_INTAKE_FIELDS.has(name)) {
      unmapped.push(name);
      continue;
    }

    // Documents write dates as prose ("March 2, 2017"); the intake needs
    // YYYY-MM-DD. Read it here rather than rejecting the whole apply and
    // making the lawyer retype a date the system could parse. Anything
    // genuinely ambiguous is refused with its reason, never guessed.
    let value = field.value;
    if (DATE_FIELDS.has(name) && typeof value === 'string' && value.trim()) {
      const parsed = normaliseDate(value);
      if (!parsed.value) {
        unreadableDates.push(`${name}: ${parsed.reason}`);
        continue;
      }
      value = parsed.value;
    }

    const current = next[name];
    if (isBlank(current)) {
      next[name] = value;
      applied.push(name);
    } else if (overwriteFields.has(name)) {
      next[name] = value;
      overwritten.push(name);
    } else {
      skippedNotBlank.push(name);
    }
  }

  // A date we could not read is reported on its own, naming the field AND
  // why, so the lawyer can fix it on the Intake tab instead of guessing
  // which of the selected fields the schema objected to.
  if (unreadableDates.length > 0 && applied.length === 0 && overwritten.length === 0) {
    return {
      error: `Could not read ${unreadableDates.length === 1 ? 'a date' : 'some dates'} from the document. ${unreadableDates.join(' ')}`,
      invalidFields: unreadableDates.map(d => d.split(':')[0]),
    };
  }

  // The merged intake must still satisfy the schema — extracted values never
  // degrade the stored record. On failure, reject naming the offenders.
  const validated = employmentIntakeSchema.safeParse(next);
  if (!validated.success) {
    const invalidFields = [...new Set(validated.error.issues.map(i => String(i.path[0])))];
    // Name the value and the rule it broke. Naming only the field left the
    // lawyer unable to tell WHAT was wrong with it.
    const detail = validated.error.issues.slice(0, 4).map(i => {
      const field = String(i.path[0]);
      const offending = next[field];
      return `${field} (${JSON.stringify(offending)}): ${i.message}`;
    }).join('; ');
    return {
      error: `Applying these values would make the intake invalid, so nothing was changed. ${detail}. Uncheck those fields, or set them on the Intake tab.`,
      invalidFields,
    };
  }

  const changed = [...applied, ...overwritten];
  return {
    intake: validated.data as EmploymentIntakeData,
    applied,
    overwritten,
    skippedNotBlank,
    unmapped,
    analysisStale: changed.some(f => ANALYSIS_INPUT_FIELDS.has(f)),
  };
}

export interface TimelineDiff {
  added: Array<{ date: string; label: string }>;
  removed: Array<{ date: string; label: string }>;
}

/**
 * The consequence diff: which dated events appeared or moved because of the
 * apply. Deterministic compare by (date, label); a moved deadline shows as
 * one removed + one added under the same label.
 */
export function diffTimelines(before: TimelineEvent[], after: TimelineEvent[]): TimelineDiff {
  const key = (e: TimelineEvent): string => `${e.date}|${e.label}`;
  const beforeKeys = new Set(before.map(key));
  const afterKeys = new Set(after.map(key));
  return {
    added: after.filter(e => !beforeKeys.has(key(e))).map(e => ({ date: e.date, label: e.label })),
    removed: before.filter(e => !afterKeys.has(key(e))).map(e => ({ date: e.date, label: e.label })),
  };
}

/**
 * Resolve an extraction by id, tolerating legacy records stored before ids
 * existed: "idx-N" addresses the N-th stored extraction.
 */
export function resolveExtraction(
  extractions: DocumentExtractionResult[],
  extractionId: string,
): DocumentExtractionResult | undefined {
  const byId = extractions.find(e => e.id === extractionId);
  if (byId) return byId;
  const m = /^idx-(\d+)$/.exec(extractionId);
  if (m) return extractions[Number(m[1])];
  return undefined;
}
