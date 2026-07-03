/**
 * CA Extraction Mapping — turns fields extracted from an uploaded
 * collective agreement into grievance-intake values, feeding the CA
 * deadline clocks (filing / referral) without the rep re-typing them.
 *
 * Rules:
 *   - NEVER overwrite a value the reviewer already entered — extraction
 *     fills blanks only.
 *   - Every value is validated before it lands (day counts must be
 *     positive integers, kinds must be calendar/working, dates ISO).
 *   - Pure function: no I/O, no model calls — testable in isolation.
 */

import type { GrievanceIntakeData, CaProcedureStep } from '../types/labour-intake.js';

/** One extracted field as returned by the document extractor. */
export interface ExtractedField {
  value: string | number | boolean | null;
  confidence: 'high' | 'medium' | 'low';
}

export interface CaExtractionResult {
  intake: GrievanceIntakeData;
  /** Intake field names that were filled from the CA. */
  filled: string[];
}

const ISO_DATE_RE = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

function asTrimmedString(v: unknown, maxLen = 2000): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return s.length > 0 ? s.slice(0, maxLen) : null;
}

function asPositiveInt(v: unknown): number | null {
  const n = typeof v === 'number' ? v : typeof v === 'string' ? parseFloat(v) : NaN;
  if (!Number.isFinite(n) || n <= 0 || n > 3650) return null;
  return Math.round(n);
}

function asDayKind(v: unknown): 'calendar' | 'working' | null {
  if (typeof v !== 'string') return null;
  const s = v.trim().toLowerCase();
  if (s.startsWith('calendar')) return 'calendar';
  if (s.startsWith('working') || s.startsWith('business')) return 'working';
  return null;
}

function asIsoDate(v: unknown): string | null {
  if (typeof v !== 'string') return null;
  const s = v.trim();
  return ISO_DATE_RE.test(s) ? s : null;
}

function asBool(v: unknown): boolean | null {
  return typeof v === 'boolean' ? v : null;
}

function isEmpty(v: unknown): boolean {
  return v === undefined || v === null || v === ''
    || (Array.isArray(v) && v.length === 0);
}

/**
 * Parse the extractor's procedure_steps_json string into validated steps.
 * Returns null unless at least one step with a usable label survives.
 */
export function parseProcedureSteps(v: unknown): CaProcedureStep[] | null {
  if (typeof v !== 'string' || !v.trim()) return null;
  let raw: unknown;
  try { raw = JSON.parse(v); } catch { return null; }
  if (!Array.isArray(raw)) return null;

  const steps: CaProcedureStep[] = [];
  for (const entry of raw.slice(0, 10)) {
    if (typeof entry !== 'object' || entry === null) continue;
    const e = entry as Record<string, unknown>;
    const label = asTrimmedString(e.label, 60);
    if (!label) continue;
    steps.push({
      label,
      employer_response_days: asPositiveInt(e.employer_response_days),
      advance_days: asPositiveInt(e.advance_days),
      day_kind: asDayKind(e.day_kind),
    });
  }
  return steps.length > 0 ? steps : null;
}

/**
 * Fill blank CA fields on a grievance intake from a collective-agreement
 * extraction. Returns a new intake object plus the list of fields filled.
 */
export function applyCaExtraction(
  intake: GrievanceIntakeData,
  extractedFields: Record<string, ExtractedField>,
): CaExtractionResult {
  const updated: Record<string, unknown> = { ...(intake as Record<string, unknown>) };
  const filled: string[] = [];

  const raw = (key: string): unknown => extractedFields[key]?.value ?? null;

  const fill = (field: string, value: unknown): void => {
    if (value === null || !isEmpty(updated[field])) return;
    updated[field] = value;
    filled.push(field);
  };

  fill('ca_title', asTrimmedString(raw('ca_title')));
  fill('ca_expiry_date', asIsoDate(raw('ca_expiry_date')));
  fill('union_name', asTrimmedString(raw('union_name')));
  fill('employer_name', asTrimmedString(raw('employer_name')));
  fill('grievance_procedure_article', asTrimmedString(raw('grievance_procedure_article')));
  fill('just_cause_article', asTrimmedString(raw('just_cause_article')));
  fill('filing_deadline_days', asPositiveInt(raw('filing_deadline_days')));
  fill('filing_deadline_kind', asDayKind(raw('filing_deadline_kind')));
  fill('referral_deadline_days', asPositiveInt(raw('referral_deadline_days')));
  fill('referral_deadline_kind', asDayKind(raw('referral_deadline_kind')));
  fill('time_limits_mandatory', asBool(raw('time_limits_mandatory')));
  fill('sunset_clause_months', asPositiveInt(raw('sunset_clause_months')));
  fill('procedure_steps', parseProcedureSteps(raw('procedure_steps_json')));

  // Fields with no dedicated intake column land in ca_notes so nothing
  // the extractor found is lost.
  const noteParts: string[] = [];
  const arb = asTrimmedString(raw('arbitration_article'), 200);
  if (arb) noteParts.push(`Arbitration article: ${arb}`);
  const steps = asTrimmedString(raw('grievance_steps'), 1500);
  if (steps) noteParts.push(`Procedure steps (extracted): ${steps}`);
  if (noteParts.length > 0 && isEmpty(updated.ca_notes)) {
    updated.ca_notes = noteParts.join('\n').slice(0, 2000);
    filled.push('ca_notes');
  }

  return { intake: updated as GrievanceIntakeData, filled };
}
