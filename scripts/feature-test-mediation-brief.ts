/**
 * Feature test — research-informed mediation brief.
 *
 * Creates a matter with a full Bardal profile, records offers on the
 * negotiation ledger, generates the mediation brief against a LOCAL server,
 * and asserts the deterministic front matter is present and correct:
 * profile table, itemized damages table, negotiation history (or its honest
 * absence), no duplicated h1 from the model, and the research-derived
 * lawyer review flags. One live LLM call (~$0.10-0.25).
 *
 * Usage: npm run serve -- --port 3799   (separate terminal)
 *        npx tsx scripts/feature-test-mediation-brief.ts
 */

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3799';

let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  [${detail}]` : ''}`);
  if (!ok) failures++;
}

async function api(method: string, url: string, body?: unknown): Promise<{ status: number; json: Record<string, unknown> }> {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
}

async function main() {
  const m = await api('POST', '/api/matters', {
    clientName: 'Dana Woo',
    matterTitle: '[FEATURE-TEST] Mediation brief upgrade',
    matterDescription: 'Wrongful dismissal, mediation brief generator test.',
    matterType: 'employment_agreement',
    jurisdiction: 'CA',
  });
  const mid = (m.json.matterId ?? m.json.id) as string;
  check('matter created', Boolean(mid));

  const intake = {
    client_first_name: 'Dana',
    client_last_name: 'Woo',
    client_age: 52,
    employer_legal_name: 'Meridian Logistics Inc.',
    job_title: 'Operations Manager',
    hire_date: '2013-03-04',
    termination_date: '2026-02-27',
    was_terminated: true,
    annual_salary: 104000,
    has_bonus: true,
    bonus_amount: 9000,
    termination_clause_exists: false,
    received_severance_offer: true,
    severance_weeks_offered: 12,
    severance_payment_type: 'lump_sum',
  };
  const i = await api('POST', '/api/employment/intake', { matterId: mid, intake });
  check('intake accepted', i.status === 200, JSON.stringify(i.json).slice(0, 160));

  const a = await api('POST', '/api/employment/analyze', { matterId: mid });
  check('analysis runs', a.status === 200, JSON.stringify(a.json).slice(0, 160));
  const gates = ((a.json.analysis as Record<string, unknown>)?.gates ?? []) as Array<{ triggered: boolean; issueCodes: string[] }>;
  const approved = gates.filter((g) => g.triggered).flatMap((g) => g.issueCodes);
  await api('POST', `/api/employment/${mid}/issues`, { approved, dismissed: [] });

  // Record a negotiation history: employer offer, client counter.
  const n1 = await api('POST', `/api/employment/${mid}/negotiation`, {
    date: '2026-04-02', party: 'employer', kind: 'offer', amountCad: 42000, terms: 'Lump sum, full and final release',
  });
  const n2 = await api('POST', `/api/employment/${mid}/negotiation`, {
    date: '2026-05-11', party: 'client', kind: 'counter', amountCad: 130000,
  });
  check('negotiation ledger recorded', n1.status === 200 && n2.status === 200,
    `${n1.status}/${n2.status}`);

  // Generate the brief (one live LLM call).
  const gen = await api('POST', `/api/employment/${mid}/litigation-document`, {
    documentType: 'mediation_brief',
    lawyerName: 'Feature Test',
    firmName: 'Example Firm LLP',
  });
  const doc = (gen.json.document ?? gen.json) as Record<string, unknown>;
  const html = String(doc.html ?? '');
  check('brief generated', gen.status === 200 && html.length > 1500, `${gen.status} len=${html.length}`);

  // Deterministic front matter present.
  check('title block present', html.includes('<h1>Mediation Brief of the Plaintiff, Dana Woo</h1>'));
  check('profile table present', html.includes('Profile of the Plaintiff') && html.includes('Operations Manager'));
  check('profile shows age and tenure', html.includes('52') && html.includes('2013-03-04 to 2026-02-27'));
  check('damages table present', html.includes('Damages Calculation'));
  check('negotiation history present with both offers', html.includes('Negotiation History') && html.includes('$42,000') && html.includes('$130,000'));

  // Exactly one h1: the model must not add its own title.
  const h1Count = (html.match(/<h1[\s>]/g) ?? []).length;
  check('exactly one h1 (model added no title)', h1Count === 1, `h1 count=${h1Count}`);

  // The narrative sections from the research model.
  check('narrative has an Overview section', /<h2[^>]*>\s*Overview/i.test(html));
  check('narrative has a Settlement Position section', /<h2[^>]*>[^<]*Settlement Position/i.test(html));

  // Factum convention: narrative paragraphs numbered consecutively,
  // starting at 1, with no gaps.
  const paraNumbers = [...html.matchAll(/<p[^>]*>(\d+)\.&nbsp;/g)].map((m) => Number(m[1]));
  check('narrative paragraphs are numbered', paraNumbers.length >= 5, `found ${paraNumbers.length}`);
  check('numbering starts at 1 and is consecutive',
    paraNumbers.length > 0 && paraNumbers[0] === 1 && paraNumbers.every((v, idx) => v === idx + 1),
    paraNumbers.slice(0, 10).join(','));

  // House style.
  check('no em-dashes in the brief', !html.includes('—'));

  // Research-derived review flags.
  const flags = (doc.lawyerReviewFlags ?? []) as string[];
  check('mitigation netting flag present', flags.some((f) => f.includes('mitigation')), flags.join(' | ').slice(0, 200));
  check('Rule 49 attachment flag present', flags.some((f) => f.includes('Rule 49')));

  await api('DELETE', `/api/matters/${mid}`);
  console.log(failures === 0 ? '\nAll mediation-brief checks passed.' : `\n${failures} check(s) FAILED.`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch((err) => { console.error(err); process.exit(1); });
