/**
 * Unit Tests — canon full-text verification
 * (src/employment/canon-store.ts, src/employment/canon-verifier.ts)
 *
 * A real case quoted with words it never used, or cited to a paragraph
 * it does not have, must be flagged. Quotations outside a canon context
 * (for example, contract language from the intake) must never be
 * checked against case reports.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { saveCanonText, getCanonText, listCanonTexts, _resetCanonCache } from '../../src/employment/canon-store.js';
import { checkCanonTextIntegrity } from '../../src/employment/canon-verifier.js';

let dir: string;

const WAKSDALE_TEXT = `Waksdale v. Swegon North America Inc., 2020 ONCA 391
[1] The issue on appeal is the enforceability of the termination provisions in an employment agreement.
[2] ${'The appellant submits further context here. '.repeat(4)}
[3] An employment agreement must be interpreted as a whole and not on a piecemeal basis.
[4] ${'Additional reasoning of the court appears in this paragraph. '.repeat(4)}
[5] The mischief associated with an illegal provision is readily identified.
${'Concluding administrative text of the decision. '.repeat(12)}`;

beforeAll(() => {
  dir = fs.mkdtempSync(path.join(os.tmpdir(), 'canon-test-'));
  process.env.LAVERN_CANON_DIR = dir;
  _resetCanonCache();
});

afterAll(() => {
  delete process.env.LAVERN_CANON_DIR;
  _resetCanonCache();
  fs.rmSync(dir, { recursive: true, force: true });
});

describe('canon-store', () => {
  it('saves and reads a canon text with provenance', () => {
    const meta = saveCanonText('waksdale', WAKSDALE_TEXT, 'test fixture');
    expect(meta.name).toContain('Waksdale');
    expect(meta.sha256).toHaveLength(64);
    expect(getCanonText('waksdale')).toContain('piecemeal basis');
    expect(listCanonTexts().some(t => t.keyword === 'waksdale')).toBe(true);
  });

  it('rejects keywords outside the canon and texts that are too short', () => {
    expect(() => saveCanonText('not-a-case', WAKSDALE_TEXT, 'x')).toThrow(/not in the citation canon/i);
    expect(() => saveCanonText('hryniak', 'too short', 'x')).toThrow(/too short/i);
  });
});

describe('checkCanonTextIntegrity', () => {
  it('passes a genuine quotation with a valid pinpoint', () => {
    const html = `<p>In Waksdale v Swegon North America Inc, 2020 ONCA 391, the Court held that
      "An employment agreement must be interpreted as a whole and not on a piecemeal basis" (at para 3).</p>`;
    expect(checkCanonTextIntegrity(html)).toEqual([]);
  });

  it('flags a fabricated quotation attributed to a stored case', () => {
    const html = `<p>As stated in Waksdale v Swegon North America Inc:
      "termination clauses are always unenforceable whenever any employee objects to them in writing".</p>`;
    const flags = checkCanonTextIntegrity(html);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('was not found in the stored full text');
    expect(flags[0]).toContain('Waksdale');
  });

  it('flags a pinpoint to a paragraph the case does not have', () => {
    const html = `<p>Waksdale v Swegon North America Inc holds this at para 99.</p>`;
    const flags = checkCanonTextIntegrity(html);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('paragraph 99');
  });

  it('checks pinpoint ranges at both ends', () => {
    const ok = checkCanonTextIntegrity('<p>See Waksdale v Swegon North America Inc at paras 1-5.</p>');
    expect(ok).toEqual([]);
    const bad = checkCanonTextIntegrity('<p>See Waksdale v Swegon North America Inc at paras 3-40.</p>');
    expect(bad).toHaveLength(1);
  });

  it('tolerates curly quotes, whitespace, and ellipses in genuine quotations', () => {
    const html = `<p>Waksdale v Swegon North America Inc: “An employment agreement must be
      interpreted   as a whole ... not on a piecemeal basis”.</p>`;
    expect(checkCanonTextIntegrity(html)).toEqual([]);
  });

  it('asks for the text when a quotation cites a canon case that is not on file', () => {
    const html = `<p>In Hryniak v Mauldin, 2014 SCC 7, the Court said
      "a culture shift is required in order to create an environment promoting timely and affordable access".</p>`;
    const flags = checkCanonTextIntegrity(html);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('not on file');
    expect(flags[0]).toContain('Hryniak');
  });

  it('ignores quotations with no canon case in the same paragraph', () => {
    const html = `<p>The termination clause provides that "the Company may terminate your employment
      at any time on providing the minimum notice required by the Employment Standards Act".</p>
      <p>That clause is unenforceable under Waksdale v Swegon North America Inc.</p>`;
    expect(checkCanonTextIntegrity(html)).toEqual([]);
  });
});
