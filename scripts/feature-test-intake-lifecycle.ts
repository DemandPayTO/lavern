/**
 * Feature Test — intake editing and document lifecycle, against a LOCAL
 * server. Deterministic: only $0 operations (intake, analysis, the
 * mitigation log, and the court forms), so the loop can run repeatedly
 * at no API cost.
 *
 * Usage: npm run serve   # in one terminal
 *        npx tsx scripts/feature-test-intake-lifecycle.ts
 *
 * Exits non-zero on the first failed check.
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

  // ── Employment: create → intake → analyze → approve ───────────────────
  const m = await api('POST', '/api/matters', {
    clientName: 'Feature Test', matterTitle: `[FEATURE-TEST] intake-lifecycle ${stamp}`,
    matterDescription: '[FEATURE-TEST]', matterType: 'employment_agreement', jurisdiction: 'CA',
  });
  const mid = m.json.matterId as string;
  check('matter created', (m.status === 200 || m.status === 201) && Boolean(mid));

  const soon = new Date();
  soon.setDate(soon.getDate() + 10);
  const soonIso = `${soon.getFullYear()}-${String(soon.getMonth() + 1).padStart(2, '0')}-${String(soon.getDate()).padStart(2, '0')}`;
  const intakeV1 = {
    client_first_name: 'Iris', client_last_name: 'Valdez', client_age: 44,
    employer_legal_name: 'Test Employer Corp', job_title: 'Coordinator',
    hire_date: '2018-02-05', termination_date: '2026-06-15',
    annual_salary: 90000, was_terminated: true,
    received_severance_offer: true, severance_deadline: soonIso,
  };
  await api('POST', '/api/employment/intake', { matterId: mid, intake: intakeV1 });
  const a1 = await api('POST', '/api/employment/analyze', { matterId: mid });
  const gates = ((a1.json.analysis as Record<string, unknown>)?.gates ?? []) as Array<{ triggered: boolean; issueCodes: string[] }>;
  const approved = [...new Set(gates.filter(g => g.triggered).flatMap(g => g.issueCodes))];
  await api('POST', `/api/employment/${mid}/issues`, { approved, dismissed: [] });
  check('analysis + approvals', a1.status === 200 && approved.length > 0);

  // ── Intake edit: salary and discrimination flag ────────────────────────
  await api('POST', '/api/employment/intake', { matterId: mid, intake: { ...intakeV1, annual_salary: 130000, believes_discriminatory_termination: true } });
  const a2 = await api('POST', '/api/employment/analyze', { matterId: mid });
  const d1 = (a1.json.analysis as Record<string, { esaNoticePay: number }>).damagesEstimate;
  const d2 = (a2.json.analysis as Record<string, { esaNoticePay: number }>).damagesEstimate;
  check('edit recomputes figures', d2.esaNoticePay > d1.esaNoticePay, `${d1.esaNoticePay} -> ${d2.esaNoticePay}`);

  const g1 = await api('GET', `/api/employment/${mid}`);
  const data = g1.json.data as { approvedIssues: string[]; timeline: Array<{ label: string }> };
  check('approvals preserved through edit', JSON.stringify(data.approvedIssues) === JSON.stringify(approved));
  check('HRTO clock appears after discrimination flagged', data.timeline.some(e => e.label.includes('HRTO')));
  check('ESA clock present', data.timeline.some(e => e.label.includes('ESA claim')));
  const empStage = g1.json.stage as { stage?: string; evidence?: string[] } | undefined;
  check('stage derives to assessment after analysis', empStage?.stage === 'assessment', JSON.stringify(empStage));
  const empNext = (g1.json.nextSteps ?? []) as Array<{ action: string; urgency: string }>;
  check('next steps recommend assessing the pending severance offer',
    empNext.some(n => n.action.includes('Assess the severance offer') && n.urgency === 'urgent'),
    JSON.stringify(empNext.map(n => n.action)));

  // ── Lifecycle: generate two $0 documents, advance statuses ─────────────
  const L = { lawyerName: 'Feature Test', firmName: 'Test Firm', courtLocation: 'Toronto' };
  const gen1 = await api('POST', `/api/employment/${mid}/litigation-document`, { documentType: 'mitigation_log', ...L });
  const gen2 = await api('POST', `/api/employment/${mid}/litigation-document`, {
    documentType: 'affidavit_of_service', ...L,
    formFields: {
      document_served: 'Statement of Claim', served_party: 'Test Employer Corp',
      service_date: '2026-07-03', service_method: 'courier',
      server_name: 'D. Process', server_city: 'City of Toronto',
    },
  });
  check('deterministic documents generated at $0', gen1.status === 200 && gen2.status === 200
    && Number(gen1.json.costUsd) === 0 && Number(gen2.json.costUsd) === 0);

  const g2 = await api('GET', `/api/employment/${mid}`);
  const docs = (g2.json.generatedDocuments ?? []) as Array<{ docType: string; status: string }>;
  check('generatedDocuments lists both as draft',
    docs.some(d => d.docType === 'mitigation_log' && d.status === 'draft')
    && docs.some(d => d.docType === 'affidavit_of_service' && d.status === 'draft'),
    JSON.stringify(docs.map(d => `${d.docType}:${d.status}`)));

  const s1 = await api('POST', `/api/employment/${mid}/document-status`, { docType: 'mitigation_log', status: 'reviewed' });
  const s2 = await api('POST', `/api/employment/${mid}/document-status`, { docType: 'affidavit_of_service', status: 'filed', date: '2026-07-04' });
  const afterDocs = (s2.json.generatedDocuments ?? []) as Array<{ docType: string; status: string; statusDate: string | null }>;
  check('status transitions persist',
    s1.status === 200 && s2.status === 200
    && afterDocs.some(d => d.docType === 'mitigation_log' && d.status === 'reviewed')
    && afterDocs.some(d => d.docType === 'affidavit_of_service' && d.status === 'filed' && d.statusDate === '2026-07-04'));

  const bad1 = await api('POST', `/api/employment/${mid}/document-status`, { docType: 'sj_factum', status: 'reviewed' });
  const bad2 = await api('POST', `/api/employment/${mid}/document-status`, { docType: 'mitigation_log', status: 'destroyed' });
  check('unknown document 404s, invalid status 400s', bad1.status === 404 && bad2.status === 400);

  // ── Labour: intake edit preserves approvals, recomputes clocks ─────────
  const lm = await api('POST', '/api/matters', {
    clientName: 'Feature Test Grievor', matterTitle: `[FEATURE-TEST] labour ${stamp}`,
    matterDescription: '[FEATURE-TEST]', matterType: 'employment_agreement', jurisdiction: 'CA',
  });
  const lmid = lm.json.matterId as string;
  const gIntake = {
    grievor_first_name: 'Test', grievor_last_name: 'Grievor',
    employer_name: 'Test Plant Inc', union_name: 'Test Local 1',
    grievance_type: 'discharge', discipline_imposed: 'discharge',
    incident_date: '2026-07-01', filing_deadline_days: 10, filing_deadline_kind: 'calendar',
    grievance_filed: false,
  };
  const li1 = await api('POST', '/api/labour/intake', { matterId: lmid, intake: gIntake });
  const lCodes = [...new Set(((li1.json.gates ?? []) as Array<{ triggered: boolean; issueCodes: string[] }>).filter(g => g.triggered).flatMap(g => g.issueCodes))];
  await api('POST', `/api/labour/${lmid}/issues`, { approved: lCodes, dismissed: [] });

  const li2 = await api('POST', '/api/labour/intake', { matterId: lmid, intake: { ...gIntake, filing_deadline_days: 25 } });
  const lDeadlines = (li2.json.deadlines ?? []) as Array<{ label: string }>;
  check('labour edit recomputes clocks', li2.status === 200 && lDeadlines.some(d => d.label.includes('25 calendar days')));
  const lg = await api('GET', `/api/labour/${lmid}`);
  check('labour approvals preserved', JSON.stringify((lg.json.data as { approvedIssues: string[] }).approvedIssues) === JSON.stringify(lCodes));
  const labStage = lg.json.stage as { stage?: string } | undefined;
  check('labour stage derives to assessment', labStage?.stage === 'assessment', JSON.stringify(labStage));
  const labNext = (lg.json.nextSteps ?? []) as Array<{ action: string }>;
  check('labour next steps recommend filing the grievance',
    labNext.some(n => n.action.includes('File the grievance')),
    JSON.stringify(labNext.map(n => n.action)));

  // ── Outcome capture: close and reopen the labour matter ───────────────
  const closeRes = await api('POST', `/api/employment/${lmid}/outcome`, { resolution: 'grievance_withdrawn', date: '2026-07-05' });
  const closedStage = await api('GET', `/api/labour/${lmid}`);
  check('outcome closes the matter and resolves the stage', closeRes.status === 200
    && (closedStage.json.stage as { stage?: string })?.stage === 'resolution');
  const reopenRes = await fetch(`${BASE}/api/employment/${lmid}/outcome`, { method: 'DELETE' });
  const reopenedStage = await api('GET', `/api/labour/${lmid}`);
  check('reopening restores the working stage', reopenRes.status === 200
    && (reopenedStage.json.stage as { stage?: string })?.stage !== 'resolution');

  // ── Calendar feed ──────────────────────────────────────────────────────
  const icsRes = await fetch(`${BASE}/api/employment/deadlines.ics`);
  const ics = await icsRes.text();
  check('docket exports as an iCalendar feed', icsRes.status === 200
    && (icsRes.headers.get('content-type') ?? '').includes('text/calendar')
    && ics.includes('BEGIN:VCALENDAR')
    && ics.includes('Iris Valdez v Test Employer Corp')
    && ics.includes(`DTSTART;VALUE=DATE:${soonIso.replace(/-/g, '')}`));

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
