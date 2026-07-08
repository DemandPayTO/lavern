/**
 * Net-settlement calculator — what the client actually takes home.
 *
 * A settlement number means little to a client until it is translated into
 * cash after withholding and fees. This module computes the rule-certain
 * layer deterministically: how each component of an Ontario employment
 * settlement is characterized for tax, what the employer must withhold at
 * source, how much of a retiring allowance can move to an RRSP without
 * withholding, and what remains after legal fees and HST.
 *
 * Design discipline (deterministic-first):
 * - Everything computed here is a published rule: CRA composite lump-sum
 *   withholding rates (10 percent to 5,000; 20 percent over 5,000 to
 *   15,000; 30 percent over 15,000, outside Quebec), the eligible retiring
 *   allowance transfer formula (2,000 per year of service before 1996 plus
 *   1,500 per year before 1989 without pension vesting), and Ontario HST
 *   at 13 percent on legal fees.
 * - What depends on the client's full tax year (marginal rate at filing,
 *   payroll table withholding on salary continuance) is NOT invented. The
 *   lawyer may supply an effective rate for an estimate; otherwise the
 *   calculator reports the character of the payment and says so.
 * - Characterization risk is flagged, not silently accepted: a general
 *   damages allocation that is a large share of the total invites CRA
 *   scrutiny and must be supported by the pleadings.
 *
 * This is a withholding and cash-flow estimate for negotiation planning.
 * It is not tax advice and does not compute a final tax liability.
 */

export interface SettlementAllocation {
  /** Lump-sum severance / damages for lost income (retiring allowance). */
  retiringAllowanceCad: number;
  /** Notice period paid through payroll over time (employment income). */
  salaryContinuanceCad: number;
  /** General damages genuinely referable to non-wage claims (human rights, moral damages). */
  generalDamagesCad: number;
  /** Employer contribution to legal fees, paid directly to the firm. */
  legalFeeContributionCad: number;
  /** Portion of the retiring allowance the client directs to an RRSP. */
  rrspTransferCad?: number;
}

export interface NetSettlementInputs {
  allocation: SettlementAllocation;
  /** Full or partial years of service before 1996 (eligible transfer room). */
  yearsBefore1996?: number;
  /** Years before 1989 with no vested pension or DPSP (adds 1,500 per year). */
  yearsBefore1989NoPension?: number;
  /** Optional lawyer-supplied effective tax rate for the salary continuance estimate (0 to 60). */
  effectiveTaxRatePct?: number | null;
  /** Firm contingency or fee percentage applied to the recovery (0 to 50). */
  feePct?: number | null;
  /** When true the fee base includes the employer legal fee contribution. Default false. */
  feeOnGross?: boolean;
}

export interface SettlementLine {
  key: 'retiring_allowance' | 'salary_continuance' | 'general_damages' | 'legal_fee_contribution' | 'rrsp_transfer';
  label: string;
  grossCad: number;
  withholdingCad: number | null;
  netCad: number | null;
  treatment: string;
}

export interface NetSettlementResult {
  lines: SettlementLine[];
  totals: {
    grossSettlementCad: number;
    eligibleRrspRoomCad: number;
    appliedRrspTransferCad: number;
    withholdingCad: number;
    /** Cash paid to the client before fees (excludes RRSP transfer and legal fee contribution). */
    cashBeforeFeesCad: number;
    feeCad: number;
    feeHstCad: number;
    /** What the client pays the firm after the employer contribution credit. */
    clientPaysFeesCad: number;
    /** Cash to client after withholding, fees, and HST. */
    netCashCad: number;
    /** Net cash plus the RRSP transfer (total client value received now). */
    netValueCad: number;
  };
  lumpSumWithholdingRatePct: number | null;
  flags: string[];
  notes: string[];
}

const HST_RATE = 0.13;

/**
 * CRA composite lump-sum withholding rate outside Quebec, selected by the
 * amount of the payment (not graduated).
 */
export function lumpSumWithholdingRate(amountCad: number): number {
  if (amountCad <= 0) return 0;
  if (amountCad <= 5000) return 0.10;
  if (amountCad <= 15000) return 0.20;
  return 0.30;
}

