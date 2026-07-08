/**
 * Net-settlement calculator — the rule-certain layer must be exact:
 * lump-sum withholding brackets, eligible RRSP transfer room, HST on fees,
 * and the character of each settlement component.
 */

import { describe, it, expect } from 'vitest';
import {
  computeNetSettlement,
  compareAllocations,
  lumpSumWithholdingRate,
  eligibleRrspRoom,
  type SettlementAllocation,
} from '../../src/employment/net-settlement.js';

const zeroAllocation: SettlementAllocation = {
  retiringAllowanceCad: 0,
  salaryContinuanceCad: 0,
  generalDamagesCad: 0,
  legalFeeContributionCad: 0,
};

describe('lumpSumWithholdingRate', () => {
  it('uses the CRA composite brackets by payment amount', () => {
    expect(lumpSumWithholdingRate(0)).toBe(0);
    expect(lumpSumWithholdingRate(5000)).toBe(0.10);
    expect(lumpSumWithholdingRate(5000.01)).toBe(0.20);
    expect(lumpSumWithholdingRate(15000)).toBe(0.20);
    expect(lumpSumWithholdingRate(15000.01)).toBe(0.30);
    expect(lumpSumWithholdingRate(80000)).toBe(0.30);
  });
});

describe('eligibleRrspRoom', () => {
  it('is 2,000 per pre-1996 year plus 1,500 per pre-1989 year without pension', () => {
    expect(eligibleRrspRoom(0, 0)).toBe(0);
    expect(eligibleRrspRoom(6, 0)).toBe(12000);
    expect(eligibleRrspRoom(10, 3)).toBe(24500);
  });

  it('is zero for modern service (hired after 1995)', () => {
    expect(eligibleRrspRoom(undefined, undefined)).toBe(0);
  });
});

