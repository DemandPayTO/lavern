/**
 * Next-Step Engine — what should happen next on this matter, derived
 * deterministically from the stage and the matter's state. This is the
 * point of a workflow system: the file carries its own momentum.
 *
 * Rules are ordered by consequence: limitation jeopardy first, then the
 * decision the lawyer owes, then the document the file is waiting on.
 * At most three recommendations are returned; every one carries its
 * reason.
 */

import type { EmploymentMatterData } from '../types/employment-intake.js';
import type { LabourMatterData } from '../types/labour-intake.js';
import type { EmploymentStage, LabourStage, StageResult } from './stage-model.js';
import { computeGrievanceDeadlines } from '../labour/gate-evaluator.js';

export interface NextStep {
  action: string;
  reason: string;
  urgency: 'urgent' | 'now' | 'soon';
  /** Matter-view tab the action lives on. */
  goTo?: 'issues' | 'docs' | 'draft' | 'intake' | 'client' | 'negotiation';
}

const URGENCY_ORDER: Record<NextStep['urgency'], number> = { urgent: 0, now: 1, soon: 2 };

function cap(steps: NextStep[]): NextStep[] {
  return steps.sort((a, b) => URGENCY_ORDER[a.urgency] - URGENCY_ORDER[b.urgency]).slice(0, 3);
}

function daysUntil(iso: string | undefined | null, today: Date): number | null {
  if (!iso) return null;
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return null;
  const t = new Date(today);
  t.setHours(0, 0, 0, 0);
  return Math.round((d.getTime() - t.getTime()) / 86_400_000);
}

function hasDoc(matter: Record<string, unknown>, docType: string): boolean {
  const legacy: Record<string, string> = {
    demand_letter: 'generatedDemandLetter',
    statement_of_claim: 'generatedSOC',
    application: 'generatedApplication',
  };
  return Boolean(matter[legacy[docType] ?? `generated_${docType}`]);
}

function docStatus(matter: Record<string, unknown>, docType: string): string {
  const legacy: Record<string, string> = {
    demand_letter: 'generatedDemandLetter',
    statement_of_claim: 'generatedSOC',
    application: 'generatedApplication',
  };
  const doc = matter[legacy[docType] ?? `generated_${docType}`];
  if (!doc || typeof doc !== 'object') return 'none';
  return String((doc as Record<string, unknown>).status ?? 'draft');
}

// ── Employment ───────────────────────────────────────────────────────────

