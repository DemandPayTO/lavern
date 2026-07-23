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
  'hire_date', 'contract_signed_date', 'first_day_of_work',
  'termination_date', 'last_day_worked',
  // Compensation
  'annual_salary', 'salary_period', 'hours_per_week',
  'has_bonus', 'bonus_amount',
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

  for (const name of selectedFields) {
    const field = extraction.extractedFields[name];
    if (!field || isBlank(field.value)) continue; // nothing extracted → nothing to apply
    if (!APPLYABLE_INTAKE_FIELDS.has(name)) {
      unmapped.push(name);
      continue;
    }
    const current = next[name];
    if (isBlank(current)) {
      next[name] = field.value;
      applied.push(name);
    } else if (overwriteFields.has(name)) {
      next[name] = field.value;
      overwritten.push(name);
    } else {
      skippedNotBlank.push(name);
    }
  }

  // The merged intake must still satisfy the schema — extracted values never
  // degrade the stored record. On failure, reject naming the offenders.
  const validated = employmentIntakeSchema.safeParse(next);
  if (!validated.success) {
    const invalidFields = [...new Set(validated.error.issues.map(i => String(i.path[0])))];
    return {
      error: 'Applying these values would make the intake invalid. Uncheck the listed fields or correct them manually.',
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
