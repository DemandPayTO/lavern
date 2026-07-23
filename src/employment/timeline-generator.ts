/**
 * Timeline Generator — builds a chronological event sequence from intake data.
 *
 * The timeline is a living document: it starts with facts from intake and
 * grows as the matter progresses (discovery events, court dates, settlement
 * offers, etc.). Lawyers can add events manually.
 *
 * Used by:
 *   - Intake analysis (initial timeline from facts)
 *   - Demand letter (employment background section)
 *   - Statement of Claim (facts section — chronological narrative)
 *   - Matter dashboard (visual timeline in UI)
 */

import type { EmploymentIntakeData, TimelineEvent } from '../types/employment-intake.js';

/**
 * Build the initial timeline from structured intake data.
 *
 * Extracts every known date from the intake and creates a sorted,
 * chronological sequence of events. Only adds events where the date
 * is actually provided (no placeholder dates).
 *
 * @param intake Structured intake data.
 * @returns Sorted array of TimelineEvent objects.
 */
export function buildTimelineFromIntake(intake: EmploymentIntakeData): TimelineEvent[] {
  const events: TimelineEvent[] = [];

  // ── Employment events ──────────────────────────────────────────────────

  if (intake.contract_signed_date) {
    events.push({
      date: intake.contract_signed_date,
      label: 'Employment contract signed',
      description: intake.employer_legal_name
        ? `The client signed an employment agreement with ${intake.employer_legal_name}.`
        : 'The client signed an employment agreement.',
      category: 'employment',
      source: 'intake_form',
    });
  }

  if (intake.first_day_of_work) {
    events.push({
      date: intake.first_day_of_work,
      label: 'First day of work',
      description: intake.job_title
        ? `The client commenced employment as ${intake.job_title}${intake.employer_legal_name ? ` at ${intake.employer_legal_name}` : ''}.`
        : 'The client\'s first day of employment.',
      category: 'employment',
      source: 'intake_form',
    });
  }

  if (intake.hire_date && intake.hire_date !== intake.first_day_of_work) {
    events.push({
      date: intake.hire_date,
      label: 'Hire date',
      description: intake.job_title
        ? `The client was hired as ${intake.job_title}${intake.employer_legal_name ? ` at ${intake.employer_legal_name}` : ''}.`
        : 'The client\'s date of hire.',
      category: 'employment',
      source: 'intake_form',
    });
  }

  // ── Role changes ───────────────────────────────────────────────────────

  if (intake.role_changed_since_signing && intake.role_change_details) {
    // We don't have a specific date for the role change, so we note it
    // without adding to the timeline. The lawyer can add the exact date.
  }

  // ── Predecessor employer (successor employer situation) ────────────────

  if (intake.acquisition_date && intake.predecessor_employer_name) {
    events.push({
      date: intake.acquisition_date,
      label: 'Employer acquisition/restructuring',
      description: `${intake.predecessor_employer_name} was acquired or restructured; the client's employment continued with ${intake.employer_legal_name ?? 'the successor employer'}.`,
      category: 'employment',
      source: 'intake_form',
    });
  }

  // ── Mid-employment clause addition ─────────────────────────────────────

  if (intake.clause_added_mid_employment && intake.clause_signed_date) {
    events.push({
      date: intake.clause_signed_date,
      label: 'Termination clause added mid-employment',
      description: 'A new or amended termination clause was introduced after the initial hiring. Fresh consideration may be in issue.',
      category: 'legal',
      source: 'intake_form',
    });
  }

  // ── Termination events ─────────────────────────────────────────────────

  if (intake.termination_date) {
    const reasons = [];
    if (intake.employer_alleged_just_cause) reasons.push('employer alleged just cause');
    if (intake.is_constructive_dismissal) reasons.push('constructive dismissal');
    if (intake.was_terminated) reasons.push('terminated');
    if (intake.resigned) reasons.push('resigned');

    events.push({
      date: intake.termination_date,
      label: intake.is_constructive_dismissal ? 'Constructive dismissal' : 'Termination',
      description: `The employment ended${reasons.length > 0 ? ` (${reasons.join(', ')})` : ''}.${intake.termination_reasons ? ` Stated reason: ${intake.termination_reasons}` : ''}`,
      category: 'termination',
      source: 'intake_form',
    });
  }

  if (intake.last_day_worked && intake.last_day_worked !== intake.termination_date) {
    events.push({
      date: intake.last_day_worked,
      label: 'Last day worked',
      description: 'The last day on which the client attended work.',
      category: 'termination',
      source: 'intake_form',
    });
  }

  // ── Severance offer ────────────────────────────────────────────────────

  if (intake.received_severance_offer && intake.severance_deadline) {
    events.push({
      date: intake.severance_deadline,
      label: 'Severance offer deadline',
      description: `Deadline for the client to accept the severance offer${intake.severance_weeks_offered ? ` (${intake.severance_weeks_offered} weeks offered)` : ''}.`,
      category: 'legal',
      source: 'intake_form',
    });
  }

  // ── Mitigation ─────────────────────────────────────────────────────────

  if (intake.new_employment_found && intake.new_employment_start_date) {
    events.push({
      date: intake.new_employment_start_date,
      label: 'New employment started',
      description: intake.new_employment_salary
        ? `The client commenced new employment at $${intake.new_employment_salary.toLocaleString('en-CA')} per year.`
        : 'The client commenced new employment (mitigation).',
      category: 'mitigation',
      source: 'intake_form',
    });
  }

  // ── Limitation period and statutory filing deadlines ──────────────────

  if (intake.termination_date) {
    const termDate = new Date(intake.termination_date);
    if (!isNaN(termDate.getTime())) {
      const plusYears = (years: number): string => {
        const d = new Date(termDate);
        d.setFullYear(d.getFullYear() + years);
        return d.toISOString().split('T')[0];
      };

      events.push({
        date: plusYears(2),
        label: 'Limitation period expires',
        description: 'The two-year limitation period under the Limitations Act, 2002 (s. 4) expires. An action must be commenced before this date.',
        category: 'legal',
        source: 'system',
      });

      // HRTO one-year deadline (Code s. 34(1)), docketed where the intake
      // discloses a discrimination dimension. The clock runs from the last
      // incident; termination is the conservative anchor available here.
      const hrDimension = Boolean(intake.believes_discriminatory_termination)
        || (intake.discrimination_grounds?.length ?? 0) > 0
        || Boolean(intake.accommodation_denied);
      if (hrDimension) {
        events.push({
          date: plusYears(1),
          label: 'HRTO application deadline (Code s. 34(1))',
          description: 'One year from the last incident of discrimination to file the HRTO application. The date shown assumes the termination is the last incident; confirm the actual last incident in the series.',
          category: 'legal',
          source: 'system',
        });
      }

      // ESA claim window (two years). Filing an ESA claim for termination
      // or severance pay can bar a civil action for the same amounts
      // (ESA ss. 97 and 98), so the election matters more than the date.
      events.push({
        date: plusYears(2),
        label: 'ESA claim filing deadline',
        description: 'Two years to file an employment standards claim. Election caution: filing an ESA claim for termination or severance pay generally bars a civil action for the same entitlements (ESA ss. 97 and 98); choose the forum deliberately.',
        category: 'legal',
        source: 'system',
      });
    }
  }

  // ── Sort chronologically ───────────────────────────────────────────────

  events.sort((a, b) => a.date.localeCompare(b.date));

  return events;
}

