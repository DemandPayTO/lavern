/**
 * Unit Tests — Labour gate evaluator + CA deadline computation
 * (src/labour/gate-evaluator.ts)
 *
 * The defining feature of the labour vertical: deadlines come from the
 * collective agreement, not statute. These tests pin the clock math
 * (calendar vs working days), the missed/urgent escalation, and the
 * core gates (Wm Scott, Weber, DFR, KVP, Millhaven, sunset clause).
 */

import { describe, it, expect } from 'vitest';
import { evaluateLabourGates, computeGrievanceDeadlines, buildGrievanceTimeline } from '../../src/labour/gate-evaluator.js';
import type { GrievanceIntakeData } from '../../src/types/labour-intake.js';

function iso(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return d.toISOString().slice(0, 10);
}

const gate = (results: ReturnType<typeof evaluateLabourGates>, id: string) =>
  results.find(g => g.gate === id)!;

describe('computeGrievanceDeadlines', () => {
  it('computes the filing deadline from knowledge date + calendar days', () => {
    const intake = {
      incident_date: iso(-10),
      knowledge_date: iso(-5),
      filing_deadline_days: 15,
      filing_deadline_kind: 'calendar',
      grievance_filed: false,
    } as GrievanceIntakeData;

    const deadlines = computeGrievanceDeadlines(intake);
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0].kind).toBe('filing');
    expect(deadlines[0].date).toBe(iso(10)); // -5 + 15
    expect(deadlines[0].overdue).toBe(false);
    expect(deadlines[0].approximate).toBe(false);
  });

  it('working-day deadlines skip weekends and are marked approximate', () => {
    // 5 working days from a known Monday = the following Monday
    const monday = '2026-07-06'; // Monday
    const intake = {
      incident_date: monday,
      filing_deadline_days: 5,
      filing_deadline_kind: 'working',
      grievance_filed: false,
    } as GrievanceIntakeData;

    const [d] = computeGrievanceDeadlines(intake);
    expect(d.date).toBe('2026-07-13'); // Mon 6 → Fri 10 is 4 wd, +1 = Mon 13
    expect(d.approximate).toBe(true);
  });

  it('computes the referral deadline from the last step response', () => {
    const intake = {
      grievance_filed: true,
      last_step_response_date: iso(-3),
      referral_deadline_days: 10,
      referral_deadline_kind: 'calendar',
    } as GrievanceIntakeData;

    const [d] = computeGrievanceDeadlines(intake);
    expect(d.kind).toBe('referral');
    expect(d.date).toBe(iso(7));
  });

  it('no filing deadline once the grievance is filed', () => {
    const intake = {
      incident_date: iso(-10),
      filing_deadline_days: 15,
      grievance_filed: true,
    } as GrievanceIntakeData;
    expect(computeGrievanceDeadlines(intake)).toHaveLength(0);
  });

  const TWO_STEPS = [
    { label: 'Step 1', employer_response_days: 5, advance_days: 5, day_kind: 'calendar' as const },
    { label: 'Step 2', employer_response_days: 10, advance_days: null, day_kind: 'calendar' as const },
  ];

  it('computes the employer response clock when a step is presented and unanswered', () => {
    const intake = {
      grievance_filed: true,
      procedure_steps: TWO_STEPS,
      step_events: [{ step_label: 'Step 1', presented_date: iso(-2) }],
    } as GrievanceIntakeData;

    const deadlines = computeGrievanceDeadlines(intake);
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0].kind).toBe('step_response');
    expect(deadlines[0].date).toBe(iso(3)); // presented -2 + 5
    expect(deadlines[0].label).toContain('Step 1');
  });

  it('computes the advance clock after a non-final step response', () => {
    const intake = {
      grievance_filed: true,
      procedure_steps: TWO_STEPS,
      step_events: [{ step_label: 'Step 1', presented_date: iso(-6), response_date: iso(-1) }],
    } as GrievanceIntakeData;

    const deadlines = computeGrievanceDeadlines(intake);
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0].kind).toBe('step_advance');
    expect(deadlines[0].date).toBe(iso(4)); // response -1 + 5
    expect(deadlines[0].label).toContain('Step 2');
  });

  it('a final step response starts the referral clock', () => {
    const intake = {
      grievance_filed: true,
      referral_deadline_days: 30,
      referral_deadline_kind: 'calendar',
      procedure_steps: TWO_STEPS,
      step_events: [
        { step_label: 'Step 1', presented_date: iso(-20), response_date: iso(-15) },
        { step_label: 'Step 2', presented_date: iso(-12), response_date: iso(-5) },
      ],
    } as GrievanceIntakeData;

    const deadlines = computeGrievanceDeadlines(intake);
    expect(deadlines).toHaveLength(1);
    expect(deadlines[0].kind).toBe('referral');
    expect(deadlines[0].date).toBe(iso(25)); // -5 + 30
  });

  it('an explicit last_step_response_date takes precedence over the final step event', () => {
    const intake = {
      grievance_filed: true,
      last_step_response_date: iso(-10),
      referral_deadline_days: 30,
      referral_deadline_kind: 'calendar',
      procedure_steps: TWO_STEPS,
      step_events: [{ step_label: 'Step 2', presented_date: iso(-12), response_date: iso(-5) }],
    } as GrievanceIntakeData;

    const referrals = computeGrievanceDeadlines(intake).filter(d => d.kind === 'referral');
    expect(referrals).toHaveLength(1);
    expect(referrals[0].date).toBe(iso(20)); // -10 + 30, not -5 + 30
  });
});

