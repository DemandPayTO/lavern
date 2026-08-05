/**
 * Demand letter furniture and figures — the parts that must not be
 * written by a model.
 *
 * Two problems this solves, both learned from the mediation brief:
 *
 * THE NUMBERS. The letter's figures were described to the model in the
 * prompt and it wrote them into prose. A transposed digit in a served
 * demand is the number opposing counsel holds the client to, so the
 * itemisation is built here from the matter record instead, with the
 * model writing only the narrative around it.
 *
 * THE FURNITURE. The salutation, the "Re:" block and the signature block
 * are fixed forms that recur in every letter. A model that learns them
 * from the firm's precedents reproduces them mid-letter (as it did with
 * the brief's cover and sign-off), so they are assembled here and any
 * echo is scrubbed.
 *
 * Deterministic: no model call.
 */

import type { EmploymentIntakeData, IntakeAnalysisResult } from '../types/employment-intake.js';

export const esc = (s: unknown): string =>
  String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

const cad = (n: number): string => `$${Math.round(n).toLocaleString('en-CA')}`;

// ── The letterhead-adjacent furniture ────────────────────────────────────

export interface DemandFurnitureInput {
  intake: EmploymentIntakeData;
  lawyerName: string;
  firmName: string;
  firmAddress?: string;
  /** Who the letter goes to; the employer when counsel is unknown. */
  recipientName?: string;
  fileNumber?: string;
}

/**
 * Salutation and the "Re:" block. Addressed to opposing counsel when
 * known, to the employer otherwise, and never invented: an unknown
 * recipient is marked for the lawyer.
 */
export function buildDemandOpening(input: DemandFurnitureInput): string {
  const client = [input.intake.client_first_name, input.intake.client_last_name]
    .filter(Boolean).join(' ') || '[LAWYER: client name]';
  const employer = input.intake.employer_legal_name
    ?? input.intake.employer_operating_name ?? '[LAWYER: employer name]';
  const recipient = input.recipientName?.trim();
  return [
    '<p><strong>WITHOUT PREJUDICE</strong></p>',
    recipient
      ? `<p>${esc(recipient)}</p>`
      : '<p>[LAWYER: name and address of the recipient, counsel where known]</p>',
    `<p><strong>Re: ${esc(client)} and ${esc(employer)}</strong>${input.fileNumber ? `<br>Our File No.: ${esc(input.fileNumber)}` : ''}</p>`,
    `<p>Dear ${recipient ? 'Counsel' : '[LAWYER: salutation]'}:</p>`,
  ].join('\n');
}

/** The signature block, identical on every letter the firm sends. */
export function buildDemandSignature(input: DemandFurnitureInput): string {
  return [
    '<p>Yours truly,</p>',
    `<p><strong>${esc(input.firmName || '[LAWYER: firm]')}</strong></p>`,
    `<p>${esc(input.lawyerName || '[LAWYER: name]')}<br>Barrister and Solicitor${input.firmAddress ? `<br>${esc(input.firmAddress)}` : ''}</p>`,
  ].join('\n');
}

/**
 * Remove furniture the model wrote anyway. Same failure as the brief:
 * a style profile learns the firm's salutation and sign-off because they
 * recur in every precedent, then reproduces them inside the body.
 */
export function scrubDemandBody(html: string): string {
  const FURNITURE = [
    /^without prejudice\.?$/i,
    /^dear\b/i,
    /^re:\s/i,
    /^yours (truly|very truly|sincerely)/i,
    /^barrister and solicitor/i,
    /^our file no/i,
  ];
  const withoutFurniture = html.replace(/<p(\s[^>]*)?>([\s\S]*?)<\/p>/gi, (match, _attrs, inner) => {
    const text = String(inner).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
    return FURNITURE.some(re => re.test(text)) ? '' : match;
  });
  return dropEmptyHeadings(withoutFurniture);
}

/**
 * Remove a heading with nothing under it.
 *
 * The model writes the section headings it was given and, where it was
 * told the content is supplied elsewhere, leaves the heading standing over
 * an empty section. In a live run that produced a bare "Damages
 * Quantification" heading immediately above the table's own. An empty
 * heading is a defect on its own terms, so it goes here rather than in the
 * table insertion.
 */
function dropEmptyHeadings(html: string): string {
  // The heading's own text must stop at its FIRST closing tag. A lazy
  // [\s\S]*? does not: forced to satisfy the "next heading" lookahead, it
  // backtracks into a longer match and swallows the section before it.
  return html.replace(
    /<h([1-6])(?:\s[^>]*)?>(?:(?!<\/h\1>)[\s\S])*<\/h\1>\s*(?=<h[1-6][\s>]|$)/gi,
    '',
  );
}

/**
 * Put the damages table in the letter.
 *
 * Under the model's own damages heading where it wrote one (without
 * repeating the heading), otherwise above the Demand section so the letter
 * reads itemisation-then-demand, otherwise at the end.
 *
 * The replacement is always a FUNCTION. The table is full of dollar
 * amounts, and "$12,000" inside a replacement STRING is read as a
 * backreference, which in a live run corrupted the figures to
 * "(Demand2,000)" and duplicated the matched heading.
 */