/**
 * System-event labels buildTimelineFromIntake itself emits. On a preserving
 * rebuild these regenerate from intake, so stored copies are dropped rather
 * than duplicated.
 */
const GENERATED_SYSTEM_LABELS = new Set([
  'Limitation period expires',
  'HRTO application deadline (Code s. 34(1))',
  'ESA claim filing deadline',
]);

/**
 * Rebuild the intake-derived timeline WITHOUT losing events the rebuild does
 * not know how to regenerate: lawyer-entered court dates, route-added system
 * ticklers (Statement of Defence due, correspondence, debrief and outcome
 * records), and document-extraction events. Plain buildTimelineFromIntake
 * replaces the array wholesale, which silently wiped those on every intake
 * save; every intake mutation path must use this instead.
 */
export function rebuildTimelinePreserving(
  existing: TimelineEvent[] | undefined,
  intake: EmploymentIntakeData,
): TimelineEvent[] {
  const regenerated = buildTimelineFromIntake(intake);
  const preserved = (existing ?? []).filter(e =>
    e.source === 'lawyer_entry'
    || e.source === 'document_extraction'
    || (e.source === 'system' && !GENERATED_SYSTEM_LABELS.has(e.label)));
  // Guard against exact duplicates if a preserved event matches a
  // regenerated one (same date + label).
  const seen = new Set(regenerated.map(e => `${e.date}|${e.label}`));
  const merged = [...regenerated, ...preserved.filter(e => !seen.has(`${e.date}|${e.label}`))];
  merged.sort((a, b) => a.date.localeCompare(b.date));
  return merged;
}

