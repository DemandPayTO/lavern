/**
 * Unit Tests — negotiation ledger summary math (src/employment/negotiation.ts)
 */

import { describe, it, expect } from 'vitest';
import { summarizeNegotiation, amountsFromAnalysis, type NegotiationEntry } from '../../src/employment/negotiation.js';

function e(partial: Partial<NegotiationEntry> & Pick<NegotiationEntry, 'date' | 'party' | 'kind'>): NegotiationEntry {
  return {
    id: `id-${partial.date}-${partial.party}-${partial.kind}`,
    amountCad: null,
    recordedAt: `${partial.date}T12:00:00.000Z`,
    ...partial,
  };
}

const AMOUNTS = { esaTotalCad: 15_000, commonLawLowCad: 60_000, commonLawHighCad: 100_000 };

describe('summarizeNegotiation', () => {
  it('tracks the latest employer offer against the assessed range', () => {
    const s = summarizeNegotiation([
      e({ date: '2026-06-01', party: 'employer', kind: 'offer', amountCad: 20_000 }),
      e({ date: '2026-06-10', party: 'client', kind: 'counter', amountCad: 95_000 }),
      e({ date: '2026-06-20', party: 'employer', kind: 'counter', amountCad: 50_000 }),
    ], AMOUNTS);

    expect(s.latestEmployerOffer).toEqual({ amountCad: 50_000, date: '2026-06-20' });
    expect(s.offerVsRange!.gapToLowCad).toBe(10_000);
    expect(s.offerVsRange!.positionInRange).toBeCloseTo(-0.25, 2);
    expect(s.employerMovementCad).toBe(30_000);
    expect(s.awaitingResponseFrom).toBe('client');
  });

  it('an offer inside the range positions correctly', () => {
    const s = summarizeNegotiation([
      e({ date: '2026-06-01', party: 'employer', kind: 'offer', amountCad: 80_000 }),
    ], AMOUNTS);
    expect(s.offerVsRange!.positionInRange).toBeCloseTo(0.5, 2);
    expect(s.offerVsRange!.gapToLowCad).toBe(-20_000);
  });

  it('acceptance ends the awaiting state', () => {
    const s = summarizeNegotiation([
      e({ date: '2026-06-01', party: 'employer', kind: 'offer', amountCad: 70_000 }),
      e({ date: '2026-06-05', party: 'client', kind: 'acceptance', amountCad: 70_000 }),
    ], AMOUNTS);
    expect(s.awaitingResponseFrom).toBeNull();
  });

  it('a client demand leaves the ball with the employer', () => {
    const s = summarizeNegotiation([
      e({ date: '2026-06-01', party: 'client', kind: 'demand', amountCad: 90_000 }),
    ], AMOUNTS);
    expect(s.awaitingResponseFrom).toBe('employer');
    expect(s.latestEmployerOffer).toBeNull();
  });

  it('empty ledger summarizes safely', () => {
    const s = summarizeNegotiation([], AMOUNTS);
    expect(s.entries).toBe(0);
    expect(s.offerVsRange).toBeNull();
    expect(s.awaitingResponseFrom).toBeNull();
  });
});

describe('amountsFromAnalysis', () => {
  it('extracts ESA total and common law bounds', () => {
    const a = amountsFromAnalysis({
      damagesEstimate: { esaNoticePay: 10_000, esaSeverancePay: 5_000, commonLawLowAmount: 60_000, commonLawHighAmount: 100_000 },
    });
    expect(a).toEqual({ esaTotalCad: 15_000, commonLawLowCad: 60_000, commonLawHighCad: 100_000 });
  });

  it('tolerates missing analysis', () => {
    const a = amountsFromAnalysis(null);
    expect(a.commonLawLowCad).toBeNull();
  });
});