/** Eligible retiring allowance transfer room (ITA s. 60(j.1)). */
export function eligibleRrspRoom(yearsBefore1996 = 0, yearsBefore1989NoPension = 0): number {
  const y96 = Math.max(0, Math.floor(yearsBefore1996));
  const y89 = Math.max(0, Math.floor(yearsBefore1989NoPension));
  return y96 * 2000 + y89 * 1500;
}

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

/** Deterministic net-settlement computation. Pure — unit tested. */
export function computeNetSettlement(inputs: NetSettlementInputs): NetSettlementResult {
  const a = inputs.allocation;
  const retiring = Math.max(0, a.retiringAllowanceCad || 0);
  const continuance = Math.max(0, a.salaryContinuanceCad || 0);
  const damages = Math.max(0, a.generalDamagesCad || 0);
  const legalFeeContribution = Math.max(0, a.legalFeeContributionCad || 0);
  const requestedTransfer = Math.max(0, a.rrspTransferCad || 0);

  const flags: string[] = [];
  const notes: string[] = [];

  // RRSP transfer: capped at the eligible room and at the retiring allowance itself.
  const room = eligibleRrspRoom(inputs.yearsBefore1996, inputs.yearsBefore1989NoPension);
  const appliedTransfer = Math.min(requestedTransfer, room, retiring);
  if (requestedTransfer > appliedTransfer) {
    flags.push(
      `RRSP transfer reduced to $${appliedTransfer.toLocaleString('en-CA')}: the eligible (s. 60(j.1)) room is $${room.toLocaleString('en-CA')} and only the retiring allowance can be transferred. Amounts beyond the eligible portion require personal RRSP room and a TD2-style direction.`,
    );
  }

  // Retiring allowance: withholding on the amount actually paid in cash.
  const retiringCashPortion = retiring - appliedTransfer;
  const lumpRate = retiringCashPortion > 0 ? lumpSumWithholdingRate(retiringCashPortion) : null;
  const retiringWithholding = round2(retiringCashPortion * (lumpRate ?? 0));

  // Salary continuance: payroll withholding depends on the client's tax
  // situation; estimate only when the lawyer supplies an effective rate.
  const rate = inputs.effectiveTaxRatePct;
  const hasRate = typeof rate === 'number' && Number.isFinite(rate) && rate >= 0 && rate <= 60;
  const continuanceWithholding = continuance > 0 && hasRate ? round2(continuance * (rate / 100)) : null;
  if (continuance > 0) {
    notes.push(
      'Salary continuance is regular employment income: income tax under the payroll tables plus CPP and EI deductions apply, and benefits often continue during the continuance period.'
        + (hasRate ? ` Estimated here at the supplied effective rate of ${rate}%.` : ' Supply an effective tax rate for a cash estimate.'),
    );
  }

  const lines: SettlementLine[] = [];
  if (retiring > 0) {
    lines.push({
      key: 'retiring_allowance',
      label: 'Retiring allowance (lump-sum severance / damages for lost income)',
      grossCad: retiring,
      withholdingCad: retiringWithholding,
      netCad: round2(retiringCashPortion - retiringWithholding),
      treatment: `Taxable. Lump-sum withholding at source${lumpRate != null ? ` (${Math.round(lumpRate * 100)}% on the cash portion)` : ''}. No CPP or EI.`,
    });
  }
  if (appliedTransfer > 0) {
    lines.push({
      key: 'rrsp_transfer',
      label: 'Direct transfer to RRSP (eligible portion, no withholding)',
      grossCad: appliedTransfer,
      withholdingCad: 0,
      netCad: appliedTransfer,
      treatment: 'Transferred without withholding under s. 60(j.1); taxed on eventual RRSP withdrawal.',
    });
  }
  if (continuance > 0) {
    lines.push({
      key: 'salary_continuance',
      label: 'Salary continuance (paid through payroll)',
      grossCad: continuance,
      withholdingCad: continuanceWithholding,
      netCad: continuanceWithholding != null ? round2(continuance - continuanceWithholding) : null,
      treatment: 'Employment income: payroll tax tables, CPP, and EI apply.',
    });
  }
  if (damages > 0) {
    lines.push({
      key: 'general_damages',
      label: 'General damages (non-wage claims)',
      grossCad: damages,
      withholdingCad: 0,
      netCad: damages,
      treatment: 'Non-taxable when genuinely referable to claims independent of lost employment income.',
    });
  }
  if (legalFeeContribution > 0) {
    lines.push({
      key: 'legal_fee_contribution',
      label: 'Employer contribution to legal fees (paid to the firm)',
      grossCad: legalFeeContribution,
      withholdingCad: 0,
      netCad: 0,
      treatment: 'Paid directly to the firm; generally not taxable to the client and reduces the fee owed.',
    });
  }

  const grossSettlement = retiring + continuance + damages + legalFeeContribution;

  // Characterization risk: a heavy general damages share invites CRA scrutiny.
  if (grossSettlement > 0 && damages / grossSettlement > 0.2) {
    flags.push(
      `General damages are ${Math.round((damages / grossSettlement) * 100)}% of the settlement. CRA may challenge the characterization; the allocation must be supported by the pleadings and the evidence of the non-wage claims.`,
    );
  }

  // EI interaction: severance is allocated by Service Canada and delays benefits.
  if (retiring + continuance > 0) {
    notes.push(
      'Service Canada allocates termination pay and severance across the weeks following termination, which delays the start of EI benefits and can require repayment of EI already received for that period.',
    );
  }

  const withholding = retiringWithholding + (continuanceWithholding ?? 0);
  const cashBeforeFees = round2(
    (retiringCashPortion - retiringWithholding)
      + (continuanceWithholding != null ? continuance - continuanceWithholding : continuance)
      + damages,
  );
  if (continuance > 0 && continuanceWithholding == null) {
    notes.push('Cash figures treat the salary continuance as gross because no effective tax rate was supplied.');
  }

  // Fees: the percentage is charged on the recovery (excluding the employer
  // legal fee contribution unless feeOnGross), HST applies to the full fee,
  // and the employer contribution is credited against the total bill.
  const feePct = typeof inputs.feePct === 'number' && Number.isFinite(inputs.feePct)
    ? Math.min(Math.max(inputs.feePct, 0), 50)
    : null;
  const feeBase = (inputs.feeOnGross ? grossSettlement : grossSettlement - legalFeeContribution);
  const fee = feePct != null ? round2(feeBase * (feePct / 100)) : 0;
  const feeHst = round2(fee * HST_RATE);
  const clientPaysFees = round2(Math.max(0, fee + feeHst - legalFeeContribution));
  if (feePct != null && legalFeeContribution > 0) {
    notes.push('The employer legal fee contribution is credited against the total legal bill (fee plus HST).');
  }
  if (feePct != null) {
    notes.push('Legal fees paid to recover employment income or a retiring allowance are generally deductible by the client under ITA s. 60(o.1).');
  }

  const netCash = round2(cashBeforeFees - clientPaysFees);
  return {
    lines,
    totals: {
      grossSettlementCad: round2(grossSettlement),
      eligibleRrspRoomCad: room,
      appliedRrspTransferCad: appliedTransfer,
      withholdingCad: round2(withholding),
      cashBeforeFeesCad: cashBeforeFees,
      feeCad: fee,
      feeHstCad: feeHst,
      clientPaysFeesCad: clientPaysFees,
      netCashCad: netCash,
      netValueCad: round2(netCash + appliedTransfer),
    },
    lumpSumWithholdingRatePct: lumpRate != null ? Math.round(lumpRate * 100) : null,
    flags,
    notes,
  };
}

export interface AllocationScenario {
  label: string;
  allocation: SettlementAllocation;
}

export interface ScenarioComparisonRow {
  label: string;
  grossSettlementCad: number;
  withholdingCad: number;
  netCashCad: number;
  netValueCad: number;
  flags: number;
}

/**
 * Compare allocation scenarios for the same settlement discussion (for
 * example all-cash versus RRSP transfer versus a general damages split).
 */
export function compareAllocations(
  scenarios: AllocationScenario[],
  shared: Omit<NetSettlementInputs, 'allocation'> = {},
): ScenarioComparisonRow[] {
  return scenarios.map((s) => {
    const result = computeNetSettlement({ ...shared, allocation: s.allocation });
    return {
      label: s.label,
      grossSettlementCad: result.totals.grossSettlementCad,
      withholdingCad: result.totals.withholdingCad,
      netCashCad: result.totals.netCashCad,
      netValueCad: result.totals.netValueCad,
      flags: result.flags.length,
    };
  });
}