/**
 * Add a manual event to the timeline.
 * Returns a new sorted timeline array (does not mutate the input).
 */
export function addTimelineEvent(
  timeline: TimelineEvent[],
  event: TimelineEvent,
): TimelineEvent[] {
  const updated = [...timeline, event];
  updated.sort((a, b) => a.date.localeCompare(b.date));
  return updated;
}

/**
 * Compute the limitation deadline from the termination date.
 * Returns null if no termination date is provided.
 */
export function computeLimitationDeadline(terminationDate: string | undefined): {
  date: string;
  daysRemaining: number;
  urgent: boolean;
} | null {
  if (!terminationDate) return null;

  const termDate = new Date(terminationDate);
  if (isNaN(termDate.getTime())) return null;

  const limitationDate = new Date(termDate);
  limitationDate.setFullYear(limitationDate.getFullYear() + 2);

  const today = new Date();
  today.setHours(0, 0, 0, 0);
  const diffMs = limitationDate.getTime() - today.getTime();
  const daysRemaining = Math.ceil(diffMs / (1000 * 60 * 60 * 24));

  return {
    date: limitationDate.toISOString().split('T')[0],
    daysRemaining,
    urgent: daysRemaining <= 90,
  };
}

/**
 * Compute Bardal factors from intake data.
 */
export function computeBardalFactors(intake: EmploymentIntakeData): {
  age: number | null;
  tenureYears: number | null;
  character: string;
  availability: string;
} {
  // Age at termination
  let age: number | null = null;
  if (intake.client_age) {
    age = intake.client_age;
  } else if (intake.client_date_of_birth && intake.termination_date) {
    const dob = new Date(intake.client_date_of_birth);
    const term = new Date(intake.termination_date);
    if (!isNaN(dob.getTime()) && !isNaN(term.getTime())) {
      age = term.getFullYear() - dob.getFullYear();
      const monthDiff = term.getMonth() - dob.getMonth();
      if (monthDiff < 0 || (monthDiff === 0 && term.getDate() < dob.getDate())) {
        age--;
      }
    }
  }

  // Tenure
  let tenureYears: number | null = null;
  const startDate = intake.hire_date ?? intake.first_day_of_work;
  const endDate = intake.termination_date ?? intake.last_day_worked;
  if (startDate && endDate) {
    const start = new Date(startDate);
    const end = new Date(endDate);
    if (!isNaN(start.getTime()) && !isNaN(end.getTime())) {
      tenureYears = Math.round(((end.getTime() - start.getTime()) / (1000 * 60 * 60 * 24 * 365.25)) * 10) / 10;
    }
  }

  // Character of employment (from job title — rough heuristic)
  const title = (intake.job_title ?? '').toLowerCase();
  let character = 'mid-level';
  if (/\b(ceo|cfo|cto|coo|president|vp|vice\s*president|director|partner|principal|managing)\b/.test(title)) {
    character = 'senior executive';
  } else if (/\b(manager|supervisor|lead|head|chief|senior)\b/.test(title)) {
    character = 'senior/managerial';
  } else if (/\b(junior|intern|trainee|apprentice|entry|assistant|clerk)\b/.test(title)) {
    character = 'entry-level';
  }

  // Availability of similar employment (rough assessment)
  let availability = 'moderate';
  if (age && age >= 55) availability = 'limited (age factor)';
  if (intake.has_known_medical_condition) availability = 'limited (health factor)';
  if (character === 'senior executive') availability = 'limited (specialised role)';

  return { age, tenureYears, character, availability };
}

/**
 * Recommend a procedure type based on estimated total damages.
 * Small Claims: ≤ $50,000
 * Simplified:   $50,001 – $200,000
 * Ordinary:     > $200,000
 */
export function recommendProcedure(estimatedDamages: number): 'small_claims' | 'simplified' | 'ordinary' {
  if (estimatedDamages <= 50_000) return 'small_claims';
  if (estimatedDamages <= 200_000) return 'simplified';
  return 'ordinary';
}
