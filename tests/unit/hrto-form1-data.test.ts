/**
 * Unit Tests — HRTO Form 1 datasets populator
 * (src/employment/hrto-form1-data.ts)
 *
 * The output must import cleanly into the official XFA SmartForm, so the
 * tests pin: correct section-scoped placement (node names repeat across
 * sections), ground checkbox mapping, XML escaping, and the conservative
 * leave-blank philosophy.
 */

import { describe, it, expect } from 'vitest';
import { buildForm1DatasetsXml, form1DataFilename } from '../../src/employment/hrto-form1-data.js';
import type { EmploymentIntakeData } from '../../src/types/employment-intake.js';

/** Boundary-aware section slice (\`</sfrmRespondent\` must not match \`</sfrmRespondentType\`). */
function section(xml: string, name: string): string {
  const open = new RegExp(`<${name}(?=[\\s/>])`).exec(xml);
  const closeRe = new RegExp(`</${name}(?=[\\s>])`, 'g');
  closeRe.lastIndex = open!.index;
  const close = closeRe.exec(xml);
  return xml.slice(open!.index, close!.index);
}

const intake = {
  client_first_name: 'Aisha',
  client_last_name: 'Osei',
  client_email: 'aisha@example.com',
  client_address: '22 Birchmount Rd',
  client_city: 'Toronto',
  client_postal_code: 'M1K 1S7',
  employer_legal_name: 'Brightpath Financial Group Inc',
  employer_address: '100 King St W, Toronto',
  termination_date: '2026-04-20',
  discrimination_grounds: ['disability', 'sex'],
  experienced_reprisal: true,
} as unknown as EmploymentIntakeData;

describe('buildForm1DatasetsXml', () => {
  const xml = buildForm1DatasetsXml(intake, { lawyerName: 'Jordan Whitfield', lsoNumber: 'P12345' });

  it('places applicant names in the applicant section', () => {
    const applicant = section(xml, 'sfrmApplicant');
    expect(applicant).toContain('>Osei</txtLastName');
    expect(applicant).toContain('>Aisha</txtFirstName');
    expect(applicant).toContain('>aisha@example.com</txtEmail');
  });

  it('places the respondent organization in the respondent section only', () => {
    const respondent = section(xml, 'sfrmRespondent');
    expect(respondent).toContain('>Brightpath Financial Group Inc</txtOrgName');
    // Applicant section must NOT have been contaminated
    const applicant = section(xml, 'sfrmApplicant');
    expect(applicant).not.toContain('Brightpath');
  });

  it('checks the mapped ground checkboxes and reprisal', () => {
    const grounds = section(xml, 'sfrmListofGrounds');
    expect(grounds).toMatch(/<chkDisability\s*\n?>1<\/chkDisability/);
    expect(grounds).toMatch(/<chkSexGender\s*\n?>1<\/chkSexGender/);
    expect(grounds).toMatch(/<chkReprisal\s*\n?>1<\/chkReprisal/);
    // Unselected grounds stay 0
    expect(grounds).toMatch(/<chkAge\s*\n?>0<\/chkAge/);
  });

  it('sets the date of last event (s. 34(1) anchor)', () => {
    expect(xml).toMatch(/<dtpDateofLastEvent\s*\n?>2026-04-20<\/dtpDateofLastEvent/);
  });

  it('flags the monetary remedy and references Schedule A', () => {
    const remedy = section(xml, 'sfrmRemedy');
    expect(remedy).toMatch(/<chkMonetary\s*\n?>1<\/chkMonetary/);
    expect(remedy).toContain('Schedule &quot;A&quot;');
  });

  it('escapes XML-hostile characters in values', () => {
    const hostile = buildForm1DatasetsXml({
      ...intake,
      employer_legal_name: 'Smith & Wesson <Holdings>',
    } as unknown as EmploymentIntakeData);
    expect(hostile).toContain('Smith &amp; Wesson &lt;Holdings&gt;');
    expect(hostile).not.toContain('<Holdings>');
  });

  it('leaves unmapped narrative sections blank (lawyer completes them)', () => {
    expect(xml).toMatch(/<txtExplainLateTimeline\s*\n?\/>/);
  });

  it('remains well-formed enough for import: no stray unescaped ampersands', () => {
    // Every & must be part of an entity
    const bad = xml.match(/&(?!amp;|lt;|gt;|quot;|apos;|#)/g);
    expect(bad).toBeNull();
  });
});

describe('form1DataFilename', () => {
  it('names the file after the client', () => {
    expect(form1DataFilename(intake)).toBe('HRTO-Form1-data-Osei.xml');
  });
});
