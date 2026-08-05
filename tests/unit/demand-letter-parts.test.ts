/**
 * Unit Tests — demand letter furniture and figures.
 *
 * The numbers in a served demand are the numbers the client is held to,
 * so the itemisation is built here rather than written by a model. The
 * furniture recurs in every letter, so a style profile learns it and the
 * model reproduces it; the scrub is what stops that reaching the page.
 */

import { describe, it, expect } from 'vitest';
import {
  buildDemandOpening, buildDemandSignature, buildDemandDamagesTable, scrubDemandBody,
  insertDamagesTable, defaultDamageHeads,
} from '../../src/employment/demand-letter-parts.js';

const intake = {
  client_first_name: 'Aisha', client_last_name: 'Osei',
  employer_legal_name: 'Brightpath Financial Group Inc',
  annual_salary: 110000,
} as never;

const analysis = {
  damagesEstimate: {
    esaNoticeWeeks: 8, esaNoticePay: 16923, esaSeverancePay: 14808,
    commonLawLowMonths: 8, commonLawHighMonths: 12,
    commonLawLowAmount: 73333, commonLawHighAmount: 110000,
    additionalHeads: [{ name: 'Human Rights Code damages', basis: 'injury to dignity', estimatedAmount: 25000 }],
    totalEstimateLow: 73333, totalEstimateHigh: 135000,
  },
  bardalFactors: { age: 47, tenureYears: 6.6 },
  timeline: [], gates: [],
  limitationDeadline: { date: '2028-04-20', daysRemaining: 600, urgent: false },
  recommendedProcedure: 'simplified',
} as never;

const furniture = { intake, lawyerName: 'Jordan Haworth', firmName: 'Evans Law Firm' };

describe('furniture', () => {
  it('builds the without-prejudice marking, the Re: block and the salutation', () => {
    const opening = buildDemandOpening({ ...furniture, recipientName: 'Ms. R. Chen, Counsel for Brightpath', fileNumber: 'EV-1044' });
    expect(opening).toContain('WITHOUT PREJUDICE');
    expect(opening).toContain('Re: Aisha Osei and Brightpath Financial Group Inc');
    expect(opening).toContain('EV-1044');
    expect(opening).toContain('Dear Counsel:');
  });

  it('marks an unknown recipient instead of inventing one', () => {
    const opening = buildDemandOpening(furniture);
    expect(opening).toContain('[LAWYER: name and address of the recipient');
    expect(opening).toContain('[LAWYER: salutation]');
  });

  it('signs with the firm and the lawyer', () => {
    const sig = buildDemandSignature({ ...furniture, firmAddress: '1 King St W' });
    expect(sig).toContain('Yours truly');
    expect(sig).toContain('Evans Law Firm');
    expect(sig).toContain('Jordan Haworth');
    expect(sig).toContain('1 King St W');
  });

  it('scrubs furniture the model wrote anyway, keeping the substance', () => {
    const body = [
      '<p>WITHOUT PREJUDICE</p>',
      '<p>Dear Counsel:</p>',
      '<p>Re: Osei and Brightpath</p>',
      '<p>We act for Ms. Osei in respect of the termination of her employment.</p>',
      '<p>Yours truly,</p>',
      '<p>Barrister and Solicitor</p>',
    ].join('');
    const out = scrubDemandBody(body);
    expect(out).toContain('We act for Ms. Osei');
    expect(out).not.toContain('WITHOUT PREJUDICE');
    expect(out).not.toContain('Dear Counsel');
    expect(out).not.toContain('Yours truly');
    expect(out).not.toContain('Barrister and Solicitor');
  });
});

