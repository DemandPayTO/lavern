/**
 * Stage Model — where a matter stands in its lifecycle, derived
 * deterministically from the matter's own state. Nothing is stored: the
 * stage is always consistent with the evidence, and every derivation
 * returns the evidence it relied on.
 *
 * Employment: intake → assessment → demand → negotiation → proceedings → resolution.
 * Labour:     intake → assessment → grievance → procedure → arbitration → resolution.
 *
 * The stage is the spine of the workflow: the next-step engine reasons
 * from it, the dashboard displays it, and outcome capture ends it.
 */

import type { EmploymentMatterData } from '../types/employment-intake.js';
import type { LabourMatterData } from '../types/labour-intake.js';

export interface StageResult<S extends string> {
  stage: S;
  label: string;
  /** Why the matter is at this stage. */
  evidence: string[];
}

export type EmploymentStage = 'intake' | 'assessment' | 'demand' | 'negotiation' | 'proceedings' | 'resolution';
export type LabourStage = 'intake' | 'assessment' | 'grievance' | 'procedure' | 'arbitration' | 'resolution';

const EMPLOYMENT_STAGE_LABELS: Record<EmploymentStage, string> = {
  intake: 'Intake',
  assessment: 'Assessment',
  demand: 'Demand',
  negotiation: 'Negotiation',
  proceedings: 'Proceedings',
  resolution: 'Resolution',
};

const LABOUR_STAGE_LABELS: Record<LabourStage, string> = {
  intake: 'Intake',
  assessment: 'Assessment',
  grievance: 'Grievance filed',
  procedure: 'Grievance procedure',
  arbitration: 'Arbitration',
  resolution: 'Resolution',
};

interface DocState {
  exists: boolean;
  status: string;
}

/** Lifecycle state of a generated document on the matter. */
function docState(matter: Record<string, unknown>, docType: string): DocState {
  const legacy: Record<string, string> = {
    demand_letter: 'generatedDemandLetter',
    statement_of_claim: 'generatedSOC',
    application: 'generatedApplication',
  };
  const key = legacy[docType] ?? `generated_${docType}`;
  const doc = matter[key];
  if (!doc || typeof doc !== 'object') return { exists: false, status: 'none' };
  const status = String((doc as Record<string, unknown>).status ?? 'draft');
  return { exists: true, status };
}

function sentOrFiled(state: DocState): boolean {
  return state.exists && (state.status === 'sent' || state.status === 'filed');
}

/** The matter has a recorded outcome (outcome capture) or is closed. */
export function isResolved(matter: Record<string, unknown>): boolean {
  if (matter.outcome && typeof matter.outcome === 'object') return true;
  const status = String(matter.status ?? '');
  return status === 'closed' || status === 'complete' || status === 'completed';
}

// ── Employment ───────────────────────────────────────────────────────────

export function deriveEmploymentStage(
  matter: Record<string, unknown>,
  employment: EmploymentMatterData | null | undefined,
): StageResult<EmploymentStage> {
  const evidence: string[] = [];
  const finish = (stage: EmploymentStage): StageResult<EmploymentStage> => ({
    stage, label: EMPLOYMENT_STAGE_LABELS[stage], evidence,
  });

  if (isResolved(matter)) {
    evidence.push(matter.outcome ? 'An outcome has been recorded.' : 'The matter is closed.');
    return finish('resolution');
  }
  const minutes = docState(matter, 'settlement_minutes');
  const acceptance = docState(matter, 'rule49_acceptance');
  if (sentOrFiled(minutes) || sentOrFiled(acceptance)) {
    evidence.push(sentOrFiled(minutes)
      ? 'Minutes of Settlement have been sent or filed.'
      : 'An acceptance of offer has been served.');
    return finish('resolution');
  }

  const proceedingsDocs = ['statement_of_claim', 'application', 'notice_of_action', 'sj_notice_of_motion', 'sj_affidavit', 'sj_factum', 'reply', 'settlement_conference_brief', 'hrto_schedule_a'];
  for (const dt of proceedingsDocs) {
    const st = docState(matter, dt);
    if (st.exists) {
      evidence.push(`${dt.replace(/_/g, ' ')} ${sentOrFiled(st) ? 'has been served or filed' : 'is in draft'}.`);
      return finish('proceedings');
    }
  }

  const demand = docState(matter, 'demand_letter');
  const negotiationDocs = ['counter_offer', 'rule49_offer', 'rule49_withdrawal'];
  const negotiationActivity = negotiationDocs.some(dt => docState(matter, dt).exists);
  if (sentOrFiled(demand) || negotiationActivity) {
    evidence.push(sentOrFiled(demand)
      ? 'The demand letter has been sent; the response clock is running.'
      : 'Offer or counter-offer activity is on the record.');
    return finish('negotiation');
  }
  if (demand.exists || docState(matter, 'severance_assessment').exists) {
    evidence.push(demand.exists
      ? 'A demand letter has been drafted and awaits review and sending.'
      : 'The severance offer has been assessed.');
    return finish('demand');
  }

  if (employment?.analysis) {
    evidence.push('The issue analysis has been run.');
    return finish('assessment');
  }

  evidence.push('The intake is open; the analysis has not yet been run.');
  return finish('intake');
}

// ── Labour ───────────────────────────────────────────────────────────────

export function deriveLabourStage(
  matter: Record<string, unknown>,
  labour: LabourMatterData | null | undefined,
): StageResult<LabourStage> {
  const evidence: string[] = [];
  const finish = (stage: LabourStage): StageResult<LabourStage> => ({
    stage, label: LABOUR_STAGE_LABELS[stage], evidence,
  });

  if (isResolved(matter)) {
    evidence.push(matter.outcome ? 'An outcome has been recorded.' : 'The matter is closed.');
    return finish('resolution');
  }
  const memorandum = docState(matter, 'settlement_memorandum');
  const decline = docState(matter, 'decline_letter');
  if (sentOrFiled(memorandum) || sentOrFiled(decline)) {
    evidence.push(sentOrFiled(memorandum)
      ? 'A Memorandum of Settlement has been sent or signed.'
      : 'The decision letter declining to advance has been sent.');
    return finish('resolution');
  }

  const referral = docState(matter, 'referral_to_arbitration');
  const arbitrationDocs = ['arbitration_brief', 'particulars', 'production_request'];
  if (sentOrFiled(referral) || arbitrationDocs.some(dt => docState(matter, dt).exists)) {
    evidence.push(sentOrFiled(referral)
      ? 'The grievance has been referred to arbitration.'
      : 'Arbitration preparation documents are on the record.');
    return finish('arbitration');
  }

  const intake = labour?.intake as Record<string, unknown> | undefined;
  const stepEvents = (intake?.step_events as Array<Record<string, unknown>> | undefined)
    ?.filter(e => e.presented_date || e.response_date) ?? [];
  if (stepEvents.length > 0 || intake?.last_step_response_date) {
    evidence.push('Step presentations or responses are recorded in the grievance procedure.');
    return finish('procedure');
  }

  if (intake?.grievance_filed || sentOrFiled(docState(matter, 'grievance_filing'))) {
    evidence.push('The grievance has been filed.');
    return finish('grievance');
  }

  if ((labour?.gates?.length ?? 0) > 0) {
    evidence.push('The gate analysis has been run on the intake.');
    return finish('assessment');
  }

  evidence.push('The grievance intake is open.');
  return finish('intake');
}