export function recommendEmploymentNextSteps(
  matter: Record<string, unknown>,
  employment: EmploymentMatterData | null | undefined,
  stage: StageResult<EmploymentStage>,
  today: Date = new Date(),
): NextStep[] {
  const steps: NextStep[] = [];
  if (stage.stage === 'resolution') {
    return [{
      action: 'Record the outcome and close the file',
      reason: 'The matter has reached resolution; the closed record feeds the firm\'s outcome history.',
      urgency: 'soon', goTo: 'intake',
    }];
  }

  const analysis = employment?.analysis as Record<string, unknown> | null | undefined;
  const intake = (employment?.intake ?? {}) as Record<string, unknown>;
  const timeline = employment?.timeline ?? [];

  // An employer offer awaiting the client side's move: the negotiation is
  // the matter's core moment; a stale unanswered offer is lost leverage.
  const negotiation = (matter.negotiation ?? []) as Array<{
    date?: string; party?: string; kind?: string; amountCad?: number | null;
  }>;
  const lastMove = [...negotiation].sort((a, b) => String(a.date).localeCompare(String(b.date))).at(-1);
  const negotiationClosed = negotiation.some(e => e.kind === 'acceptance');
  if (lastMove && !negotiationClosed && lastMove.party === 'employer' && (lastMove.kind === 'offer' || lastMove.kind === 'counter')) {
    const days = daysUntil(lastMove.date, today);
    if (days !== null && days <= -5) {
      steps.push({
        action: 'Respond to the employer\'s outstanding offer',
        reason: `The employer's ${lastMove.kind} of ${lastMove.amountCad != null ? '$' + Number(lastMove.amountCad).toLocaleString('en-CA') : 'unspecified amount'} has sat unanswered for ${-days} days.`,
        urgency: 'now',
        goTo: 'negotiation',
      });
    }
  }

  // Scheduled client correspondence that has come due: the lawyer drafts,
  // reviews, and sends; Starling's job is to make sure it is not missed.
  const correspondence = (matter.correspondence ?? []) as Array<{
    title?: string; dueDate?: string; status?: string;
  }>;
  for (const c of correspondence) {
    if (c.status !== 'scheduled' && c.status !== 'drafted') continue;
    const days = daysUntil(c.dueDate, today);
    if (days === null || days > 3) continue;
    steps.push({
      action: c.status === 'drafted'
        ? `Review and send the client email: ${c.title}`
        : `Draft and send the client email: ${c.title}`,
      reason: days < 0
        ? `This client email is ${-days} day${days === -1 ? '' : 's'} overdue.`
        : 'This client email is due; the client is waiting on the firm\'s guidance.',
      urgency: days < 0 ? 'urgent' : 'now',
      goTo: 'client',
    });
  }

  // Open action items from call debriefs. Near-term dated items surface as
  // their own step; undated follow-ups roll up into one nudge to the Debrief
  // tab so they are not lost there.
  const debriefs = (matter.debriefs ?? []) as Array<{
    actionItems?: Array<{ task?: string; dueDate?: string | null; status?: string }>;
  }>;
  const openActionItems = debriefs.flatMap(d => d.actionItems ?? []).filter(it => it.status === 'open');
  for (const it of openActionItems) {
    if (!it.dueDate || !it.task) continue;
    const days = daysUntil(it.dueDate, today);
    if (days === null || days > 3) continue; // future dated items live on the docket
    steps.push({
      action: `Action item: ${it.task}`,
      reason: days < 0
        ? `This action item is ${-days} day${days === -1 ? '' : 's'} overdue.`
        : 'This action item is due.',
      urgency: days < 0 ? 'urgent' : 'now',
      goTo: 'debrief',
    });
  }
  const undatedOpen = openActionItems.filter(it => !it.dueDate && it.task).length;
  if (undatedOpen > 0) {
    steps.push({
      action: undatedOpen === 1
        ? 'Work through the open action item from your last debrief'
        : `Work through ${undatedOpen} open action items from your debriefs`,
      reason: 'These follow-ups from a call have no date set and live on the Debrief tab.',
      urgency: 'soon',
      goTo: 'debrief',
    });
  }

  // Limitation jeopardy overrides everything.
  const lim = analysis?.limitationDeadline as { date?: string } | undefined;
  const limDays = daysUntil(lim?.date, today);
  if (limDays !== null && limDays <= 60 && !hasDoc(matter, 'statement_of_claim') && !hasDoc(matter, 'notice_of_action')) {
    steps.push({
      action: 'Issue the claim: Statement of Claim, or a Notice of Action if time is too short to plead',
      reason: `The limitation period expires ${lim!.date} (${limDays} days). Nothing has been issued.`,
      urgency: 'urgent', goTo: 'draft',
    });
  }

  if (stage.stage === 'intake') {
    steps.push({
      action: 'Run the issue analysis',
      reason: 'The gates, the entitlement figures, and the deadline clocks all start from the analysis.',
      urgency: 'now', goTo: 'issues',
    });
    return cap(steps);
  }

  // Decisions the lawyer owes: triggered gates with no decision.
  const undecided = (employment?.gates ?? []).filter(g =>
    g.triggered && g.issueCodes.length > 0
    && !g.issueCodes.some(c => employment!.approvedIssues.includes(c) || employment!.dismissedIssues.includes(c)));
  if (undecided.length > 0) {
    steps.push({
      action: `Decide the ${undecided.length} undecided issue${undecided.length === 1 ? '' : 's'}`,
      reason: 'Only approved issues are advanced in generated documents.',
      urgency: 'now', goTo: 'issues',
    });
  }

  if (stage.stage === 'assessment') {
    const offerDays = daysUntil(intake.severance_deadline as string, today);
    if (intake.received_severance_offer && !hasDoc(matter, 'severance_assessment')) {
      steps.push({
        action: 'Assess the severance offer',
        reason: offerDays !== null
          ? `The offer's acceptance deadline is ${intake.severance_deadline} (${offerDays} days).`
          : 'An offer is on the table and has not been assessed against the entitlements.',
        urgency: offerDays !== null && offerDays <= 14 ? 'urgent' : 'now', goTo: 'draft',
      });
    } else {
      steps.push({
        action: 'Generate the demand letter',
        reason: 'The analysis is complete and the approved issues are ready to advance.',
        urgency: 'soon', goTo: 'draft',
      });
    }
  }

  if (stage.stage === 'demand' && docStatus(matter, 'demand_letter') === 'draft') {
    steps.push({
      action: 'Review the demand letter and mark it sent',
      reason: 'The response clock starts from the date of sending, not the date of drafting.',
      urgency: 'now', goTo: 'docs',
    });
  }

  if (stage.stage === 'negotiation') {
    const responseDue = timeline.find(ev => ev.label === 'Demand letter response due');
    const respDays = daysUntil(responseDue?.date, today);
    if (respDays !== null && respDays < 0) {
      steps.push({
        action: 'No response recorded: follow up, or proceed to the Statement of Claim',
        reason: `The response was due ${responseDue!.date} (${-respDays} days ago).`,
        urgency: 'now', goTo: 'draft',
      });
    } else if (respDays !== null) {
      steps.push({
        action: 'Await the employer\'s response; prepare the Statement of Claim in the meantime',
        reason: `The response is due ${responseDue!.date} (${respDays} days).`,
        urgency: 'soon', goTo: 'draft',
      });
    }
  }

  if (stage.stage === 'proceedings') {
    if (docStatus(matter, 'statement_of_claim') === 'draft') {
      steps.push({
        action: 'Serve the Statement of Claim and record service',
        reason: 'The defence clock starts from service; recording it dockets the defence-due date.',
        urgency: 'now', goTo: 'docs',
      });
    }
    const defenceDue = timeline.find(ev => ev.label === 'Statement of Defence due');
    const defDays = daysUntil(defenceDue?.date, today);
    if (defDays !== null && defDays < 0) {
      steps.push({
        action: 'The defence period has expired with nothing recorded: consider noting default',
        reason: `The defence was due ${defenceDue!.date}.`,
        urgency: 'now', goTo: 'docs',
      });
    }
    const form14d = timeline.find(ev => ev.label.includes('Form 14D'));
    const fdDays = daysUntil(form14d?.date, today);
    if (fdDays !== null && fdDays >= 0) {
      steps.push({
        action: 'File the Statement of Claim (Form 14D)',
        reason: `Thirty days from the Notice of Action: due ${form14d!.date} (${fdDays} days).`,
        urgency: fdDays <= 10 ? 'urgent' : 'now', goTo: 'draft',
      });
    }
  }

  if (steps.length === 0) {
    steps.push({
      action: 'Review the docket and the draft catalogue',
      reason: 'No clock is running and no decision is outstanding on the record.',
      urgency: 'soon', goTo: 'draft',
    });
  }
  return cap(steps);
}

