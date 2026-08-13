/**
 * The court shell of a Reply (Form 25A): everything on the page that is
 * form rather than pleading.
 *
 * Form 25A (RCP-25A-E, 2007/07) prescribes the whole document: the general
 * heading, the title REPLY, then separate consecutively numbered
 * paragraphs. The form's own first three paragraphs are canonical: the
 * plaintiff admits, denies, and has no knowledge in respect of the
 * allegations contained in named paragraphs of the statement of defence.
 * After the paragraphs come the date, the name, address and telephone
 * number of the plaintiff's lawyer, and TO: the name and address of the
 * defendant's lawyer. There is no notice text and no registrar block: a
 * Reply is not originating process, so the Form 14A furniture the claim
 * carries does not belong here.
 *
 * The model writes only the pleading paragraphs. Numbering is mechanical
 * ({{para}} markers resolved document-wide by numberSocParagraphs), so the
 * paragraphs are consecutively numbered every time, not merely when the
 * model remembers. The pilot's first generated Reply arrived as a sheet of
 * unnumbered prose; this module is why that cannot happen again.
 *
 * Deterministic: no model call.
 */

import { numberSocParagraphs } from './soc-nodes.js';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

export interface ReplyShellInput {
  courtFileNumber?: string;
  courtLocation?: string;
  plaintiffName: string;
  defendantName: string;
  lawyerName: string;
  firmName: string;
  firmAddress?: string;
  /**
   * The lawyer block exactly as it should appear on court documents, one
   * lawyer per line. When present it replaces the single lawyerName line.
   */
  lawyerBlock?: string;
}

/** The general heading and the title: everything above the first numbered paragraph. */
export function buildReplyFrontMatter(input: ReplyShellInput): string {
  const fileNo = input.courtFileNumber?.trim()
    ? esc(input.courtFileNumber)
    : '[LAWYER: court file number]';

  return [
    `<p class="right">Court File No.: ${fileNo}</p>`,
    '<p class="centre"><strong>ONTARIO<br>SUPERIOR COURT OF JUSTICE</strong></p>',
    '<p><strong>B E T W E E N:</strong></p>',
    `<p class="centre"><strong>${esc(input.plaintiffName.toUpperCase())}</strong></p>`,
    '<p class="centre">Plaintiff</p>',
    '<p class="centre">- and -</p>',
    `<p class="centre"><strong>${esc(input.defendantName.toUpperCase())}</strong></p>`,
    '<p class="centre">Defendant</p>',
    '<p class="centre"><strong><u>REPLY</u></strong></p>',
  ].join('\n');
}

function contactBlock(input: ReplyShellInput): string {
  const lawyerLines = input.lawyerBlock?.trim()
    ? input.lawyerBlock.trim().split(/\r?\n/).map(l => esc(l.trim())).filter(Boolean)
    : [esc(input.lawyerName)];
  return [
    `<strong>${esc(input.firmName)}</strong>`,
    input.firmAddress ? esc(input.firmAddress) : '[LAWYER: address and telephone number]',
    ...lawyerLines,
    'Lawyers for the Plaintiff',
  ].join('<br>');
}

/**
 * Everything below the last numbered paragraph: the date, the plaintiff's
 * lawyer block, the TO: block, and the backsheet text the HTML preview
 * shows (the Word export cuts the tail after <hr> and builds the real
 * landscape Form 4C page from the stored backsheet instead).
 */
export function buildReplyClosing(input: ReplyShellInput): string {
  const contact = contactBlock(input);
  const city = (input.courtLocation ?? 'Toronto').toUpperCase();
  return [
    '<p>Date: _______________________</p>',
    `<p>${contact}</p>`,
    `<p><strong>TO:</strong> [LAWYER: name and address of the Defendant's lawyer]</p>`,
    '<hr>',
    `<p class="centre">${esc(input.plaintiffName.toUpperCase())} v. ${esc(input.defendantName.toUpperCase())}</p>`,
    `<p class="right">Court File No.: ${input.courtFileNumber?.trim() ? esc(input.courtFileNumber) : '_______________'}</p>`,
    '<p class="centre"><strong>ONTARIO<br>SUPERIOR COURT OF JUSTICE</strong></p>',
    `<p class="centre">PROCEEDING COMMENCED AT ${esc(city)}</p>`,
    '<p class="centre"><strong><u>REPLY</u></strong></p>',
    `<p>${contact}</p>`,
  ].join('\n');
}

/**
 * Paragraphs the model was told not to write but sometimes writes anyway:
 * heading and signature furniture the shell already owns. Matching is
 * against the paragraph's full text, so a pleading paragraph that merely
 * begins with "To" or mentions Ontario is never touched.
 */
const FURNITURE_LINE = new RegExp(
  '^(?:'
  + 'court file no\\.?:?.*'
  + '|ontario'
  + '|superior court of justice'
  + '|ontario\\s*superior court of justice'
  + '|b\\s*e\\s*t\\s*w\\s*e\\s*e\\s*n:?'
  + '|between:?'
  + '|plaintiffs?'
  + '|defendants?'
  + '|-?\\s*and\\s*-?'
  + '|reply'
  + '|reply \\(form 25a\\)'
  + '|form 25a'
  + '|date:?\\s*_*'
  + '|\\(date\\)'
  + '|to:\\s.{0,200}'
  + '|lawyers? for the plaintiffs?'
  + '|_{3,}'
  + ')$',
  'i',
);

/**
 * Normalize the model's pleading body to bare paragraphs ready for
 * mechanical numbering: headings and list wrappers become paragraphs or
 * disappear, furniture echoes are dropped, and any numbers the model wrote
 * itself are stripped so {{para}} markers can own the count.
 */
export function prepareReplyBody(html: string, dropExactLines: string[] = []): string {
  const exact = new Set(dropExactLines.map(s => s.trim().toLowerCase()).filter(Boolean));
  let body = html
    // Headings carry no pleading content a Reply may keep; a heading that
    // is not furniture (rare) survives as an emphasised paragraph.
    .replace(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi, '<p><strong>$1</strong></p>')
    // List items are paragraphs in a pleading; the wrappers go.
    .replace(/<li[^>]*>([\s\S]*?)<\/li>/gi, '<p>$1</p>')
    .replace(/<\/?(?:ol|ul)[^>]*>/gi, '');

  // Drop furniture echoes and empty paragraphs.
  body = body.replace(/<p[^>]*>([\s\S]*?)<\/p>/gi, (whole, inner: string) => {
    const text = inner.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    if (text === '' || FURNITURE_LINE.test(text) || exact.has(text.toLowerCase())) return '';
    return whole;
  });

  // Strip model-written paragraph numbers and mark for mechanical numbering.
  body = body.replace(/<p([^>]*)>\s*(?:<strong>\s*)?(?:\d+[.)]\s*)/gi, (m, attrs: string) => {
    const keepStrong = /<strong>/i.test(m) ? '<strong>' : '';
    return `<p${attrs}>${keepStrong}`;
  });
  body = body.replace(/<p([^>]*)>\s*/gi, '<p$1>{{para}}. ');

  return body.replace(/\n{3,}/g, '\n\n').trim();
}

/** The finished Reply: shell, consecutively numbered paragraphs, closing. */
export function assembleReply(bodyHtml: string, shell: ReplyShellInput): string {
  const body = numberSocParagraphs(prepareReplyBody(bodyHtml, [shell.plaintiffName, shell.defendantName]));
  return [buildReplyFrontMatter(shell), body, buildReplyClosing(shell)].join('\n');
}
