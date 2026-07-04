/**
 * Remedy Worksheet — deterministic make-whole computation for a
 * grievance. No model calls: every figure is arithmetic over the intake,
 * and every line carries its own derivation so the reviewer can verify
 * it against payroll records.
 *
 * The presumptive arbitral remedy for discharge is reinstatement with
 * full compensation. This worksheet quantifies the compensation claim:
 * gross back pay, vacation pay, benefits, pension contributions, less
 * interim earnings. Interest and grid step increases are noted for the
 * reviewer rather than modelled.
 */

import type { GrievanceIntakeData } from '../types/labour-intake.js';

export interface RemedyWorksheetResult {
  html: string;
  documentTitle: string;
  reviewerFlags: string[];
}

function money(n: number): string {
  return n.toLocaleString('en-CA', { style: 'currency', currency: 'CAD', maximumFractionDigits: 2 });
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/** Weekly wage from the intake's rate and period. Null when not derivable. */
export function weeklyWage(intake: GrievanceIntakeData): number | null {
  const rate = intake.wage_rate;
  if (!rate || rate <= 0) return null;
  switch (intake.wage_rate_period ?? 'hour') {
    case 'hour': {
      const hours = intake.hours_per_week && intake.hours_per_week > 0 ? intake.hours_per_week : 40;
      return rate * hours;
    }
    case 'week': return rate;
    case 'year': return rate / 52;
  }
}

/**
 * Build the remedy worksheet. Throws when the wage rate is missing;
 * the route converts that into a clear validation message.
 */
export function buildRemedyWorksheet(intake: GrievanceIntakeData, asOf?: Date): RemedyWorksheetResult {
  const weekly = weeklyWage(intake);
  if (weekly === null) {
    throw new Error('A wage rate is required to compute the remedy worksheet. Enter the rate, its period, and hours per week where hourly.');
  }

  const lossStart = intake.discipline_letter_date || intake.incident_date;
  if (!lossStart) {
    throw new Error('An incident or discipline date is required to compute the back-pay period.');
  }

  const today = asOf ?? new Date();
  const start = new Date(`${lossStart}T00:00:00`);
  const days = Math.max(0, Math.round((today.getTime() - start.getTime()) / 86_400_000));
  const weeks = Math.round((days / 7) * 10) / 10;

  const grievor = [intake.grievor_first_name, intake.grievor_last_name].filter(Boolean).join(' ') || 'the grievor';
  const asOfIso = today.toISOString().slice(0, 10);

  // ── Lines ───────────────────────────────────────────────────────────
  const grossBackPay = Math.round(weekly * weeks * 100) / 100;
  const vacationPct = intake.vacation_pay_percent ?? 0;
  const vacationPay = Math.round(grossBackPay * (vacationPct / 100) * 100) / 100;
  const benefitsPct = intake.benefits_load_percent ?? 0;
  const benefits = Math.round(grossBackPay * (benefitsPct / 100) * 100) / 100;
  const pensionPct = intake.pension_contrib_percent ?? 0;
  const pension = Math.round(grossBackPay * (pensionPct / 100) * 100) / 100;
  const subtotal = grossBackPay + vacationPay + benefits + pension;
  const interim = intake.interim_earnings ?? 0;
  const net = Math.max(0, Math.round((subtotal - interim) * 100) / 100);

  const rateLine = intake.wage_rate_period === 'year'
    ? `${money(intake.wage_rate!)} per annum (${money(weekly)} per week)`
    : intake.wage_rate_period === 'week'
      ? `${money(intake.wage_rate!)} per week`
      : `${money(intake.wage_rate!)} per hour × ${intake.hours_per_week && intake.hours_per_week > 0 ? intake.hours_per_week : 40} hours per week (${money(weekly)} per week)`;

  const rows: Array<[string, string, string]> = [
    ['Gross back pay', `${money(weekly)} per week × ${weeks} weeks`, money(grossBackPay)],
  ];
  if (vacationPct > 0) rows.push(['Vacation pay', `${vacationPct}% of gross back pay`, money(vacationPay)]);
  if (benefitsPct > 0) rows.push(['Benefits', `${benefitsPct}% of gross back pay`, money(benefits)]);
  if (pensionPct > 0) rows.push(['Pension contributions', `${pensionPct}% of gross back pay`, money(pension)]);
  rows.push(['Subtotal', '', money(subtotal)]);
  if (interim > 0) rows.push(['Less: interim earnings', 'Mitigation set-off per the record', `(${money(interim)})`]);
  rows.push(['Net compensation claimed', '', money(net)]);

  const tableRows = rows.map(([item, basis, amount]) => `
    <tr>
      <td>${esc(item)}</td>
      <td>${esc(basis)}</td>
      <td style="text-align:right">${esc(amount)}</td>
    </tr>`).join('');

  const html = `
<h1>Remedy Worksheet</h1>
<p><strong>Grievor:</strong> ${esc(grievor)}${intake.employer_name ? ` &nbsp;·&nbsp; <strong>Employer:</strong> ${esc(String(intake.employer_name))}` : ''}${intake.union_name ? ` &nbsp;·&nbsp; <strong>Union:</strong> ${esc(String(intake.union_name))}` : ''}${intake.grievance_number ? ` &nbsp;·&nbsp; <strong>Grievance:</strong> #${esc(String(intake.grievance_number))}` : ''}</p>
<p><strong>Loss period:</strong> ${esc(lossStart)} to ${esc(asOfIso)} (${weeks} weeks). The period runs to the date of this worksheet; it continues to accrue until reinstatement or other resolution.</p>
<p><strong>Wage rate:</strong> ${esc(rateLine)}</p>

<h2>Compensation</h2>
<table>
  <thead>
    <tr><th>Item</th><th>Basis</th><th style="text-align:right">Amount</th></tr>
  </thead>
  <tbody>${tableRows}
  </tbody>
</table>

<h2>Non-monetary relief</h2>
<p>In addition to compensation, the remedy claimed includes: reinstatement without loss of seniority; restoration of service and seniority for all purposes, including vacation entitlement and pension accrual; removal of the discipline from the grievor's record; and interest on all amounts. Interest is claimed in accordance with arbitral practice under the collective agreement and is not computed in this worksheet.</p>

<h2>Notes for the reviewer</h2>
<p>This worksheet is arithmetic over the file as entered. It does not model wage grid progression, scheduled increases, premiums, overtime patterns, or shift differentials; where these apply, the claim should be adjusted from payroll records.</p>`;

  const reviewerFlags = [
    'Verify the wage rate and hours against payroll records or the wage schedule in the collective agreement.',
    'Confirm interim earnings against the grievor\'s records; the set-off must be documented.',
    'Grid step increases, scheduled wage increases, premiums, and overtime are not modelled; adjust from payroll records where applicable.',
    'Interest is claimed but not computed; confirm the applicable arbitral practice.',
  ];
  if (vacationPct === 0) reviewerFlags.push('No vacation pay percentage was entered; confirm the CA rate and add it if applicable.');
  if (benefitsPct === 0 && pensionPct === 0) reviewerFlags.push('No benefits or pension values were entered; for a discharge these are usually a substantial part of the make-whole claim.');

  return {
    html: html.trim(),
    documentTitle: 'Remedy Worksheet',
    reviewerFlags,
  };
}
