/**
 * Feature test — HRTO Schedule "A" is drawn from the attached pleading.
 *
 * Attaches a Notice of Application carrying particulars that exist nowhere in
 * the intake (the successor job title, the board minute and its date, the
 * appointee's name, the quoted phrase), then asserts the generated Schedule
 * "A" carries them across, numbers consecutively from 1 across every heading,
 * stays in the filed register, and leaves the civil causes of action behind.
 *
 * One live LLM call (~$0.10-0.20).
 *
 * Usage: npm run serve -- --port 3799   (separate terminal)
 *        EVAL_BASE_URL=http://localhost:3799 npx tsx scripts/feature-test-schedule-a.ts
 */

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3799';
let failures = 0;
function check(name: string, ok: boolean, detail?: string) {
  console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}${!ok && detail ? `  [${detail}]` : ''}`);
  if (!ok) failures++;
}
async function api(method: string, url: string, body?: unknown) {
  const res = await fetch(`${BASE}${url}`, {
    method,
    headers: body === undefined ? {} : { 'Content-Type': 'application/json' },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  return { status: res.status, json: await res.json().catch(() => ({})) as Record<string, unknown> };
}

// Particulars that appear ONLY in the attached pleading, never in the intake.
// If these reach the Schedule, the source document was genuinely read.
const NOA_ONLY = {
  cfoTitle: 'Chief Financial Officer',
  restructuring: 'organizational restructuring',
  namedExec: 'Priya Raman',
  quotedPhrase: 'fresh perspective',
};

const NOTICE_OF_APPLICATION = `
NOTICE OF APPLICATION — ONTARIO SUPERIOR COURT OF JUSTICE
BETWEEN: MARGARET OKONJO, Applicant, and NORTHWIND COMMUNITY SERVICES, Respondent.

THE APPLICANT CLAIMS:
1. Damages in lieu of reasonable notice at common law.
2. Statutory notice and severance pay under the Employment Standards Act, 2000.
3. Damages under the Human Rights Code for discrimination on the ground of age.

GROUNDS FOR THE APPLICATION:
4. The Applicant was employed by the Respondent from July 1, 1988 until February 12, 2026, a period of
   thirty-seven years and seven months. At termination she held the position of Director of Finance and
   Operations and earned $125,257.62 per annum. She was 64 years of age.
5. The Respondent terminated the Applicant's employment on February 12, 2026, stating that her position
   was eliminated as part of an ${NOA_ONLY.restructuring}. No cause was alleged and no performance
   concern was ever raised with the Applicant.
6. Contemporaneously with the elimination of her position, the Respondent created the position of
   ${NOA_ONLY.cfoTitle}, carrying substantially the duties the Applicant had performed.
7. The board minute of January 19, 2026 records that the Respondent sought a "${NOA_ONLY.quotedPhrase}" in its senior
   finance leadership. The Applicant was neither considered for nor offered the new position.
8. The ${NOA_ONLY.cfoTitle} position was filled by ${NOA_ONLY.namedExec}, who was 38 years of age at the
   date of appointment.
9. The Applicant states that her age was a factor in the decision to eliminate her position and in the
   decision not to appoint her to the successor position, contrary to section 5(1) of the Human Rights Code.
10. The Applicant was one of two members of senior management over the age of 60. The other, the Director
    of Facilities, was terminated on March 3, 2026 in the same exercise.
