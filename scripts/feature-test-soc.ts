/**
 * Feature test — the Statement of Claim, and its one model-written section.
 *
 * The claim assembles from the firm's pleading nodes; only the Background
 * Facts are drafted. This exercises both: that the drafted facts read the
 * documents attached to the matter, that they plead facts rather than
 * conclusions, and that the settled pleading language still comes through
 * around them.
 *
 * Two live LLM calls (~$0.30).
 *
 * Usage: npm run serve -- --port 3799   (separate terminal)
 *        npx tsx scripts/feature-test-soc.ts
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

// Particulars that live ONLY in the attached documents, never in the intake.
// Their presence proves the facts were drafted from the documents.
const DOC_ONLY = {
  witnessTitle: 'Regional Operations Manager',
  quotedWords: 'looking for someone with more runway',
  memoDate: 'November 4, 2025',
};

const TERMINATION_MEMO = `
INTERNAL MEMORANDUM
Date: ${DOC_ONLY.memoDate}
From: Alan Petrie, ${DOC_ONLY.witnessTitle}
Re: Structure of the operations group

We have been reviewing the shape of the operations group. In discussion on
November 4, 2025 the Vice President said we were "${DOC_ONLY.quotedWords}" in
the operations lead role. No concern about performance was raised. The
recommendation is to end the reporting line of the current incumbent effective
in the new year and to recruit externally.
`.trim();

const HR_FILE_NOTE = `
HR FILE NOTE
The employee raised a concern on December 12, 2025 that the restructuring
appeared directed at the older members of the operations group. The concern was
acknowledged and no investigation was opened.
`.trim();

async function main() {
  const m = await api('POST', '/api/matters', {
    clientName: 'Ruth Delacroix',
    matterTitle: '[FEATURE-TEST] Statement of Claim',
    matterDescription: 'Wrongful dismissal with a human rights overlay.',
    matterType: 'employment_agreement',
    jurisdiction: 'CA',
  });
  const mid = (m.json.matterId ?? m.json.id) as string;
  check('matter created', Boolean(mid));

  const intake = {
    client_first_name: 'Ruth',
    client_last_name: 'Delacroix',
    client_age: 58,
    employer_legal_name: 'Cartwright Industrial Services Inc.',
    job_title: 'Director of Operations',
    hire_date: '2004-05-17',
    termination_date: '2026-01-09',
    was_terminated: true,
    annual_salary: 148000,
    has_bonus: true,
    bonus_amount: 22000,
    termination_clause_exists: true,
    believes_discriminatory_termination: true,
    discrimination_grounds: ['age'],
    termination_reasons: 'Restructuring of the operations group',
  };
  const i = await api('POST', '/api/employment/intake', { matterId: mid, intake });
  check('intake accepted', i.status === 200, JSON.stringify(i.json).slice(0, 200));

  const a = await api('POST', '/api/employment/analyze', { matterId: mid });
  check('analysis runs', a.status === 200, JSON.stringify(a.json).slice(0, 200));
  const gates = ((a.json.analysis as Record<string, unknown>)?.gates ?? []) as Array<{ triggered: boolean; issueCodes: string[] }>;
  const approved = gates.filter(g => g.triggered).flatMap(g => g.issueCodes);
  await api('POST', `/api/employment/${mid}/issues`, { approved, dismissed: [] });
  check('issues approved', approved.length > 0, approved.join(','));

  // Two documents on the matter, as a real file would carry.
  const s1 = await api('POST', `/api/employment/${mid}/brief-sources`, {
    name: 'Internal memorandum (Nov 2025)', text: TERMINATION_MEMO, kind: 'correspondence',
  });
  const s2 = await api('POST', `/api/employment/${mid}/brief-sources`, {
    name: 'HR file note (Dec 2025)', text: HR_FILE_NOTE, kind: 'other',
  });
  check('documents attached to the matter', s1.status === 200 && s2.status === 200, `${s1.status}/${s2.status}`);
  const sourceIds = ((s2.json.sources ?? []) as Array<{ id: string }>).map(s => s.id);
  check('two sources on the matter', sourceIds.length === 2, `${sourceIds.length}`);

  // ── The Background Facts, drafted section by section ──────────────────
  const draft = await api('POST', `/api/employment/${mid}/soc-section/draft`, {
    sectionId: 'SOC_FACTS_01',
    briefSourceIds: sourceIds,
  });
  check('background facts drafted', draft.status === 200, JSON.stringify(draft.json).slice(0, 200));
  const factsHtml = String(draft.json.html ?? '');
  const facts = factsHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
  check('facts section has substance', facts.length > 400, `${facts.length} chars`);

  // THE FIX: the section-by-section facts route passed no documents at all
  // before, so the facts were written from intake fields alone.
  for (const [label, needle] of Object.entries(DOC_ONLY)) {
    check(`drafted from the documents: ${label}`, facts.includes(needle), `missing "${needle}"`);
  }

  // Craft: facts, not conclusions. These words plead a conclusion the causes
  // of action already plead in the firm's own language, and invite a strike.
  const conclusory = ['callously', 'egregious', 'in bad faith', 'deliberately', 'without regard', 'unconscionable', 'malicious'];
  const found = conclusory.filter(w => new RegExp(`\\b${w}\\b`, 'i').test(facts));
  check('no conclusory characterisation in the facts', found.length === 0, found.join(', '));

  // Craft: an account, not a checklist keyed to the causes.
  check('the facts carry no headings', !/<h[1-6][\s>]/i.test(factsHtml));
  check('the facts are paragraphs', (factsHtml.match(/<p[\s>]/g) ?? []).length >= 5,
    `${(factsHtml.match(/<p[\s>]/g) ?? []).length} paragraphs`);

  // Craft: active voice with the actor named, and the fact at the front of the
  // paragraph. Tested loosely on purpose. Some passive is correct pleading
  // ("no concern about performance was raised" has no actor by design), so the
  // check is that the passive is the exception rather than the register.
  const factParas = [...factsHtml.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(mm => mm[1].replace(/<[^>]+>/g, ' ').replace(/\{\{para\}\}\.?/g, '').replace(/^\s*\d+[.)]\s*/, '').trim())
    .filter(Boolean);
  check('the facts came back as readable paragraphs', factParas.length >= 5, `${factParas.length}`);

  // The passive that matters hides who did the contested thing. "was employed
  // by the Defendant" is settled pleading idiom and names its actor already.
  // Tolerance is deliberate, and was learned the hard way: this check twice
  // failed on prose that was fine. Legal writing carries legitimate passives
  // (a third party's dismissal, an act whose actor is not in issue), and one
  // such clause inside an otherwise active paragraph is not a regression.
  // What IS a regression is the register reverting wholesale, so the test is
  // a proportion rather than an absolute. A check that only ever fires falsely
  // is worse than no check: it teaches you to ignore it.
  const agentlessPassive = factParas.filter(t => new RegExp(`\\b(?:was|were)\\s+(?:terminated|dismissed|eliminated|removed|replaced|denied|refused|rejected|excluded|demoted|reassigned|selected|appointed|filled)\\b`, 'i').test(t));
  check('the active voice is the register, not the exception',
    agentlessPassive.length <= Math.max(2, Math.floor(factParas.length * 0.3)),
    `${agentlessPassive.length} of ${factParas.length} paragraphs`);

  const weakOpener = factParas.filter(t => /^(?:There (?:was|were|is|are)\b|It (?:was|is)\b|In (?:the )?(?:circumstances|addition)\b)/i.test(t));
  check('no paragraph opens by circling the fact', weakOpener.length === 0,
    weakOpener.slice(0, 2).map(t => t.slice(0, 60)).join(' | '));

  // Point first: a pleaded fact opens with its actor or its date, not with a
  // subordinate clause building toward the fact.
  const pointFirst = factParas.filter(t => /^(?:On|By|In|At|The Plaintiff|The Defendant|Throughout|Between|Prior to|Following)\b/i.test(t));
  check('paragraphs lead with the fact', pointFirst.length >= Math.ceil(factParas.length * 0.7),
    `${pointFirst.length} of ${factParas.length}`);

  // House style.
  check('no em-dashes in the facts', !factsHtml.includes('—'));
  check('no contractions in the facts', !/\b(don't|can't|won't|doesn't|isn't|wasn't|couldn't|didn't)\b/i.test(facts));

  // ── The whole claim: the nodes still plead the causes ─────────────────
  const gen = await api('POST', `/api/employment/${mid}/statement-of-claim`, {
    procedureType: 'ordinary',
    claimAmount: 320000,
    lawyerName: 'Feature Test',
    firmName: 'Example Firm LLP',
    courtLocation: 'Toronto',
    briefSourceIds: sourceIds,
  });
  check('claim generated', gen.status === 200, JSON.stringify(gen.json).slice(0, 200));
  const claim = String(gen.json.html ?? '');
  const claimText = claim.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  check('the claim pleads relief', /THE PLAINTIFF CLAIMS|claims against the Defendant/i.test(claimText));
  check('the settled pleading language is present', /BACKGROUND FACTS/i.test(claimText));
  check('the termination clause cause is pleaded', /termination provision|termination clause/i.test(claimText));

  // Numbering is deterministic and runs unbroken.
  const nums = [...claim.matchAll(/<p[^>]*>(\d+)\.(?:&nbsp;| )/g)].map(mm => Number(mm[1]));
  check('claim paragraphs numbered', nums.length >= 10, `found ${nums.length}`);
  check('numbering starts at 1 and never restarts',
    nums.length > 0 && nums[0] === 1 && nums.every((v, idx) => v === idx + 1),
    nums.slice(0, 40).join(','));

  check('no em-dashes in the claim', !claim.includes('—'));
  check('no {{para}} markers leak into the claim', !claim.includes('{{para}}'));

  if (process.env.SOC_DUMP) {
    const fs = await import('node:fs/promises');
    await fs.writeFile(process.env.SOC_DUMP, `<!-- FACTS -->\n${factsHtml}\n<!-- CLAIM -->\n${claim}`);
  }

  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} check(s) FAILED`}`);
  console.log(`facts=${(factsHtml.match(/<p[\s>]/g) ?? []).length} paragraphs, claim=${nums.length} numbered`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => { console.error(err); process.exit(1); });
