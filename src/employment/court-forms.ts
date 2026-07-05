/**
 * Court Forms — deterministic builders for the short procedural forms in
 * a civil file: the Affidavit of Service (Form 16B), the Rule 49 offer
 * lifecycle (Form 49B withdrawal, Form 49C acceptance), and the Costs
 * Outline (Form 57B).
 *
 * No model calls: these are formal documents whose content is data, and
 * a wrong figure or date in any of them has consequences. Every value
 * comes from the intake or the form fields the lawyer enters, and
 * missing required values fail loudly.
 *
 * Form numbers verified against ontariocourtforms.on.ca (July 2026).
 */

import type { EmploymentIntakeData } from '../types/employment-intake.js';

export interface CourtFormResult {
  html: string;
  documentTitle: string;
  lawyerReviewFlags: string[];
}

/** Free-form inputs for the deterministic court forms, entered in the UI. */
export type CourtFormFields = Record<string, string | number>;

function esc(s: unknown): string {
  return String(s ?? '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function money(n: number): string {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 });
}

function req(fields: CourtFormFields, key: string, label: string): string {
  const v = fields[key];
  if (v === undefined || v === null || String(v).trim() === '') {
    throw new Error(`${label} is required for this form.`);
  }
  return String(v).trim();
}

function opt(fields: CourtFormFields, key: string): string {
  const v = fields[key];
  return v === undefined || v === null ? '' : String(v).trim();
}

function caption(intake: EmploymentIntakeData, courtLocation?: string): string {
  const plaintiff = [intake.client_first_name, intake.client_last_name].filter(Boolean).join(' ') || '[PLAINTIFF]';
  const defendant = intake.employer_legal_name || intake.employer_operating_name || '[DEFENDANT]';
  return `
<p style="text-align:right">Court File No.: [COURT FILE NUMBER]</p>
<p style="text-align:center"><strong>ONTARIO<br>SUPERIOR COURT OF JUSTICE${courtLocation ? `<br>(${esc(courtLocation)})` : ''}</strong></p>
<p style="text-align:center">BETWEEN:</p>
<p style="text-align:center"><strong>${esc(plaintiff).toUpperCase()}</strong><br>Plaintiff</p>
<p style="text-align:center">and</p>
<p style="text-align:center"><strong>${esc(defendant).toUpperCase()}</strong><br>Defendant</p>`;
}

// ── Form 16B: Affidavit of Service ───────────────────────────────────────

const SERVICE_METHODS: Record<string, string> = {
  personal: 'personal service, by leaving a copy with the person',
  mail: 'mailing a copy to the address shown below',
  courier: 'sending a copy by courier to the address shown below',
  email: 'emailing a copy to the email address shown below, in accordance with the Rules',
  alternative: 'an alternative to personal service, as described below',
};

/**
 * Required fields: server_name, server_city, document_served, served_party,
 * service_date (YYYY-MM-DD), service_method (personal|mail|courier|email|alternative).
 * Optional: service_address, service_details.
 */
export function buildAffidavitOfService(intake: EmploymentIntakeData, fields: CourtFormFields, courtLocation?: string): CourtFormResult {
  const serverName = req(fields, 'server_name', 'The name of the person who effected service');
  const serverCity = req(fields, 'server_city', 'The city of the person who effected service');
  const documentServed = req(fields, 'document_served', 'The document served');
  const servedParty = req(fields, 'served_party', 'The party served');
  const serviceDate = req(fields, 'service_date', 'The date of service');
  const methodKey = req(fields, 'service_method', 'The method of service');
  const method = SERVICE_METHODS[methodKey];
  if (!method) throw new Error('The method of service must be one of: personal, mail, courier, email, or alternative.');
  const address = opt(fields, 'service_address');
  const details = opt(fields, 'service_details');

  const html = `${caption(intake, courtLocation)}
<h1 style="text-align:center">AFFIDAVIT OF SERVICE<br>(Form 16B, Courts of Justice Act)</h1>
<p>I, <strong>${esc(serverName)}</strong>, of the ${esc(serverCity)}, MAKE OATH AND SAY (or AFFIRM):</p>
<ol>
<li>On ${esc(serviceDate)}, I served <strong>${esc(servedParty)}</strong> with the <strong>${esc(documentServed)}</strong> by ${esc(method)}.</li>
${address ? `<li>The address at which service was made was: ${esc(address)}.</li>` : ''}
${details ? `<li>${esc(details)}</li>` : ''}
${methodKey === 'mail' ? '<li>Service by mail is effective on the fifth day after mailing (rule 16.06).</li>' : ''}
</ol>
<p>SWORN (or AFFIRMED) before me at the City of ${esc(serverCity)},<br>
in the Province of Ontario, on [DATE OF SWEARING].</p>
<table style="width:100%"><tr>
<td style="width:50%">_______________________________<br>Commissioner for Taking Affidavits<br>(or as may be)</td>
<td style="width:50%">_______________________________<br>${esc(serverName)}</td>
</tr></table>`;

  return {
    html: html.trim(),
    documentTitle: 'Affidavit of Service (Form 16B)',
    lawyerReviewFlags: [
      'Confirm the method of service is permitted for this document under Rules 16.01 to 16.09 before swearing.',
      'The affidavit must be sworn or affirmed before a commissioner; the date of swearing is blank by design.',
      'Insert the court file number.',
    ],
  };
}

// ── Form 49B: Notice of Withdrawal of Offer ─────────────────────────────

/** Required fields: offer_date (date our offer was served). Optional: withdrawing_party. */
export function buildOfferWithdrawal(intake: EmploymentIntakeData, fields: CourtFormFields, lawyerName: string, firmName: string, courtLocation?: string): CourtFormResult {
  const offerDate = req(fields, 'offer_date', 'The date the offer to settle was served');
  const party = opt(fields, 'withdrawing_party') || 'plaintiff';

  const html = `${caption(intake, courtLocation)}
<h1 style="text-align:center">NOTICE OF WITHDRAWAL OF OFFER<br>(Form 49B, Courts of Justice Act)</h1>
<p>The ${esc(party)} withdraws the offer to settle made in this proceeding, which was served on ${esc(offerDate)}.</p>
<p>Date: [DATE]</p>
<p>${esc(lawyerName)}<br>${esc(firmName)}<br>Lawyer for the ${esc(party)}</p>
<p>TO: [NAME AND ADDRESS OF THE LAWYER OR PARTY SERVED]</p>`;

  return {
    html: html.trim(),
    documentTitle: 'Notice of Withdrawal of Offer (Form 49B)',
    lawyerReviewFlags: [
      'Withdrawal ends the offer\'s Rule 49 cost consequences from the date of withdrawal; confirm the strategy before serving.',
      'An offer cannot be withdrawn after it has been accepted; confirm no acceptance has been served.',
      'Insert the court file number and the recipient details.',
    ],
  };
}

// ── Form 49C: Acceptance of Offer ────────────────────────────────────────

/** Required fields: offer_date (date the OTHER side's offer was served), offering_party. */
export function buildOfferAcceptance(intake: EmploymentIntakeData, fields: CourtFormFields, lawyerName: string, firmName: string, courtLocation?: string): CourtFormResult {
  const offerDate = req(fields, 'offer_date', 'The date the offer to settle was served');
  const offeror = req(fields, 'offering_party', 'The party whose offer is being accepted');
  const acceptingParty = opt(fields, 'accepting_party') || 'plaintiff';

  const html = `${caption(intake, courtLocation)}
<h1 style="text-align:center">ACCEPTANCE OF OFFER<br>(Form 49C, Courts of Justice Act)</h1>
<p>The ${esc(acceptingParty)} accepts the offer to settle made by the ${esc(offeror)}, which was served on ${esc(offerDate)}.</p>
<p>Date: [DATE]</p>
<p>${esc(lawyerName)}<br>${esc(firmName)}<br>Lawyer for the ${esc(acceptingParty)}</p>
<p>TO: [NAME AND ADDRESS OF THE LAWYER OR PARTY SERVED]</p>`;

  return {
    html: html.trim(),
    documentTitle: 'Acceptance of Offer (Form 49C)',
    lawyerReviewFlags: [
      'Acceptance creates a binding settlement (rule 49.09 permits enforcement); obtain the client\'s written instructions before serving.',
      'Confirm the offer had not been withdrawn and had not expired at the time of acceptance.',
      'Where the settlement requires court approval (for example, a party under disability), obtain it.',
      'Insert the court file number and the recipient details.',
    ],
  };
}

// ── Form 57B: Costs Outline ──────────────────────────────────────────────

/**
 * Required fields: actual_rate (hourly), hours_total.
 * Optional: partial_indemnity_rate, lawyer_year_of_call, disbursements
 * (one per line: "description $amount"), step_description.
 */
export function buildCostsOutline(intake: EmploymentIntakeData, fields: CourtFormFields, lawyerName: string, firmName: string, courtLocation?: string): CourtFormResult {
  const actualRate = parseFloat(req(fields, 'actual_rate', 'The actual hourly rate'));
  const hours = parseFloat(req(fields, 'hours_total', 'The total hours'));
  if (!Number.isFinite(actualRate) || actualRate <= 0 || !Number.isFinite(hours) || hours <= 0) {
    throw new Error('The hourly rate and total hours must be positive numbers.');
  }
  // Convention: partial indemnity is commonly claimed at about 60 percent
  // of the actual rate. The lawyer may override it.
  const piRateRaw = parseFloat(opt(fields, 'partial_indemnity_rate'));
  const piRate = Number.isFinite(piRateRaw) && piRateRaw > 0 ? piRateRaw : Math.round(actualRate * 0.6);
  const yearOfCall = opt(fields, 'lawyer_year_of_call');
  const step = opt(fields, 'step_description') || 'this step in the proceeding';

  const feesActual = Math.round(actualRate * hours * 100) / 100;
  const feesPI = Math.round(piRate * hours * 100) / 100;

  const disbLines = opt(fields, 'disbursements').split('\n').map(l => l.trim()).filter(Boolean);
  let disbTotal = 0;
  const disbRows = disbLines.map(line => {
    const m = line.match(/\$?\s*([\d,]+(?:\.\d{1,2})?)\s*$/);
    const amount = m ? parseFloat(m[1].replace(/,/g, '')) : 0;
    disbTotal += amount;
    const desc = m ? line.slice(0, m.index).trim().replace(/[,;:]$/, '') : line;
    return `<tr><td>${esc(desc)}</td><td style="text-align:right">${money(amount)}</td></tr>`;
  }).join('');
  disbTotal = Math.round(disbTotal * 100) / 100;

  const html = `${caption(intake, courtLocation)}
<h1 style="text-align:center">COSTS OUTLINE<br>(Form 57B, Courts of Justice Act)</h1>
<p>The plaintiff provides the following outline of the submissions to be made at the hearing in support of the costs the party will seek if successful, in respect of ${esc(step)}:</p>
<h2>Fees</h2>
<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%">
<tr><th>Lawyer</th><th>Year of call</th><th>Hours</th><th>Actual rate</th><th>Partial indemnity rate</th></tr>
<tr><td>${esc(lawyerName)}, ${esc(firmName)}</td><td>${esc(yearOfCall || '[YEAR OF CALL]')}</td><td style="text-align:right">${hours}</td><td style="text-align:right">${money(actualRate)}</td><td style="text-align:right">${money(piRate)}</td></tr>
</table>
<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%;margin-top:1em">
<tr><th></th><th style="text-align:right">Amount</th></tr>
<tr><td>Fees claimed on a partial indemnity basis (${hours} hours at ${money(piRate)})</td><td style="text-align:right">${money(feesPI)}</td></tr>
<tr><td>Fees on an actual basis, for the court's information (${hours} hours at ${money(actualRate)})</td><td style="text-align:right">${money(feesActual)}</td></tr>
</table>
<h2>Disbursements</h2>
${disbRows
    ? `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><tr><th>Disbursement</th><th style="text-align:right">Amount</th></tr>${disbRows}<tr><td><strong>Total disbursements</strong></td><td style="text-align:right"><strong>${money(disbTotal)}</strong></td></tr></table>`
    : '<p>[LIST DISBURSEMENTS, OR STATE THAT THERE ARE NONE]</p>'}
<h2>Total claimed</h2>
<p><strong>${money(feesPI + disbTotal)}</strong> (partial indemnity fees plus disbursements), together with HST as applicable.</p>
<h2>Factors relied on (rule 57.01)</h2>
<p>The amount claimed is fair and reasonable having regard to the factors in rule 57.01(1), including the amounts claimed and recovered, the complexity and importance of the issues, the principle of indemnity, the rates charged, and the amount an unsuccessful party could reasonably expect to pay. [EXPAND FOR THE SPECIFIC HEARING.]</p>
<p>Date: [DATE]</p>
<p>${esc(lawyerName)}<br>${esc(firmName)}<br>Lawyer for the plaintiff</p>`;

  return {
    html: html.trim(),
    documentTitle: 'Costs Outline (Form 57B)',
    lawyerReviewFlags: [
      'Verify the hours against the docket and the rates against the retainer before filing.',
      'The partial indemnity rate defaults to sixty percent of the actual rate where not entered; confirm it against current practice.',
      'HST is noted but not computed; confirm the treatment.',
      'Complete the rule 57.01 factors for the specific hearing and insert the court file number.',
    ],
  };
}

// ── Portal filing sheets ─────────────────────────────────────────────────
// The ESA claim and the Small Claims Court's online filing are data entry
// into government portals, which no document can bypass. These sheets put
// every value the portal asks for in one place so the transcription is
// mechanical. Portal screens change without notice; the sheet mirrors the
// information the filing requires, not the exact screen order.

interface SheetRow { label: string; value: string | undefined | null }

function sheetTable(rows: SheetRow[]): string {
  const body = rows.map(r => `
    <tr><td style="width:40%">${esc(r.label)}</td><td>${r.value ? esc(String(r.value)) : '[NOT ON FILE]'}</td></tr>`).join('');
  return `<table border="1" cellpadding="6" style="border-collapse:collapse;width:100%"><tbody>${body}</tbody></table>`;
}

/** ESA claim filing sheet: what the Ministry's online claim asks for. */
export function buildEsaFilingSheet(
  intake: EmploymentIntakeData,
  analysis?: { damagesEstimate?: { esaNoticeWeeks: number; esaNoticePay: number; esaSeverancePay: number } },
): CourtFormResult {
  const d = analysis?.damagesEstimate;
  const html = `
<h1>ESA Claim Filing Sheet</h1>
<p>Transcription sheet for the Ministry of Labour's online employment standards claim. Every value the
claim requires is set out below from the matter file. Complete the filing at ontario.ca (file an
employment standards claim); the portal's screens change without notice, so match each value to the
current screen rather than assuming the order below.</p>
<h2>Election caution (ESA ss. 97 and 98)</h2>
<p>Filing an employment standards claim for termination or severance pay generally bars a civil action
for the same entitlements. Confirm the forum election with the client in writing before filing.</p>
<h2>Claimant</h2>
${sheetTable([
    { label: 'First name', value: intake.client_first_name },
    { label: 'Last name', value: intake.client_last_name },
    { label: 'Address', value: intake.client_address },
    { label: 'Email', value: (intake as Record<string, unknown>).client_email as string },
    { label: 'Phone', value: (intake as Record<string, unknown>).client_phone as string },
  ])}
<h2>Employer</h2>
${sheetTable([
    { label: 'Legal name', value: intake.employer_legal_name },
    { label: 'Operating name (if different)', value: intake.employer_operating_name },
    { label: 'Address', value: intake.employer_address },
  ])}
<h2>Employment</h2>
${sheetTable([
    { label: 'Job title', value: intake.job_title },
    { label: 'First day of work', value: intake.hire_date ?? intake.first_day_of_work },
    { label: 'Last day of work / termination date', value: intake.termination_date ?? intake.last_day_worked },
    { label: 'Rate of pay', value: intake.annual_salary ? `${money(intake.annual_salary)} per year` : undefined },
    { label: 'Reason employment ended', value: intake.termination_reasons },
  ])}
<h2>Amounts claimed</h2>
${sheetTable([
    { label: 'Termination pay (ESA s. 57)', value: d ? `${d.esaNoticeWeeks} weeks, ${money(d.esaNoticePay)}` : undefined },
    { label: 'Severance pay (ESA s. 64), where eligible', value: d ? money(d.esaSeverancePay) : undefined },
    { label: 'Unpaid wages, vacation pay, or other amounts', value: undefined },
  ])}
<p>The two-year claim window runs from the contravention. The docket carries the deadline.</p>`;

  return {
    html: html.trim(),
    documentTitle: 'ESA Claim Filing Sheet',
    lawyerReviewFlags: [
      'Confirm the forum election (ESA ss. 97 and 98) with the client in writing before filing.',
      'Verify the amounts against the analysis and payroll records; the portal requires figures, not ranges.',
      'Portal screens change without notice; match each value to the current screen.',
    ],
  };
}

/** Small Claims Court Form 7A filing sheet for the online filing portal. */
export function buildSccFilingSheet(intake: EmploymentIntakeData, claimAmount?: number): CourtFormResult {
  const overCap = typeof claimAmount === 'number' && claimAmount > 50000;
  const html = `
<h1>Small Claims Court Filing Sheet (Plaintiff's Claim, Form 7A)</h1>
<p>Transcription sheet for filing the Plaintiff's Claim through the Small Claims Court online filing
service. The generated Form 7A document contains the reasons for the claim; this sheet carries the
data-entry values.</p>
${overCap ? '<p><strong>The amount on file exceeds the $50,000 Small Claims limit (O. Reg. 42/25, in force October 1, 2025). Abandon the excess expressly, or proceed in the Superior Court.</strong></p>' : ''}
<h2>Plaintiff</h2>
${sheetTable([
    { label: 'Name', value: [intake.client_first_name, intake.client_last_name].filter(Boolean).join(' ') },
    { label: 'Address', value: intake.client_address },
  ])}
<h2>Defendant</h2>
${sheetTable([
    { label: 'Name', value: intake.employer_legal_name ?? intake.employer_operating_name },
    { label: 'Address', value: intake.employer_address },
  ])}
<h2>Claim</h2>
${sheetTable([
    { label: 'Amount claimed', value: typeof claimAmount === 'number' ? money(Math.min(claimAmount, 50000)) : undefined },
    { label: 'Pre-judgment interest', value: 'Courts of Justice Act rate, from the date of termination' },
    { label: 'Reasons for claim', value: 'As set out in the attached Plaintiff’s Claim (Form 7A)' },
  ])}`;

  return {
    html: html.trim(),
    documentTitle: "Small Claims Filing Sheet (Form 7A)",
    lawyerReviewFlags: [
      'Confirm the defendant’s exact legal name and address for service; a misnamed defendant defeats enforcement.',
      'Where the claim exceeds $50,000, abandon the excess expressly or elect the Superior Court.',
      'Attach the generated Form 7A document as the reasons for the claim.',
    ],
  };
}
