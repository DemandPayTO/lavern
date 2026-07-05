/**
 * Feature Test — canon library and citation verification, against a LOCAL
 * server. Deterministic and $0: uploads a fixture text for one canon case,
 * exercises the verify-citations endpoint, and restores the canon library
 * to its prior state afterwards (a fixture must never masquerade as the
 * real text of a decision).
 *
 * Usage: npm run serve   # in one terminal
 *        npx tsx scripts/feature-test-canon.ts
 */

import fs from 'node:fs';
import path from 'node:path';

const BASE = process.env.EVAL_BASE_URL ?? 'http://localhost:3000';
const CANON_DIR = path.join(process.cwd(), 'data', 'canon-cases');
const FIXTURE_KEYWORD = 'waksdale';

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

function snapshotCanonState(): { file: string | null; manifest: string | null } {
  const file = path.join(CANON_DIR, `${FIXTURE_KEYWORD}.txt`);
  return {
    file: fs.existsSync(file) ? fs.readFileSync(file, 'utf-8') : null,
    manifest: fs.existsSync(path.join(CANON_DIR, 'manifest.json')) ? fs.readFileSync(path.join(CANON_DIR, 'manifest.json'), 'utf-8') : null,
  };
}

function restoreCanonState(snap: { file: string | null; manifest: string | null }) {
  const file = path.join(CANON_DIR, `${FIXTURE_KEYWORD}.txt`);
  if (snap.file === null) fs.rmSync(file, { force: true });
  else fs.writeFileSync(file, snap.file, 'utf-8');
  const manifest = path.join(CANON_DIR, 'manifest.json');
  if (snap.manifest === null) fs.rmSync(manifest, { force: true });
  else fs.writeFileSync(manifest, snap.manifest, 'utf-8');
}

const FIXTURE_TEXT = `Waksdale v. Swegon North America Inc., 2020 ONCA 391 (test fixture)
[1] The issue on appeal concerns the enforceability of termination provisions in an employment agreement.
[2] ${'Context paragraph of the fixture decision. '.repeat(5)}
[3] An employment agreement must be interpreted as a whole and not on a piecemeal basis.
[4] ${'Further fixture reasoning appears here for length. '.repeat(5)}
[5] The mischief associated with an illegal provision is readily identified.
${'Trailing fixture text for the minimum length requirement. '.repeat(10)}`;

async function main() {
  const snap = snapshotCanonState();
  try {
    // ── Library listing ────────────────────────────────────────────────
    const list0 = await api('GET', '/api/employment/canon-texts');
    const canon = (list0.json.canon ?? []) as Array<{ keyword: string; name: string; textOnFile: boolean }>;
    check('canon listing returns the canon with on-file flags', list0.status === 200 && canon.length > 20
      && canon.every(c => typeof c.textOnFile === 'boolean'));

    // ── Upload validation ──────────────────────────────────────────────
    const badKey = await api('POST', '/api/employment/canon-texts', { keyword: 'not-a-case', text: FIXTURE_TEXT });
    const badText = await api('POST', '/api/employment/canon-texts', { keyword: FIXTURE_KEYWORD, text: 'short' });
    check('upload rejects unknown keywords and short texts', badKey.status === 400 && badText.status === 400);

    // ── Upload the fixture ─────────────────────────────────────────────
    const up = await api('POST', '/api/employment/canon-texts', {
      keyword: FIXTURE_KEYWORD, text: FIXTURE_TEXT, source: '[FEATURE-TEST] fixture',
    });
    const meta = up.json.meta as Record<string, unknown> | undefined;
    check('upload stores text with provenance', up.status === 200
      && typeof meta?.sha256 === 'string' && meta?.keyword === FIXTURE_KEYWORD);

    const list1 = await api('GET', '/api/employment/canon-texts');
    const wk = ((list1.json.canon ?? []) as Array<{ keyword: string; textOnFile: boolean }>).find(c => c.keyword === FIXTURE_KEYWORD);
    check('listing shows the text on file', wk?.textOnFile === true);

    // ── Verification endpoint ──────────────────────────────────────────
    const good = await api('POST', '/api/employment/verify-citations', {
      html: `<p>In Waksdale v Swegon North America Inc, 2020 ONCA 391, the Court held that
        "An employment agreement must be interpreted as a whole and not on a piecemeal basis" (at para 3).</p>`,
    });
    check('genuine quotation with valid pinpoint passes clean', good.status === 200 && good.json.clean === true,
      JSON.stringify(good.json.flags));

    const fabricated = await api('POST', '/api/employment/verify-citations', {
      html: `<p>Waksdale v Swegon North America Inc states that "employers must always pay twenty-four months of severance whenever an employee requests it politely".</p>`,
    });
    const fabFlags = (fabricated.json.flags ?? []) as string[];
    check('fabricated quotation is flagged', fabricated.json.clean === false
      && fabFlags.some(f => f.includes('not found in the stored full text')));

    const badPin = await api('POST', '/api/employment/verify-citations', {
      html: '<p>See Waksdale v Swegon North America Inc at para 88.</p>',
    });
    check('invalid pinpoint is flagged', ((badPin.json.flags ?? []) as string[]).some(f => f.includes('paragraph 88')));

    const unknownCase = await api('POST', '/api/employment/verify-citations', {
      html: '<p>As held in Fabricated v Nonexistent Corp, 2021 ONCA 999, the claim succeeds.</p>',
    });
    check('unknown case is flagged (canon check)', ((unknownCase.json.flags ?? []) as string[]).some(f => f.includes('outside the known canon')));

    const ownParties = await api('POST', '/api/employment/verify-citations', {
      html: '<p>BETWEEN: Iris Valdez v Test Employer Corp</p>',
      excludeParties: ['Iris Valdez', 'Test Employer Corp'],
    });
    check('own style of cause is not flagged', ownParties.json.clean === true, JSON.stringify(ownParties.json.flags));

    const wrongCite = await api('POST', '/api/employment/verify-citations', {
      html: '<p>Waksdale v Swegon North America Inc, 2019 ONCA 123.</p>',
    });
    check('wrong citation for a canon case is flagged', ((wrongCite.json.flags ?? []) as string[]).some(f => f.includes('Citation mismatch')));
  } finally {
    restoreCanonState(snap);
  }

  console.log(failures === 0 ? '\nCLEAN PASS' : `\n${failures} FAILURE(S)`);
  process.exit(failures === 0 ? 0 : 1);
}

main().catch(err => {
  console.error('Feature test crashed:', err);
  process.exit(1);
});
