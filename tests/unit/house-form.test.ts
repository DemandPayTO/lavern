/**
 * Unit Tests — reproducing the firm's own letter.
 *
 * The pilot's complaint: "our demand letters always open with the same
 * boilerplate, and the one Starling generated does not follow that." What
 * matters here is that the firm's wording comes out unchanged, that a slot
 * the file cannot fill is visible rather than quietly dropped, and that
 * standard language which does not fit the file is called out.
 */

import { describe, it, expect } from 'vitest';
import {
  resolveSlots, fillSlots, renderHouseOpening, renderHouseClosing,
  checkHouseFormFit, houseFormContext, pronounInstruction, filedNameInstruction,
} from '../../src/employment/house-form.js';

const intake = {
  client_first_name: 'Aisha', client_last_name: 'Osei',
  employer_legal_name: 'Brightpath Financial Group Inc',
  job_title: 'Senior Portfolio Analyst',
  annual_salary: 110000,
  hire_date: '2019-09-03',
  termination_date: '2026-04-20',
} as never;

const analysis = { bardalFactors: { age: 47, tenureYears: 6.6 } } as never;

const slots = resolveSlots({
  intake, analysis,
  recipientName: 'Ms. R. Chen',
  salutation: 'Ms. Chen',
  lawyerName: 'Jordan Haworth',
  firmName: 'Evans Law Firm',
  fileNumber: 'EV-1044',
  demandAmount: 120000,
  responseDeadlineDays: 14,
});

describe('resolveSlots', () => {
  it('fills from the matter record, in the form correspondence uses', () => {
    expect(slots.CLIENT).toBe('Aisha Osei');
    expect(slots.EMPLOYER).toBe('Brightpath Financial Group Inc');
    expect(slots.POSITION).toBe('Senior Portfolio Analyst');
    expect(slots.SALARY).toBe('$110,000');
    expect(slots['DEMAND AMOUNT']).toBe('$120,000');
    expect(slots['DATE OF HIRE']).toBe('September 3, 2019');
    expect(slots['YEARS OF SERVICE']).toBe('6.6');
  });

  it('leaves a value the file does not have undefined rather than blank', () => {
    const bare = resolveSlots({ intake: { client_first_name: 'A' } as never });
    expect(bare.EMPLOYER).toBeUndefined();
    expect(bare.SALARY).toBeUndefined();
    expect(bare['DEMAND AMOUNT']).toBeUndefined();
  });
});

describe('fillSlots', () => {
  it('changes the slot and nothing else about the firm’s sentence', () => {
    const { text } = fillSlots(
      'We are the solicitors for [CLIENT], formerly employed by [EMPLOYER] as [POSITION].',
      slots,
    );
    expect(text).toBe('We are the solicitors for Aisha Osei, formerly employed by Brightpath Financial Group Inc as Senior Portfolio Analyst.');
  });

  it('makes an unfillable slot visible instead of dropping it', () => {
    // A fluent sentence with a fact missing from the middle is the failure
    // hardest to catch on a read.
    const { text, missing } = fillSlots('Your client paid [SEVERANCE PAID] on termination.', slots);
    expect(text).toContain('[LAWYER: severance paid]');
    expect(missing).toEqual(['SEVERANCE PAID']);
  });

  it('leaves prose that merely uses brackets alone', () => {
    const { text, missing } = fillSlots('the decision in Waksdale [2020] applies', slots);
    expect(text).toBe('the decision in Waksdale [2020] applies');
    expect(missing).toEqual([]);
  });
});

describe('renderHouseOpening', () => {
  // The pilot's described opening, in their notation.
  const block = [
    'WITHOUT PREJUDICE',
    '[EMPLOYER]',
    '[RECIPIENT ADDRESS]',
    'Dear [SALUTATION]:',
    'RE: [CLIENT] v. [EMPLOYER]',
  ];

  it('reproduces the firm’s opening, their capitals and their "v." kept', () => {
    const { html } = renderHouseOpening(block, slots);
    expect(html).toContain('WITHOUT PREJUDICE');
    expect(html).toContain('Dear Ms. Chen:');
    // Their form is "RE: client v. employer", not "Re: client and employer".
    expect(html).toContain('RE: Aisha Osei v. Brightpath Financial Group Inc');
    expect(html).not.toContain('Re: Aisha Osei and');
  });

  it('keeps the firm’s emphasis on the lines that carry it', () => {
    const { html } = renderHouseOpening(block, slots);
    expect(html).toContain('<strong>WITHOUT PREJUDICE</strong>');
    expect(html).toMatch(/<strong>RE: [^<]*<\/strong>/);
    // An ordinary line is not bolded.
    expect(html).toContain('<p>Brightpath Financial Group Inc</p>');
  });

  it('reports what the file could not fill', () => {
    const { missing } = renderHouseOpening(block, slots);
    expect(missing).toEqual(['RECIPIENT ADDRESS']);
  });
});

