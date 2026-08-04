/**
 * Unit Tests — precedent alignment (precedent-templates spec, Phase 2).
 *
 * Three or more precedents of the same type are diffed against each other:
 * recurring text is the firm's boilerplate and is kept verbatim, varying
 * text becomes a placeholder. The properties that matter are that the
 * firm's language survives untouched and that nothing is ever invented.
 */

import { describe, it, expect } from 'vitest';
import {
  alignPrecedents, renderTemplate, verifyNoInventedText, classifyValues,
  toLines, MIN_PRECEDENTS, type PrecedentInput, type MatterFacts,
} from '../../src/employment/precedent-alignment.js';

const BOILERPLATE_PARA =
  'At the time of termination our client was on an approved medical leave of absence. '
  + 'The termination of an employee while on medical leave engages the Human Rights Code, '
  + 'R.S.O. 1990, c. H.19, and gives rise to a claim for damages for injury to dignity.';

function letter(client: string, employer: string, salary: string, sum: string): string {
  return [
    'EVANS LAW FIRM',
    'Barristers and Solicitors',
    'WITHOUT PREJUDICE',
    'Dear Sirs/Mesdames:',
    `Re: ${client} - Wrongful Dismissal`,
    `We are counsel to ${client}.`,
    `Our client was employed by ${employer}.`,
    BOILERPLATE_PARA,
    `Our client earned an annual salary of ${salary}.`,
    `We are instructed to accept the sum of ${sum} in full and final satisfaction of all claims.`,
    'Yours truly,',
    'EVANS LAW FIRM',
  ].join('\n');
}

const PRECEDENTS: PrecedentInput[] = [
  { name: 'Nunes', text: letter('Vera Nunes', 'Halcyon Retail Inc', '$88,000', '$95,000') },
  { name: 'Vega', text: letter('Tess Vega', 'Northwind Freight Inc', '$95,000', '$130,000') },
  { name: 'Diallo', text: letter('Marcus Diallo', 'Lakeshore Foundry Inc', '$72,000', '$118,000') },
];

const FACTS: Array<MatterFacts | undefined> = [
  { client_first_name: 'Vera', client_last_name: 'Nunes', employer_legal_name: 'Halcyon Retail Inc' },
  { client_first_name: 'Tess', client_last_name: 'Vega', employer_legal_name: 'Northwind Freight Inc' },
  { client_first_name: 'Marcus', client_last_name: 'Diallo', employer_legal_name: 'Lakeshore Foundry Inc' },
];

describe('alignment', () => {
  it('refuses fewer than three precedents', () => {
    expect(() => alignPrecedents(PRECEDENTS.slice(0, 2))).toThrow(/at least 3/);
    expect(MIN_PRECEDENTS).toBe(3);
  });

  it('keeps the firm boilerplate verbatim', () => {
    const result = alignPrecedents(PRECEDENTS, FACTS);
    const stable = result.lines.filter(l => l.stable).map(l => l.skeleton);

    // The substantive legal paragraph is the firm's asset: it must survive
    // whole, not be broken into placeholders.
    expect(stable).toContain(BOILERPLATE_PARA);
    expect(stable).toContain('EVANS LAW FIRM');
    expect(stable).toContain('WITHOUT PREJUDICE');
    expect(stable).toContain('Dear Sirs/Mesdames:');
    expect(result.stableLineCount).toBeGreaterThanOrEqual(6);
  });

  it('finds the case-specific spans and what varied in them', () => {
    const result = alignPrecedents(PRECEDENTS, FACTS);
    expect(result.slots.length).toBeGreaterThan(0);

    // Every slot records one observed value per precedent.
    for (const slot of result.slots) {
      expect(slot.observedValues).toHaveLength(PRECEDENTS.length);
      expect(slot.observedValues.every(v => typeof v === 'string')).toBe(true);
    }

    // The client's name varied and was seen in all three forms.
    const allValues = result.slots.flatMap(s => s.observedValues).join(' | ');
    expect(allValues).toContain('Vera Nunes');
    expect(allValues).toContain('Tess Vega');
    expect(allValues).toContain('Marcus Diallo');
  });

  it('warns when the precedents share nothing', () => {
    const unrelated: PrecedentInput[] = [
      { name: 'a', text: 'alpha one\nalpha two' },
      { name: 'b', text: 'beta one\nbeta two' },
      { name: 'c', text: 'gamma one\ngamma two' },
    ];
    const result = alignPrecedents(unrelated);
    expect(result.warnings.join(' ')).toMatch(/did not recur|No text recurred/i);
  });
});