describe('computeNetSettlement', () => {
  it('withholds 30 percent on a large lump-sum retiring allowance', () => {
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, retiringAllowanceCad: 80000 },
    });
    expect(r.lumpSumWithholdingRatePct).toBe(30);
    expect(r.totals.withholdingCad).toBe(24000);
    expect(r.totals.netCashCad).toBe(56000);
    expect(r.totals.grossSettlementCad).toBe(80000);
  });

  it('selects the bracket from the cash portion after the RRSP transfer', () => {
    // 20,000 retiring allowance, 6 pre-1996 years -> 12,000 room; transfer 12,000.
    // Cash portion 8,000 -> 20 percent bracket, not 30.
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, retiringAllowanceCad: 20000, rrspTransferCad: 12000 },
      yearsBefore1996: 6,
    });
    expect(r.totals.appliedRrspTransferCad).toBe(12000);
    expect(r.lumpSumWithholdingRatePct).toBe(20);
    expect(r.totals.withholdingCad).toBe(1600);
    expect(r.totals.netCashCad).toBe(6400);
    expect(r.totals.netValueCad).toBe(18400);
  });

  it('caps the RRSP transfer at the eligible room and flags the reduction', () => {
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, retiringAllowanceCad: 50000, rrspTransferCad: 30000 },
      yearsBefore1996: 4, // room 8,000
    });
    expect(r.totals.appliedRrspTransferCad).toBe(8000);
    expect(r.flags.some((f) => f.includes('RRSP transfer reduced'))).toBe(true);
  });

  it('caps the RRSP transfer at the retiring allowance itself', () => {
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, retiringAllowanceCad: 3000, rrspTransferCad: 10000 },
      yearsBefore1996: 10, // room 20,000 exceeds the allowance
    });
    expect(r.totals.appliedRrspTransferCad).toBe(3000);
    expect(r.totals.withholdingCad).toBe(0);
    expect(r.totals.netCashCad).toBe(0);
    expect(r.totals.netValueCad).toBe(3000);
  });

  it('passes general damages through untaxed and flags a heavy allocation', () => {
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, retiringAllowanceCad: 40000, generalDamagesCad: 30000 },
    });
    const damagesLine = r.lines.find((l) => l.key === 'general_damages');
    expect(damagesLine?.withholdingCad).toBe(0);
    expect(damagesLine?.netCad).toBe(30000);
    expect(r.flags.some((f) => f.includes('CRA may challenge'))).toBe(true);
  });

  it('does not flag a modest general damages allocation', () => {
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, retiringAllowanceCad: 90000, generalDamagesCad: 10000 },
    });
    expect(r.flags.some((f) => f.includes('CRA may challenge'))).toBe(false);
  });

  it('leaves salary continuance gross without a supplied rate and says so', () => {
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, salaryContinuanceCad: 60000 },
    });
    const line = r.lines.find((l) => l.key === 'salary_continuance');
    expect(line?.withholdingCad).toBeNull();
    expect(line?.netCad).toBeNull();
    expect(r.totals.cashBeforeFeesCad).toBe(60000);
    expect(r.notes.some((n) => n.includes('no effective tax rate was supplied'))).toBe(true);
  });

  it('estimates salary continuance at the supplied effective rate', () => {
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, salaryContinuanceCad: 60000 },
      effectiveTaxRatePct: 30,
    });
    const line = r.lines.find((l) => l.key === 'salary_continuance');
    expect(line?.withholdingCad).toBe(18000);
    expect(line?.netCad).toBe(42000);
    expect(r.totals.netCashCad).toBe(42000);
  });

  it('charges the fee on the recovery, HST on the fee, and credits the employer contribution', () => {
    // 100,000 retiring allowance + 10,000 employer fee contribution, 30% fee.
    // Fee base excludes the contribution: 100,000. Fee 30,000, HST 3,900.
    // Client pays 33,900 - 10,000 = 23,900.
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, retiringAllowanceCad: 100000, legalFeeContributionCad: 10000 },
      feePct: 30,
    });
    expect(r.totals.feeCad).toBe(30000);
    expect(r.totals.feeHstCad).toBe(3900);
    expect(r.totals.clientPaysFeesCad).toBe(23900);
    // Cash: 100,000 - 30,000 withholding = 70,000; minus 23,900 = 46,100.
    expect(r.totals.netCashCad).toBe(46100);
  });

  it('includes the contribution in the fee base when feeOnGross is set', () => {
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, retiringAllowanceCad: 100000, legalFeeContributionCad: 10000 },
      feePct: 30,
      feeOnGross: true,
    });
    expect(r.totals.feeCad).toBe(33000);
  });

  it('never charges a negative client fee when the contribution exceeds the bill', () => {
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, retiringAllowanceCad: 10000, legalFeeContributionCad: 9000 },
      feePct: 10, // fee 100 + HST 13 = 113, far below the 9,000 credit
    });
    expect(r.totals.clientPaysFeesCad).toBe(0);
    expect(r.totals.netCashCad).toBe(r.totals.cashBeforeFeesCad);
  });

  it('notes the EI allocation consequence whenever termination pay is present', () => {
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, retiringAllowanceCad: 25000 },
    });
    expect(r.notes.some((n) => n.includes('EI'))).toBe(true);
  });

  it('handles an all-zero allocation without lines, flags, or NaN', () => {
    const r = computeNetSettlement({ allocation: zeroAllocation });
    expect(r.lines).toHaveLength(0);
    expect(r.totals.grossSettlementCad).toBe(0);
    expect(r.totals.netCashCad).toBe(0);
    expect(Number.isNaN(r.totals.netValueCad)).toBe(false);
  });

  it('clamps negative inputs to zero instead of corrupting totals', () => {
    const r = computeNetSettlement({
      allocation: { ...zeroAllocation, retiringAllowanceCad: -5000, generalDamagesCad: 20000 },
    });
    expect(r.totals.grossSettlementCad).toBe(20000);
    expect(r.totals.netCashCad).toBe(20000);
  });
});

describe('compareAllocations', () => {
  it('ranks scenarios for the same discussion deterministically', () => {
    const rows = compareAllocations(
      [
        { label: 'All cash', allocation: { ...zeroAllocation, retiringAllowanceCad: 100000 } },
        {
          label: 'Damages split',
          allocation: { ...zeroAllocation, retiringAllowanceCad: 85000, generalDamagesCad: 15000 },
        },
      ],
      { feePct: 30 },
    );
    expect(rows).toHaveLength(2);
    expect(rows[0].label).toBe('All cash');
    // Same gross, but the damages split shelters 15,000 from withholding.
    expect(rows[0].grossSettlementCad).toBe(rows[1].grossSettlementCad);
    expect(rows[1].withholdingCad).toBeLessThan(rows[0].withholdingCad);
    expect(rows[1].netCashCad).toBeGreaterThan(rows[0].netCashCad);
  });
});
