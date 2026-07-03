/**
 * Labour Gate Evaluator — deterministic issue-spotting for union-side
 * grievance matters. The labour sibling of the employment 16-gate engine.
 *
 * Every gate is pure logic over intake data — no model calls, identical
 * output for identical input. Gates surface issues for the reviewer
 * (union counsel OR labour relations officer) to approve before any
 * document generation uses them.
 *
 * The defining structural difference from employment law: TIME LIMITS
 * COME FROM THE COLLECTIVE AGREEMENT, not statute. computeGrievanceDeadlines
 * turns the CA's step limits into concrete docket dates.
 */

import type { GrievanceIntakeData, LabourGateResult, LabourMatterData } from '../types/labour-intake.js';

// ── Deadline computation ─────────────────────────────────────────────────

export interface GrievanceDeadline {
  /** ISO date. */
  date: string;
  label: string;
  kind: 'filing' | 'referral';
  daysRemaining: number;
  overdue: boolean;
  /** True when computed from working days — approximate (statutory holidays not modelled). */
  approximate: boolean;
}

function addDays(iso: string, days: number, dayKind: 'calendar' | 'working'): string | null {
  const start = new Date(`${iso}T00:00:00`);
  if (isNaN(start.getTime())) return null;
  if (dayKind === 'calendar') {
    start.setDate(start.getDate() + days);
    return start.toISOString().slice(0, 10);
  }
  // Working days: skip weekends. Statutory holidays are NOT modelled —
  // callers must label these dates approximate and verify against the CA.
  let remaining = days;
  while (remaining > 0) {
    start.setDate(start.getDate() + 1);
    const dow = start.getDay();
    if (dow !== 0 && dow !== 6) remaining--;
  }
  return start.toISOString().slice(0, 10);
}