export function insertDamagesTable(body: string, table: string): string {
  if (!table) return body;

  const damagesHeading = /<h2(\s[^>]*)?>\s*(damages[^<]*|quantification[^<]*)<\/h2>/i;
  if (damagesHeading.test(body)) {
    const tableOnly = table.replace(/^<h2[^>]*>[\s\S]*?<\/h2>\s*/i, '');
    return body.replace(damagesHeading, match => `${match}\n${tableOnly}`);
  }

  const demandHeading = /<h2(\s[^>]*)?>\s*Demand\s*<\/h2>/i;
  if (demandHeading.test(body)) {
    return body.replace(demandHeading, match => `${table}\n${match}`);
  }

  return `${body}\n${table}`;
}

// ── The figures ──────────────────────────────────────────────────────────

export interface DemandDamagesInput {
  intake: EmploymentIntakeData;
  analysis: IntakeAnalysisResult;
  /** Heads the lawyer chose, when they overrode the analysis. */
  heads?: Array<{ label: string; amount?: number | null; basis?: string }>;
  /** Amounts the employer has already paid, netted off the total. */
  amountsPaid?: Array<{ label: string; amount: number }>;
  /** Mitigation earnings to date, netted off the total. */
  mitigationEarnings?: number | null;
  demandAmount: number;
}

/**
 * The itemised damages table, built from the record.
 *
 * Netting is done here rather than flagged for the lawyer to do by hand:
 * a demand that ignores what has already been paid invites the reply that
 * the letter is unserious, and the arithmetic is not a matter of judgment.
 */
export function buildDemandDamagesTable(input: DemandDamagesInput): { html: string; flags: string[] } {
  const flags: string[] = [];
  const d = input.analysis.damagesEstimate;
  if (!input.intake.annual_salary || !d || d.commonLawHighAmount <= 0) {
    return {
      html: '',
      flags: ['Damages table omitted: no salary or damages estimate on the file. Run the analysis before sending this letter.'],
    };
  }

  const rows: string[] = [];
  rows.push('<tr><th>Head</th><th>Basis</th><th>Amount</th></tr>');

  const heads = input.heads?.length
    ? input.heads
    : [
        {
          label: 'Pay in lieu of reasonable notice',
          amount: d.commonLawHighAmount,
          basis: `${d.commonLawLowMonths} to ${d.commonLawHighMonths} months at the plaintiff's compensation, claimed at the higher end`,
        },
        ...(d.additionalHeads ?? []).map(h => ({
          label: h.name, amount: h.estimatedAmount ?? null, basis: h.basis,
        })),
      ];

  let gross = 0;
  for (const head of heads) {
    const amount = typeof head.amount === 'number' && head.amount > 0 ? head.amount : null;
    if (amount) gross += amount;
    rows.push(`<tr><td>${esc(head.label)}</td><td>${esc(head.basis ?? '')}</td><td>${amount ? cad(amount) : '[LAWYER: quantify]'}</td></tr>`);
    if (!amount) flags.push(`Damages table: "${head.label}" has no amount. Quantify it or remove the head before sending.`);
  }

  rows.push(`<tr><th>Subtotal</th><td></td><th>${cad(gross)}</th></tr>`);

  // Netting: what has been paid, and what has been earned in mitigation.
  let deductions = 0;
  for (const paid of input.amountsPaid ?? []) {
    if (paid.amount > 0) {
      deductions += paid.amount;
      rows.push(`<tr><td>Less: ${esc(paid.label)}</td><td>paid to date</td><td>(${cad(paid.amount)})</td></tr>`);
    }
  }
  if (typeof input.mitigationEarnings === 'number' && input.mitigationEarnings > 0) {
    deductions += input.mitigationEarnings;
    rows.push(`<tr><td>Less: mitigation earnings</td><td>earned to date</td><td>(${cad(input.mitigationEarnings)})</td></tr>`);
  }

  const net = Math.max(0, gross - deductions);
  if (deductions > 0) {
    rows.push(`<tr><th>Net claim</th><td></td><th>${cad(net)}</th></tr>`);
  }

  // The demand is the lawyer's number. Where it diverges materially from
  // the netted claim, say so rather than letting the letter argue with
  // its own table.
  if (input.demandAmount > 0) {
    rows.push(`<tr><th>Amount demanded in settlement</th><td>all-inclusive</td><th>${cad(input.demandAmount)}</th></tr>`);
    const reference = net > 0 ? net : gross;
    if (reference > 0 && Math.abs(input.demandAmount - reference) > reference * 0.25) {
      flags.push(
        `The amount demanded (${cad(input.demandAmount)}) differs materially from the itemised ${deductions > 0 ? 'net' : 'gross'} claim (${cad(reference)}). Confirm the demand figure, or adjust the heads so the table and the demand agree.`,
      );
    }
  }

  if ((input.amountsPaid ?? []).length === 0 && !input.mitigationEarnings) {
    flags.push('Damages table: no amounts paid and no mitigation earnings were entered. If the employer has paid statutory entitlements or the client has earned income, enter them so the letter nets them off.');
  }

  return {
    html: `<h2>Damages Quantification</h2>\n<table>\n${rows.join('\n')}\n</table>`,
    flags,
  };
}
