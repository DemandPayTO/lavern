/**
 * Unit Tests — the Form 25A shell around the Reply.
 *
 * The properties: paragraphs are consecutively numbered no matter what the
 * model wrote; the general heading and title come from the shell in the
 * prescribed order; the Form 14A furniture of an originating process never
 * appears; furniture the model echoes anyway is dropped; the closing
 * carries the date line, the counsel block and the TO: block the form
 * prescribes.
 */

import { describe, it, expect } from 'vitest';
import { assembleReply, prepareReplyBody, buildReplyFrontMatter, buildReplyClosing } from '../../src/employment/reply-shell.js';
import type { ReplyShellInput } from '../../src/employment/reply-shell.js';

const SHELL: ReplyShellInput = {
  courtFileNumber: 'CV-26-00012345-0000',
  courtLocation: 'Toronto',
  plaintiffName: 'Kimberly Botsford',
  defendantName: 'Acme Widgets Inc.',
  lawyerName: 'Jordan Haworth',
  lawyerBlock: 'John Evans (LSO# 11111A)\nJordan Haworth (LSO# 22222B)',
  firmName: 'Evans Law Firm',
  firmAddress: '15 Prince Arthur Avenue, Toronto ON M5R 1B2',
};

const BODY = [
  '<p>The Plaintiff admits the allegations contained in paragraphs 1, 2 and 3 of the Statement of Defence.</p>',
  '<p>The Plaintiff denies the allegations contained in paragraphs 4 to 19 of the Statement of Defence.</p>',
  '<p>In reply to paragraph 14 of the Statement of Defence, the Plaintiff made reasonable efforts to mitigate.</p>',
].join('\n');

describe('assembleReply', () => {
  it('numbers every pleading paragraph consecutively from 1', () => {
    const html = assembleReply(BODY, SHELL);
    expect(html).toContain('>1. The Plaintiff admits');
    expect(html).toContain('>2. The Plaintiff denies');
    expect(html).toContain('>3. In reply to paragraph 14');
    expect(html).not.toContain('{{para}}');
  });

  it('renumbers even when the model wrote its own numbers', () => {
    const numbered = '<p>1. The Plaintiff admits nothing.</p>\n<p>7) The Plaintiff denies everything.</p>';
    const html = assembleReply(numbered, SHELL);
    expect(html).toContain('>1. The Plaintiff admits nothing.');
    expect(html).toContain('>2. The Plaintiff denies everything.');
    expect(html).not.toContain('>7)');
  });

  it('puts the general heading in the prescribed order, then the title REPLY', () => {
    const html = assembleReply(BODY, SHELL);
    const order = [
      'Court File No.: CV-26-00012345-0000',
      'ONTARIO',
      'SUPERIOR COURT OF JUSTICE',
      'B E T W E E N:',
      'KIMBERLY BOTSFORD',
      'Plaintiff',
      '- and -',
      'ACME WIDGETS INC.',
      'Defendant',
      '<u>REPLY</u>',
    ];
    let at = -1;
    for (const piece of order) {
      const next = html.indexOf(piece, at + 1);
      expect(next, `${piece} appears after the previous piece`).toBeGreaterThan(at);
      at = next;
    }
    // The title precedes the first numbered paragraph.
    expect(html.indexOf('<u>REPLY</u>')).toBeLessThan(html.indexOf('>1. '));
  });

  it('carries none of the originating-process furniture', () => {
    const html = assembleReply(BODY, SHELL);
    expect(html).not.toMatch(/TO THE DEFENDANT/i);
    expect(html).not.toMatch(/Local Registrar/i);
    expect(html).not.toMatch(/WITHIN TWENTY DAYS/i);
  });

  it('closes with the date line, the counsel block, and the TO: block, in that order', () => {
    const html = assembleReply(BODY, SHELL);
    const date = html.indexOf('Date: ');
    const firm = html.indexOf('Evans Law Firm', date);
    const evans = html.indexOf('John Evans (LSO# 11111A)', date);
    const to = html.indexOf('<strong>TO:</strong>');
    expect(date).toBeGreaterThan(html.indexOf('>3. '));
    expect(firm).toBeGreaterThan(date);
    expect(evans).toBeGreaterThan(firm);
    expect(to).toBeGreaterThan(evans);
    expect(html).toContain('Jordan Haworth (LSO# 22222B)');
    expect(html).toContain('Lawyers for the Plaintiff');
  });

  it('includes the backsheet tail after <hr> with the REPLY title', () => {
    const html = assembleReply(BODY, SHELL);
    const hr = html.indexOf('<hr>');
    expect(hr).toBeGreaterThan(-1);
    const tail = html.slice(hr);
    expect(tail).toContain('KIMBERLY BOTSFORD v. ACME WIDGETS INC.');
    expect(tail).toContain('PROCEEDING COMMENCED AT TORONTO');
    expect(tail).toContain('<u>REPLY</u>');
  });

  it('falls back to the single lawyer name when no block is set, and to placeholders when the file number is missing', () => {
    const html = assembleReply(BODY, { ...SHELL, lawyerBlock: undefined, courtFileNumber: undefined });
    expect(html).toContain('Jordan Haworth');
    expect(html).not.toContain('LSO# 11111A');
    expect(html).toContain('[LAWYER: court file number]');
  });
});