describe('evaluateLabourGates', () => {
  const dischargeIntake = {
    grievance_type: 'discharge',
    discipline_imposed: 'discharge',
    incident_date: iso(-2),
    filing_deadline_days: 5,
    filing_deadline_kind: 'calendar',
    grievance_filed: false,
    prior_discipline: true,
    sunset_clause_months: 24,
    union_rep_present_at_meeting: false,
    off_duty_conduct: true,
    believes_discriminatory: true,
    discrimination_grounds: ['disability'],
  } as GrievanceIntakeData;

  it('triggers the discharge cluster: Wm Scott, remedy, procedure, record', () => {
    const gates = evaluateLabourGates(dischargeIntake);
    expect(gate(gates, 'LG1').triggered).toBe(true);   // just cause
    expect(gate(gates, 'LG1').reason).toContain('William Scott');
    expect(gate(gates, 'LG11').triggered).toBe(true);  // reinstatement/make-whole
    expect(gate(gates, 'LG9').triggered).toBe(true);   // no union rep at meeting
    expect(gate(gates, 'LG8').reason).toContain('24 months'); // sunset clause
    expect(gate(gates, 'LG7').reason).toContain('Millhaven'); // off-duty
    expect(gate(gates, 'LG5').triggered).toBe(true);   // human rights overlay
  });

  it('LG2 escalates to urgent review when a deadline is within 10 days', () => {
    const gates = evaluateLabourGates(dischargeIntake);
    const lg2 = gate(gates, 'LG2');
    expect(lg2.triggered).toBe(true);
    expect(lg2.requiresLawyerReview).toBe(true);
    expect(lg2.reason).toContain('URGENT');
  });

  it('LG2 flags missed time limits with s. 48(16) relief', () => {
    const gates = evaluateLabourGates({
      incident_date: iso(-30),
      filing_deadline_days: 10,
      filing_deadline_kind: 'calendar',
      grievance_filed: false,
    } as GrievanceIntakeData);
    expect(gate(gates, 'LG2').reason).toContain('48(16)');
  });

  it('LG2 treats an overdue employer response as the employer\'s lateness, not a missed limit', () => {
    const gates = evaluateLabourGates({
      grievance_filed: true,
      procedure_steps: [{ label: 'Step 1', employer_response_days: 5, advance_days: 5, day_kind: 'calendar' }],
      step_events: [{ step_label: 'Step 1', presented_date: iso(-10) }],
    } as GrievanceIntakeData);
    const lg2 = gate(gates, 'LG2');
    expect(lg2.reason).not.toContain('TIME LIMIT APPEARS MISSED');
    expect(lg2.reason).toContain('Employer response overdue');
    expect(lg2.requiresLawyerReview).toBe(true);
  });

  it('Weber exclusivity always fires (arbitration is the forum)', () => {
    const gates = evaluateLabourGates({} as GrievanceIntakeData);
    expect(gate(gates, 'LG3').triggered).toBe(true);
    expect(gate(gates, 'LG3').reason).toContain('Weber');
  });

  it('DFR gate fires on explicit concern and on unfiled discharge', () => {
    expect(gate(evaluateLabourGates({ dfr_concern: true } as GrievanceIntakeData), 'LG4').triggered).toBe(true);
    expect(gate(evaluateLabourGates({
      grievance_type: 'discharge', grievance_filed: false,
    } as GrievanceIntakeData), 'LG4').triggered).toBe(true);
    expect(gate(evaluateLabourGates({} as GrievanceIntakeData), 'LG4').triggered).toBe(false);
  });

  it('KVP gate fires on policy grievances', () => {
    const gates = evaluateLabourGates({ grievance_type: 'policy' } as GrievanceIntakeData);
    expect(gate(gates, 'LG6').triggered).toBe(true);
    expect(gate(gates, 'LG6').reason).toContain('KVP');
  });
});

describe('buildGrievanceTimeline', () => {
  it('orders events chronologically and includes system deadline events', () => {
    const timeline = buildGrievanceTimeline({
      incident_date: iso(-10),
      discipline_letter_date: iso(-8),
      grievance_filed: false,
      filing_deadline_days: 20,
      filing_deadline_kind: 'calendar',
    } as GrievanceIntakeData);

    const dates = timeline.map(t => t.date);
    expect([...dates].sort()).toEqual(dates);
    expect(timeline.some(t => t.category === 'deadline' && t.source === 'system')).toBe(true);
  });
});