describe('renderHouseClosing', () => {
  it('reproduces the sign-off as the firm writes it', () => {
    const { html } = renderHouseClosing(['Yours very truly,', '[FIRM]', '[LAWYER]'], slots);
    expect(html).toContain('Yours very truly,');
    expect(html).toContain('Evans Law Firm');
    expect(html).toContain('Jordan Haworth');
  });
});

describe('checkHouseFormFit', () => {
  const clauses = [
    { part: 'Background', text: 'On [DATE OF TERMINATION] your client terminated her employment without cause.' },
  ];

  it('is quiet when the standard language fits the file', () => {
    expect(checkHouseFormFit(clauses, intake)).toEqual([]);
  });

  it('catches a dismissal recitation used on a resignation file', () => {
    // The exact case the pilot described: she resigned and was walked out.
    const resigned = { ...(intake as object), resigned: true } as never;
    const issues = checkHouseFormFit(clauses, resigned);
    expect(issues).toHaveLength(1);
    expect(issues[0].part).toBe('Background');
    expect(issues[0].message).toContain('the employer ended the employment');
  });

  it('catches constructive dismissal language on a file that does not plead it', () => {
    const issues = checkHouseFormFit(
      [{ part: 'Opening', text: 'This is a constructive dismissal.' }],
      intake,
    );
    expect(issues[0].message).toContain('a constructive dismissal');
  });

  it('is satisfied when the file does plead it', () => {
    const cd = { ...(intake as object), is_constructive_dismissal: true } as never;
    expect(checkHouseFormFit([{ part: 'Opening', text: 'This is a constructive dismissal.' }], cd)).toEqual([]);
  });

  it('reports each clause once, not once per matching phrase', () => {
    const resigned = { ...(intake as object), resigned: true } as never;
    const issues = checkHouseFormFit(
      [{ part: 'Background', text: 'terminated her employment without cause and dismissed her' }],
      resigned,
    );
    expect(issues).toHaveLength(1);
  });
});

describe('houseFormContext', () => {
  const context = houseFormContext({
    label: 'Evans demand letter',
    fixedClauses: [{ part: 'Opening paragraph', text: 'We are the solicitors for [CLIENT].' }],
    formStructure: ['Opening', 'Background', 'Entitlement', 'Demand'],
    voice: 'Firm and unadorned.',
  });

  it('says reproduce, not imitate', () => {
    expect(context).toContain('REPRODUCE');
    expect(context).toContain('Reproduce the standard passages word for word');
    expect(context).toContain('Do not improve, shorten, modernise or reorder them');
  });

  it('carries the firm’s standard language and the order of its parts', () => {
    expect(context).toContain('We are the solicitors for [CLIENT].');
    expect(context).toContain('1. Opening');
    expect(context).toContain('2. Background');
  });

  it('tells the drafter not to write the furniture that is supplied', () => {
    expect(context).toContain('The opening block and the closing are supplied already');
  });

  it('rewrites language that does not fit rather than dropping it', () => {
    // Changed at the lawyer's direction: every letter here is read before
    // it is sent, so a passage that does not fit should arrive rewritten
    // rather than removed with a note explaining its absence.
    expect(context).toContain('rewrite it');
    expect(context).toContain('smallest change the facts require');
  });

  it('still drops language for a point the file does not raise at all', () => {
    expect(context).toContain('leave that passage out');
  });

  it('is empty when there is no form to reproduce', () => {
    expect(houseFormContext({ label: 'x', fixedClauses: [] })).toBe('');
  });
});


describe('the firm’s heading casing', () => {
  // Mirrors the generator's rule. A letter reading BACKGROUND, ENTITLEMENT
  // and then "Damages Quantification" reads as two documents spliced.
  const OUR_HEADINGS = /^(damages\b|note to the lawyer)/i;
  const firmUsesCaps = (html: string) => {
    const headings = [...html.matchAll(/<h[12][^>]*>([^<]+)<\/h[12]>/gi)]
      .map(m => m[1].trim())
      .filter(h => !OUR_HEADINGS.test(h));
    return headings.length >= 2 && headings.every(h => h === h.toUpperCase());
  };

  it('is detected from the firm’s own headings', () => {
    expect(firmUsesCaps('<h2>BACKGROUND</h2><h2>ENTITLEMENT</h2><h2>DEMAND</h2>')).toBe(true);
  });

  it('ignores our headings, which arrive in our casing', () => {
    // Both of these poisoned the detection in live runs: one mixed-case
    // heading of OURS was enough to conclude the firm does not use capitals.
    expect(firmUsesCaps('<h2>BACKGROUND</h2><h2>Damages Quantification</h2><h2>DEMAND</h2>')).toBe(true);
    expect(firmUsesCaps('<h2>BACKGROUND</h2><h2>DEMAND</h2><h2>Note to the lawyer</h2>')).toBe(true);
  });

  it('leaves a firm that writes in title case alone', () => {
    expect(firmUsesCaps('<h2>Background</h2><h2>Entitlement</h2>')).toBe(false);
  });

  it('does not conclude anything from a single heading', () => {
    expect(firmUsesCaps('<h2>BACKGROUND</h2>')).toBe(false);
  });
});


