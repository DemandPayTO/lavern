/**
 * Feature Test — form-fill slice, against a LOCAL server. Deterministic
 * and $0: the portal filing sheets and the OLRB data files are pure data.
 *
 * Usage: npm run serve   # in one terminal
 *        npx tsx scripts/feature-test-forms.ts
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
    headers: { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
}

async function main() {
  const stamp = Date.now();
  const L = { lawyerName: 'Feature Test', firmName: 'Test Firm', courtLocation: 'Toronto' };

  // ── Employment matter with analysis ────────────────────────────────────
  const m = await api('POST', '/api/matters', {
    clientName: 'Forms Test', matterTitle: `[FEATURE-TEST] forms ${stamp}`,
    matterDescription: '[FEATURE-TEST]', matterType: 'employment_agreement', jurisdiction: 'CA',
  });
  const mid = m.json.matterId as string;
  await api('POST', '/api/employment/intake', { matterId: mid, intake: {
    client_first_name: 'Iris', client_last_name: 'Valdez',
    employer_legal_name: 'Test Employer Corp', job_title: 'Coordinator',
    hire_date: '2018-02-05', termination_date: '2026-06-15',
    annual_salary: 90000, was_terminated: true,
  }});
  await api('POST', '/api/employment/analyze', { matterId: mid });

  // ── ESA filing sheet ───────────────────────────────────────────────────
  const esa = await api('POST', `/api/employment/${mid}/litigation-document`, { documentType: 'esa_filing_sheet', ...L });
  const esaHtml = String(esa.json.html ?? '');
  check('ESA sheet at $0 with election caution and figures', esa.status === 200
    && Number(esa.json.costUsd) === 0
    && esaHtml.includes('ss. 97 and 98')
    && esaHtml.includes('Valdez')
    && !esaHtml.includes('—'));

  // ── Small Claims sheet with the cap check ──────────────────────────────
  const sccOver = await api('POST', `/api/employment/${mid}/litigation-document`, { documentType: 'scc_filing_sheet', claimAmount: 65000, ...L });
  check('Small Claims sheet warns above the limit', sccOver.status === 200
    && String(sccOver.json.html).includes('Abandon the excess'));
  const sccUnder = await api('POST', `/api/employment/${mid}/litigation-document`, { documentType: 'scc_filing_sheet', claimAmount: 30000, ...L });
  check('Small Claims sheet clean under the limit', sccUnder.status === 200
    && !String(sccUnder.json.html).includes('Abandon the excess'));

  // ── DOCX downloads for the sheets ──────────────────────────────────────
  const dl = await fetch(`${BASE}/api/employment/${mid}/download/esa-filing-sheet`);
  check('ESA sheet DOCX download', dl.status === 200
    && (dl.headers.get('content-type') ?? '').includes('wordprocessingml'));

  // ── Labour matter + OLRB data files ────────────────────────────────────
  const lm = await api('POST', '/api/matters', {
    clientName: 'Forms Grievor', matterTitle: `[FEATURE-TEST] olrb ${stamp}`,
    matterDescription: '[FEATURE-TEST]', matterType: 'employment_agreement', jurisdiction: 'CA',
  });
  const lmid = lm.json.matterId as string;
  await api('POST', '/api/labour/intake', { matterId: lmid, intake: {
    grievor_first_name: 'Amara', grievor_last_name: 'Okonkwo',
    grievor_classification: 'Press Operator',
    grievor_contact: 'amara@example.com, 416-555-0182',
    union_name: 'Unifor Local 222', employer_name: 'Durham Metal Works Inc',
    workplace_location: 'Oshawa plant',
    grievance_type: 'discharge', discipline_imposed: 'discharge',
    incident_date: '2026-07-01', grievance_filed: true,
  }});

  const a30 = await fetch(`${BASE}/api/labour/${lmid}/form/a30-data`);
  const a30Xml = await a30.text();
  check('A-30 data file populates the style of cause and union block', a30.status === 200
    && (a30.headers.get('content-disposition') ?? '').includes('olrb-form-a30-data')
    && a30Xml.includes('>Amara Okonkwo</applicant')
    && a30Xml.includes('>Unifor Local 222</respondingPartyTradeUnion'));

  const a53 = await fetch(`${BASE}/api/labour/${lmid}/form/a53-data`);
  const a53Xml = await a53.text();
  check('A-53 data file populates the worker and employer blocks', a53.status === 200
    && a53Xml.includes('>Amara</firstName')
    && a53Xml.includes('>amara@example.com</email')
    && a53Xml.includes('>Durham Metal Works Inc</orgName'));

  const badForm = await fetch(`${BASE}/api/labour/${lmid}/form/a99-data`);
  check('unknown form id is rejected', badForm.status === 400);

  // ── Cleanup ────────────────────────────────────────────────────────────
  for (const id of [mid, lmid]) {
    await fetch(`${BASE}/api/matters/${id}`, { method: 'DELETE' }).catch(() => undefined);
  }

  console.log(failures === 0 ? '\nCLEAN PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Feature test crashed:', err);
  process.exit(1);
});
