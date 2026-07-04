/**
 * Unit Tests — deterministic court forms (src/employment/court-forms.ts)
 *
 * Forms 16B, 49B, 49C, and 57B are data, not drafting: a wrong figure or
 * date has consequences, so missing inputs must fail loudly and the
 * arithmetic must be exact.
 */

import { describe, it, expect } from 'vitest';
import { buildAffidavitOfService, buildOfferWithdrawal, buildOfferAcceptance, buildCostsOutline } from '../../src/employment/court-forms.js';
import type { EmploymentIntakeData } from '../../src/types/employment-intake.js';

const intake = {
  client_first_name: 'Helena', client_last_name: 'Kovacs',
  employer_legal_name: 'Stellar Freight Systems Inc',
} as EmploymentIntakeData;

describe('buildAffidavitOfService (Form 16B)', () => {
  const fields = {
    server_name: 'Dana Whitfield', server_city: 'City of Toronto',
    document_served: 'Statement of Claim', served_party: 'Stellar Freight Systems Inc',
    service_date: '2026-07-02', service_method: 'courier',
    service_address: '100 Bay Street, Toronto',
  };

  it('produces the sworn form with the caption and service facts', () => {
    const result = buildAffidavitOfService(intake, fields, 'Toronto');
    expect(result.documentTitle).toBe('Affidavit of Service (Form 16B)');
    expect(result.html).toContain('HELENA KOVACS');
    expect(result.html).toContain('STELLAR FREIGHT SYSTEMS INC');
    expect(result.html).toContain('Statement of Claim');
    expect(result.html).toContain('2026-07-02');
    expect(result.html).toContain('courier');
    expect(result.html).toContain('MAKE OATH AND SAY');
    expect(result.html).not.toContain('—');
    expect(result.lawyerReviewFlags.length).toBeGreaterThan(0);
  });

  it('adds the rule 16.06 mail note only for service by mail', () => {
    const byMail = buildAffidavitOfService(intake, { ...fields, service_method: 'mail' });
    expect(byMail.html).toContain('16.06');
    expect(buildAffidavitOfService(intake, fields).html).not.toContain('16.06');
  });

  it('rejects missing or invalid inputs with actionable messages', () => {
    expect(() => buildAffidavitOfService(intake, { ...fields, service_date: '' })).toThrow(/date of service/i);
    expect(() => buildAffidavitOfService(intake, { ...fields, service_method: 'carrier pigeon' })).toThrow(/method of service/i);
  });
});

describe('buildOfferWithdrawal / buildOfferAcceptance (Forms 49B, 49C)', () => {
  it('withdrawal names the offer date and warns about acceptance', () => {
    const r = buildOfferWithdrawal(intake, { offer_date: '2026-06-01' }, 'J. Whitfield', 'Whitfield Law');
    expect(r.documentTitle).toContain('49B');
    expect(r.html).toContain('withdraws the offer to settle');
    expect(r.html).toContain('2026-06-01');
    expect(r.lawyerReviewFlags.join(' ')).toMatch(/cannot be withdrawn after it has been accepted/i);
  });

  it('acceptance names the offeror and flags the binding consequence', () => {
    const r = buildOfferAcceptance(intake, { offer_date: '2026-06-15', offering_party: 'defendant' }, 'J. Whitfield', 'Whitfield Law');
    expect(r.documentTitle).toContain('49C');
    expect(r.html).toContain('accepts the offer to settle made by the defendant');
    expect(r.lawyerReviewFlags.join(' ')).toMatch(/binding settlement/i);
  });

  it('both require the offer date', () => {
    expect(() => buildOfferWithdrawal(intake, {}, 'J', 'F')).toThrow(/offer to settle was served/i);
    expect(() => buildOfferAcceptance(intake, { offering_party: 'defendant' }, 'J', 'F')).toThrow(/offer to settle was served/i);
  });
});

describe('buildCostsOutline (Form 57B)', () => {
  it('computes partial indemnity fees and totals the disbursements', () => {
    const r = buildCostsOutline(intake, {
      actual_rate: 500, hours_total: 40, partial_indemnity_rate: 300,
      lawyer_year_of_call: '2015',
      disbursements: 'Filing fees $229\nProcess server $150.50\nTranscripts $1,000',
    }, 'J. Whitfield', 'Whitfield Law');
    expect(r.documentTitle).toContain('57B');
    expect(r.html).toContain('$12,000.00');  // 300 × 40 partial indemnity
    expect(r.html).toContain('$20,000.00');  // 500 × 40 actual
    expect(r.html).toContain('$1,379.50');   // disbursements total
    expect(r.html).toContain('$13,379.50');  // fees PI + disbursements
    expect(r.html).toContain('57.01');
  });

  it('defaults the partial indemnity rate to sixty percent of actual', () => {
    const r = buildCostsOutline(intake, { actual_rate: 500, hours_total: 10 }, 'J', 'F');
    expect(r.html).toContain('$300.00');   // PI rate
    expect(r.html).toContain('$3,000.00'); // PI fees
    expect(r.lawyerReviewFlags.join(' ')).toMatch(/sixty percent/);
  });

  it('rejects non-numeric or missing rate and hours', () => {
    expect(() => buildCostsOutline(intake, { actual_rate: 'lots', hours_total: 10 }, 'J', 'F')).toThrow(/positive numbers/i);
    expect(() => buildCostsOutline(intake, { hours_total: 10 }, 'J', 'F')).toThrow(/hourly rate/i);
  });
});
