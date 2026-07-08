/**
 * Feature Test — net-settlement calculator, against a LOCAL server.
 * Deterministic: only $0 operations. Exits non-zero on the first failure.
 *
 * Usage: npm run serve   # in one terminal
 *        npx tsx scripts/feature-test-net-settlement.ts
 */

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  [${detail}]` : ''}`);
  if (!ok) failures++;
}

async function api(method: string, url: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
}

async function main() {
  const stamp = Date.now();

  const m = await api('POST', '/api/matters', {
    clientName: 'Feature Test', matterTitle: `[FEATURE-TEST] net-settlement ${stamp}`,
    matterDescription: '[FEATURE-TEST]', matterType: 'employment_agreement', jurisdiction: 'CA',
  });
  const mid = m.json.matterId as string;
  check('matter created', (m.status === 200 || m.status === 201) && Boolean(mid));

  // Empty state: no saved inputs yet.
  const empty = await api('GET', `/api/employment/${mid}/net-settlement`);
  check('empty state returns null inputs', empty.status === 200 && empty.json.inputs === null && empty.json.result === null);

  // Compute and persist: 100k lump sum + 10k employer legal fees, 30% fee.
  const post = await api('POST', `/api/employment/${mid}/net-settlement`, {
    allocation: {
      retiringAllowanceCad: 100000, salaryContinuanceCad: 0,
      generalDamagesCad: 0, legalFeeContributionCad: 10000,
    },
    feePct: 30,
  });
  const result = post.json.result as { totals?: Record<string, number>; lumpSumWithholdingRatePct?: number } | undefined;
  check('calculation saved', post.status === 200 && Boolean(result));
  check('30 percent lump-sum bracket applied', result?.lumpSumWithholdingRatePct === 30);
  check('withholding is 30,000', result?.totals?.withholdingCad === 30000);
  check('client pays firm 23,900 after credit', result?.totals?.clientPaysFeesCad === 23900);
  check('net cash is 46,100', result?.totals?.netCashCad === 46100);

  // Persistence: reload returns the same computed result.
  const reload = await api('GET', `/api/employment/${mid}/net-settlement`);
  const reloaded = reload.json.result as { totals?: Record<string, number> } | undefined;
  check('inputs persist on the matter', reload.status === 200 && reloaded?.totals?.netCashCad === 46100);

  // Validation: negative amounts rejected by the schema.
  const bad = await api('POST', `/api/employment/${mid}/net-settlement`, {
    allocation: { retiringAllowanceCad: -5, salaryContinuanceCad: 0, generalDamagesCad: 0, legalFeeContributionCad: 0 },
  });
  check('negative amount rejected', bad.status === 400);

  // RRSP transfer capped at eligible room, with a flag.
  const rrsp = await api('POST', `/api/employment/${mid}/net-settlement`, {
    allocation: {
      retiringAllowanceCad: 50000, salaryContinuanceCad: 0,
      generalDamagesCad: 0, legalFeeContributionCad: 0, rrspTransferCad: 30000,
    },
    yearsBefore1996: 4,
  });
  const rrspResult = rrsp.json.result as { totals?: Record<string, number>; flags?: string[] } | undefined;
  check('RRSP transfer capped at room (8,000)', rrspResult?.totals?.appliedRrspTransferCad === 8000);
  check('cap is flagged', Boolean(rrspResult?.flags?.some((f) => f.includes('RRSP transfer reduced'))));

  // Clear.
  const del = await api('DELETE', `/api/employment/${mid}/net-settlement`);
  check('inputs cleared', del.status === 200);
  const after = await api('GET', `/api/employment/${mid}/net-settlement`);
  check('empty again after clear', after.json.inputs === null);

  // Tenant scoping is enforced by getMatterById(userId); a bogus matter 404s.
  const bogus = await api('GET', '/api/employment/no-such-matter/net-settlement');
  check('unknown matter returns 404', bogus.status === 404);

  await api('DELETE', `/api/matters/${mid}`);

  console.log(failures === 0 ? '\nAll net-settlement checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
