/**
 * The worklist: what every file needs, computed where the lawyer starts.
 *
 * The stage model and the next-step engine already know what each matter
 * needs; until now that knowledge only surfaced after the matter was
 * opened. This module wraps both so the MATTERS LIST can carry the top
 * next action per file, and adds the one state the engines lacked: a
 * file that is WAITING on someone else. Waiting files leave the "needs
 * me" pile; after the nudge window they come back with a follow-up
 * action, because waiting that nobody is watching is how files stall.
 *
 * Everything here is deterministic and cheap: no model calls, safe to
 * run across the whole caseload on every list request.
 */

import type { EmploymentMatterData } from '../types/employment-intake.js';
import { deriveEmploymentStage, deriveLabourStage } from './stage-model.js';
import { recommendEmploymentNextSteps, recommendLabourNextSteps } from './next-steps.js';

// ── Waiting state ────────────────────────────────────────────────────────

export const WAITING_PARTIES = ['client', 'opposing_counsel', 'tribunal', 'partner'] as const;
export type WaitingParty = typeof WAITING_PARTIES[number];

export const WAITING_LABELS: Record<WaitingParty, string> = {
  client: 'the client',
  opposing_counsel: 'opposing counsel',
  tribunal: 'the court or tribunal',
  partner: 'partner review',
};

/** After this many days, a waiting file returns to "needs me" with a follow-up action. */
export const DEFAULT_NUDGE_DAYS = 7;

export interface WaitingOnRecord {
  who: WaitingParty;
  /** ISO date-time the waiting started. */
  since: string;
  note?: string;
  nudgeAfterDays?: number;
}

export interface WaitingState {
  who: WaitingParty;
  whoLabel: string;
  since: string;
  days: number;
  note?: string;
  nudgeAfterDays: number;
  /** True once the wait has outrun the nudge window: the file needs the lawyer again. */
  nudged: boolean;
}

export function waitingState(raw: unknown, now: Date = new Date()): WaitingState | null {
  if (typeof raw !== 'object' || raw === null) return null;
  const r = raw as Partial<WaitingOnRecord>;
  if (!r.who || !(WAITING_PARTIES as readonly string[]).includes(r.who) || typeof r.since !== 'string') return null;
  const since = new Date(r.since);
  if (isNaN(since.getTime())) return null;
  const days = Math.max(0, Math.floor((now.getTime() - since.getTime()) / 86_400_000));
  const nudgeAfterDays = typeof r.nudgeAfterDays === 'number' && r.nudgeAfterDays >= 1 && r.nudgeAfterDays <= 90
    ? Math.round(r.nudgeAfterDays)
    : DEFAULT_NUDGE_DAYS;
  return {
    who: r.who as WaitingParty,
    whoLabel: WAITING_LABELS[r.who as WaitingParty],
    since: r.since,
    days,
    note: typeof r.note === 'string' && r.note ? r.note : undefined,
    nudgeAfterDays,
    nudged: days >= nudgeAfterDays,
  };
}

// ── The top step, computed for the list ──────────────────────────────────

export interface WorklistAction {
  action: string;
  reason: string;
  urgency: 'urgent' | 'now' | 'soon';
  goTo?: string;
  stage: string;
  stageLabel: string;
}

/**
 * The single most pressing next step for a matter record, or null when
 * the engines cannot say (no intake yet, resolved, or malformed data).
 * Never throws: a matter whose data confuses the engine still lists.
 */
export function topStepOf(record: Record<string, unknown>): WorklistAction | null {
  try {
    const employment = record.employmentData as EmploymentMatterData | undefined;
    if (employment?.intake && Object.keys(employment.intake).length > 0) {
      const stage = deriveEmploymentStage(record, employment);
      const steps = recommendEmploymentNextSteps(record, employment, stage);
      const top = steps[0];
      if (!top) return null;
      return { action: top.action, reason: top.reason, urgency: top.urgency, goTo: top.goTo, stage: stage.stage, stageLabel: stage.label };
    }
    const labour = record.labourData as { intake?: Record<string, unknown> } | undefined;
    if (labour?.intake && Object.keys(labour.intake).length > 0) {
      const stage = deriveLabourStage(record, labour as never);
      const steps = recommendLabourNextSteps(record, labour as never, stage);
      const top = steps[0];
      if (!top) return null;
      return { action: top.action, reason: top.reason, urgency: top.urgency, goTo: top.goTo, stage: stage.stage, stageLabel: stage.label };
    }
    return null;
  } catch {
    return null;
  }
}

/**
 * The action shown for a waiting file that has outrun its nudge window.
 * It replaces the engine's step because following up IS the next step.
 */
export function nudgeAction(w: WaitingState): WorklistAction {
  return {
    action: `Follow up: waiting on ${w.whoLabel} for ${w.days} days`,
    reason: w.note ? `Waiting since ${w.since.slice(0, 10)}: ${w.note}` : `Waiting since ${w.since.slice(0, 10)} with no response recorded.`,
    urgency: 'now',
    goTo: 'client',
    stage: 'waiting',
    stageLabel: 'Waiting',
  };
}
