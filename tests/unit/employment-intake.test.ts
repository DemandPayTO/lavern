/**
 * Unit Tests — Employment Intake System
 *
 * Tests the gate evaluator, timeline generator, Bardal calculation,
 * limitation deadline, procedure recommendation, and intake schema.
 */

import { describe, it, expect } from 'vitest';
import { evaluateGates, getTriggeredIssueCodes, getGateInfo, getGateForIssue } from '../../src/employment/gate-evaluator.js';
import {
  buildTimelineFromIntake,
  addTimelineEvent,
  computeLimitationDeadline,
  computeBardalFactors,
  recommendProcedure,
} from '../../src/employment/timeline-generator.js';
import { employmentIntakeSchema, createEmploymentMatterData } from '../../src/types/employment-intake.js';
import type { EmploymentIntakeData, TimelineEvent } from '../../src/types/employment-intake.js';

// ── Test fixtures ────────────────────────────────────────────────────────

function makeIntake(overrides: Partial<EmploymentIntakeData> = {}): EmploymentIntakeData {
  return {
    client_first_name: 'Jane',
    client_last_name: 'Doe',
    client_age: 45,
    employer_legal_name: 'Acme Corp',
    hire_date: '2018-03-15',
    termination_date: '2026-06-01',
    job_title: 'Senior Manager',
    annual_salary: 95000,
    was_terminated: true,
    ...overrides,
  } as EmploymentIntakeData;
}

// ═══════════════════════════════════════════════════════════════════════════
// GATE EVALUATOR
// ═══════════════════════════════════════════════════════════════════════════

