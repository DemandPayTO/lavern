/**
 * Litigation timetables — the lawyer's proposed dates, validated and docketed.
 *
 * The three timetable documents (the Rule 76 motion, the consent order and
 * the contested order) previously emitted [DATE] placeholders for the lawyer
 * to fill in Word. Those dates are exactly the ones worth capturing: unlike
 * a deponent's name, a proposed date carries consequences. Collected here it
 * can be checked for ordering, measured against the Rule 48.14 deadline, and
 * put on the docket so the timetable the lawyer proposed becomes the
 * deadlines they are actually tracked against.
 *
 * Deterministic: no model call.
 */

import type { TimelineEvent, EmploymentIntakeData } from '../types/employment-intake.js';
import { normaliseDate } from './date-normalise.js';

/**
 * The steps of a simplified-procedure timetable, in the order they must
 * occur. Order is the whole point of the validation: productions before
 * examinations, mediation before setting down, pre-trial before trial.
 */
export const TIMETABLE_STEPS = [
  { key: 'affidavits_of_documents', label: 'Affidavits of documents exchanged' },
  { key: 'productions', label: 'Documentary productions delivered' },
  { key: 'examinations', label: 'Examinations for discovery completed' },
  { key: 'mediation', label: 'Mediation completed' },
  { key: 'set_down', label: 'Action set down for trial' },
  { key: 'pre_trial', label: 'Pre-trial conference' },
  { key: 'trial', label: 'Trial' },
] as const;

export type TimetableStepKey = typeof TIMETABLE_STEPS[number]['key'];
export type TimetableDates = Partial<Record<TimetableStepKey, string>>;

export interface TimetableIssue {
  step: TimetableStepKey;
  message: string;
  /** A hard error blocks generation; a caution is shown but does not block. */
  severity: 'error' | 'caution';
}

export interface TimetableValidation {
  ok: boolean;
  /** Normalised YYYY-MM-DD dates for the steps that were supplied. */
  dates: TimetableDates;
  issues: TimetableIssue[];
}

/**
 * Rule 48.14: an action is dismissed for delay if it has not been set down
 * within five years of commencement. A timetable that proposes setting down
 * after that date needs an extension, and the lawyer must know before the
 * motion is served, not after.
 */
const RULE_48_14_YEARS = 5;

function addYears(iso: string, years: number): string {
  const d = new Date(`${iso}T00:00:00`);
  d.setFullYear(d.getFullYear() + years);
  return d.toISOString().slice(0, 10);
}

/**
 * Validate proposed dates: readable, in the future, in the right order, and
 * within the Rule 48.14 window where the commencement date is known.
 */
export function validateTimetable(
  raw: Record<string, string | undefined>,
  options: { today?: string; claimIssuedDate?: string } = {},
): TimetableValidation {
  const today = options.today ?? new Date().toISOString().slice(0, 10);
  const dates: TimetableDates = {};
  const issues: TimetableIssue[] = [];

  for (const step of TIMETABLE_STEPS) {
    const value = raw[step.key];
    if (!value || !String(value).trim()) continue;

    const parsed = normaliseDate(String(value));
    if (!parsed.value) {
      issues.push({ step: step.key, message: `${step.label}: ${parsed.reason}`, severity: 'error' });
      continue;
    }
    if (parsed.value < today) {
      issues.push({
        step: step.key,
        message: `${step.label} is in the past (${parsed.value}). A timetable proposes future dates.`,
        severity: 'error',
      });
      continue;
    }
    dates[step.key] = parsed.value;
  }

  // Ordering: each supplied step must fall on or after the previous one.
  // Steps the lawyer left blank are skipped rather than treated as breaks.
  let previous: { label: string; date: string } | null = null;
  for (const step of TIMETABLE_STEPS) {
    const date = dates[step.key];
    if (!date) continue;
    if (previous && date < previous.date) {
      issues.push({
        step: step.key,
        message: `${step.label} (${date}) falls before ${previous.label} (${previous.date}).`,
        severity: 'error',
      });
    }
    previous = { label: step.label, date };
  }

  // Rule 48.14, where the commencement date is known.
  if (options.claimIssuedDate && dates.set_down) {
    const deadline = addYears(options.claimIssuedDate, RULE_48_14_YEARS);
    if (dates.set_down > deadline) {
      issues.push({
        step: 'set_down',
        message:
          `Setting down on ${dates.set_down} is after the Rule 48.14 deadline of ${deadline} `
          + `(five years from ${options.claimIssuedDate}). The motion must ask for an extension.`,
        severity: 'caution',
      });
    }
  }

  return { ok: !issues.some(i => i.severity === 'error'), dates, issues };
}

/**
 * Render the timetable for the generator, so the document carries the
 * lawyer's real dates instead of [DATE] placeholders. Steps left blank stay
 * as placeholders rather than being invented.
 */
export function timetableForPrompt(dates: TimetableDates): string {
  const lines = TIMETABLE_STEPS.map(step => {
    const date = dates[step.key];
    return `- ${step.label}: ${date ?? '[DATE]'}`;
  });
  return `PROPOSED TIMETABLE (use these exact dates in Schedule A; leave [DATE] where one is not given):\n${lines.join('\n')}`;
}

/**
 * Timeline events for the docket.
 *
 * These are the lawyer's own proposed dates, not yet ordered by a court, so
 * they are NOT marked as court deadlines: a red court chip should mean a
 * date a judge imposed. They become ordinary docket items the lawyer is
 * reminded about, and can be promoted when the order is made.
 */
export function timetableTimelineEvents(
  dates: TimetableDates,
  options: { proposed?: boolean } = {},
): TimelineEvent[] {
  const proposed = options.proposed ?? true;
  const prefix = proposed ? 'Proposed: ' : '';
  return TIMETABLE_STEPS
    .filter(step => dates[step.key])
    .map(step => ({
      date: dates[step.key]!,
      label: `${prefix}${step.label}`,
      description: proposed
        ? 'From the timetable proposed in the motion. Confirm when the order is made.'
        : 'Fixed by the timetable order.',
      category: 'legal' as const,
      source: 'system' as const,
      // Only a date a court has actually ordered is a court deadline.
      courtDeadline: !proposed,
    }));
}

/** The date the claim was issued, for the Rule 48.14 check, where known. */
export function claimIssuedDate(intake: EmploymentIntakeData | null | undefined): string | undefined {
  if (!intake) return undefined;
  const value = (intake as unknown as Record<string, unknown>).claim_issued_date;
  return typeof value === 'string' && value ? value : undefined;
}
