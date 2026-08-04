/**
 * Date normalisation for extracted and corrected facts.
 *
 * The intake schema requires YYYY-MM-DD. Documents do not: a Statement of
 * Claim says "March 2, 2017", an offer letter says "March 2nd, 2017", and a
 * model asked for ISO sometimes returns a full timestamp. Rejecting those
 * makes the lawyer hand-fix a date the system could read perfectly well,
 * and the rejection previously named the field without showing the value,
 * which is close to unactionable.
 *
 * AMBIGUOUS DATES ARE REFUSED, NOT GUESSED. "03/04/2017" is 3 April in
 * Canadian usage and 4 March in American, and both appear in documents that
 * cross the border. Getting a termination date wrong by a month moves a
 * limitation deadline, so anything that could be read two ways is handed
 * back to the lawyer with the reason.
 *
 * Deterministic: no model call.
 */

const MONTHS: Record<string, number> = {
  january: 1, jan: 1, february: 2, feb: 2, march: 3, mar: 3, april: 4, apr: 4,
  may: 5, june: 6, jun: 6, july: 7, jul: 7, august: 8, aug: 8,
  september: 9, sep: 9, sept: 9, october: 10, oct: 10,
  november: 11, nov: 11, december: 12, dec: 12,
};

export interface DateNormalisation {
  /** YYYY-MM-DD when it could be read unambiguously. */
  value?: string;
  /** Why it could not be, in words the lawyer can act on. */
  reason?: string;
}

function iso(y: number, m: number, d: number): DateNormalisation {
  if (m < 1 || m > 12 || d < 1 || d > 31) {
    return { reason: `"${y}-${m}-${d}" is not a real date.` };
  }
  // Reject impossible day-of-month (31 April, 30 February).
  const probe = new Date(Date.UTC(y, m - 1, d));
  if (probe.getUTCMonth() !== m - 1 || probe.getUTCDate() !== d) {
    return { reason: `That day does not exist in that month.` };
  }
  return { value: `${y}-${String(m).padStart(2, '0')}-${String(d).padStart(2, '0')}` };
}

/**
 * Read a date as written in a legal document into YYYY-MM-DD.
 *
 * Returns { value } when it is unambiguous, { reason } when it is not.
 */
export function normaliseDate(raw: string): DateNormalisation {
  const input = String(raw ?? '').trim();
  if (!input) return { reason: 'No date given.' };

  // Already correct.
  if (/^\d{4}-\d{2}-\d{2}$/.test(input)) {
    const [y, m, d] = input.split('-').map(Number);
    return iso(y, m, d);
  }

  // ISO with a time component, which a model often returns.
  const isoTime = input.match(/^(\d{4})-(\d{1,2})-(\d{1,2})[T ]/);
  if (isoTime) return iso(Number(isoTime[1]), Number(isoTime[2]), Number(isoTime[3]));

  // Unpadded ISO: 2017-3-2
  const loose = input.match(/^(\d{4})[-/](\d{1,2})[-/](\d{1,2})$/);
  if (loose) return iso(Number(loose[1]), Number(loose[2]), Number(loose[3]));

  // "March 2, 2017" / "March 2nd 2017" / "Mar 2 2017"
  const monthFirst = input.match(/^([A-Za-z]+)\.?\s+(\d{1,2})(?:st|nd|rd|th)?,?\s+(\d{4})$/);
  if (monthFirst) {
    const month = MONTHS[monthFirst[1].toLowerCase()];
    if (month) return iso(Number(monthFirst[3]), month, Number(monthFirst[2]));
    return { reason: `"${monthFirst[1]}" is not a month.` };
  }

  // "2 March 2017" / "2nd of March, 2017"
  const dayFirst = input.match(/^(\d{1,2})(?:st|nd|rd|th)?\s+(?:of\s+)?([A-Za-z]+)\.?,?\s+(\d{4})$/);
  if (dayFirst) {
    const month = MONTHS[dayFirst[2].toLowerCase()];
    if (month) return iso(Number(dayFirst[3]), month, Number(dayFirst[1]));
    return { reason: `"${dayFirst[2]}" is not a month.` };
  }

  // All-numeric with the year last: the ambiguous case.
  const numeric = input.match(/^(\d{1,2})[-/.](\d{1,2})[-/.](\d{4})$/);
  if (numeric) {
    const a = Number(numeric[1]);
    const b = Number(numeric[2]);
    // Only safe when one number cannot be a month.
    if (a > 12 && b <= 12) return iso(Number(numeric[3]), b, a);          // 25/03/2017
    if (b > 12 && a <= 12) return iso(Number(numeric[3]), a, b);          // 03/25/2017
    return {
      reason: `"${input}" could be read two ways (day/month or month/day). Enter it on the Intake tab so the deadline dates are right.`,
    };
  }

  // Month and year only: no day means no deadline arithmetic.
  const monthYear = input.match(/^([A-Za-z]+)\.?,?\s+(\d{4})$/);
  if (monthYear && MONTHS[monthYear[1].toLowerCase()]) {
    return { reason: `"${input}" has no day, so it cannot be used for a deadline. Enter the exact date on the Intake tab.` };
  }

  return { reason: `"${input}" is not a date Starling can read. Enter it on the Intake tab.` };
}

/** Intake fields validated as YYYY-MM-DD. */
export const DATE_FIELDS: ReadonlySet<string> = new Set([
  'hire_date', 'termination_date', 'client_date_of_birth', 'contract_signed_date',
  'last_day_worked', 'severance_deadline', 'notice_given_date', 'roe_date',
  'complaint_date', 'leave_start_date', 'leave_end_date', 'accommodation_request_date',
]);