describe('the damages table', () => {
  it('itemises the heads and totals them', () => {
    const { html } = buildDemandDamagesTable({ intake, analysis, demandAmount: 135000 });
    expect(html).toContain('Pay in lieu of reasonable notice');
    expect(html).toContain('$110,000');
    expect(html).toContain('Human Rights Code damages');
    expect(html).toContain('$25,000');
    expect(html).toContain('Subtotal');
    expect(html).toContain('$135,000');
  });

  it('nets amounts paid and mitigation earnings, showing a net claim', () => {
    const { html } = buildDemandDamagesTable({
      intake, analysis, demandAmount: 100000,
      amountsPaid: [{ label: 'ESA notice and severance', amount: 31731 }],
      mitigationEarnings: 12000,
    });
    expect(html).toContain('Less: ESA notice and severance');
    expect(html).toContain('($31,731)');
    expect(html).toContain('Less: mitigation earnings');
    expect(html).toContain('($12,000)');
    // 135,000 gross - 43,731 = 91,269
    expect(html).toContain('Net claim');
    expect(html).toContain('$91,269');
  });

  it('flags a demand that argues with its own table', () => {
    const { flags } = buildDemandDamagesTable({ intake, analysis, demandAmount: 400000 });
    expect(flags.some(f => f.includes('differs materially'))).toBe(true);
  });

  it('accepts the lawyer’s own heads over the analysis defaults', () => {
    const { html } = buildDemandDamagesTable({
      intake, analysis, demandAmount: 90000,
      heads: [
        { label: 'Pay in lieu of notice', amount: 82500, basis: 'nine months' },
        { label: 'Moral damages', amount: null, basis: 'manner of dismissal' },
      ],
    });
    expect(html).toContain('nine months');
    expect(html).toContain('$82,500');
    expect(html).not.toContain('Human Rights Code damages');
    // An unquantified head is visible, not silently dropped.
    expect(html).toContain('[LAWYER: quantify]');
  });

  it('flags an unquantified head and a missing netting entry', () => {
    const { flags } = buildDemandDamagesTable({
      intake, analysis, demandAmount: 135000,
      heads: [{ label: 'Moral damages', amount: null, basis: 'manner of dismissal' }],
    });
    expect(flags.some(f => f.includes('Moral damages') && f.includes('no amount'))).toBe(true);
    expect(flags.some(f => f.includes('no amounts paid'))).toBe(true);
  });

  it('omits the table and says why when the file has no figures', () => {
    const { html, flags } = buildDemandDamagesTable({
      intake: { client_first_name: 'A' } as never, analysis, demandAmount: 100000,
    });
    expect(html).toBe('');
    expect(flags[0]).toContain('Run the analysis');
  });
});


describe('the table survives insertion (the $1 backreference trap)', () => {
  it('dollar amounts are not read as regex backreferences when the table is inserted', () => {
    // "$12,000" in a replacement STRING becomes group 1 plus "2,000".
    // The generator must use a replacement function. This pins the shape
    // of the bug: a live run produced "(Demand2,000)" and "Demand20,000".
    const table = buildDemandDamagesTable({
      intake, analysis, demandAmount: 120000,
      amountsPaid: [{ label: 'ESA notice and severance', amount: 31731 }],
      mitigationEarnings: 12000,
    }).html;
    const body = '<h2>Legal Analysis</h2><p>x</p><h2>Demand</h2><p>y</p>';

    // The original: a capturing regex plus a replacement STRING.
    const broken = body.replace(/(<h2[^>]*>\s*Demand\s*<\/h2>)/i, `${table}\n$1`);
    const fixed = body.replace(/<h2[^>]*>\s*Demand\s*<\/h2>/i, m => `${table}\n${m}`);

    // The fixed form keeps every figure intact and adds exactly one heading.
    expect(fixed).toContain('($12,000)');
    expect(fixed).toContain('$120,000');
    expect((fixed.match(/<h2[^>]*>\s*Demand\s*<\/h2>/gi) ?? []).length).toBe(1);

    // Sanity: the naive form is what produced "(Demand2,000)" in a live run,
    // each "$1..." swallowing the heading into the middle of an amount.
    expect(broken).not.toContain('($12,000)');
    expect((broken.match(/Demand<\/h2>/gi) ?? []).length).toBeGreaterThan(1);
  });
});


