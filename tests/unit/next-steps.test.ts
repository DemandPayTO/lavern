/**
 * Unit Tests — next-step engine (src/employment/next-steps.ts)
 *
 * The recommendations must rank consequence first (limitation jeopardy,
 * missed clocks), carry reasons, and cap at three.
 */

import { describe, it, expect } from 'vitest';
import { recommendEmploymentNextSteps, recommendLabourNextSteps } from '../../src/employment/next-steps.js';
import { deriveEmploymentStage, deriveLabourStage } from '../../src/employment/stage-model.js';
import type { EmploymentMatterData } from '../../src/types/employment-intake.js';
import type { LabourMatterData } from '../../src/types/labour-intake.js';

const TODAY = new Date('2026-07-05T12:00:00');

function emp(overrides: Partial<Record<string, unknown>> = {}, matter: Record<string, unknown> = {}) {
  const employment = {
    intake: { client_first_name: 'A' },
    gates: [], approvedIssues: [], dismissedIssues: [], documentExtractions: [],
    timeline: [], analysis: { gates: [] },
    selectedTone: 'professional', selectedProcedure: null, selectedDocumentType: null, demandAmount: null,
    ...overrides,
  } as unknown as EmploymentMatterData;
  const stage = deriveEmploymentStage(matter, employment);
  return recommendEmploymentNextSteps(matter, employment, stage, TODAY);
}

describe('recommendEmploymentNextSteps', () => {
  it('limitation jeopardy leads everything', () => {
    const steps = emp({ analysis: { gates: [], limitationDeadline: { date: '2026-08-10' } } });
    expect(steps[0].urgency).toBe('urgent');
    expect(steps[0].action).toContain('Issue the claim');
  });

  it('undecided gates demand a decision', () => {
    const steps = emp({
      gates: [{ gate: 'G4', triggered: true, reason: 'x', issueCodes: ['cause'], requiresLawyerReview: true }],
    });
    expect(steps.some(s => s.action.includes('undecided issue'))).toBe(true);
  });

  it('a received offer without an assessment recommends the assessment with deadline urgency', () => {
    const steps = emp({ intake: { received_severance_offer: true, severance_deadline: '2026-07-12' } });
    const assess = steps.find(s => s.action.includes('Assess the severance offer'));
    expect(assess?.urgency).toBe('urgent'); // seven days out
  });

  it('a drafted demand letter asks to be sent; a passed response deadline escalates', () => {
    const drafted = emp({}, { generatedDemandLetter: { status: 'draft' } });
    expect(drafted.some(s => s.action.includes('mark it sent'))).toBe(true);

    const passed = emp({
      timeline: [{ date: '2026-07-01', label: 'Demand letter response due', category: 'legal', source: 'system' }],
    }, { generatedDemandLetter: { status: 'sent' } });
    expect(passed.some(s => s.action.includes('No response recorded'))).toBe(true);
  });

  it('an expired defence period suggests noting default; caps at three', () => {
    const steps = emp({
      timeline: [{ date: '2026-07-01', label: 'Statement of Defence due', category: 'legal', source: 'system' }],
      gates: [
        { gate: 'G1', triggered: true, reason: 'x', issueCodes: ['a'], requiresLawyerReview: false },
      ],
      analysis: { gates: [], limitationDeadline: { date: '2026-07-20' } },
    }, { generatedSOC: { status: 'sent' } });
    expect(steps.some(s => s.action.includes('noting default'))).toBe(true);
    expect(steps.length).toBeLessThanOrEqual(3);
  });

  it('resolution recommends closing the record', () => {
    const steps = emp({}, { outcome: { resolution: 'settled' } });
    expect(steps).toHaveLength(1);
    expect(steps[0].action).toContain('Record the outcome');
  });
});

describe('recommendLabourNextSteps', () => {
  function lab(intake: Partial<LabourMatterData['intake']>, matter: Record<string, unknown> = {}) {
    const labour = {
      intake: intake as LabourMatterData['intake'],
      gates: [{ gate: 'LG1', triggered: true, reason: '', issueCodes: [], requiresLawyerReview: false }],
      approvedIssues: [], dismissedIssues: [], timeline: [], analysis: null,
    } as LabourMatterData;
    const stage = deriveLabourStage(matter, labour);
    return recommendLabourNextSteps(matter, labour, stage, TODAY);
  }

  it('a running filing clock recommends filing with urgency from the days remaining', () => {
    const steps = lab({ incident_date: '2026-07-01', filing_deadline_days: 10, filing_deadline_kind: 'calendar', grievance_filed: false });
    const file = steps.find(s => s.action.includes('File the grievance'));
    expect(file?.urgency).toBe('urgent'); // six days left
  });

  it('a missed union clock escalates to s. 48(16)', () => {
    const steps = lab({ incident_date: '2026-06-01', filing_deadline_days: 10, filing_deadline_kind: 'calendar', grievance_filed: false });
    expect(steps[0].action).toContain('48(16)');
    expect(steps[0].urgency).toBe('urgent');
  });

  it('a DFR concern without a merits memorandum recommends preparing it', () => {
    const steps = lab({ grievance_filed: true, dfr_concern: true });
    expect(steps.some(s => s.action.includes('merits assessment'))).toBe(true);
  });

  it('the arbitration stage recommends particulars, production, and the brief', () => {
    const steps = lab({ grievance_filed: true }, { generated_referral_to_arbitration: { status: 'sent' } });
    expect(steps.some(s => s.action.includes('particulars'))).toBe(true);
    expect(steps.some(s => s.action.includes('arbitration brief'))).toBe(true);
  });
});
