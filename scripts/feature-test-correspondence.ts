/**
 * Feature Test — client correspondence engine, against a LOCAL server.
 * Deterministic: drafts are template merges, $0. Covers: start series →
 * docket pickup → next-step recommendation → draft → edit → mark sent →
 * timeline event → skip → cleanup.
 *
 * Usage: npm run serve   # in one terminal
 *        npx tsx scripts/feature-test-correspondence.ts
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
    clientName: 'Corr Test', matterTitle: `[FEATURE-TEST] correspondence ${stamp}`,
    matterDescription: '[FEATURE-TEST]', matterType: 'employment_agreement', jurisdiction: 'CA',
  });
  const mid = m.json.matterId as string;
  check('matter created', (m.status === 200 || m.status === 201) && Boolean(mid));

  const termination = new Date();
  termination.setDate(termination.getDate() - 14);
  const termIso = `${termination.getFullYear()}-${String(termination.getMonth() + 1).padStart(2, '0')}-${String(termination.getDate()).padStart(2, '0')}`;
  const intake = await api('POST', '/api/employment/intake', {
    matterId: mid,
    intake: {
      client_first_name: 'Corr', client_last_name: 'Test', client_email: 'corr@example.com',
      employer_legal_name: 'Corr Employer Inc', job_title: 'Analyst',
      hire_date: '2019-03-01', termination_date: termIso,
      annual_salary: 80000, was_terminated: true,
    },
  });
  check('intake saved', intake.status === 200);

  // Start the series (7-week window)
  const start = await api('POST', `/api/employment/${mid}/correspondence/start`, { sequence: 'mitigation', followUpWeeks: 7 });
  const items = (start.json.correspondence ?? []) as Array<{ id: string; dueDate: string; status: string }>;
  check('series started with two steps', start.status === 200 && items.length === 2);
  check('restart refused', (await api('POST', `/api/employment/${mid}/correspondence/start`, { sequence: 'mitigation', followUpWeeks: 7 })).status === 409);

  // Docket pickup
  const deadlines = await api('GET', '/api/employment/deadlines');
  const docket = (deadlines.json.deadlines ?? deadlines.json.items ?? []) as Array<{ matterId: string; kind: string; label: string }>;
  const mine = docket.filter(d => d.matterId === mid && d.kind === 'client_email');
  check('docket carries the due client email', mine.length >= 1, JSON.stringify(docket.slice(0, 2)));

  // Next-step recommendation (step 1 is due today)
  const detail = await api('GET', `/api/employment/${mid}`);
  const steps = (detail.json.nextSteps ?? []) as Array<{ action: string; goTo?: string }>;
  check('next steps recommend the client email', steps.some(s => /client email/i.test(s.action) && s.goTo === 'client'), JSON.stringify(steps));

  // Draft step 1
  const draft = await api('POST', `/api/employment/${mid}/correspondence/mitigation-1/draft`);
  const draftItem = draft.json.item as { status: string; draft: { subject: string; body: string } };
  check('draft built', draft.status === 200 && draftItem.status === 'drafted');
  check('draft merges client + window', draftItem.draft.body.includes('Dear Corr') && draftItem.draft.body.includes('7 weeks'));
  check('draft flags lawyer judgment', draftItem.draft.body.includes('[LAWYER:'));
  check('draft has no em dashes', !draftItem.draft.body.includes('—'));

  // Edit, then mark sent
  const edit = await api('PUT', `/api/employment/${mid}/correspondence/mitigation-1/draft`, {
    subject: 'Edited: duty to mitigate', body: 'Edited body.',
  });
  check('lawyer edit saved', edit.status === 200 && (edit.json.item as { draft: { subject: string } }).draft.subject.startsWith('Edited'));

  const sent = await api('POST', `/api/employment/${mid}/correspondence/mitigation-1/status`, { status: 'sent' });
  check('marked sent', sent.status === 200);

  const after = await api('GET', `/api/employment/${mid}`);
  const timeline = ((after.json.data as Record<string, unknown> | undefined)?.timeline ?? []) as Array<{ label: string }>;
  check('timeline records the sent email', timeline.some(t => t.label.startsWith('Client email sent:')), JSON.stringify(timeline.slice(-2)));

  // Step 2: skip
  const skip = await api('POST', `/api/employment/${mid}/correspondence/mitigation-2/status`, { status: 'skipped' });
  check('step 2 skipped', skip.status === 200);
  const list = await api('GET', `/api/employment/${mid}/correspondence`);
  const open = (list.json.correspondence as Array<{ status: string }>).filter(c => c.status === 'scheduled' || c.status === 'drafted');
  check('no open items remain', open.length === 0);

  // Cleanup
  const del = await api('DELETE', `/api/matters/${mid}`);
  check('cleanup', del.status === 200);

  console.log(failures === 0 ? '\nCLEAN PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => {
  console.error('Feature test crashed:', err);
  process.exit(1);
});