describe('evaluateGates', () => {
  it('returns 16 gates', () => {
    const gates = evaluateGates(makeIntake());
    expect(gates).toHaveLength(16);
    expect(gates.map(g => g.gate)).toEqual([
      'G1','G2','G3','G4','G5','G6','G7','G8',
      'G9','G10','G11','G12','G13','G14','G15','G16',
    ]);
  });

  it('triggers G6 (reasonable notice) when terminated', () => {
    const gates = evaluateGates(makeIntake({ was_terminated: true }));
    const g6 = gates.find(g => g.gate === 'G6')!;
    expect(g6.triggered).toBe(true);
    expect(g6.issueCodes).toContain('wrongful_dismissal');
  });

  it('triggers G9 (ESA) when terminated', () => {
    const gates = evaluateGates(makeIntake({ was_terminated: true }));
    const g9 = gates.find(g => g.gate === 'G9')!;
    expect(g9.triggered).toBe(true);
  });

  it('triggers G16 (document closing) when terminated', () => {
    const gates = evaluateGates(makeIntake({ was_terminated: true }));
    const g16 = gates.find(g => g.gate === 'G16')!;
    expect(g16.triggered).toBe(true);
  });

  it('does NOT trigger G6/G9/G16 when not terminated', () => {
    const gates = evaluateGates(makeIntake({ was_terminated: false, resigned: false }));
    expect(gates.find(g => g.gate === 'G6')!.triggered).toBe(false);
    expect(gates.find(g => g.gate === 'G9')!.triggered).toBe(false);
    expect(gates.find(g => g.gate === 'G16')!.triggered).toBe(false);
  });

  it('triggers G3 when termination clause exists', () => {
    const gates = evaluateGates(makeIntake({
      termination_clause_exists: true,
      termination_clause_text: 'The employer may terminate at any time with 2 weeks notice.',
    }));
    const g3 = gates.find(g => g.gate === 'G3')!;
    expect(g3.triggered).toBe(true);
    expect(g3.issueCodes).toContain('termination_clause_invalidity');
    expect(g3.issueCodes).toContain('waksdale_at_any_time');
    expect(g3.reason).toContain('at any time');
  });

  it('triggers G3 for mid-employment clause without fresh consideration', () => {
    const gates = evaluateGates(makeIntake({
      termination_clause_exists: true,
      termination_clause_text: 'Termination with 4 weeks notice.',
      clause_added_mid_employment: true,
      fresh_consideration_provided: false,
    }));
    const g3 = gates.find(g => g.gate === 'G3')!;
    expect(g3.issueCodes).toContain('no_fresh_consideration');
  });

  it('triggers G4 when employer alleged just cause', () => {
    const gates = evaluateGates(makeIntake({ employer_alleged_just_cause: true }));
    const g4 = gates.find(g => g.gate === 'G4')!;
    expect(g4.triggered).toBe(true);
  });

  it('triggers G5 for constructive dismissal', () => {
    const gates = evaluateGates(makeIntake({
      was_terminated: false,
      is_constructive_dismissal: true,
      constructive_dismissal_grounds: ['cd_pay', 'cd_duties'],
    }));
    const g5 = gates.find(g => g.gate === 'G5')!;
    expect(g5.triggered).toBe(true);
    expect(g5.reason).toContain('2 grounds');
  });

  it('triggers G7 when induced from prior employment', () => {
    const gates = evaluateGates(makeIntake({ left_secure_employment: true }));
    const g7 = gates.find(g => g.gate === 'G7')!;
    expect(g7.triggered).toBe(true);
    expect(g7.issueCodes).toContain('inducement');
  });

  it('triggers G8 for successor employer', () => {
    const gates = evaluateGates(makeIntake({
      employer_changed_through_acquisition: true,
      predecessor_employer_name: 'OldCo Inc',
    }));
    const g8 = gates.find(g => g.gate === 'G8')!;
    expect(g8.triggered).toBe(true);
    expect(g8.reason).toContain('OldCo Inc');
  });

  it('triggers G10 for discrimination', () => {
    const gates = evaluateGates(makeIntake({
      believes_discriminatory_termination: true,
      discrimination_grounds: ['age', 'disability'],
    }));
    const g10 = gates.find(g => g.gate === 'G10')!;
    expect(g10.triggered).toBe(true);
    expect(g10.issueCodes).toContain('human_rights_overlay');
  });

  it('triggers G10 for accommodation denial', () => {
    const gates = evaluateGates(makeIntake({
      has_known_medical_condition: true,
      accommodation_denied: true,
    }));
    const g10 = gates.find(g => g.gate === 'G10')!;
    expect(g10.triggered).toBe(true);
    expect(g10.issueCodes).toContain('disability_accommodation');
  });

  it('triggers G11 for bad faith conduct', () => {
    const gates = evaluateGates(makeIntake({
      bad_faith_conduct: ['bf_false_cause', 'bf_reputation'],
      humiliating_termination: true,
    }));
    const g11 = gates.find(g => g.gate === 'G11')!;
    expect(g11.triggered).toBe(true);
    expect(g11.issueCodes).toContain('bad_faith_dismissal');
  });

  it('triggers G11 for ROE issues', () => {
    const gates = evaluateGates(makeIntake({ roe_wrong_or_missing: true }));
    const g11 = gates.find(g => g.gate === 'G11')!;
    expect(g11.triggered).toBe(true);
    expect(g11.issueCodes).toContain('roe_bad_faith');
  });

  it('triggers G12 for bonus/commission claims when terminated', () => {
    const gates = evaluateGates(makeIntake({
      has_bonus: true,
      has_commissions: true,
      was_terminated: true,
    }));
    const g12 = gates.find(g => g.gate === 'G12')!;
    expect(g12.triggered).toBe(true);
    expect(g12.reason).toContain('bonus');
    expect(g12.reason).toContain('commissions');
  });

  it('does NOT trigger G12 for bonus if not terminated', () => {
    const gates = evaluateGates(makeIntake({
      has_bonus: true,
      was_terminated: false,
    }));
    const g12 = gates.find(g => g.gate === 'G12')!;
    expect(g12.triggered).toBe(false);
  });

  it('triggers G13 for non-compete', () => {
    const gates = evaluateGates(makeIntake({ has_non_compete: true }));
    const g13 = gates.find(g => g.gate === 'G13')!;
    expect(g13.triggered).toBe(true);
    expect(g13.issueCodes).toContain('non_compete_void');
    expect(g13.reason).toContain('ESA s. 67.2');
  });

  it('triggers G14 for OHSA reprisal', () => {
    const gates = evaluateGates(makeIntake({ reprisal_type: 'ohsa' }));
    const g14 = gates.find(g => g.gate === 'G14')!;
    expect(g14.triggered).toBe(true);
  });

  it('G1 and G15 are never auto-triggered', () => {
    const gates = evaluateGates(makeIntake());
    expect(gates.find(g => g.gate === 'G1')!.triggered).toBe(false);
    expect(gates.find(g => g.gate === 'G15')!.triggered).toBe(false);
  });
});

