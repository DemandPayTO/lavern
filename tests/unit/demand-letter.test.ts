/**
 * Unit Tests — Demand Letter Generator
 *
 * Tests the prompt builder, section selection, and review flag computation.
 * Does NOT call Claude — tests the pure logic that drives the generation.
 */

import { describe, it, expect } from 'vitest';
import { getExpectedSections } from '../../src/employment/demand-letter-generator.js';
import { buildDemandDamagesTable } from '../../src/employment/demand-letter-parts.js';

// ═══════════════════════════════════════════════════════════════════════════
// SECTION SELECTION
// ═══════════════════════════════════════════════════════════════════════════

describe('getExpectedSections', () => {
  it('always includes base sections (salutation, background, termination, damages, demand, closing)', () => {
    const sections = getExpectedSections([]);
    expect(sections).toContain('salutation');
    expect(sections).toContain('employment_background');
    expect(sections).toContain('termination_facts');
    expect(sections).toContain('damages_quantification');
    expect(sections).toContain('demand');
    expect(sections).toContain('closing');
  });

  it('adds reasonable notice analysis for wrongful_dismissal', () => {
    const sections = getExpectedSections(['wrongful_dismissal']);
    expect(sections).toContain('reasonable_notice_analysis');
  });

  it('adds termination clause analysis for Waksdale issues', () => {
    const sections = getExpectedSections(['waksdale_at_any_time', 'termination_clause_invalidity']);
    expect(sections).toContain('termination_clause_analysis');
    // Should not duplicate the section
    expect(sections.filter(s => s === 'termination_clause_analysis')).toHaveLength(1);
  });

  it('adds just cause analysis', () => {
    const sections = getExpectedSections(['termination_for_cause']);
    expect(sections).toContain('just_cause_analysis');
  });

  it('adds constructive dismissal analysis', () => {
    const sections = getExpectedSections(['constructive_dismissal']);
    expect(sections).toContain('constructive_dismissal_analysis');
  });

  it('adds inducement analysis', () => {
    const sections = getExpectedSections(['inducement']);
    expect(sections).toContain('inducement_analysis');
  });

  it('adds ESA entitlements for esa_severance', () => {
    const sections = getExpectedSections(['esa_severance']);
    expect(sections).toContain('esa_entitlements');
  });

  it('adds human rights analysis for multiple HR issues without duplication', () => {
    const sections = getExpectedSections(['human_rights_overlay', 'disability_accommodation', 'workplace_harassment']);
    expect(sections).toContain('human_rights_analysis');
    expect(sections.filter(s => s === 'human_rights_analysis')).toHaveLength(1);
  });

  it('adds bad faith analysis', () => {
    const sections = getExpectedSections(['bad_faith_dismissal', 'roe_bad_faith']);
    expect(sections).toContain('bad_faith_analysis');
    expect(sections.filter(s => s === 'bad_faith_analysis')).toHaveLength(1);
  });

  it('adds compensation claims for Matthews bonus/RSU', () => {
    const sections = getExpectedSections(['matthews_bonus_rsu']);
    expect(sections).toContain('compensation_claims');
  });

  it('adds restrictive covenant analysis', () => {
    const sections = getExpectedSections(['non_compete_void', 'non_solicitation_unenforceable']);
    expect(sections).toContain('restrictive_covenant_analysis');
    expect(sections.filter(s => s === 'restrictive_covenant_analysis')).toHaveLength(1);
  });

  it('adds OHSA reprisal analysis', () => {
    const sections = getExpectedSections(['ohsa_reprisal']);
    expect(sections).toContain('ohsa_reprisal_analysis');
  });

  it('handles a complex case with many issues', () => {
    const sections = getExpectedSections([
      'wrongful_dismissal',
      'termination_clause_invalidity',
      'waksdale_at_any_time',
      'bad_faith_dismissal',
      'human_rights_overlay',
      'disability_accommodation',
      'matthews_bonus_rsu',
      'esa_severance',
      'non_compete_void',
    ]);

    // Base sections
    expect(sections).toContain('salutation');
    expect(sections).toContain('employment_background');
    expect(sections).toContain('termination_facts');
    expect(sections).toContain('damages_quantification');
    expect(sections).toContain('demand');
    expect(sections).toContain('closing');

    // Issue-specific sections
    expect(sections).toContain('reasonable_notice_analysis');
    expect(sections).toContain('termination_clause_analysis');
    expect(sections).toContain('bad_faith_analysis');
    expect(sections).toContain('human_rights_analysis');
    expect(sections).toContain('compensation_claims');
    expect(sections).toContain('esa_entitlements');
    expect(sections).toContain('restrictive_covenant_analysis');

    // No duplicates
    const unique = new Set(sections);
    expect(unique.size).toBe(sections.length);
  });
});


describe('demand table figure integrity (revamp)', () => {
  const analysis = {
    damagesEstimate: {
      esaNoticeWeeks: 8, esaNoticePay: 1, esaSeverancePay: 1,
      commonLawLowMonths: 8, commonLawHighMonths: 12,
      commonLawLowAmount: 80000, commonLawHighAmount: 120000,
      additionalHeads: [], totalEstimateLow: 80000, totalEstimateHigh: 120000,
    },
    bardalFactors: { age: 47, tenureYears: 8 }, timeline: [], gates: [],
    limitationDeadline: { date: '', daysRemaining: 0, urgent: false }, recommendedProcedure: 'simplified',
  } as never;
  const intake = { annual_salary: 120000 } as never;

  it('a $0 head is a quantified nil, not [LAWYER: quantify]', () => {
    const { html, flags } = buildDemandDamagesTable({
      intake, analysis, demandAmount: 120000,
      heads: [{ label: 'Pay in lieu', amount: 120000 }, { label: 'Bonus through notice', amount: 0 }],
    });
    expect(html).toContain('Bonus through notice');
    expect(html).not.toContain('[LAWYER: quantify]');
    expect(flags.some(f => f.includes('Bonus through notice'))).toBe(false);
  });

  it('a confirmed zero mitigation is not treated as a forgotten field', () => {
    const { flags } = buildDemandDamagesTable({
      intake, analysis, demandAmount: 120000,
      heads: [{ label: 'Pay in lieu', amount: 120000 }], mitigationEarnings: 0,
    });
    expect(flags.some(f => f.includes('no amounts paid and no mitigation'))).toBe(false);
  });

  it('when deductions exceed the heads the $0 net is flagged and the divergence check uses net', () => {
    const { html, flags } = buildDemandDamagesTable({
      intake, analysis, demandAmount: 150000,
      heads: [{ label: 'Pay in lieu', amount: 100000 }],
      amountsPaid: [{ label: 'ESA', amount: 130000 }],
    });
    expect(html).toContain('Net claim');
    expect(flags.some(f => f.includes('exceeds the itemised heads'))).toBe(true);
    expect(flags.some(f => f.includes('differs materially'))).toBe(true);
  });
});
