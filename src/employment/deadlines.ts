/**
 * Deadline Docket — aggregates every date a plaintiff-side employment
 * lawyer must not miss, across all matters:
 *
 *   - Limitation deadlines (from the analysis; the 2-year Limitations Act
 *     clock and any statute-specific dates already on the timeline)
 *   - Demand letter response deadlines (system tickler events)
 *   - Severance offer acceptance deadlines (from intake)
 *   - Any other future timeline events
 *
 * Pure read-model over matter data_json — no writes, no LLM calls.
 * Consumed by GET /api/employment/deadlines (dashboard docket) and the
 * weekly digest email.
 */

import type { EmploymentMatterData } from '../types/employment-intake.js';
import type { LabourMatterData } from '../types/labour-intake.js';
import { computeGrievanceDeadlines } from '../labour/gate-evaluator.js';

export interface DeadlineItem {
  matterId: string;
  /** "Client v Employer" display label. */
  matterLabel: string;
  /** ISO date (YYYY-MM-DD). */
  date: string;
  /** What the deadline is. */
  label: string;
  /** Days from today (negative = overdue). */
  daysRemaining: number;
  /** 'critical' <= 14 days, 'soon' <= 45, 'upcoming' otherwise. */
  urgency: 'overdue' | 'critical' | 'soon' | 'upcoming';
  kind: 'limitation' | 'demand_response' | 'severance_offer' | 'timeline'
    | 'grievance_filing' | 'grievance_referral' | 'grievance_step';
}

function daysFromToday(isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`);
  if (isNaN(target.getTime())) return NaN;
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function urgencyFor(days: number): DeadlineItem['urgency'] {
  if (days < 0) return 'overdue';
  if (days <= 14) return 'critical';
  if (days <= 45) return 'soon';
  return 'upcoming';
}

/** Horizon: deadlines further out than this are noise in a docket. */
const HORIZON_DAYS = 180;
/** Overdue window: things more than 30 days past are stale, not actionable. */
const OVERDUE_WINDOW_DAYS = -30;

/**
 * Collect deadline items from a set of matter rows — employment matters
 * (limitations, ticklers, severance offers) and labour grievance matters
 * (CA filing/referral clocks) in one docket.
 * Deduplicates limitation dates that also appear as timeline events.
 */
export function collectDeadlines(
  rows: Array<{ id: string; data_json: string }>,
): DeadlineItem[] {
  const items: DeadlineItem[] = [];

  for (const row of rows) {
    let matter: Record<string, unknown>;
    try {
      matter = JSON.parse(row.data_json) as Record<string, unknown>;
    } catch {
      continue; // corrupt row — skip, never break the docket
    }

    const push = (matterLabel: string, date: string, label: string, kind: DeadlineItem['kind']) => {
      const days = daysFromToday(date);
      if (isNaN(days) || days > HORIZON_DAYS || days < OVERDUE_WINDOW_DAYS) return;
      items.push({ matterId: row.id, matterLabel, date, label, daysRemaining: days, urgency: urgencyFor(days), kind });
    };

    const employment = matter.employmentData as EmploymentMatterData | undefined;
    if (employment) {
      const intake = employment.intake as Record<string, unknown> | undefined;
      const client = [intake?.client_first_name, intake?.client_last_name].filter(Boolean).join(' ');
      const employer = (intake?.employer_legal_name ?? intake?.employer_operating_name ?? '') as string;
      const matterLabel = client && employer ? `${client} v ${employer}` : client || employer || row.id;

      // 1. Limitation deadline from the analysis
      const lim = (employment.analysis as Record<string, unknown> | null)?.limitationDeadline as
        | { date?: string }
        | undefined;
      if (lim?.date) push(matterLabel, lim.date, 'Limitation period expires', 'limitation');

      // 2. Severance offer acceptance deadline from intake
      if (intake?.received_severance_offer && intake?.severance_deadline) {
        push(matterLabel, String(intake.severance_deadline), 'Severance offer acceptance deadline', 'severance_offer');
      }

      // 3. Future timeline events (demand response ticklers + lawyer entries).
      //    Skip the limitation event — already captured above.
      for (const ev of employment.timeline ?? []) {
        if (/limitation/i.test(ev.label)) continue;
        const days = daysFromToday(ev.date);
        if (isNaN(days) || days < 0) continue; // past timeline events are history, not deadlines
        const kind: DeadlineItem['kind'] = /response due/i.test(ev.label) ? 'demand_response' : 'timeline';
        if (kind === 'timeline' && ev.source !== 'lawyer_entry' && ev.source !== 'system') continue;
        push(matterLabel, ev.date, ev.label, kind);
      }
    }

    // 4. Grievance clocks from the CA (labour matters). computeGrievanceDeadlines
    //    already drops the filing clock once the grievance is filed.
    const labour = matter.labourData as LabourMatterData | undefined;
    if (labour?.intake) {
      const grievor = [labour.intake.grievor_first_name, labour.intake.grievor_last_name].filter(Boolean).join(' ');
      const grievanceNo = labour.intake.grievance_number ? ` (#${labour.intake.grievance_number})` : '';
      const employer = labour.intake.employer_name ?? '';
      const matterLabel = grievor
        ? `${grievor}${grievanceNo}${employer ? ` — ${employer}` : ''}`
        : employer || row.id;
      for (const d of computeGrievanceDeadlines(labour.intake)) {
        const kind: DeadlineItem['kind'] = d.kind === 'filing' ? 'grievance_filing'
          : d.kind === 'referral' ? 'grievance_referral'
            : 'grievance_step';
        push(matterLabel, d.date, d.label, kind);
      }
    }
  }

  items.sort((a, b) => a.date.localeCompare(b.date));
  return items;
}
