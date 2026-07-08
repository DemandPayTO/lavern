/**
 * Negotiation ledger — every offer and counter on the matter, tracked
 * against the assessed entitlement. The negotiation is the product's core
 * moment; this makes it visible instead of living in the lawyer's head.
 *
 * Entries are facts, not advice: who moved, when, how much, on what terms.
 * The summary computes position deterministically: where the latest employer
 * offer sits against the ESA floor and the assessed common-law range, and
 * the movement history. Feeds outcome capture richer calibration data
 * (offers along the way, not just the final number).
 */

export type NegotiationParty = 'employer' | 'client';
export type NegotiationKind = 'offer' | 'counter' | 'demand' | 'acceptance' | 'rejection';

export interface NegotiationEntry {
  id: string;
  date: string;           // ISO date
  party: NegotiationParty;
  kind: NegotiationKind;
  amountCad: number | null;
  terms?: string;
  note?: string;
  recordedAt: string;     // ISO timestamp
}

export interface NegotiationSummary {
  entries: number;
  latestEmployerOffer: { amountCad: number; date: string } | null;
  latestClientPosition: { amountCad: number; date: string; kind: NegotiationKind } | null;
  /** Latest employer offer as a share of the assessed range (0 = at/below ESA floor context, 1 = at high end). */
  offerVsRange: {
    esaFloorCad: number | null;
    assessedLowCad: number | null;
    assessedHighCad: number | null;
    gapToLowCad: number | null;
    gapToHighCad: number | null;
    positionInRange: number | null;
  } | null;
  /** Employer movement between first and latest offer. */
  employerMovementCad: number | null;
  awaitingResponseFrom: NegotiationParty | null;
}

export interface AnalysisAmounts {
  esaTotalCad?: number | null;
  commonLawLowCad?: number | null;
  commonLawHighCad?: number | null;
}

/** Deterministic position summary. Pure — unit tested. */
export function summarizeNegotiation(
  entries: NegotiationEntry[],
  amounts: AnalysisAmounts,
): NegotiationSummary {
  const sorted = [...entries].sort((a, b) => a.date.localeCompare(b.date) || a.recordedAt.localeCompare(b.recordedAt));

  const employerOffers = sorted.filter((e) => e.party === 'employer' && e.amountCad != null);
  const clientMoves = sorted.filter((e) => e.party === 'client' && e.amountCad != null);
  const latestEmployer = employerOffers.at(-1) ?? null;
  const latestClient = clientMoves.at(-1) ?? null;

  let offerVsRange: NegotiationSummary['offerVsRange'] = null;
  if (latestEmployer) {
    const low = amounts.commonLawLowCad ?? null;
    const high = amounts.commonLawHighCad ?? null;
    const offer = latestEmployer.amountCad!;
    let positionInRange: number | null = null;
    if (low != null && high != null && high > low) {
      positionInRange = Math.round(((offer - low) / (high - low)) * 100) / 100;
    }
    offerVsRange = {
      esaFloorCad: amounts.esaTotalCad ?? null,
      assessedLowCad: low,
      assessedHighCad: high,
      gapToLowCad: low != null ? Math.round(low - offer) : null,
      gapToHighCad: high != null ? Math.round(high - offer) : null,
      positionInRange,
    };
  }

  const firstEmployer = employerOffers[0] ?? null;
  const employerMovementCad = firstEmployer && latestEmployer && firstEmployer.id !== latestEmployer.id
    ? Math.round(latestEmployer.amountCad! - firstEmployer.amountCad!)
    : null;

  // Whose move is it? The party who did NOT make the last substantive move.
  const lastSubstantive = sorted.filter((e) => e.kind !== 'rejection').at(-1) ?? null;
  const terminal = sorted.some((e) => e.kind === 'acceptance');
  const awaitingResponseFrom: NegotiationParty | null = terminal || !lastSubstantive
    ? null
    : lastSubstantive.party === 'employer' ? 'client' : 'employer';

  return {
    entries: sorted.length,
    latestEmployerOffer: latestEmployer ? { amountCad: latestEmployer.amountCad!, date: latestEmployer.date } : null,
    latestClientPosition: latestClient ? { amountCad: latestClient.amountCad!, date: latestClient.date, kind: latestClient.kind } : null,
    offerVsRange,
    employerMovementCad,
    awaitingResponseFrom,
  };
}

/** Amounts from the stored analysis shape (best-effort). */
export function amountsFromAnalysis(analysis: Record<string, unknown> | null | undefined): AnalysisAmounts {
  const dmg = (analysis?.damagesEstimate ?? {}) as Record<string, unknown>;
  const num = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);
  const esaNotice = num(dmg.esaNoticePay) ?? 0;
  const esaSeverance = num(dmg.esaSeverancePay) ?? 0;
  return {
    esaTotalCad: esaNotice + esaSeverance || null,
    commonLawLowCad: num(dmg.commonLawLowAmount),
    commonLawHighCad: num(dmg.commonLawHighAmount),
  };
}