function daysFromToday(iso: string): number {
  const target = new Date(`${iso}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / 86_400_000);
}

/**
 * Compute the grievance docket dates from CA time limits.
 *
 * Filing clock starts at knowledge_date (if set) else incident_date.
 * Referral clock starts at last_step_response_date.
 */
export function computeGrievanceDeadlines(intake: GrievanceIntakeData): GrievanceDeadline[] {
  const out: GrievanceDeadline[] = [];

  const filingStart = intake.knowledge_date || intake.incident_date;
  if (filingStart && intake.filing_deadline_days && !intake.grievance_filed) {
    const kind = intake.filing_deadline_kind ?? 'calendar';
    const date = addDays(filingStart, intake.filing_deadline_days, kind);
    if (date) {
      const days = daysFromToday(date);
      out.push({
        date,
        label: `Grievance filing deadline (${intake.filing_deadline_days} ${kind} days${intake.grievance_procedure_article ? `, ${intake.grievance_procedure_article}` : ''})`,
        kind: 'filing',
        daysRemaining: days,
        overdue: days < 0,
        approximate: kind === 'working',
      });
    }
  }

  if (intake.last_step_response_date && intake.referral_deadline_days) {
    const kind = intake.referral_deadline_kind ?? 'calendar';
    const date = addDays(intake.last_step_response_date, intake.referral_deadline_days, kind);
    if (date) {
      const days = daysFromToday(date);
      out.push({
        date,
        label: `Referral to arbitration deadline (${intake.referral_deadline_days} ${kind} days from Step response)`,
        kind: 'referral',
        daysRemaining: days,
        overdue: days < 0,
        approximate: kind === 'working',
      });
    }
  }

  return out;
}

// ── Gates ────────────────────────────────────────────────────────────────

export function evaluateLabourGates(intake: GrievanceIntakeData): LabourGateResult[] {
  const results: LabourGateResult[] = [];
  const deadlines = computeGrievanceDeadlines(intake);

  const discharge = intake.grievance_type === 'discharge' || intake.discipline_imposed === 'discharge';
  const disciplined = discharge || (intake.discipline_imposed != null && intake.discipline_imposed !== 'none');

  // ── LG1: Just cause / Wm Scott framework ────────────────────────────
  results.push({
    gate: 'LG1',
    triggered: disciplined,
    reason: disciplined
      ? `Discipline imposed (${intake.discipline_imposed ?? 'discharge'}) — just cause analysis under the William Scott framework: was there cause, was the penalty excessive, what substitution is appropriate.`
      : 'No discipline in issue.',
    issueCodes: disciplined ? ['just_cause_challenge'] : [],
    requiresLawyerReview: false,
  });

  // ── LG2: Time limits (the CA clock) ───────────────────────────────────
  const urgentDeadline = deadlines.find(d => d.daysRemaining <= 10 && !d.overdue);
  const missedDeadline = deadlines.find(d => d.overdue);
  results.push({
    gate: 'LG2',
    triggered: deadlines.length > 0,
    reason: missedDeadline
      ? `TIME LIMIT APPEARS MISSED: ${missedDeadline.label} was ${missedDeadline.date}. Assess relief under LRA s. 48(16) (arbitrator may extend where reasonable grounds and no substantial prejudice) — act immediately.`
      : urgentDeadline
        ? `URGENT: ${urgentDeadline.label} — ${urgentDeadline.daysRemaining} day(s) remaining (${urgentDeadline.date}).`
        : deadlines.length > 0
          ? `CA time limits computed: ${deadlines.map(d => `${d.label} → ${d.date}`).join('; ')}.`
          : 'No CA time limits captured.',
    issueCodes: deadlines.length > 0 ? ['grievance_time_limits'] : [],
    requiresLawyerReview: Boolean(missedDeadline || urgentDeadline),
  });

  // ── LG3: Weber exclusivity ────────────────────────────────────────────
  results.push({
    gate: 'LG3',
    triggered: true,
    reason: 'Dispute arises from the collective agreement — arbitration is the exclusive forum (Weber v Ontario Hydro). Civil action is not available; frame all claims (including Code and tort-flavoured claims) for the arbitrator, who has s. 48(12)(j) power to apply employment-related statutes.',
    issueCodes: ['weber_exclusive_forum'],
    requiresLawyerReview: false,
  });

  // ── LG4: Duty of fair representation exposure ────────────────────────
  const dfr = Boolean(intake.dfr_concern) || (discharge && intake.grievance_filed === false);
  results.push({
    gate: 'LG4',
    triggered: dfr,
    reason: dfr
      ? 'DFR exposure (LRA s. 74): document the union\'s investigation, its reasoning, and communications with the grievor at every decision point. Decisions may be wrong but must not be arbitrary, discriminatory, or in bad faith. Discharge cases attract the closest scrutiny.'
      : 'No duty-of-fair-representation concern flagged.',
    issueCodes: dfr ? ['dfr_exposure'] : [],
    requiresLawyerReview: dfr,
  });

  // ── LG5: Human rights overlay ─────────────────────────────────────────
  const hr = Boolean(intake.believes_discriminatory) || Boolean(intake.accommodation_involved) ||
    (intake.discrimination_grounds?.length ?? 0) > 0;
  results.push({
    gate: 'LG5',
    triggered: hr,
    reason: hr
      ? 'Human Rights Code overlay: the arbitrator can interpret and apply the Code (LRA s. 48(12)(j)) including accommodation to undue hardship and Code damages. Plead the Code claim in the grievance/particulars — do not assume a separate HRTO application (s. 45.1 deference risk).'
      : 'No human rights dimension identified.',
    issueCodes: hr ? ['human_rights_overlay'] : [],
    requiresLawyerReview: hr,
  });

  // ── LG6: KVP policy challenge ─────────────────────────────────────────
  const policy = intake.grievance_type === 'policy' ||
    /polic|rule/i.test(intake.employer_stated_grounds ?? '');
  results.push({
    gate: 'LG6',
    triggered: policy,
    reason: policy
      ? 'Employer rule/policy in issue — KVP test: the rule must be consistent with the CA, reasonable, clear, brought to the employee\'s attention, consistently enforced, and (for discharge) the employee warned of the consequence.'
      : 'No unilateral rule/policy challenge identified.',
    issueCodes: policy ? ['kvp_policy_challenge'] : [],
    requiresLawyerReview: false,
  });

  // ── LG7: Off-duty conduct ─────────────────────────────────────────────
  results.push({
    gate: 'LG7',
    triggered: Boolean(intake.off_duty_conduct),
    reason: intake.off_duty_conduct
      ? 'Discipline for off-duty conduct — Millhaven factors: the employer must show real harm to its reputation or product, inability of the grievor to perform, refusal of others to work with them, serious breach of the Criminal Code, or difficulty managing the workforce.'
      : 'No off-duty conduct in issue.',
    issueCodes: intake.off_duty_conduct ? ['off_duty_conduct'] : [],
    requiresLawyerReview: false,
  });

  // ── LG8: Prior record / sunset clause ────────────────────────────────
  const sunset = Boolean(intake.prior_discipline) && intake.sunset_clause_months != null && intake.sunset_clause_months > 0;
  results.push({
    gate: 'LG8',
    triggered: Boolean(intake.prior_discipline),
    reason: intake.prior_discipline
      ? sunset
        ? `Employer relies on prior record — check the sunset clause (${intake.sunset_clause_months} months): expunged discipline cannot be relied on. Verify each prior incident's date and challenge any that should be cleared.`
        : 'Employer relies on prior record — verify each incident was grieved/not grieved, its age, and whether progressive discipline was genuinely followed.'
      : 'No prior discipline in issue.',
    issueCodes: intake.prior_discipline ? ['prior_record_challenge'] : [],
    requiresLawyerReview: false,
  });

  // ── LG9: Procedural defects ───────────────────────────────────────────
  const procDefect = intake.union_rep_present_at_meeting === false || intake.investigation_conducted === false;
  results.push({
    gate: 'LG9',
    triggered: procDefect,
    reason: procDefect
      ? `Procedural defects in the discipline: ${[
          intake.union_rep_present_at_meeting === false ? 'no union representation at the disciplinary meeting (check the CA\'s representation clause — may void the discipline)' : '',
          intake.investigation_conducted === false ? 'no/inadequate investigation before discipline' : '',
        ].filter(Boolean).join('; ')}.`
      : 'No procedural defects identified.',
    issueCodes: procDefect ? ['procedural_defects'] : [],
    requiresLawyerReview: false,
  });

  // ── LG10: OHSA / statutory reprisal ──────────────────────────────────
  results.push({
    gate: 'LG10',
    triggered: Boolean(intake.ohsa_reprisal_alleged),
    reason: intake.ohsa_reprisal_alleged
      ? 'OHSA reprisal alleged — forum choice: grievance arbitration OR OLRB s. 50 complaint (reverse onus on the employer at the Board), not both. Assess which forum serves the grievor better before filing.'
      : 'No statutory reprisal alleged.',
    issueCodes: intake.ohsa_reprisal_alleged ? ['ohsa_reprisal'] : [],
    requiresLawyerReview: Boolean(intake.ohsa_reprisal_alleged),
  });

  // ── LG11: Remedy scope ────────────────────────────────────────────────
  results.push({
    gate: 'LG11',
    triggered: discharge,
    reason: discharge
      ? 'Discharge — remedy framing: reinstatement with full make-whole compensation is the presumptive arbitral remedy (unlike wrongful dismissal damages in court). Quantify back pay, benefits, pension contributions, and seniority restoration; address any mitigation set-off.'
      : 'No discharge remedy analysis required.',
    issueCodes: discharge ? ['reinstatement_make_whole'] : [],
    requiresLawyerReview: false,
  });

  return results;
}