`.trim();

async function main() {
  const m = await api('POST', '/api/matters', {
    clientName: 'Margaret Okonjo',
    matterTitle: '[FEATURE-TEST] Schedule A source grounding',
    matterDescription: 'Age discrimination, HRTO Schedule A generated from the notice of application.',
    matterType: 'employment_agreement',
    jurisdiction: 'CA',
  });
  const mid = (m.json.matterId ?? m.json.id) as string;
  check('matter created', Boolean(mid));

  // The intake deliberately does NOT carry the CFO, the board minute, the
  // successor's name, or the quoted phrase. Only the pleading has those.
  const intake = {
    client_first_name: 'Margaret',
    client_last_name: 'Okonjo',
    client_age: 64,
    employer_legal_name: 'Northwind Community Services',
    job_title: 'Director of Finance and Operations',
    hire_date: '1988-07-01',
    termination_date: '2026-02-12',
    was_terminated: true,
    annual_salary: 125257.62,
    termination_clause_exists: false,
    believes_discriminatory_termination: true,
    discrimination_grounds: ['age'],
  };
  const i = await api('POST', '/api/employment/intake', { matterId: mid, intake });
  check('intake accepted', i.status === 200, JSON.stringify(i.json).slice(0, 200));

  const a = await api('POST', '/api/employment/analyze', { matterId: mid });
  check('analysis runs', a.status === 200, JSON.stringify(a.json).slice(0, 200));
  const gates = ((a.json.analysis as Record<string, unknown>)?.gates ?? []) as Array<{ triggered: boolean; issueCodes: string[] }>;
  const approved = gates.filter(g => g.triggered).flatMap(g => g.issueCodes);
  await api('POST', `/api/employment/${mid}/issues`, { approved, dismissed: [] });
  check('human rights issue approved (G10)', approved.some(c => /human_rights|discrimination|harassment/.test(c)), approved.join(','));

  // Attach the pleading, exactly as the lawyer would from the workspace.
  const src = await api('POST', `/api/employment/${mid}/brief-sources`, {
    name: 'Notice of Application (issued)',
    text: NOTICE_OF_APPLICATION,
    kind: 'other',
  });
  check('notice of application attached', src.status === 200, JSON.stringify(src.json).slice(0, 200));
  const sourceIds = ((src.json.sources ?? []) as Array<{ id: string }>).map(s => s.id);

  const gen = await api('POST', `/api/employment/${mid}/litigation-document`, {
    documentType: 'hrto_schedule_a',
    lawyerName: 'Feature Test',
    firmName: 'Example Firm LLP',
    briefSourceIds: sourceIds,
    includeGeneratedDemand: false,
    includeGeneratedSoc: false,
  });
  const doc = (gen.json.document ?? gen.json) as Record<string, unknown>;
  const html = String(doc.html ?? '');
  check('schedule A generated', gen.status === 200 && html.length > 800, `${gen.status} len=${html.length}`);

  const text = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');

  // 1. THE FIX: particulars that exist only in the pleading must appear.
  for (const [label, needle] of Object.entries(NOA_ONLY)) {
    check(`carried from the pleading: ${label}`, text.includes(needle), `missing "${needle}"`);
  }
  // The board minute is checked by substance, not by phrasing: the model may
  // legitimately write "a minute of a meeting of the board of directors".
  // The model sometimes generalises this dated particular away. That is model
  // fidelity, not wiring, so the requirement is: either the date is pleaded,
  // or the guard tells counsel it was dropped. Silence on both is the failure.
  const dateCarried = text.includes('January 19, 2026') && /board|minute/i.test(text);
  const flagsEarly = (gen.json.reviewFlags ?? doc.lawyerReviewFlags ?? []) as string[];
  const dateFlagged = flagsEarly.some(f => /the narrative does not use/.test(f) && f.includes('January 19, 2026'));
  check('the January 19 board minute is pleaded, or its loss is flagged',
    dateCarried || dateFlagged, `carried=${dateCarried}, flagged=${dateFlagged}`);
  if (!dateCarried && dateFlagged) console.log('     note: the model dropped the dated particular; the guard caught it.');

  // 2. Numbering is ours: consecutive from 1, across every heading.
  const nums = [...html.matchAll(/<p[^>]*>(\d+)\.(?:&nbsp;| )/g)].map(mm => Number(mm[1]));
  check('paragraphs numbered', nums.length >= 8, `found ${nums.length}`);
  check('numbering starts at 1 and never restarts',
    nums.length > 0 && nums[0] === 1 && nums.every((v, idx) => v === idx + 1),
    nums.slice(0, 40).join(','));

  // 3. Any <ol> must be a sub-list under a numbered paragraph (the remedies
  //    menu, for example), never the main narrative: if the model were still
  //    numbering the narrative itself, the <p> run above would be short.
  const olCount = (html.match(/<ol[\s>]/gi) ?? []).length;
  check('ordered lists are sub-lists, not the narrative', olCount === 0 || nums.length >= 8,
    `ol=${olCount}, numbered paragraphs=${nums.length}`);

  // 4. Length: the bloat the lawyer reported was ~7 pages (~3,500 words).
  const words = text.split(' ').filter(Boolean).length;
  check('not padded to seven pages', words < 2600, `${words} words`);

  // 5. No section exists to say a claim is not advanced.
  check('no not-advanced filler section',
    !/does not(,| ).{0,60}(advance|plead)/i.test(text) && !/freestanding claim of harassment/i.test(text),
    'found a section disclaiming unpleaded causes');

  // 5b. Craft: active voice with the actor named, and the fact at the front of
  //     the paragraph. Loose on purpose: some passive is correct, so the test
  //     is that the passive is the exception rather than the register.
  const saParas = [...html.matchAll(/<p[^>]*>([\s\S]*?)<\/p>/gi)]
    .map(mm => mm[1].replace(/<[^>]+>/g, ' ').replace(/&nbsp;|\u00a0/g, ' ').replace(/^\s*\d+[.)]\s*/, '').replace(/\s+/g, ' ').trim())
    .filter(t => t.length > 40);
  check('the narrative came back as readable paragraphs', saParas.length >= 5, `${saParas.length}`);

  // The passive that matters hides who did the contested thing. "was employed
  // by the Respondent" is settled pleading idiom and names its actor already.
  // Tolerance is deliberate, and was learned the hard way: this check twice
  // failed on prose that was fine. Legal writing carries legitimate passives
  // (a third party's dismissal, an act whose actor is not in issue), and one
  // such clause inside an otherwise active paragraph is not a regression.
  // What IS a regression is the register reverting wholesale, so the test is
  // a proportion rather than an absolute. A check that only ever fires falsely
  // is worse than no check: it teaches you to ignore it.
  const saPassive = saParas.filter(t => new RegExp(`\\b(?:was|were)\\s+(?:terminated|dismissed|eliminated|removed|replaced|denied|refused|rejected|excluded|demoted|reassigned|selected|appointed|filled)\\b`, 'i').test(t));
  check('the active voice is the register, not the exception',
    saPassive.length <= Math.max(2, Math.floor(saParas.length * 0.3)),
    `${saPassive.length} of ${saParas.length} paragraphs`);

  // Point first is tested by what the rule FORBIDS, not by a list of approved
  // openers. An earlier version whitelisted "On", "The Plaintiff" and their
  // kind, and duly failed a pass on "The memorandum records that ..." and
  // "Since January 9, 2026 the Plaintiff has sought ...", both of which lead
  // with the fact. The failure mode is a paragraph that circles before it
  // lands: a subordinate clause, or throat clearing, ahead of the fact.
  const saCircling = saParas.filter(t => new RegExp(`^(?:Although|While|Whereas|Because|Given|Notwithstanding|In light of|In the circumstances|In circumstances|By way of background|As background|As a preliminary|There (?:was|were|is|are)|It (?:was|is|should|must|bears|would)|Notably|Significantly|Importantly|Critically|Tellingly|Of note)\\b`, 'i').test(t));
  check('no paragraph circles before it lands on the fact', saCircling.length === 0,
    saCircling.slice(0, 2).map(t => t.slice(0, 70)).join(' | '));

  // 6. House style. A document filed with the Tribunal says "the applicant",
  //    never the correspondence register "our client".
  check('no em-dashes', !html.includes('—'));
  const ourClient = (text.match(/our client/gi) ?? []).length;
  check('filed register: no "our client"', ourClient === 0, `${ourClient} occurrence(s)`);

  // The party is defined once in full, then carried by first name.
  check('the applicant is defined once, in full',
    /The Applicant, Margaret Okonjo \("Margaret"\)/.test(text), 'the defining form is missing');
  const defined = (text.match(/\("Margaret"\)/g) ?? []).length;
  check('the definition appears once only', defined === 1, `${defined} occurrence(s)`);
  const firstName = (text.match(/\bMargaret\b/g) ?? []).length;
  check('the first name carries the narrative', firstName >= 8, `${firstName} use(s)`);
  // The party label stays legitimate in the defining sentence, in a section
  // heading ("IMPACT ON THE APPLICANT") and in the filing line, so the test is
  // dominance rather than absence: the narrative must be carried by the name.
  const partyLabel = (text.match(/\bthe Applicant\b/gi) ?? []).length;
  check('the first name carries the narrative, not the party label',
    firstName >= partyLabel * 3, `${firstName} name use(s) against ${partyLabel} label use(s)`);

  // 7. The carry-over guard reports itself when civil relief survives.
  const flags = (gen.json.reviewFlags ?? doc.lawyerReviewFlags ?? []) as string[];
  const civilInText = /reasonable notice|Employment Standards Act|wrongful dismissal|severance pay|common law|Bardal/i.test(text);
  const civilFlagged = flags.some(f => /pleads the Code and the remedies under section 45\.2/.test(f));
  check('civil relief guard agrees with the text', civilInText === civilFlagged,
    `civil language in text=${civilInText}, flagged=${civilFlagged}`);
  if (civilInText) console.log('     note: civil language present; the guard flagged it for counsel.');

  if (process.env.SCHEDULE_A_DUMP) {
    await (await import('node:fs/promises')).writeFile(process.env.SCHEDULE_A_DUMP, html);
  }
  console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} check(s) FAILED`}`);
  console.log(`words=${words} paragraphs=${nums.length} cost=${String(gen.json.costUsd ?? doc.costUsd ?? 'n/a')}`);
  process.exit(failures === 0 ? 0 : 1);
}
main().catch(err => { console.error(err); process.exit(1); });
