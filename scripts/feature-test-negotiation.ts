/**
 * Feature Test — negotiation ledger, against a LOCAL server. Deterministic, $0.
 * Covers: record entries → summary math → timeline events → stale-offer
 * next-step → delete → cleanup. Also exercises the comparables route shape
 * (configured or not, it must answer ok:true).
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

function iso(daysFromNow: number): string {
  const d = new Date();
  d.setDate(d.getDate() + daysFromNow);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

async function main() {
  const stamp = Date.now();
  const m = await api('POST', '/api/matters', {
    clientName: 'Neg Test', matterTitle: `[FEATURE-TEST] negotiation ${stamp}`,
    matterDescription: '[FEATURE-TEST]', matterType: 'employment_agreement', jurisdiction: 'CA',
  });
  const mid = m.json.matterId as string;
  check('matter created', (m.status === 200 || m.status === 201) && Boolean(mid));

  await api('POST', '/api/employment/intake', {
    matterId: mid,
    intake: {
      client_first_name: 'Neg', client_last_name: 'Test',
      employer_legal_name: 'Neg Employer Inc', job_title: 'Manager',
      hire_date: '2014-01-06', termination_date: iso(-30),
      annual_salary: 100000, client_age: 48, was_terminated: true,
    },
  });

  // Record: employer offer 10 days ago, client counter, employer counter 8 days ago
  const e1 = await api('POST', `/api/employment/${mid}/negotiation`, { date: iso(-10), party: 'employer', kind: 'offer', amountCad: 20000 });
  check('employer offer recorded', e1.status === 200);
  const e2 = await api('POST', `/api/employment/${mid}/negotiation`, { date: iso(-9), party: 'client', kind: 'counter', amountCad: 110000 });
  check('client counter recorded', e2.status === 200);
  const e3 = await api('POST', `/api/employment/${mid}/negotiation`, { date: iso(-8), party: 'employer', kind: 'counter', amountCad: 45000 });
  check('employer counter recorded', e3.status === 200);
  check('rejects malformed entry', (await api('POST', `/api/employment/${mid}/negotiation`, { date: 'yesterday', party: 'employer', kind: 'offer' })).status === 400);

  const list = await api('GET', `/api/employment/${mid}/negotiation`);
  const summary = list.json.summary as Record<string, unknown>;
  check('summary tracks the latest employer offer', (summary.latestEmployerOffer as { amountCad: number })?.amountCad === 45000);
  check('summary computes employer movement', summary.employerMovementCad === 25000);
  check('summary awaits the client side', summary.awaitingResponseFrom === 'client');

  const detail = await api('GET', `/api/employment/${mid}`);
  const timeline = ((detail.json.data as Record<string, unknown>)?.timeline ?? []) as Array<{ label: string }>;
  check('timeline records the moves', timeline.filter(t => /recorded$/.test(t.label)).length === 3, JSON.stringify(timeline.slice(-3)));

  const steps = (detail.json.nextSteps ?? []) as Array<{ action: string; goTo?: string }>;
  check('next steps flag the stale offer', steps.some(s => /outstanding offer/i.test(s.action) && s.goTo === 'negotiation'), JSON.stringify(steps));

  // Comparables route answers coherently whether or not the library is configured
  const comp = await api('GET', `/api/employment/${mid}/comparables`);
  check('comparables route answers', comp.status === 200 && comp.json.ok === true, JSON.stringify(comp.json).slice(0, 120));

  // Delete an entry
  const entryId = ((list.json.entries as Array<{ id: string }>) ?? [])[0]?.id;
  check('entry deletes', (await api('DELETE', `/api/employment/${mid}/negotiation/${entryId}`)).status === 200);
  const after = await api('GET', `/api/employment/${mid}/negotiation`);
  check('ledger shrinks', (after.json.entries as unknown[]).length === 2);

  const del = await api('DELETE', `/api/matters/${mid}`);
  check('cleanup', del.status === 200);

  console.log(failures === 0 ? '\nCLEAN PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Feature test crashed:', err);
  process.exit(1);
});