describe('classification', () => {
  it('matches values against the matter each precedent came from', () => {
    const result = classifyValues(
      ['Halcyon Retail Inc', 'Northwind Freight Inc', 'Lakeshore Foundry Inc'], FACTS,
    );
    expect(result.placeholder).toBe('EMPLOYER_NAME');
    expect(result.basis).toBe('matter_data');
  });

  it('recognises the client name in any form', () => {
    const result = classifyValues(['Vera Nunes', 'Tess Vega', 'Marcus Diallo'], FACTS);
    expect(result.placeholder).toBe('CLIENT_NAME');
    expect(result.basis).toBe('matter_data');
  });

  it('falls back to pattern matching for money and dates', () => {
    expect(classifyValues(['$88,000', '$95,000', '$72,000'], []).placeholder).toBe('AMOUNT');
    expect(classifyValues(['June 3, 2026', 'March 14, 2026', 'November 21, 2025'], []).placeholder).toBe('DATE');
  });

  it('leaves anything it cannot place for the lawyer to name', () => {
    const result = classifyValues(['blue', 'green', 'red'], []);
    expect(result.placeholder).toBeNull();
    expect(result.basis).toBe('unclassified');
  });
});

describe('rendering and the safety property', () => {
  it('never invents prose', () => {
    const result = alignPrecedents(PRECEDENTS, FACTS);
    const accepted = Object.fromEntries(
      result.slots.map(s => [s.id, s.suggestedPlaceholder]),
    );
    const rendered = renderTemplate(result, accepted);
    const check = verifyNoInventedText(result, rendered, PRECEDENTS);
    expect(check.offending).toEqual([]);
    expect(check.ok).toBe(true);
  });

  it('emits the boilerplate and placeholders, never a stray slot token', () => {
    const result = alignPrecedents(PRECEDENTS, FACTS);
    const accepted = Object.fromEntries(result.slots.map(s => [s.id, s.suggestedPlaceholder]));
    const rendered = renderTemplate(result, accepted);

    expect(rendered).toContain(BOILERPLATE_PARA);
    expect(rendered).toContain('WITHOUT PREJUDICE');
    expect(rendered).not.toContain('‹slot:');
  });

  it('restores the first precedent’s wording for a rejected slot', () => {
    const result = alignPrecedents(PRECEDENTS, FACTS);
    const rejected = Object.fromEntries(result.slots.map(s => [s.id, null]));
    const rendered = renderTemplate(result, rejected);
    expect(rendered).not.toContain('‹slot:');
    expect(rendered).not.toContain('{{');
  });

  it('can drop optional lines that only some precedents carry', () => {
    const withExtra: PrecedentInput[] = [
      { name: 'a', text: `${PRECEDENTS[0].text}\nOur client also claims punitive damages.` },
      PRECEDENTS[1],
      PRECEDENTS[2],
    ];
    const result = alignPrecedents(withExtra, FACTS);
    const accepted = Object.fromEntries(result.slots.map(s => [s.id, s.suggestedPlaceholder]));
    const kept = renderTemplate(result, accepted, { includeOptionalLines: true });
    const dropped = renderTemplate(result, accepted, { includeOptionalLines: false });
    expect(kept.length).toBeGreaterThanOrEqual(dropped.length);
  });
});

describe('text preparation', () => {
  it('normalises whitespace and drops blank lines', () => {
    expect(toLines('  One   two  \n\n\n  Three ')).toEqual(['One two', 'Three']);
  });
});