describe('prepareReplyBody', () => {
  it('drops the furniture the model was told not to write', () => {
    const echoed = [
      '<h1>REPLY</h1>',
      '<p class="centre">ONTARIO</p>',
      '<p>SUPERIOR COURT OF JUSTICE</p>',
      '<p>B E T W E E N:</p>',
      '<p>KIMBERLY BOTSFORD</p>',
      '<p>Plaintiff</p>',
      '<p>- and -</p>',
      '<p>Defendant</p>',
      '<p>The Plaintiff denies the allegations contained in paragraphs 4 to 19 of the Statement of Defence.</p>',
      '<p>Date: ____________</p>',
      '<p>TO: Smith LLP, Lawyers for the Defendant</p>',
      '<p>Lawyers for the Plaintiff</p>',
    ].join('\n');
    const body = prepareReplyBody(echoed, ['Kimberly Botsford', 'Acme Widgets Inc.']);
    const paras = body.match(/<p[^>]*>/g) ?? [];
    expect(paras.length).toBe(1); // only the pleading paragraph survives; the echoed party name line is dropped by exact match
    expect(body).toContain('The Plaintiff denies');
    expect(body).not.toMatch(/SUPERIOR COURT/);
    expect(body).not.toMatch(/Date:/);
    expect(body).not.toMatch(/TO: Smith/);
  });

  it('turns list items into pleading paragraphs and keeps no heading tags', () => {
    const listy = '<h2>Response to New Matters</h2><ol><li>The Plaintiff mitigated.</li><li>The limitation defence fails.</li></ol>';
    const body = prepareReplyBody(listy);
    expect(body).not.toMatch(/<h[1-6]/);
    expect(body).not.toMatch(/<[ou]l|<li/);
    expect(body).toContain('{{para}}. The Plaintiff mitigated.');
    expect(body).toContain('{{para}}. The limitation defence fails.');
    expect(body).toContain('Response to New Matters');
  });

  it('does not touch pleading paragraphs that merely mention Ontario or begin with To', () => {
    const body = prepareReplyBody('<p>To the extent the Defence alleges cause, the Plaintiff worked in Ontario without discipline.</p>');
    expect(body).toContain('{{para}}. To the extent the Defence alleges cause');
  });

  it('strips a bolded model number without losing the bold text', () => {
    const body = prepareReplyBody('<p><strong>3. </strong>The Plaintiff denies paragraph 9.</p>');
    expect(body).toContain('{{para}}. <strong>');
    expect(body).not.toMatch(/3\.\s*<\/strong>/);
  });
});

describe('buildReplyFrontMatter and buildReplyClosing escape their inputs', () => {
  it('escapes HTML in party and firm names', () => {
    const front = buildReplyFrontMatter({ ...SHELL, plaintiffName: 'A <script> B' });
    expect(front).toContain('A &lt;SCRIPT&gt; B');
    const closing = buildReplyClosing({ ...SHELL, firmName: 'Evans & Co <b>' });
    expect(closing).toContain('Evans &amp; Co &lt;b&gt;');
  });
});
