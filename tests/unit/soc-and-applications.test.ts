/**
 * Unit Tests — SOC Generator and Application Generator
 *
 * Tests form names, court names, and structural helpers.
 * Does NOT call Claude — tests pure logic only.
 */

import { describe, it, expect } from 'vitest';
import { getFormName, getCourtName } from '../../src/employment/soc-generator.js';
import { getApplicationFormName } from '../../src/employment/application-generator.js';

describe('SOC — getFormName', () => {
  it('returns Small Claims form name', () => {
    expect(getFormName('small_claims')).toContain('Form 7A');
  });

  it('returns Simplified Procedure form name', () => {
    const name = getFormName('simplified');
    expect(name).toContain('Form 14A');
    expect(name).toContain('Rule 76');
  });

  it('returns Ordinary Procedure form name', () => {
    const name = getFormName('ordinary');
    expect(name).toContain('Form 14A');
    expect(name).not.toContain('Rule 76');
  });
});

describe('SOC — getCourtName', () => {
  it('returns Small Claims Court for small_claims', () => {
    const name = getCourtName('small_claims', 'Toronto');
    expect(name).toContain('Small Claims Court');
    expect(name).toContain('Toronto');
  });

  it('returns Superior Court for simplified', () => {
    const name = getCourtName('simplified', 'Ottawa');
    expect(name).toContain('Superior Court of Justice');
    expect(name).toContain('Ottawa');
  });

  it('returns Superior Court for ordinary', () => {
    const name = getCourtName('ordinary', 'Hamilton');
    expect(name).toContain('Superior Court of Justice');
    expect(name).toContain('Hamilton');
  });
});

describe('Application — getApplicationFormName', () => {
  it('returns Notice of Application form name', () => {
    const name = getApplicationFormName('notice_of_application');
    expect(name).toContain('Form 14E');
  });

  it('returns HRTO form name', () => {
    const name = getApplicationFormName('hrto_application');
    expect(name).toContain('HRTO');
    expect(name).toContain('Form 1');
  });

  it('returns ESA complaint form name', () => {
    const name = getApplicationFormName('esa_complaint');
    expect(name).toContain('ESA');
    expect(name).toContain('Ministry of Labour');
  });
});

describe('the counsel block on the shell', () => {
  it('a multi-lawyer block replaces the single lawyer line on cover and backsheet', async () => {
    const { buildSocClosing } = await import('../../src/employment/soc-shell.js');
    const html = buildSocClosing({
      courtLocation: 'Toronto', plaintiffName: 'Aisha Osei', defendantName: 'Acme Widgets Ltd',
      procedureType: 'ordinary', lawyerName: 'Jordan Haworth', firmName: 'Evans Law Firm',
      firmAddress: '15 Prince Arthur Avenue, Toronto ON M5R 1B2',
      lawyerBlock: 'John Evans\nJordan Haworth',
    });
    expect(html).toContain('John Evans');
    expect(html).toContain('Jordan Haworth');
    expect(html).toContain('15 Prince Arthur Avenue');
    expect(html).toContain('Lawyers for the Plaintiff');
    expect(html).not.toContain('[LAWYER: LSO number]');
  });

  it('without a block, the single lawyer line and its LSO reminder stand', async () => {
    const { buildSocClosing } = await import('../../src/employment/soc-shell.js');
    const html = buildSocClosing({
      courtLocation: 'Toronto', plaintiffName: 'A', defendantName: 'B',
      procedureType: 'ordinary', lawyerName: 'Jordan Haworth', firmName: 'Evans Law Firm',
    });
    expect(html).toContain('Jordan Haworth');
    expect(html).toContain('[LAWYER: LSO number]');
  });
});