describe('getTriggeredIssueCodes', () => {
  it('returns issue codes from triggered gates only', () => {
    const gates = evaluateGates(makeIntake({
      was_terminated: true,
      has_non_compete: true,
    }));
    const codes = getTriggeredIssueCodes(gates);
    expect(codes).toContain('wrongful_dismissal');
    expect(codes).toContain('non_compete_void');
    expect(codes).toContain('esa_severance');
  });
});

describe('getGateInfo', () => {
  it('returns info for valid gates', () => {
    const info = getGateInfo('G6');
    expect(info).toBeDefined();
    expect(info!.name).toBe('Reasonable Notice');
    expect(info!.description).toContain('Bardal');
  });

  it('returns undefined for invalid gates', () => {
    expect(getGateInfo('G99')).toBeUndefined();
  });
});

describe('getGateForIssue', () => {
  it('maps issue codes to gates', () => {
    expect(getGateForIssue('wrongful_dismissal')).toBe('G6');
    expect(getGateForIssue('waksdale_at_any_time')).toBe('G3');
    expect(getGateForIssue('non_compete_void')).toBe('G13');
  });

  it('returns undefined for unknown issues', () => {
    expect(getGateForIssue('fake_issue')).toBeUndefined();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// TIMELINE GENERATOR
// ═══════════════════════════════════════════════════════════════════════════

describe('buildTimelineFromIntake', () => {
  it('builds timeline from basic employment facts', () => {
    const timeline = buildTimelineFromIntake(makeIntake());
    expect(timeline.length).toBeGreaterThan(0);
    // Should have hire date and termination date at minimum
    expect(timeline.some(e => e.label.toLowerCase().includes('hire'))).toBe(true);
    expect(timeline.some(e => e.label.toLowerCase().includes('termination'))).toBe(true);
  });

  it('sorts events chronologically', () => {
    const timeline = buildTimelineFromIntake(makeIntake({
      contract_signed_date: '2018-01-10',
      hire_date: '2018-03-15',
      termination_date: '2026-06-01',
    }));
    for (let i = 1; i < timeline.length; i++) {
      expect(timeline[i].date >= timeline[i - 1].date).toBe(true);
    }
  });

  it('includes limitation period deadline', () => {
    const timeline = buildTimelineFromIntake(makeIntake({ termination_date: '2026-06-01' }));
    const limitation = timeline.find(e => e.label.includes('Limitation'));
    expect(limitation).toBeDefined();
    expect(limitation!.date).toBe('2028-06-01');
    expect(limitation!.category).toBe('legal');
  });

  it('includes severance offer deadline', () => {
    const timeline = buildTimelineFromIntake(makeIntake({
      received_severance_offer: true,
      severance_deadline: '2026-07-15',
      severance_weeks_offered: 8,
    }));
    const offer = timeline.find(e => e.label.includes('Severance offer'));
    expect(offer).toBeDefined();
    expect(offer!.description).toContain('8 weeks');
  });

  it('includes new employment start (mitigation)', () => {
    const timeline = buildTimelineFromIntake(makeIntake({
      new_employment_found: true,
      new_employment_start_date: '2026-09-01',
      new_employment_salary: 80000,
    }));
    const newJob = timeline.find(e => e.label.includes('New employment'));
    expect(newJob).toBeDefined();
    expect(newJob!.category).toBe('mitigation');
  });

  it('includes successor employer acquisition date', () => {
    const timeline = buildTimelineFromIntake(makeIntake({
      employer_changed_through_acquisition: true,
      predecessor_employer_name: 'OldCo',
      acquisition_date: '2020-06-01',
    }));
    const acq = timeline.find(e => e.label.includes('acquisition'));
    expect(acq).toBeDefined();
    expect(acq!.description).toContain('OldCo');
  });

  it('handles empty intake gracefully', () => {
    const timeline = buildTimelineFromIntake({} as EmploymentIntakeData);
    expect(timeline).toEqual([]);
  });
});

describe('addTimelineEvent', () => {
  it('adds event and re-sorts', () => {
    const original: TimelineEvent[] = [
      { date: '2020-01-01', label: 'Event A', category: 'employment', source: 'intake_form' },
      { date: '2026-01-01', label: 'Event C', category: 'termination', source: 'intake_form' },
    ];
    const updated = addTimelineEvent(original, {
      date: '2023-06-15',
      label: 'Event B',
      category: 'other',
      source: 'lawyer_entry',
    });
    expect(updated).toHaveLength(3);
    expect(updated[1].label).toBe('Event B');
    // Original not mutated
    expect(original).toHaveLength(2);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// LIMITATION DEADLINE
// ═══════════════════════════════════════════════════════════════════════════

describe('computeLimitationDeadline', () => {
  it('computes 2-year deadline from termination date', () => {
    const result = computeLimitationDeadline('2024-06-01');
    expect(result).not.toBeNull();
    expect(result!.date).toBe('2026-06-01');
  });

  it('returns null for missing date', () => {
    expect(computeLimitationDeadline(undefined)).toBeNull();
    expect(computeLimitationDeadline('')).toBeNull();
  });

  it('marks urgent when under 90 days', () => {
    // Use a termination date that makes the limitation ~60 days from now
    const now = new Date();
    const termDate = new Date(now);
    termDate.setFullYear(termDate.getFullYear() - 2);
    termDate.setDate(termDate.getDate() + 60);
    const result = computeLimitationDeadline(termDate.toISOString().split('T')[0]);
    expect(result).not.toBeNull();
    expect(result!.urgent).toBe(true);
    expect(result!.daysRemaining).toBeLessThanOrEqual(90);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// BARDAL FACTORS
// ═══════════════════════════════════════════════════════════════════════════

describe('computeBardalFactors', () => {
  it('computes age from client_age field', () => {
    const bardal = computeBardalFactors(makeIntake({ client_age: 52 }));
    expect(bardal.age).toBe(52);
  });

  it('computes age from DOB and termination date', () => {
    const bardal = computeBardalFactors(makeIntake({
      client_age: undefined,
      client_date_of_birth: '1980-03-15',
      termination_date: '2026-06-01',
    }));
    expect(bardal.age).toBe(46);
  });

  it('computes tenure from hire and termination dates', () => {
    const bardal = computeBardalFactors(makeIntake({
      hire_date: '2018-03-15',
      termination_date: '2026-06-01',
    }));
    expect(bardal.tenureYears).toBeGreaterThan(8);
    expect(bardal.tenureYears).toBeLessThan(9);
  });

  it('classifies senior executives correctly', () => {
    const bardal = computeBardalFactors(makeIntake({ job_title: 'Vice President, Operations' }));
    expect(bardal.character).toBe('senior executive');
  });

  it('classifies managers correctly', () => {
    const bardal = computeBardalFactors(makeIntake({ job_title: 'Senior Manager' }));
    expect(bardal.character).toBe('senior/managerial');
  });

  it('classifies entry-level correctly', () => {
    const bardal = computeBardalFactors(makeIntake({ job_title: 'Junior Analyst' }));
    expect(bardal.character).toBe('entry-level');
  });

  it('flags limited availability for older workers', () => {
    const bardal = computeBardalFactors(makeIntake({ client_age: 58 }));
    expect(bardal.availability).toContain('limited');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// PROCEDURE RECOMMENDATION
// ═══════════════════════════════════════════════════════════════════════════

describe('recommendProcedure', () => {
  it('recommends small_claims for ≤ $50,000', () => {
    expect(recommendProcedure(35000)).toBe('small_claims');
    expect(recommendProcedure(50000)).toBe('small_claims');
  });

  it('recommends simplified for $50,001 – $200,000', () => {
    expect(recommendProcedure(50001)).toBe('simplified');
    expect(recommendProcedure(120000)).toBe('simplified');
    expect(recommendProcedure(200000)).toBe('simplified');
  });

  it('recommends ordinary for > $200,000', () => {
    expect(recommendProcedure(200001)).toBe('ordinary');
    expect(recommendProcedure(500000)).toBe('ordinary');
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INTAKE SCHEMA VALIDATION
// ═══════════════════════════════════════════════════════════════════════════

describe('employmentIntakeSchema', () => {
  it('validates a complete intake', () => {
    const result = employmentIntakeSchema.safeParse(makeIntake());
    expect(result.success).toBe(true);
  });

  it('validates an empty intake (all fields optional)', () => {
    const result = employmentIntakeSchema.safeParse({});
    expect(result.success).toBe(true);
  });

  it('rejects invalid date format', () => {
    const result = employmentIntakeSchema.safeParse({
      hire_date: '15/03/2018',
    });
    expect(result.success).toBe(false);
  });

  it('rejects negative salary', () => {
    const result = employmentIntakeSchema.safeParse({
      annual_salary: -50000,
    });
    expect(result.success).toBe(false);
  });

  it('rejects invalid discrimination grounds', () => {
    const result = employmentIntakeSchema.safeParse({
      discrimination_grounds: ['not_a_real_ground'],
    });
    expect(result.success).toBe(false);
  });

  it('accepts valid discrimination grounds', () => {
    const result = employmentIntakeSchema.safeParse({
      discrimination_grounds: ['age', 'disability', 'sex'],
    });
    expect(result.success).toBe(true);
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// EMPLOYMENT MATTER DATA
// ═══════════════════════════════════════════════════════════════════════════

describe('createEmploymentMatterData', () => {
  it('creates a fresh matter data with sensible defaults', () => {
    const data = createEmploymentMatterData();
    expect(data.timeline).toEqual([]);
    expect(data.gates).toEqual([]);
    expect(data.approvedIssues).toEqual([]);
    expect(data.dismissedIssues).toEqual([]);
    expect(data.documentExtractions).toEqual([]);
    expect(data.analysis).toBeNull();
    expect(data.selectedTone).toBe('professional');
    expect(data.selectedProcedure).toBeNull();
    expect(data.demandAmount).toBeNull();
  });
});

// ═══════════════════════════════════════════════════════════════════════════
// INTEGRATION: Full intake → analysis flow
// ═══════════════════════════════════════════════════════════════════════════

describe('full intake → analysis flow', () => {
  it('processes a wrongful dismissal case end-to-end', () => {
    const intake = makeIntake({
      client_age: 52,
      hire_date: '2015-01-10',
      termination_date: '2026-06-01',
      annual_salary: 120000,
      job_title: 'Director of Engineering',
      was_terminated: true,
      employer_alleged_just_cause: false,
      termination_clause_exists: true,
      termination_clause_text: 'The Company may terminate at any time with 2 weeks notice or pay in lieu.',
      has_bonus: true,
      bonus_amount: 15000,
      experienced_harassment: true,
      bad_faith_conduct: ['bf_reputation'],
    });

    // 1. Timeline
    const timeline = buildTimelineFromIntake(intake);
    expect(timeline.length).toBeGreaterThan(0);
    expect(timeline.some(e => e.label.includes('Limitation'))).toBe(true);

    // 2. Gates
    const gates = evaluateGates(intake);
    const triggered = gates.filter(g => g.triggered).map(g => g.gate);
    expect(triggered).toContain('G3');  // termination clause
    expect(triggered).toContain('G6');  // reasonable notice
    expect(triggered).toContain('G9');  // ESA
    expect(triggered).toContain('G10'); // harassment → human rights
    expect(triggered).toContain('G11'); // bad faith
    expect(triggered).toContain('G12'); // bonus claims
    expect(triggered).toContain('G16'); // document closer

    // G3 should flag "at any time" language
    const g3 = gates.find(g => g.gate === 'G3')!;
    expect(g3.issueCodes).toContain('waksdale_at_any_time');

    // 3. Bardal
    const bardal = computeBardalFactors(intake);
    expect(bardal.age).toBe(52);
    expect(bardal.tenureYears).toBeGreaterThan(11);
    expect(bardal.character).toBe('senior executive'); // Director

    // 4. Issue codes
    const codes = getTriggeredIssueCodes(gates);
    expect(codes).toContain('wrongful_dismissal');
    expect(codes).toContain('termination_clause_invalidity');
    expect(codes).toContain('waksdale_at_any_time');
    expect(codes).toContain('bad_faith_dismissal');
    expect(codes).toContain('matthews_bonus_rsu');

    // 5. Procedure recommendation
    // $120K salary / 12 = $10K/mo. At 18 months notice = $180K → simplified procedure.
    // At 22 months (aggressive estimate for 52yo Director, 11 years) = $220K → ordinary.
    const monthlySalary = 120000 / 12;
    expect(recommendProcedure(monthlySalary * 18)).toBe('simplified');
    expect(recommendProcedure(monthlySalary * 22)).toBe('ordinary');
  });
});
