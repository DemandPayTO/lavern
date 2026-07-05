/**
 * Unit Tests — Feature 3 form-fill slice:
 *   - OLRB Forms A-30 / A-53 datasets population (src/labour/olrb-form-data.ts)
 *   - Portal filing sheets (src/employment/court-forms.ts)
 *   - Pinned Form 14C notice injection (src/employment/litigation-documents.ts)
 */

import { describe, it, expect } from 'vitest';
import { buildA30DatasetsXml, buildA53DatasetsXml, olrbDataFilename } from '../../src/labour/olrb-form-data.js';
import { buildEsaFilingSheet, buildSccFilingSheet } from '../../src/employment/court-forms.js';
import { injectForm14cNotice } from '../../src/employment/litigation-documents.js';
import { sectionBounds } from '../../src/documents/xfa-datasets.js';
import type { GrievanceIntakeData } from '../../src/types/labour-intake.js';
import type { EmploymentIntakeData } from '../../src/types/employment-intake.js';

const grievance = {
  grievor_first_name: 'Amara', grievor_last_name: 'Okonkwo',
  grievor_classification: 'Press Operator',
  grievor_contact: 'amara@example.com, 416-555-0182',
  union_name: 'Unifor Local 222',
  employer_name: 'Durham Metal & Works Inc',
  workplace_location: 'Oshawa plant',
} as GrievanceIntakeData;

describe('OLRB datasets population', () => {
  it('A-30 sets the style of cause and the responding union contact inside formA30 only', () => {
    const xml = buildA30DatasetsXml(grievance, {
      representativeName: 'Jordan Whitfield', organizationName: 'Whitfield Labour Law',
      email: 'jw@example.com', phone: '416-555-0100',
    });
    expect(xml).toContain('>Amara Okonkwo</applicant');
    expect(xml).toContain('>Unifor Local 222</respondingPartyTradeUnion');
    expect(xml).toContain('>Durham Metal &amp; Works Inc</respondingPartyEmployer');

    // The contact lands inside formA30's partA1a, not a later form's
    const a30 = sectionBounds(xml, 'formA30')!;
    const slice = xml.slice(a30.start, a30.end);
    expect(slice).toContain('>Whitfield Labour Law</orgName');
    expect(slice).toContain('>Jordan</firstName');
    expect(slice).toContain('>Whitfield</lastName');
    const after = xml.slice(a30.end);
    expect(after).not.toContain('Whitfield Labour Law');
  });

  it('A-53 sets the applicant worker and the responding employer blocks', () => {
    const xml = buildA53DatasetsXml(grievance);
    expect(xml).toContain('>Amara Okonkwo</applicant');
    const a53 = sectionBounds(xml, 'formA53')!;
    const slice = xml.slice(a53.start, a53.end);
    expect(slice).toContain('>Amara</firstName');
    expect(slice).toContain('>Okonkwo</lastName');
    expect(slice).toContain('>amara@example.com</email');
    expect(slice).toContain('>416-555-0182</phone');
    expect(slice).toContain('>Durham Metal &amp; Works Inc</orgName');
    expect(slice).toContain('>Oshawa plant</fullAddress');
  });

  it('leaves the narrative questions blank by design', () => {
    const xml = buildA30DatasetsXml(grievance, {});
    for (const q of ['question3', 'question4', 'question5']) {
      expect(new RegExp(`<${q}\\s*\\n?/>`).test(xml)).toBe(true);
    }
  });

  it('names the download from the grievor', () => {
    expect(olrbDataFilename('a30', grievance)).toBe('olrb-form-a30-data-amara-okonkwo.xml');
  });
});

describe('portal filing sheets', () => {
  const intake = {
    client_first_name: 'Iris', client_last_name: 'Valdez',
    employer_legal_name: 'Test Employer Corp',
    job_title: 'Coordinator', hire_date: '2018-02-05', termination_date: '2026-06-15',
    annual_salary: 90000,
  } as EmploymentIntakeData;

  it('ESA sheet carries the election caution and the entitlement figures', () => {
    const r = buildEsaFilingSheet(intake, { damagesEstimate: { esaNoticeWeeks: 8, esaNoticePay: 13846, esaSeverancePay: 14538 } });
    expect(r.html).toContain('ss. 97 and 98');
    expect(r.html).toContain('8 weeks');
    expect(r.html).toContain('$13,846.00');
    expect(r.html).toContain('[NOT ON FILE]'); // fields the file does not hold are visible, not invented
    expect(r.html).not.toContain('—');
  });

  it('Small Claims sheet warns above the monetary limit and caps the amount', () => {
    const over = buildSccFilingSheet(intake, 65000);
    expect(over.html).toContain('$50,000');
    expect(over.html).toContain('Abandon the excess');
    expect(over.html).toContain('$50,000.00'); // capped figure
    const under = buildSccFilingSheet(intake, 30000);
    expect(under.html).not.toContain('Abandon the excess');
    expect(under.html).toContain('$30,000.00');
  });
});

describe('Form 14C notice injection', () => {
  it('replaces the placeholder with the pinned official wording', () => {
    const html = '<h1>NOTICE OF ACTION</h1><p>[STANDARD FORM 14C NOTICE AND WARNINGS TO THE DEFENDANT, PER THE OFFICIAL FORM]</p><h2>STATEMENT OF THE NATURE OF THE CLAIM</h2>';
    const out = injectForm14cNotice(html);
    expect(out).toContain('A LEGAL PROCEEDING HAS BEEN COMMENCED AGAINST YOU');
    expect(out).toContain('WITHIN TWENTY DAYS');
    expect(out).toContain('AUTOMATICALLY BE DISMISSED');
    expect(out).not.toContain('[STANDARD FORM 14C');
  });

  it('leaves documents without the placeholder untouched', () => {
    const html = '<p>No placeholder here.</p>';
    expect(injectForm14cNotice(html)).toBe(html);
  });
});