// ── Timeline ─────────────────────────────────────────────────────────────

export function buildGrievanceTimeline(intake: GrievanceIntakeData): LabourMatterData['timeline'] {
  const timeline: LabourMatterData['timeline'] = [];
  const push = (date: string | undefined | null, label: string, category: LabourMatterData['timeline'][number]['category'], description?: string) => {
    if (!date) return;
    timeline.push({ date, label, category, description, source: 'intake_form' });
  };

  push(intake.grievor_seniority_date, 'Grievor seniority date', 'other');
  push(intake.incident_date, 'Incident', 'incident', intake.incident_description || undefined);
  push(intake.knowledge_date, 'Union/grievor became aware of incident', 'incident');
  push(intake.discipline_letter_date, `Discipline imposed${intake.discipline_imposed ? ` (${intake.discipline_imposed})` : ''}`, 'incident');
  push(intake.grievance_filed_date, `Grievance filed${intake.grievance_number ? ` (#${intake.grievance_number})` : ''}`, 'grievance');
  push(intake.last_step_response_date, `Employer response at ${intake.current_step || 'final step'}`, 'grievance');

  for (const d of computeGrievanceDeadlines(intake)) {
    timeline.push({
      date: d.date,
      label: d.label,
      description: d.approximate ? 'Computed from working days — approximate; verify against the CA and statutory holidays.' : undefined,
      category: 'deadline',
      source: 'system',
    });
  }

  timeline.sort((a, b) => a.date.localeCompare(b.date));
  return timeline;
}
