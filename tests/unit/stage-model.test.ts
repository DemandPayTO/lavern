/**
 * Unit Tests — matter stage model (src/employment/stage-model.ts)
 *
 * The stage is derived, never stored: these tests pin the evidence
 * ladder for both verticals and the resolution overrides.
 */

import { describe, it, expect } from 'vitest';
import { deriveEmploymentStage, deriveLabourStage } from '../../src/employment/stage-model.js';
import type { EmploymentMatterData } from '../../src/types/employment-intake.js';
import type { LabourMatterData } from '../../src/types/labour-intake.js';

const employmentData = (analysis: boolean): EmploymentMatterData => ({
  intake: { client_first_name: 'A' },
  gates: [], approvedIssues: [], dismissedIssues: [], documentExtractions: [],
  timeline: [], analysis: analysis ? ({ gates: [] } as unknown as EmploymentMatterData['analysis']) : null,
  selectedTone: 'professional', selectedProcedure: null, selectedDocumentType: null, demandAmount: null,
} as unknown as EmploymentMatterData);

describe('deriveEmploymentStage', () => {
  it('walks the ladder: intake → assessment → demand → negotiation → proceedings → resolution', () => {
    expect(deriveEmploymentStage({}, employmentData(false)).stage).toBe('intake');
    expect(deriveEmploymentStage({}, employmentData(true)).stage).toBe('assessment');
    expect(deriveEmploymentStage({ generatedDemandLetter: { status: 'draft' } }, employmentData(true)).stage).toBe('demand');
    expect(deriveEmploymentStage({ generatedDemandLetter: { status: 'sent' } }, employmentData(true)).stage).toBe('negotiation');
    expect(deriveEmploymentStage({
      generatedDemandLetter: { status: 'sent' }, generatedSOC: { status: 'draft' },
    }, employmentData(true)).stage).toBe('proceedings');
    expect(deriveEmploymentStage({
      generatedSOC: { status: 'sent' }, generated_settlement_minutes: { status: 'sent' },
    }, employmentData(true)).stage).toBe('resolution');
  });

  it('offer activity is negotiation even without a demand letter', () => {
    const r = deriveEmploymentStage({ generated_rule49_offer: { status: 'draft' } }, employmentData(true));
    expect(r.stage).toBe('negotiation');
  });

  it('a recorded outcome or closed status resolves the matter regardless of documents', () => {
    expect(deriveEmploymentStage({ outcome: { resolution: 'settled' } }, employmentData(true)).stage).toBe('resolution');
    expect(deriveEmploymentStage({ status: 'closed' }, employmentData(false)).stage).toBe('resolution');
  });

  it('returns evidence for the derivation', () => {
    const r = deriveEmploymentStage({ generatedDemandLetter: { status: 'sent' } }, employmentData(true));
    expect(r.evidence.join(' ')).toContain('response clock');
    expect(r.label).toBe('Negotiation');
  });
});

describe('deriveLabourStage', () => {
  const labourData = (extra: Partial<LabourMatterData['intake']> = {}, gates = 1): LabourMatterData => ({
    intake: { grievor_first_name: 'B', ...extra } as LabourMatterData['intake'],
    gates: Array.from({ length: gates }, (_, i) => ({ gate: `LG${i}`, triggered: true, reason: '', issueCodes: [], requiresLawyerReview: false })),
    approvedIssues: [], dismissedIssues: [], timeline: [], analysis: null,
  });

  it('walks the ladder: assessment → grievance → procedure → arbitration → resolution', () => {
    expect(deriveLabourStage({}, labourData({}, 0)).stage).toBe('intake');
    expect(deriveLabourStage({}, labourData()).stage).toBe('assessment');
    expect(deriveLabourStage({}, labourData({ grievance_filed: true })).stage).toBe('grievance');
    expect(deriveLabourStage({}, labourData({
      grievance_filed: true,
      step_events: [{ step_label: 'Step 1', presented_date: '2026-07-02' }],
    })).stage).toBe('procedure');
    expect(deriveLabourStage({ generated_referral_to_arbitration: { status: 'sent' } }, labourData({ grievance_filed: true })).stage).toBe('arbitration');
    expect(deriveLabourStage({ generated_settlement_memorandum: { status: 'sent' } }, labourData({ grievance_filed: true })).stage).toBe('resolution');
  });

  it('a sent decline letter resolves the grievance', () => {
    expect(deriveLabourStage({ generated_decline_letter: { status: 'sent' } }, labourData()).stage).toBe('resolution');
  });
});