describe('pronouns', () => {
  // The precedents were written for particular clients and carry their
  // pronouns. Another client's letter must not inherit them, and the
  // opening block is deterministic so the model cannot correct it there.
  const opening = ['We act on the termination of [POSSESSIVE] employment.', '[SUBJECT] was advised on [DATE OF TERMINATION].'];
  const forClient = (pronouns?: string) => resolveSlots({
    intake: { ...(intake as object), client_pronouns: pronouns } as never, analysis,
  });

  it('fills the possessive and the subject differently, which is the whole point', () => {
    // "her" is possessive in "her employment" and object in "advised her";
    // that is why the slot is chosen when the letter is learned, not now.
    const { html } = renderHouseOpening(opening, forClient('he'));
    expect(html).toContain('the termination of his employment');
    expect(html).toContain('he was advised');
  });

  it('carries she/her through unchanged', () => {
    const { html } = renderHouseOpening(opening, forClient('she'));
    expect(html).toContain('the termination of her employment');
    expect(html).toContain('she was advised');
  });

  it('uses their for they/them', () => {
    const { html } = renderHouseOpening(opening, forClient('they'));
    expect(html).toContain('the termination of their employment');
  });

  it('falls back to the client’s name rather than guessing', () => {
    // Never inferred from the name, so with nothing recorded the name
    // itself carries every position.
    const { html } = renderHouseOpening(opening, forClient(undefined));
    expect(html).toContain("the termination of Aisha Osei's employment");
    expect(html).not.toMatch(/\b(his|her|their) employment/);
  });

  it('does the same for name-only, which is how much correspondence is written', () => {
    const { html } = renderHouseOpening(opening, forClient('name'));
    expect(html).toContain("Aisha Osei's employment");
  });
});

describe('pronounInstruction', () => {
  it('tells the drafter what to use, and warns about singular they agreement', () => {
    expect(pronounInstruction('she')).toContain('she, her, hers');
    expect(pronounInstruction('they')).toContain('they were advised');
    expect(pronounInstruction('they')).toContain('not to be avoided');
  });

  it('forbids guessing when nothing is recorded', () => {
    expect(pronounInstruction(undefined)).toContain('never infer pronouns from a name');
    expect(pronounInstruction('name')).toContain('Do not use pronouns');
  });
});

describe('the reproduction rule', () => {
  const context = houseFormContext({
    label: 'x',
    fixedClauses: [{ part: 'Background', text: 'The employer terminated the employment.' }],
    pronouns: 'he',
    typicalWords: 900,
  });

  it('says rewrite at minimum, not rewrite freely', () => {
    expect(context).toContain('smallest change the facts require');
    expect(context).toContain('Do not take the mismatch as licence to rewrite the letter');
  });

  it('refuses to bend the facts to keep a sentence', () => {
    expect(context).toContain('Never state a fact the file does not support');
  });

  it('carries the pronouns and the firm’s own length', () => {
    expect(context).toContain('he, him, his');
    expect(context).toContain('900 words');
  });
});

describe('pronounInstruction in a filed document', () => {
  it('keeps the correspondence register when no party term is given', () => {
    expect(pronounInstruction(undefined)).toContain('"our client"');
    expect(pronounInstruction(undefined)).not.toContain('filed with a court');
  });

  it('forbids the correspondence register once a party term is given', () => {
    const out = pronounInstruction(undefined, 'Margaret');
    expect(out).toContain('"Margaret"');
    expect(out).toContain('Never write "our client" or "the client"');
  });

  it('carries the prohibition on every pronoun branch, not just the fallback', () => {
    for (const p of ['she', 'he', 'they', 'name', undefined]) {
      expect(pronounInstruction(p, 'Margaret')).toContain('Never write "our client"');
    }
  });

  it('leaves recorded pronouns intact', () => {
    expect(pronounInstruction('they', 'Margaret')).toContain('they, them, their');
  });
});

describe('filedNameInstruction', () => {
  it('defines the party once in full, then carries the first name', () => {
    const out = filedNameInstruction({ firstName: 'Margaret', lastName: 'Okonjo', partyLabel: 'The Applicant' });
    expect(out).toContain('The Applicant, Margaret Okonjo ("Margaret")');
    expect(out).toContain('call the party Margaret');
    expect(out).toContain('only once');
  });

  it('tells the model not to fall back to the party label', () => {
    const out = filedNameInstruction({ firstName: 'Margaret', lastName: 'Okonjo', partyLabel: 'The Applicant' });
    expect(out).toContain('Do not fall back to "The Applicant"');
  });

  it('returns undefined when the file has no first name, rather than defining a nameless party', () => {
    expect(filedNameInstruction({ firstName: '', lastName: 'Okonjo', partyLabel: 'The Applicant' })).toBeUndefined();
    expect(filedNameInstruction({ firstName: null, lastName: null, partyLabel: 'The Applicant' })).toBeUndefined();
  });

  it('works from a first name alone', () => {
    const out = filedNameInstruction({ firstName: 'Margaret', lastName: null, partyLabel: 'The Applicant' });
    expect(out).toContain('The Applicant, Margaret ("Margaret")');
  });
});
