/**
 * Property fuzz — deterministic modules must hold their invariants over a
 * wide random input space. Seeded PRNG so failures are reproducible.
 *
 * Invariants checked (1,000 cases each):
 * - net-settlement: no NaN anywhere, withholding >= 0, net cash <= gross,
 *   RRSP transfer never exceeds room or the retiring allowance, and the
 *   client fee is never negative.
 * - negotiation summary: never throws, entry count preserved, movement is
 *   finite when two employer offers exist.
 */

import { computeNetSettlement } from '../src/employment/net-settlement.js';
import { summarizeNegotiation, type NegotiationEntry } from '../src/employment/negotiation.js';

let seed = 20260708;
function rnd(): number {
  seed = (seed * 1103515245 + 12345) % 2147483648;
  return seed / 2147483648;
}
const amount = () => Math.round(rnd() * 500000 * 100) / 100;

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  if (!ok) {
    failures++;
    console.error(`FAIL ${name}${detail ? `  [${detail}]` : ''}`);
  }
}

function isFiniteDeep(obj: unknown, path = ''): string | null {
  if (typeof obj === 'number') return Number.isFinite(obj) ? null : path;
  if (Array.isArray(obj)) {
    for (let i = 0; i < obj.length; i++) {
      const bad = isFiniteDeep(obj[i], `${path}[${i}]`);
      if (bad) return bad;
    }
    return null;
  }
  if (obj && typeof obj === 'object') {
    for (const [k, v] of Object.entries(obj)) {
      const bad = isFiniteDeep(v, `${path}.${k}`);
      if (bad) return bad;
    }
  }
  return null;
}

// ── net-settlement ───────────────────────────────────────────────────────
for (let i = 0; i < 1000; i++) {
  const inputs = {
    allocation: {
      retiringAllowanceCad: amount(),
      salaryContinuanceCad: rnd() < 0.5 ? amount() : 0,
      generalDamagesCad: rnd() < 0.5 ? amount() : 0,
      legalFeeContributionCad: rnd() < 0.3 ? amount() / 10 : 0,
      rrspTransferCad: rnd() < 0.5 ? amount() : undefined,
    },
    yearsBefore1996: rnd() < 0.3 ? Math.floor(rnd() * 30) : undefined,
    effectiveTaxRatePct: rnd() < 0.4 ? Math.round(rnd() * 60) : null,
    feePct: rnd() < 0.6 ? Math.round(rnd() * 50) : null,
    feeOnGross: rnd() < 0.2,
  };
  const r = computeNetSettlement(inputs);
  const nan = isFiniteDeep(r.totals, 'totals');
  check(`net-settlement case ${i}: finite`, nan === null, nan ?? '');
  check(`net-settlement case ${i}: withholding >= 0`, r.totals.withholdingCad >= 0);
  check(`net-settlement case ${i}: net cash <= gross`, r.totals.netCashCad <= r.totals.grossSettlementCad + 0.01);
  check(`net-settlement case ${i}: rrsp within room`, r.totals.appliedRrspTransferCad <= Math.max(r.totals.eligibleRrspRoomCad, 0));
  check(`net-settlement case ${i}: rrsp within allowance`, r.totals.appliedRrspTransferCad <= inputs.allocation.retiringAllowanceCad + 0.01);
  check(`net-settlement case ${i}: client fee >= 0`, r.totals.clientPaysFeesCad >= 0);
  if (failures > 10) break;
}

// ── negotiation summary ──────────────────────────────────────────────────
const parties = ['employer', 'client'] as const;
const kinds = ['offer', 'counter', 'demand', 'acceptance', 'rejection'] as const;
for (let i = 0; i < 1000; i++) {
  const n = Math.floor(rnd() * 8);
  const entries: NegotiationEntry[] = Array.from({ length: n }, (_, j) => ({
    id: `e${j}`,
    date: `202${Math.floor(rnd() * 7)}-0${1 + Math.floor(rnd() * 9)}-1${Math.floor(rnd() * 9)}`,
    party: parties[Math.floor(rnd() * 2)],
    kind: kinds[Math.floor(rnd() * 5)],
    amountCad: rnd() < 0.8 ? amount() : null,
    recordedAt: new Date(1700000000000 + j * 1000).toISOString(),
  }));
  try {
    const s = summarizeNegotiation(entries, {
      esaTotalCad: rnd() < 0.5 ? amount() : null,
      commonLawLowCad: rnd() < 0.5 ? amount() : null,
      commonLawHighCad: rnd() < 0.5 ? amount() : null,
    });
    check(`negotiation case ${i}: count preserved`, s.entries === n);
    const nan = isFiniteDeep(s.employerMovementCad ?? 0, 'movement');
    check(`negotiation case ${i}: movement finite`, nan === null);
  } catch (err) {
    check(`negotiation case ${i}: does not throw`, false, String(err));
  }
  if (failures > 10) break;
}

if (failures === 0) {
  console.log('Property fuzz: 2,000 cases, all invariants held.');
  process.exit(0);
}
console.error(`Property fuzz: ${failures} invariant violation(s).`);
process.exit(1);
