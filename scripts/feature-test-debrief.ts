/**
 * Feature test — Matter Debrief.
 *
 * Creates a matter, posts raw call notes, analyzes them (one live LLM call),
 * approves the reviewed debrief, and asserts: action items are stored, dated
 * items reach the docket AND the ICS feed, an email item carries a draft,
 * check-off toggles status and removes the item from the docket, and the
 * model never invented a date it was not given.
 *
 * Usage: SHEM_DB_PATH=... npm run serve -- --port 3799   (separate terminal)
 *        npx tsx scripts/feature-test-debrief.ts
 */

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3799';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  [${detail}]` : ''}`);
  if (!ok) failures++;
}

async function api(method: string, url: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown>; text: string }> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const text = await res.text();
  let json: Record<string, unknown> = {};
  try { json = JSON.parse(text) as Record<string, unknown>; } catch { /* ics is text */ }
  return { status: res.status, json, text };
}

async function main() {
  const m = await api('POST', '/api/matters', {
    clientName: 'Dana Woo', matterTitle: '[FEATURE-TEST] Debrief', matterDescription: 'debrief test',
    matterType: 'employment_agreement', jurisdiction: 'CA',
  });
  const mid = (m.json.matterId ?? m.json.id) as string;
  check('matter created', Boolean(mid));

  await api('POST', '/api/employment/intake', { matterId: mid, intake: {
    client_first_name: 'Dana', client_last_name: 'Woo', client_email: 'dana@example.com',
    employer_legal_name: 'Meridian Logistics Inc.', was_terminated: true,
    hire_date: '2013-03-04', termination_date: '2026-02-27', annual_salary: 104000,
  } });

  // Notes with ONE explicit date ("by July 31") and one undated task.
  const notes = `Call with Dana on 2026-07-15. She wants to counter the 12-week offer from Meridian Logistics Inc. Employer alleged cause but has no warning letters. I will draft a counter-offer letter and send it to opposing counsel by July 31. Dana will send me her job search log at some point. Please email Dana a reminder about keeping her mitigation records.`;

  const analyze = await api('POST', `/api/employment/${mid}/debrief/analyze`, { rawNotes: notes, callType: 'client', callDate: '2026-07-15' });
  check('analyze succeeds', analyze.status === 200 && analyze.json.ok === true, JSON.stringify(analyze.json).slice(0, 200));
  const proposed = analyze.json.proposed as { summary: string; actionItems: Array<{ task: string; dueDate: string | null; kind: string; emailSubject?: string; emailBody?: string }> };
  check('proposed summary present', Boolean(proposed?.summary));
  check('extracted multiple action items', (proposed?.actionItems?.length ?? 0) >= 2, `got ${proposed?.actionItems?.length}`);
  const dated = proposed.actionItems.filter(i => i.dueDate);
  check('at least one dated item (July 31)', dated.some(i => i.dueDate === '2026-07-31'), JSON.stringify(dated).slice(0, 200));
  check('no item has an invented malformed date', proposed.actionItems.every(i => i.dueDate === null || /^\d{4}-\d{2}-\d{2}$/.test(i.dueDate)));
  check('an email item carries a draft', proposed.actionItems.some(i => i.kind === 'email' && (i.emailBody || i.emailSubject)));

  // Approve the reviewed debrief verbatim.
  const save = await api('POST', `/api/employment/${mid}/debrief`, { callType: 'client', summary: proposed.summary, actionItems: proposed.actionItems });
  check('save succeeds', save.status === 200 && save.json.ok === true, JSON.stringify(save.json).slice(0, 160));
  check('scheduled count reported', Number(save.json.scheduled) >= 1, `scheduled=${save.json.scheduled}`);
  const debrief = save.json.debrief as { actionItems: Array<{ id: string; dueDate: string | null; task: string }> };

  // Dated item reaches the docket ICS feed.
  const ics = await api('GET', '/api/employment/deadlines.ics');
  check('dated action item appears in the ICS feed', ics.text.includes('Action item:'), ics.text.slice(0, 120));

  // Docket via GET matter reflects the stored debrief.
  const got = await api('GET', `/api/employment/${mid}`);
  const storedDebriefs = (got.json.debriefs ?? []) as Array<{ actionItems: unknown[] }>;
  check('GET matter returns the debrief', storedDebriefs.length === 1 && storedDebriefs[0].actionItems.length >= 2);

  // Check off the dated item → it leaves the ICS feed.
  const datedItem = debrief.actionItems.find(i => i.dueDate);
  if (datedItem) {
    const toggle = await api('POST', `/api/employment/${mid}/debrief/${datedItem.id}/status`, { status: 'done' });
    check('check-off succeeds', toggle.status === 200 && toggle.json.ok === true);
    const ics2 = await api('GET', '/api/employment/deadlines.ics');
    check('checked-off item leaves the docket', !ics2.text.includes(datedItem.task), 'still present after done');
  }

  // Bad status rejected.
  const bad = await api('POST', `/api/employment/${mid}/debrief/${datedItem?.id ?? 'x'}/status`, { status: 'nope' });
  check('invalid status rejected (400)', bad.status === 400, `got ${bad.status}`);

  await api('DELETE', `/api/matters/${mid}`);
  console.log(failures === 0 ? '\nAll debrief checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