// ── Labour ───────────────────────────────────────────────────────────────

export function recommendLabourNextSteps(
  matter: Record<string, unknown>,
  labour: LabourMatterData | null | undefined,
  stage: StageResult<LabourStage>,
  today: Date = new Date(),
): NextStep[] {
  const steps: NextStep[] = [];
  if (stage.stage === 'resolution') {
    return [{
      action: 'Record the outcome and close the file',
      reason: 'The grievance has reached resolution; the closed record completes the paper trail.',
      urgency: 'soon', goTo: 'intake',
    }];
  }

  const intake = (labour?.intake ?? {}) as LabourMatterData['intake'];
  const deadlines = labour?.intake ? computeGrievanceDeadlines(intake) : [];

  for (const d of deadlines) {
    const kindText = d.kind === 'filing' ? 'File the grievance'
      : d.kind === 'referral' ? 'Refer the grievance to arbitration'
        : d.kind === 'step_advance' ? 'Advance the grievance to the next step'
          : null;
    if (d.kind === 'step_response' && d.overdue) {
      steps.push({
        action: 'The employer\'s response is overdue: check whether the agreement deems a non-response a denial',
        reason: `${d.label} was due ${d.date}; the clock to advance may already be running.`,
        urgency: 'now', goTo: 'issues',
      });
      continue;
    }
    if (!kindText) continue;
    if (d.overdue) {
      steps.push({
        action: `${kindText}, and assess relief under LRA s. 48(16) immediately`,
        reason: `${d.label} was ${d.date}; the limit appears missed.`,
        urgency: 'urgent', goTo: 'draft',
      });
    } else {
      steps.push({
        action: kindText,
        reason: `${d.label}: due ${d.date} (${d.daysRemaining} days).`,
        urgency: d.daysRemaining <= 10 ? 'urgent' : 'now', goTo: 'draft',
      });
    }
  }

  const undecided = (labour?.gates ?? []).filter(g =>
    g.triggered && g.issueCodes.length > 0
    && !g.issueCodes.some(c => labour!.approvedIssues.includes(c) || labour!.dismissedIssues.includes(c)));
  if (undecided.length > 0) {
    steps.push({
      action: `Decide the ${undecided.length} undecided issue${undecided.length === 1 ? '' : 's'}`,
      reason: 'Only approved issues are argued in generated documents.',
      urgency: 'now', goTo: 'issues',
    });
  }

  if (intake.dfr_concern && !hasDoc(matter, 'merits_assessment')) {
    steps.push({
      action: 'Prepare the merits assessment memorandum',
      reason: 'A s. 74 complaint has been raised or threatened; the considered-judgment record is the answer to it.',
      urgency: 'now', goTo: 'draft',
    });
  }

  if (stage.stage === 'arbitration') {
    if (!hasDoc(matter, 'particulars') || !hasDoc(matter, 'production_request')) {
      steps.push({
        action: 'Prepare the particulars and the production request',
        reason: 'Both are routinely required before the hearing; early production requests get answered.',
        urgency: 'soon', goTo: 'draft',
      });
    }
    if (!hasDoc(matter, 'arbitration_brief')) {
      steps.push({
        action: 'Prepare the arbitration brief',
        reason: 'The grievance is at the arbitration stage.',
        urgency: 'soon', goTo: 'draft',
      });
    }
  }

  if (steps.length === 0) {
    steps.push({
      action: 'Review the docket and the grievance record',
      reason: 'No clock is running and no decision is outstanding on the record.',
      urgency: 'soon', goTo: 'draft',
    });
  }
  return cap(steps);
}
