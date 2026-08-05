/**
 * Unit Tests — draft review: the deterministic half.
 *
 * The model's observations are judgment and labelled as such. What must be
 * mechanically right is the CHECKED half: a figure the file cannot vouch
 * for is flagged, a figure the file knows (including offers on the
 * negotiation ledger) is not, and structural style divergence is reported.
 * A false positive here costs the lawyer trust in the whole review.
 */

import { describe, it, expect } from 'vitest';
import { checkFigures, checkStyleDivergence, reviewLengthFinding } from '../../src/employment/draft-review.js';
import { styleGuideSchema } from '../../src/employment/style-profile.js';

const intake = { annual_salary: 110000 } as never;
const analysis = {
  damagesEstimate: {
    esaNoticeWeeks: 6, esaNoticePay: 12692, esaSeverancePay: 13962,
    commonLawLowMonths: 8, commonLawHighMonths: 12,
    commonLawLowAmount: 73333, commonLawHighAmount: 110000,
    additionalHeads: [], totalEstimateLow: 73333, totalEstimateHigh: 110000,
  },
  bardalFactors: { age: 47, tenureYears: 6.6 },
  timeline: [], gates: [],
  limitationDeadline: { date: '2028-04-20', daysRemaining: 600, urgent: false },
  recommendedProcedure: 'simplified',
} as never;

describe('checkFigures', () => {
  it('flags a figure nothing on the file supports', () => {
    const findings = checkFigures('<p>We seek $250,000 in damages. The range is $110,000.</p>', intake, analysis, []);
    expect(findings.some(f => f.observation.includes('$250,000'))).toBe(true);
    expect(findings[0].basis).toBe('checked');
  });

  it('does NOT flag the analysis figures or the salary', () => {
    const findings = checkFigures('<p>Salary $110,000; ESA notice $12,692; range to $110,000.</p>', intake, analysis, []);
    expect(findings.filter(f => f.observation.includes('nothing on the file supports'))).toHaveLength(0);
  });

  it('does NOT flag offers on the negotiation ledger', () => {
    // The employer's counter and the client's demand are on the file.
    const findings = checkFigures(
      '<p>The demand was $120,000; the employer countered at $48,500. Range to $110,000.</p>',
      intake, analysis, [], [120000, 48500],
    );
    expect(findings.filter(f => f.observation.includes('nothing on the file supports'))).toHaveLength(0);
  });

  it('does NOT flag a figure that appears in an attached source', () => {
    const findings = checkFigures(
      '<p>The claim pleads $132,000. Range to $110,000.</p>',
      intake, analysis, ['The plaintiff claims $132,000 in damages.'],
    );
    expect(findings.filter(f => f.observation.includes('nothing on the file supports'))).toHaveLength(0);
  });

  it('tolerates rounding in prose', () => {
    const rounded = { ...analysis, damagesEstimate: { ...(analysis as never as { damagesEstimate: Record<string, number> }).damagesEstimate, totalEstimateHigh: 109_998 } } as never;
    const findings = checkFigures('<p>We value the claim at $110,000.</p>', intake, rounded, []);
    expect(findings.filter(f => f.observation.includes('nothing on the file supports'))).toHaveLength(0);
  });

  it('notes when the assessed high figure never appears', () => {
    const findings = checkFigures('<p>Salary $110,000 only.</p>', { annual_salary: 110000 } as never, {
      ...(analysis as never as Record<string, unknown>),
      damagesEstimate: { ...(analysis as never as { damagesEstimate: Record<string, number> }).damagesEstimate, totalEstimateHigh: 250000 },
    } as never, []);
    expect(findings.some(f => f.observation.includes('does not appear in the draft'))).toBe(true);
  });
});

describe('derived figures are supported, not flagged', () => {
  it('accepts weeks and months of pay computed from the salary', () => {
    // $110,000/yr: seven weeks is $14,808; eight months is $73,333.
    const findings = checkFigures(
      '<p>Seven weeks\' pay, being $14,808, and eight months being $73,333. Range to $110,000.</p>',
      intake, analysis, [],
    );
    expect(findings.filter(f => f.observation.includes('nothing on the file supports'))).toHaveLength(0);
  });

  it('accepts a total of two known heads', () => {
    // ESA notice 12,692 + ESA severance 13,962 = 26,654.
    const findings = checkFigures('<p>Statutory entitlements total $26,654. Range to $110,000.</p>', intake, analysis, []);
    expect(findings.filter(f => f.observation.includes('nothing on the file supports'))).toHaveLength(0);
  });

  it('still flags a figure that is not derivable at all', () => {
    const findings = checkFigures('<p>We seek $317,412 in damages. Range to $110,000.</p>', intake, analysis, []);
    expect(findings.some(f => f.observation.includes('$317,412'))).toBe(true);
  });
});

describe('style divergence', () => {
  const guide = styleGuideSchema.parse({
    flow: [
      { heading: 'WHY WE ARE HERE', purpose: 'x' },
      { heading: 'MITIGATION', purpose: 'x' },
      { heading: 'WHAT RESOLUTION LOOKS LIKE', purpose: 'x' },
    ],
    voice: 'Blunt.', recurringLanguage: [], factWeaving: 'x', notes: [], typicalWords: 6000,
  });

  it('reports the firm sections the draft is missing', () => {
    const findings = checkStyleDivergence(['WHY WE ARE HERE', 'WHAT RESOLUTION LOOKS LIKE'], guide);
    expect(findings).toHaveLength(1);
    expect(findings[0].category).toBe('style_divergence');
    expect(findings[0].observation).toContain('MITIGATION');
    expect(findings[0].basis).toBe('checked');
  });

  it('stays quiet when every firm section is present', () => {
    expect(checkStyleDivergence(['WHY WE ARE HERE', 'MITIGATION', 'WHAT RESOLUTION LOOKS LIKE'], guide)).toEqual([]);
  });

  it('reports length divergence in both directions, and tolerates normal variation', () => {
    expect(reviewLengthFinding(6200, guide)).toEqual([]);
    expect(reviewLengthFinding(2000, guide)[0].observation).toContain('2,000');
    expect(reviewLengthFinding(12000, guide)[0].suggestion).toContain('tightening');
  });

  it('says nothing without a style profile', () => {
    expect(checkStyleDivergence(['ANY'], null)).toEqual([]);
    expect(reviewLengthFinding(5000, null)).toEqual([]);
  });
});