describe('end to end on realistic precedents', () => {
  it('separates each variable and names it from matter data', () => {
    const mk = (client: string, employer: string, title: string, salary: string) => [
      'EVANS LAW FIRM',
      'WITHOUT PREJUDICE',
      `We are counsel to ${client}. Our client was employed by ${employer} as a ${title}.`,
      BOILERPLATE_PARA,
      `Our client earned an annual salary of ${salary}.`,
      'Yours truly,',
    ].join('\n');

    const precedents: PrecedentInput[] = [
      { name: 'A', text: mk('Vera Nunes', 'Halcyon Retail Inc', 'Buyer', '$88,000') },
      { name: 'B', text: mk('Tess Vega', 'Northwind Freight Inc', 'Manager', '$95,000') },
      { name: 'C', text: mk('Marcus Diallo', 'Lakeshore Foundry Inc', 'Supervisor', '$72,000') },
    ];
    const facts: Array<MatterFacts | undefined> = [
      { client_first_name: 'Vera', client_last_name: 'Nunes', employer_legal_name: 'Halcyon Retail Inc', job_title: 'Buyer' },
      { client_first_name: 'Tess', client_last_name: 'Vega', employer_legal_name: 'Northwind Freight Inc', job_title: 'Manager' },
      { client_first_name: 'Marcus', client_last_name: 'Diallo', employer_legal_name: 'Lakeshore Foundry Inc', job_title: 'Supervisor' },
    ];

    const result = alignPrecedents(precedents, facts);

    // Each variable is its own slot, not one slot swallowing the line.
    expect(result.slots.length).toBeGreaterThanOrEqual(4);
    const byValue = (needle: string) =>
      result.slots.find(s => s.observedValues.some(v => v.includes(needle)));

    const clientSlot = byValue('Vera Nunes');
    const employerSlot = byValue('Halcyon');
    const titleSlot = byValue('Buyer');
    const salarySlot = byValue('88,000');

    expect(clientSlot?.suggestedPlaceholder).toBe('CLIENT_NAME');
    expect(employerSlot?.suggestedPlaceholder).toBe('EMPLOYER_NAME');
    expect(titleSlot?.suggestedPlaceholder).toBe('JOB_TITLE');
    expect(salarySlot?.suggestedPlaceholder).toBe('AMOUNT');

    // No slot swallowed a neighbour's value.
    expect(clientSlot?.observedValues.join(' ')).not.toContain('Halcyon');

    // The firm's legal paragraph is untouched, and the rendered template
    // carries placeholders rather than one case's facts.
    const accepted = Object.fromEntries(result.slots.map(s => [s.id, s.suggestedPlaceholder]));
    const rendered = renderTemplate(result, accepted);
    expect(rendered).toContain(BOILERPLATE_PARA);
    expect(rendered).toContain('{{CLIENT_NAME}}');
    expect(rendered).toContain('{{EMPLOYER_NAME}}');
    expect(rendered).not.toContain('Vera Nunes');
    expect(verifyNoInventedText(result, rendered, precedents).ok).toBe(true);
  });
});

describe('redacted precedents (verified 2026-08-04)', () => {
  const boiler = 'At the time of termination our client was on an approved medical leave of absence.';
  const letter = (client: string, employer: string) => [
    'EVANS LAW FIRM', 'WITHOUT PREJUDICE',
    `We are counsel to ${client}. Our client was employed by ${employer}.`,
    boiler, 'Yours truly,',
  ].join('\n');

  it('warns when the same redaction marker appears in every precedent', () => {
    // The dangerous case: an identical marker RECURS, so it reads as firm
    // boilerplate and would be written into the template as though it were
    // the firm's own wording.
    const result = alignPrecedents([
      { name: 'a', text: letter('[REDACTED]', '[REDACTED]') },
      { name: 'b', text: letter('[REDACTED]', '[REDACTED]') },
      { name: 'c', text: letter('[REDACTED]', '[REDACTED]') },
    ]);
    expect(result.slots).toHaveLength(0);
    expect(result.warnings.join(' ')).toMatch(/redacted/i);
    expect(result.warnings.join(' ')).toMatch(/unredacted precedents/i);
  });

  it('warns for block-character redaction too', () => {
    const result = alignPrecedents([
      { name: 'a', text: letter('███████', '█████████') },
      { name: 'b', text: letter('█████', '███████████') },
      { name: 'c', text: letter('█████████', '███████') },
    ]);
    expect(result.warnings.join(' ')).toMatch(/redact/i);
  });

  it('warns when only some precedents are redacted', () => {
    const result = alignPrecedents([
      { name: 'a', text: letter('[REDACTED]', '[REDACTED]') },
      { name: 'b', text: letter('[REDACTED]', '[REDACTED]') },
      { name: 'c', text: letter('Marcus Diallo', 'Lakeshore Foundry Inc') },
    ]);
    expect(result.slots.length).toBeGreaterThan(0);
    expect(result.warnings.join(' ')).toMatch(/redact/i);
  });

  it('stays quiet for clean precedents', () => {
    const result = alignPrecedents([
      { name: 'a', text: letter('Vera Nunes', 'Halcyon Retail Inc') },
      { name: 'b', text: letter('Tess Vega', 'Northwind Freight Inc') },
      { name: 'c', text: letter('Marcus Diallo', 'Lakeshore Foundry Inc') },
    ]);
    expect(result.warnings.join(' ')).not.toMatch(/redact/i);
  });
});