describe('placing the table', () => {
  const table = buildDemandDamagesTable({
    intake, analysis, demandAmount: 120000,
    amountsPaid: [{ label: 'ESA notice and severance', amount: 31731 }],
    mitigationEarnings: 12000,
  }).html;

  it('does not read dollar amounts as regex backreferences', () => {
    // A live run produced "(Demand2,000)" and "Demand20,000": every "$1..."
    // in the table swallowed the matched heading. The insertion must use a
    // replacement function, never a replacement string.
    const out = insertDamagesTable('<h2>Legal Analysis</h2><p>x</p><h2>Demand</h2><p>y</p>', table);
    expect(out).toContain('($12,000)');
    expect(out).toContain('$120,000');
    expect(out).not.toMatch(/Demand\d/);
    expect((out.match(/<h2[^>]*>\s*Demand\s*<\/h2>/gi) ?? []).length).toBe(1);
  });

  it('sits above the Demand section, so the letter itemises then demands', () => {
    const out = insertDamagesTable('<h2>Legal Analysis</h2><p>x</p><h2>Demand</h2><p>y</p>', table);
    expect(out.indexOf('<table>')).toBeLessThan(out.indexOf('<h2>Demand</h2>'));
  });

  it('goes under the model’s own damages heading without repeating it', () => {
    const out = insertDamagesTable('<h2>Damages Quantification</h2><p>Some prose.</p><h2>Demand</h2>', table);
    expect((out.match(/Damages Quantification/gi) ?? []).length).toBe(1);
    expect(out.indexOf('<table>')).toBeGreaterThan(out.indexOf('Damages Quantification'));
    expect(out).toContain('Some prose.');
  });

  it('falls back to the end when the letter has no anchor', () => {
    const out = insertDamagesTable('<p>A letter with no headings.</p>', table);
    expect(out).toContain('<table>');
  });
});

describe('empty headings', () => {
  it('drops a heading the model left standing over nothing', () => {
    // What a live run produced: the model wrote the heading it was given
    // and left the section empty, because the table is supplied in code.
    const out = scrubDemandBody('<h2>Legal Analysis</h2><p>x</p><h2>Damages Quantification</h2><h2>Demand</h2><p>y</p>');
    expect(out).not.toContain('Damages Quantification');
    expect(out).toContain('<h2>Legal Analysis</h2>');
    expect(out).toContain('<h2>Demand</h2>');
  });

  it('keeps a heading that has content under it', () => {
    const out = scrubDemandBody('<h2>Damages Quantification</h2><p>The claim is quantified below.</p><h2>Demand</h2><p>y</p>');
    expect(out).toContain('Damages Quantification');
  });

  it('drops a trailing empty heading at the end of the letter', () => {
    const out = scrubDemandBody('<p>Body.</p><h2>Closing</h2>');
    expect(out).not.toContain('Closing');
  });
});


describe('the default heads', () => {
  it('are what the table itemises when the lawyer says nothing', () => {
    // The workspace prefills from THIS function, so what the lawyer edits
    // is what the table would otherwise have said, not an approximation.
    const heads = defaultDamageHeads(analysis);
    const { html } = buildDemandDamagesTable({ intake, analysis, demandAmount: 135000 });
    for (const head of heads) {
      expect(html).toContain(head.label);
      if (head.basis) expect(html).toContain(head.basis);
    }
    expect(heads[0].label).toBe('Pay in lieu of reasonable notice');
    expect(heads[0].amount).toBe(110000);
    expect(heads[0].basis).toContain('8 to 12 months');
  });

  it('carries the analysis’s additional heads, including unquantified ones', () => {
    const heads = defaultDamageHeads({
      ...(analysis as object),
      damagesEstimate: {
        ...(analysis as { damagesEstimate: object }).damagesEstimate,
        additionalHeads: [
          { name: 'Moral damages', basis: 'manner of dismissal', estimatedAmount: null },
        ],
      },
    } as never);
    expect(heads).toHaveLength(2);
    expect(heads[1]).toEqual({ label: 'Moral damages', basis: 'manner of dismissal', amount: null });
  });

  it('offers nothing to prefill when there is no estimate to prefill from', () => {
    expect(defaultDamageHeads({ damagesEstimate: undefined } as never)).toEqual([]);
  });
});
