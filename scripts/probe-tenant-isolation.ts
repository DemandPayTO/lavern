/**
 * Tenant isolation probe — two real accounts against an auth-enabled server.
 *
 * Proves the property Jordan asked for directly: one login cannot read,
 * modify, or delete another login's matters or employment data. Runs
 * against a LOCAL server started with LAVERN_AUTH_ENABLED=true; email
 * verification is flipped directly in the SQLite DB (same technique as
 * smoke-test.sh).
 *
 * Usage:
 *   LAVERN_AUTH_ENABLED=true SHEM_DB_PATH=<db> npm run serve -- --port 3781
 *   SHEM_DB_PATH=<db> npx tsx scripts/probe-tenant-isolation.ts
 */

import { execSync } from 'node:child_process';

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3781';
const DB = process.env.SHEM_DB_PATH ?? './data/lavern.db';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  [${detail}]` : ''}`);
  if (!ok) failures++;
}

interface Session { cookie: string }

async function api(session: Session | null, method: string, url: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown>; setCookie: string | null }> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: {
      ...(body === undefined ? {} : { 'Content-Type': 'application/json' }),
      ...(session ? { Cookie: session.cookie } : {}),
    },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return {
    status: res.status,
    json: await res.json().catch(() => ({})) as Record<string, unknown>,
    setCookie: res.headers.get('set-cookie'),
  };
}

async function makeUser(email: string, password: string): Promise<Session> {
  const signup = await api(null, 'POST', '/api/auth/signup', { email, password });
  if (signup.status !== 200 && signup.status !== 201) throw new Error(`signup ${email}: ${signup.status} ${JSON.stringify(signup.json)}`);
  execSync(`sqlite3 "${DB}" "UPDATE users SET email_verified = 1 WHERE email = '${email}'"`);
  const login = await api(null, 'POST', '/api/auth/login', { email, password });
  if (login.status !== 200 || !login.setCookie) throw new Error(`login ${email}: ${login.status}`);
  return { cookie: login.setCookie.split(';')[0] };
}

async function main() {
  const stamp = Date.now();
  const alice = await makeUser(`alice-${stamp}@probe.test`, 'Probe-Password-1!');
  const bob = await makeUser(`bob-${stamp}@probe.test`, 'Probe-Password-2!');
  console.log('two verified accounts created and logged in\n');

  // Alice creates a matter with client-identifying content.
  const created = await api(alice, 'POST', '/api/matters', {
    clientName: 'Alice Confidential Client',
    matterTitle: `[PROBE] Alice matter ${stamp}`,
    matterDescription: 'Privileged facts belonging to Alice only.',
    matterType: 'employment_agreement',
    jurisdiction: 'CA',
  });
  const matterId = (created.json.matterId ?? created.json.id) as string;
  check('Alice creates a matter', (created.status === 200 || created.status === 201) && Boolean(matterId));

  // Alice can read it back.
  const aliceRead = await api(alice, 'GET', `/api/matters/${matterId}`);
  check('Alice reads her own matter', aliceRead.status === 200);

  // Bob must not see it in his list.
  const bobList = await api(bob, 'GET', '/api/matters');
  const bobSees = JSON.stringify(bobList.json).includes('Alice Confidential Client');
  check('Bob\'s matter list excludes Alice\'s matter', bobList.status === 200 && !bobSees);

  // Bob must not read it directly by id.
  const bobRead = await api(bob, 'GET', `/api/matters/${matterId}`);
  check('Bob cannot read Alice\'s matter by id', bobRead.status === 404 || bobRead.status === 403, `got ${bobRead.status}`);

  // Bob must not read the employment surface of it.
  const bobEmployment = await api(bob, 'GET', `/api/employment/${matterId}`);
  check('Bob cannot read Alice\'s employment data', bobEmployment.status === 404 || bobEmployment.status === 403, `got ${bobEmployment.status}`);

  // Bob must not write into it (intake, negotiation, net settlement).
  const bobIntake = await api(bob, 'POST', `/api/employment/${matterId}/net-settlement`, {
    allocation: { retiringAllowanceCad: 1, salaryContinuanceCad: 0, generalDamagesCad: 0, legalFeeContributionCad: 0 },
  });
  check('Bob cannot write to Alice\'s matter', bobIntake.status === 404 || bobIntake.status === 403, `got ${bobIntake.status}`);

  // Bob must not delete it.
  const bobDelete = await api(bob, 'DELETE', `/api/matters/${matterId}`);
  check('Bob cannot delete Alice\'s matter', bobDelete.status === 404 || bobDelete.status === 403, `got ${bobDelete.status}`);

  // Alice's matter survives Bob's attempts.
  const survives = await api(alice, 'GET', `/api/matters/${matterId}`);
  check('Alice\'s matter is intact after the attempts', survives.status === 200);

  // Unauthenticated access gets nothing.
  const anon = await api(null, 'GET', `/api/matters/${matterId}`);
  check('No session gets 401', anon.status === 401, `got ${anon.status}`);

  // Starling status endpoint is scoped (the leak fixed in badec6c stays fixed).
  const bobStatus = await api(bob, 'GET', '/api/starling/status');
  const statusLeaks = JSON.stringify(bobStatus.json).includes('Alice');
  check('Status endpoint never mentions Alice to Bob', !statusLeaks);

  await api(alice, 'DELETE', `/api/matters/${matterId}`);
  console.log(failures === 0 ? '\nISOLATION HOLDS: all probes rejected.' : `\n${failures} probe(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
