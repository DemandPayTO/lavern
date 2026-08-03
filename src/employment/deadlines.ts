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
  /** Raw time-based urgency (kept for sorting/back-compat). */
  urgency: 'overdue' | 'critical' | 'soon' | 'upcoming';
  /**
   * Triage band that drives colour. RED is reserved for court/statutory
   * deadlines only (see isCourtDeadline); everything else is amber at most.
   * critical = a court/statutory deadline overdue or due within 5 days;
   * attention = a court/statutory deadline in 6-21 days, or any non-court
   * item overdue or due within 7 days; planned = everything else.
   */
  band: 'critical' | 'attention' | 'planned';
  /** True when this is a court-imposed / statutory deadline (red-eligible). */
  isCourt: boolean;
  kind: 'limitation' | 'demand_response' | 'severance_offer' | 'timeline'
    | 'grievance_filing' | 'grievance_referral' | 'grievance_step' | 'client_email'
    | 'action_item' | 'approval';
}

/**
 * Kinds that are always court-imposed or statutory (a miss forecloses a right
 * or prejudices the client): the limitation clock and the labour grievance /
 * tribunal time limits.
 */
const COURT_KINDS: ReadonlySet<DeadlineItem['kind']> = new Set([
  'limitation', 'grievance_filing', 'grievance_referral', 'grievance_step',
]);

/**
 * Court litigation deadlines that are stored as generic timeline ticklers.
 * System-generated ticklers carry known labels ("Statement of Defence due",
 * "Statement of Claim (Form 14D) due"); lawyers may enter others. This
 * curated set auto-classifies both. Lawyer-entered events can also be flagged
 * explicitly via the courtDeadline field, which takes precedence.
 */
const COURT_DEADLINE_LABELS = /\b(statement of (claim|defence|defense)|\bSOC\b|\bSOD\b|reply \(form 25a\)|factum|affidavit of documents|examination for discovery|discovery plan|notice of motion|motion record|mediation brief|settlement conference|pre-?trial|trial record|trial date|status (notice|hearing)|form \d+[a-z]?( |,|\.|\)| due))/i;

/**
 * Is this a court-imposed / statutory deadline (red-eligible)? True when the
 * kind is always-court, the event was explicitly flagged, or the label
 * matches a known court deadline. Negotiation timing (offer expiries, demand
 * responses, replies, client emails, debrief tasks) is never court.
 */
export function isCourtDeadline(kind: DeadlineItem['kind'], label: string, flag?: boolean): boolean {
  if (flag) return true;
  if (COURT_KINDS.has(kind)) return true;
  // Only generic timeline events are pattern-matched; the negotiation kinds
  // are deliberately excluded even if their text happens to match.
  if (kind === 'timeline') return COURT_DEADLINE_LABELS.test(label);
  return false;
}

/**
 * The triage band for a deadline. Red (critical) only for court/statutory
 * deadlines inside a business week or overdue.
 */
export function priorityBand(isCourt: boolean, days: number): DeadlineItem['band'] {
  if (isCourt) {
    if (days <= 5) return 'critical';   // overdue (days < 0) or within a business week
    if (days <= 21) return 'attention';
    return 'planned';
  }
  if (days <= 7) return 'attention';    // non-court overdue or imminent: amber, never red
  return 'planned';
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

    const push = (matterLabel: string, date: string, label: string, kind: DeadlineItem['kind'], courtFlag?: boolean) => {
      const days = daysFromToday(date);
      if (isNaN(days) || days > HORIZON_DAYS || days < OVERDUE_WINDOW_DAYS) return;
      const isCourt = isCourtDeadline(kind, label, courtFlag);
      items.push({
        matterId: row.id, matterLabel, date, label, daysRemaining: days,
        urgency: urgencyFor(days), band: priorityBand(isCourt, days), isCourt, kind,
      });
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
        // System log entries (records of things that happened) are history,
        // not deadlines — keep them off the docket and the task inbox.
        if (/^(Debrief captured|Outcome recorded|Matter reopened)/i.test(ev.label)) continue;
        const days = daysFromToday(ev.date);
        if (isNaN(days) || days < 0) continue; // past timeline events are history, not deadlines
        const kind: DeadlineItem['kind'] = /response due/i.test(ev.label) ? 'demand_response' : 'timeline';
        if (kind === 'timeline' && ev.source !== 'lawyer_entry' && ev.source !== 'system') continue;
        push(matterLabel, ev.date, ev.label, kind, (ev as { courtDeadline?: boolean }).courtDeadline);
      }
    }

    // Scheduled client correspondence (mitigation series etc.): a due email
    // the lawyer has not sent is a deadline like any other. Collected outside
    // the employment guard so it surfaces even before intake is filled.
    {
      const intake = (matter.employmentData as EmploymentMatterData | undefined)?.intake as Record<string, unknown> | undefined;
      const client = [intake?.client_first_name, intake?.client_last_name].filter(Boolean).join(' ');
      const employer = (intake?.employer_legal_name ?? intake?.employer_operating_name ?? '') as string;
      const label = client && employer ? `${client} v ${employer}` : client || employer || row.id;
      const correspondence = (matter.correspondence ?? []) as Array<{
        dueDate?: string; title?: string; status?: string;
      }>;
      for (const c of correspondence) {
        if (c.status !== 'scheduled' && c.status !== 'drafted') continue;
        if (!c.dueDate || !c.title) continue;
        push(label, c.dueDate, `Client email due: ${c.title}`, 'client_email');
      }
    }

    // Debrief action items: open, dated follow-ups from call notes. Collected
    // outside the employment guard so they surface for any matter type.
    {
      const intake = (matter.employmentData as EmploymentMatterData | undefined)?.intake as Record<string, unknown> | undefined;
      const client = [intake?.client_first_name, intake?.client_last_name].filter(Boolean).join(' ');
      const employer = (intake?.employer_legal_name ?? intake?.employer_operating_name ?? '') as string;
      const label = client && employer ? `${client} v ${employer}` : client || employer || row.id;
      const debriefs = (matter.debriefs ?? []) as Array<{ actionItems?: Array<{ status?: string; dueDate?: string | null; task?: string }> }>;
      for (const d of debriefs) {
        for (const it of d.actionItems ?? []) {
          if (it.status === 'open' && it.dueDate && it.task) {
            push(label, it.dueDate, `Action: ${it.task}`, 'action_item');
          }
        }
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
        ? `${grievor}${grievanceNo}${employer ? ` v ${employer}` : ''}`
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
