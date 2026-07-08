/**
 * Feature Test — hearing bundle skeleton + witness intake, against a LOCAL
 * server. Deterministic ($0): intake, gates, and the bundle assembler only.
 *
 * Usage: npm run serve   # in one terminal
 *        npx tsx scripts/feature-test-hearing-bundle.ts
 */

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  [${detail}]` : ''}`);
  if (!ok) failures++;
}

async function api(method: string, url: string, body?: unknown): Promise<Record<string, unknown>> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const json = await res.json().catch(() => ({})) as Record<string, unknown>;
  return { status: res.status, ...json };
}

async function main() {
  const stamp = Date.now();
  const matter = await api('POST', '/api/matters', {
    clientName: 'Feature Test Grievor',
    matterTitle: `[FEATURE-TEST] hearing-bundle ${stamp}`,
    matterDescription: '[FEATURE-TEST]',
    matterType: 'employment_agreement',
    jurisdiction: 'CA',
  });
  const matterId = matter.matterId as string;
  check('matter created', Boolean(matterId));

  const intake = {
    grievor_first_name: 'Dana',
    grievor_last_name: 'Woo',
    union_name: 'Example Union',
    union_local: '100',
    employer_name: 'Acme Manufacturing Ltd.',
    grievance_type: 'discharge',
    grievance_filed: true,
    grievance_filed_date: '2026-05-01',
    grievance_number: 'G-2026-014',
    ca_title: 'Acme Manufacturing CA 2024-2027',
    discipline_imposed: 'discharge',
    discipline_letter_date: '2026-04-20',
    incident_date: '2026-04-18',
    incident_description: 'Discharged following an altercation on the floor.',
    prior_discipline: false,
    witnesses: [
      { name: 'Dana Woo', role: 'Grievor', topics: 'The April 18 events and the meeting' },
      { name: 'Sam Ortiz', role: 'Steward', topics: 'Denial of representation at the meeting' },
    ],
  };
  const intakeRes = await api('POST', '/api/labour/intake', { matterId, intake });
  check('intake with witnesses accepted', intakeRes.status === 200, JSON.stringify(intakeRes).slice(0, 200));

  const bundle = await api('POST', `/api/labour/${matterId}/document`, {
    documentType: 'hearing_bundle',
    representativeName: 'Feature Test',
    organizationName: 'Example Union Local 100',
  });
  const html = String((bundle.document as Record<string, unknown> | undefined)?.html ?? bundle.html ?? '');
  check('hearing bundle generated', bundle.status === 200 && html.length > 500, JSON.stringify(bundle).slice(0, 200));
  check('bundle costs nothing', Number((bundle.document as Record<string, unknown> | undefined)?.costUsd ?? bundle.costUsd ?? -1) === 0);
  check('tab index present', html.includes('Tab index'));
  check('witnesses listed', html.includes('Sam Ortiz'));
  check('gaps named', html.includes('Still missing from this bundle'));
  check('discharge checklist references Wm. Scott', html.includes('Wm. Scott'));
  check('no em-dashes in output', !html.includes('—'));

  // Rejects an unknown document type.
  const bad = await api('POST', `/api/labour/${matterId}/document`, {
    documentType: 'not_a_doc',
    representativeName: 'X',
    organizationName: 'Y',
  });
  check('unknown doc type rejected', bad.status === 400);

  await api('DELETE', `/api/matters/${matterId}`);
  console.log(failures === 0 ? '\nAll hearing-bundle checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
