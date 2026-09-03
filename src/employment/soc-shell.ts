/**
 * The court shell of a Statement of Claim: everything on the page that is
 * form rather than pleading.
 *
 * The general heading, the style of cause, the Form 14A notice to the
 * defendant, the registrar's issue block and the lawyer of record are
 * prescribed. A model writing them will usually get them right and
 * occasionally not, and "occasionally not" on the face of a court document
 * is a claim the registrar bounces. So they are assembled here, and the
 * model never touches them.
 *
 * The 14A notice text is pinned as an asset (form-14a-notice.txt), the
 * same discipline as the Form 14C notice: injected verbatim, never
 * paraphrased. The Rules were amended in early 2026 with new mandatory
 * forms phasing in, so every generated claim carries a standing flag to
 * verify the notice against the current form before issuing.
 *
 * DemandPay's shell was built for self-represented plaintiffs in the Small
 * Claims Court; this one issues in the Superior Court under a lawyer of
 * record. The style of cause and Rule 76 notice carry over; the notice
 * block and lawyer of record are what Starling adds.
 *
 * Deterministic: no model call.
 */

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const __dirname = path.dirname(fileURLToPath(import.meta.url));

let noticeCache: string | null = null;

/** The pinned Form 14A notice, as HTML paragraphs. */
export function form14aNoticeHtml(): string {
  if (noticeCache === null) {
    const raw = fs.readFileSync(path.resolve(__dirname, '../assets/forms/form-14a-notice.txt'), 'utf8');
    noticeCache = raw
      .split(/\n\s*\n/)
      .map(p => p.trim())
      .filter(Boolean)
      .map(p => `<p>${esc(p)}</p>`)
      .join('\n');
  }
  return noticeCache;
}

export interface SocShellInput {
  courtFileNumber?: string;
  courtLocation: string;
  plaintiffName: string;
  defendantName: string;
  procedureType: 'simplified' | 'ordinary' | 'small_claims';
  /** An action carries a Statement of Claim; an application carries a Notice
   *  of Application, with the parties named accordingly. */
  proceedingForm?: 'action' | 'application';
  lawyerName: string;
  firmName: string;
  firmAddress?: string;
  lsoNumber?: string;
  /**
   * The lawyer block exactly as it should appear on court documents, one
   * lawyer per line (e.g. "John Evans (LSO# 12345A)"). When present it
   * replaces the single lawyerName line on the cover and backsheet.
   */
  lawyerBlock?: string;
}

/**
 * Everything above the first pleaded paragraph: general heading, style of
 * cause, the 14A notice, the registrar's issue block, and the address for
 * service of the defendant.
 */
export function buildSocFrontMatter(input: SocShellInput): string {
  const application = input.proceedingForm === 'application';
  const fileNo = input.courtFileNumber?.trim()
    ? esc(input.courtFileNumber)
    : '[LAWYER: assigned on issuance]';

  const parts: string[] = [
    `<p class="right">Court File No.: ${fileNo}</p>`,
    '<p class="centre"><strong>ONTARIO<br>SUPERIOR COURT OF JUSTICE</strong></p>',
    '<p><strong>B E T W E E N:</strong></p>',
    `<p class="centre"><strong>${esc(input.plaintiffName.toUpperCase())}</strong></p>`,
    `<p class="centre">${application ? 'Applicant' : 'Plaintiff'}</p>`,
    '<p class="centre">- and -</p>',
    `<p class="centre"><strong>${esc(input.defendantName.toUpperCase())}</strong></p>`,
    `<p class="centre">${application ? 'Respondent' : 'Defendant'}</p>`,
  ];

  parts.push(`<p class="centre"><strong><u>${application ? 'NOTICE OF APPLICATION' : 'STATEMENT OF CLAIM'}</u></strong></p>`);

  // The official form carries its own notice to the responding party. For the
  // claim that text is pinned; for the application it is left to the form the
  // lawyer files on, exactly as the Notice of Action does.
  parts.push(application
    ? '<p>[LAWYER: the notice to the respondent, the hearing date and the place of hearing are carried by Form 14E; complete them on the official form.]</p>'
    : form14aNoticeHtml());

  parts.push(
    '<p>Date: _______________________</p>',
    '<p>Issued by: _______________________<br>Local Registrar</p>',
    `<p>Address of court office:<br>[LAWYER: address of the court office at ${esc(input.courtLocation)}]</p>`,
    `<p><strong>TO:</strong> ${esc(input.defendantName)}<br>[LAWYER: address for service of the ${application ? 'Respondent' : 'Defendant'}]</p>`,
  );

  if (input.procedureType === 'simplified' && !application) {
    parts.push('<p><strong>THIS ACTION IS BROUGHT AGAINST YOU UNDER THE SIMPLIFIED PROCEDURE PROVIDED IN RULE 76 OF THE RULES OF CIVIL PROCEDURE.</strong></p>');
  }

  return parts.join('\n');
}

/** The lawyer of record and the backsheet. */
export function buildSocClosing(input: SocShellInput): string {
  // The LSO number appears once: from the block or the profile, never
  // repeated because the composed address string also carries it.
  const addressCarriesLso = /LSO#/i.test(input.firmAddress ?? '');
  const lawyerLines = input.lawyerBlock?.trim()
    ? input.lawyerBlock.trim().split(/\r?\n/).map(l => esc(l.trim())).filter(Boolean)
    : [`${esc(input.lawyerName)}${input.lsoNumber && !addressCarriesLso ? ` (LSO# ${esc(input.lsoNumber)})` : input.lsoNumber || addressCarriesLso ? '' : ' [LAWYER: LSO number]'}`];
  const contact = [
    `<strong>${esc(input.firmName)}</strong>`,
    input.firmAddress ? esc(input.firmAddress) : '[LAWYER: address for service]',
    ...lawyerLines,
    lawyerLines.length > 1 ? 'Lawyers for the Plaintiff' : 'Lawyer for the Plaintiff',
  ].join('<br>');

  return [
    `<p>${contact}</p>`,
    // The backsheet, Form 4C: last page, landscape orientation is the
    // lawyer's finishing step in Word; the content is what matters here.
    '<hr>',
    `<p class="centre">${esc(input.plaintiffName.toUpperCase())} v. ${esc(input.defendantName.toUpperCase())}</p>`,
    `<p class="right">Court File No.: ${input.courtFileNumber?.trim() ? esc(input.courtFileNumber) : '_______________'}</p>`,
    '<p class="centre"><strong>ONTARIO<br>SUPERIOR COURT OF JUSTICE</strong></p>',
    `<p class="centre">PROCEEDING COMMENCED AT ${esc(input.courtLocation.toUpperCase())}</p>`,
    `<p class="centre"><strong><u>${input.proceedingForm === 'application' ? 'NOTICE OF APPLICATION' : 'STATEMENT OF CLAIM'}</u></strong></p>`,
    `<p>${contact}</p>`,
  ].join('\n');
}

/** The standing verification flag every generated claim carries. */
export const FORM_14A_CURRENCY_FLAG =
  'The notice to the defendant is the pinned Form 14A text. The Rules were amended in 2026 with new forms phasing in: verify the notice and the costs figures against the current form before issuing.';
