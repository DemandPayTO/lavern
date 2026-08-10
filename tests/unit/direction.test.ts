/**
 * Unit Tests — drafting direction.
 *
 * The pilot's case: "on this one we just want her four weeks of unpaid
 * resignation notice." A letter that says that in its prose and itemises
 * eight to twelve months in its table is worse than no direction, so what
 * matters is that the direction GOVERNS and that a draft ignoring it says
 * so rather than looking finished.
 */

import { describe, it, expect } from 'vitest';
import {
  directionContext, effectiveInstructions, checkDirectionTerms, departureFlags,
  buildDirectionExtractionPrompt, buildDepartureCheckPrompt, extractLawyerNote,
  DIRECTION_EXTRACTION_SYSTEM,
} from '../../src/employment/direction.js';

const inst = (text: string, extra: Record<string, unknown> = {}) =>
  ({ id: `i-${text.slice(0, 4)}`, text, kind: 'scope', ...extra }) as never;

const matter = {
  instructions: [inst('Demand only the four weeks of unpaid resignation notice.')],
  withheld: ['the client will accept 3 weeks to end it'],
} as never;

describe('directionContext', () => {
  it('is empty when there is no direction, so callers can append it blindly', () => {
    expect(directionContext({})).toBe('');
    expect(directionContext({ matter: { instructions: [] } as never })).toBe('');
  });

  it('tells the drafter the direction outranks the default structure', () => {
    const context = directionContext({ matter });
    expect(context).toContain('GOVERN');
    expect(context).toContain('FOLLOW THE INSTRUCTION');
    expect(context).toContain('Demand only the four weeks');
  });

  it('says a narrowing instruction narrows the claim', () => {
    const context = directionContext({ matter });
    expect(context).toContain('the draft claims only that');
    expect(context).toContain('do not add heads of damage the direction does not support');
  });

  it('never puts withheld material into a drafting prompt', () => {
    const context = directionContext({ matter });
    expect(context).not.toContain('accept 3 weeks');
    expect(context).not.toContain('withheld');
  });

  it('lets a document instruction beat the file instruction, and says so', () => {
    const context = directionContext({
      matter,
      document: { instructions: [inst('Plead the bonus claim in the statement of claim.')] } as never,
    });
    expect(context).toContain('Direction for this file:');
    expect(context).toContain('this governs');
    expect(context.indexOf('Demand only the four weeks')).toBeLessThan(context.indexOf('Plead the bonus claim'));
  });

  it('tells the drafter to speak up rather than silently half-follow', () => {
    expect(directionContext({ matter })).toContain('Note to the lawyer');
  });
});

describe('effectiveInstructions', () => {
  it('is the file direction then the document direction', () => {
    const all = effectiveInstructions({
      matter,
      document: { instructions: [inst('Keep it to two pages.')] } as never,
    });
    expect(all.map(i => i.text)).toEqual([
      'Demand only the four weeks of unpaid resignation notice.',
      'Keep it to two pages.',
    ]);
  });

  it('is empty when nothing binds', () => {
    expect(effectiveInstructions({})).toEqual([]);
  });
});

describe('checkDirectionTerms', () => {
  const instructions = [
    inst('Do not plead punitive damages.', { kind: 'exclude', mustNotInclude: ['punitive'] }),
    inst('Demand the unpaid notice period.', { kind: 'include', mustInclude: ['notice period'] }),
  ];

  it('is silent on a compliant draft', () => {
    const html = '<p>We demand payment of the unpaid notice period of four weeks.</p>';
    expect(checkDirectionTerms(html, instructions)).toEqual([]);
  });

  it('catches a term the direction forbade', () => {
    const html = '<p>We demand the unpaid notice period and punitive damages.</p>';
    const flags = checkDirectionTerms(html, instructions);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('Do not plead punitive damages');
    expect(flags[0]).toContain('it mentions "punitive"');
  });

  it('catches a term the direction required', () => {
    const flags = checkDirectionTerms('<p>We demand payment forthwith.</p>', instructions);
    expect(flags.some(f => f.includes('does not mention "notice period"'))).toBe(true);
  });

  it('reads through the markup, not around it', () => {
    // The term is split across tags in the rendered letter.
    const html = '<p>We claim <strong>punitive</strong> damages.</p>';
    expect(checkDirectionTerms(html, instructions).some(f => f.includes('punitive'))).toBe(true);
  });

  it('ignores case, because a draft capitalises where a lawyer does not', () => {
    const html = '<p>PUNITIVE DAMAGES are claimed. The notice period is owed.</p>';
    expect(checkDirectionTerms(html, instructions).some(f => f.includes('punitive'))).toBe(true);
  });

  it('says nothing for instructions with no literal terms, leaving those to the review pass', () => {
    const judgment = [inst('Keep the tone conciliatory.', { kind: 'tone' })];
    expect(checkDirectionTerms('<p>Anything at all.</p>', judgment)).toEqual([]);
  });
});

describe('departureFlags', () => {
  it('flags only what was not followed, and says what happened instead', () => {
    const flags = departureFlags([
      { instruction: 'Demand only the notice period.', followed: false, departure: 'It also claims reasonable notice at common law.' },
      { instruction: 'Keep it short.', followed: true },
    ]);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('Demand only the notice period');
    expect(flags[0]).toContain('also claims reasonable notice');
  });

  it('still says something useful when the check gave no reason', () => {
    const flags = departureFlags([{ instruction: 'Keep it short.', followed: false }]);
    expect(flags[0]).toContain('Read the draft against the instruction');
  });
});

describe('the extraction prompt', () => {
  it('separates instructions from what must never reach the other side', () => {
    expect(DIRECTION_EXTRACTION_SYSTEM).toContain('WITHHELD');
    expect(DIRECTION_EXTRACTION_SYSTEM).toContain('When in doubt, withhold it');
    expect(DIRECTION_EXTRACTION_SYSTEM).toContain('what the client will actually accept');
  });

  it('refuses to invent direction the notes do not support', () => {
    expect(DIRECTION_EXTRACTION_SYSTEM).toContain('Do not infer instructions from what a file of this kind usually needs');
  });

  it('does not treat a conditional as direction', () => {
    expect(DIRECTION_EXTRACTION_SYSTEM).toContain('It is not yet direction');
  });

  it('carries the notes and the document it is for', () => {
    const prompt = buildDirectionExtractionPrompt({
      notes: 'Partner: just chase the four weeks.',
      documentLabel: 'Demand Letter',
      intake: { client_first_name: 'Aisha', client_last_name: 'Osei', annual_salary: 110000 } as never,
    });
    expect(prompt).toContain('Demand Letter');
    expect(prompt).toContain('Aisha Osei');
    expect(prompt).toContain('just chase the four weeks');
  });

  it('says the direction is for the file when no document is named', () => {
    const prompt = buildDirectionExtractionPrompt({ notes: 'x' });
    expect(prompt).toContain('this file as a whole');
  });
});

describe('the departure check prompt', () => {
  it('gives the checker the instructions and the draft as text', () => {
    const prompt = buildDepartureCheckPrompt(
      '<p>We demand <strong>four weeks</strong> of pay.</p>',
      [inst('Demand only the notice period.')],
    );
    expect(prompt).toContain('1. Demand only the notice period.');
    expect(prompt).toContain('We demand four weeks of pay.');
    expect(prompt).not.toContain('<strong>');
  });
});


describe('the drafter’s note back', () => {
  const letter = '<p>We demand four weeks of pay.</p>\n<h2>Note to the lawyer</h2>\n<p>Per your direction I have not pleaded common law reasonable notice or punitive damages.</p>';

  it('comes out of the document, which is one that gets sent', () => {
    const { html, note } = extractLawyerNote(letter);
    expect(html).toContain('We demand four weeks');
    expect(html).not.toContain('Note to the lawyer');
    expect(html).not.toContain('reasonable notice');
    expect(note).toContain('not pleaded common law reasonable notice');
  });

  it('leaves a document without one untouched', () => {
    const plain = '<p>We demand four weeks of pay.</p>';
    expect(extractLawyerNote(plain)).toEqual({ html: plain });
  });

  it('stops the note causing a false departure on the very terms it obeyed', () => {
    // The live failure: the note said the letter OMITTED "reasonable notice"
    // and "punitive damages", and the literal check read those words and
    // reported two departures on a compliant letter.
    const instructions = [
      inst('Do not plead reasonable notice.', { mustNotInclude: ['reasonable notice'] }),
      inst('Do not claim punitive damages.', { mustNotInclude: ['punitive'] }),
    ];
    expect(checkDirectionTerms(letter, instructions)).toHaveLength(2);
    expect(checkDirectionTerms(extractLawyerNote(letter).html, instructions)).toEqual([]);
  });

  it('handles any heading level, since the drafter picks its own', () => {
    expect(extractLawyerNote('<p>Body.</p><h3>Note to the Lawyer</h3><p>x</p>').note).toBe('x');
  });
});


describe('the note must not take the sign-off with it', () => {
  it('keeps furniture that follows the note', () => {
    // A live run lost the entire closing: the note ran to the end of what
    // the model wrote, and the sign-off is appended after the body, so
    // taking everything to the end of the string swallowed it.
    const doc = [
      '<p>We demand payment.</p>',
      '<h2>Note to the lawyer</h2>',
      '<p>The standard background sentence does not fit this file.</p>',
      '<p>Yours very truly,</p>',
      '<p>EVANS LAW FIRM</p>',
    ].join('');
    const { html, note } = extractLawyerNote(doc);
    expect(html).toContain('We demand payment.');
    expect(html).toContain('Yours very truly,');
    expect(html).toContain('EVANS LAW FIRM');
    expect(html).not.toContain('Note to the lawyer');
    expect(html).not.toContain('does not fit this file');
    expect(note).toContain('does not fit this file');
    expect(note).not.toContain('EVANS LAW FIRM');
  });

  it('still takes the whole note when nothing follows it', () => {
    const doc = '<p>Body.</p><h2>Note to the lawyer</h2><p>Something to know.</p>';
    const { html, note } = extractLawyerNote(doc);
    expect(html).toBe('<p>Body.</p>');
    expect(note).toBe('Something to know.');
  });
});

describe('clampDirectionExtraction', () => {
  it('cuts an instruction list past the cap instead of failing it', async () => {
    const { clampDirectionExtraction, MAX_INSTRUCTIONS } = await import('../../src/employment/direction.js');
    const raw = { instructions: Array.from({ length: 40 }, (_, i) => ({ text: `Instruction ${i}`, kind: 'scope' })) };
    const out = clampDirectionExtraction(raw) as { instructions: unknown[] };
    expect(out.instructions.length).toBe(MAX_INSTRUCTIONS);
  });

  it('trims overlong instruction text and drops null optionals', async () => {
    const { clampDirectionExtraction } = await import('../../src/employment/direction.js');
    const raw = {
      instructions: [{ text: 'x'.repeat(1000), kind: 'scope', mustInclude: null, mustNotInclude: null }],
      withheld: null,
      proposedHeads: null,
    };
    const out = clampDirectionExtraction(raw) as { instructions: Array<Record<string, unknown>> };
    expect((out.instructions[0].text as string).length).toBeLessThanOrEqual(600);
    expect('mustInclude' in out.instructions[0]).toBe(false);
    expect('withheld' in out).toBe(false);
    expect('proposedHeads' in out).toBe(false);
  });

  it('clamped output passes the shape a long client email produces', async () => {
    const { clampDirectionExtraction } = await import('../../src/employment/direction.js');
    const raw = {
      instructions: Array.from({ length: 25 }, (_, i) => ({
        text: `Point ${i}: ` + 'the client explains at length. '.repeat(30),
        kind: i % 2 ? 'include' : 'scope',
        mustInclude: Array.from({ length: 12 }, (_, n) => `term ${n} ` + 'y'.repeat(150)),
      })),
      withheld: Array.from({ length: 30 }, () => 'z'.repeat(400)),
      proposedHeads: [{ label: 'L'.repeat(300), basis: 'B'.repeat(400), amount: null }],
    };
    const out = clampDirectionExtraction(raw) as {
      instructions: Array<{ text: string; mustInclude: string[] }>;
      withheld: string[];
      proposedHeads: Array<{ label: string; basis: string }>;
    };
    expect(out.instructions.length).toBeLessThanOrEqual(20);
    expect(out.instructions[0].text.length).toBeLessThanOrEqual(600);
    expect(out.instructions[0].mustInclude.length).toBeLessThanOrEqual(8);
    expect(out.instructions[0].mustInclude[0].length).toBeLessThanOrEqual(120);
    expect(out.withheld.length).toBeLessThanOrEqual(20);
    expect(out.withheld[0].length).toBeLessThanOrEqual(300);
    expect(out.proposedHeads[0].label.length).toBeLessThanOrEqual(200);
    expect(out.proposedHeads[0].basis.length).toBeLessThanOrEqual(300);
  });
});

describe('repairTruncatedJson', () => {
  it('closes a reply cut off mid-list and keeps every complete instruction', async () => {
    const { repairTruncatedJson } = await import('../../src/employment/direction.js');
    const truncated = '{"instructions":[{"text":"Demand only the commission.","kind":"scope"},{"text":"Keep it to two pa';
    const repaired = repairTruncatedJson(truncated);
    expect(repaired).not.toBeNull();
    const parsed = JSON.parse(repaired!) as { instructions: Array<{ text: string }> };
    expect(parsed.instructions.length).toBe(1);
    expect(parsed.instructions[0].text).toBe('Demand only the commission.');
  });

  it('a reply cut off between objects survives with both', async () => {
    const { repairTruncatedJson } = await import('../../src/employment/direction.js');
    const truncated = '{"instructions":[{"text":"A.","kind":"scope"},{"text":"B.","kind":"tone"}],"withheld":["the settlement figure"';
    const parsed = JSON.parse(repairTruncatedJson(truncated)!) as { instructions: unknown[]; withheld: string[] };
    expect(parsed.instructions.length).toBe(2);
    expect(parsed.withheld).toEqual(['the settlement figure']);
  });

  it('complete JSON comes back whole', async () => {
    const { repairTruncatedJson } = await import('../../src/employment/direction.js');
    const whole = '{"instructions":[{"text":"A.","kind":"scope"}]}';
    expect(JSON.parse(repairTruncatedJson(whole)!)).toEqual(JSON.parse(whole));
  });

  it('handles escaped quotes inside instruction text', async () => {
    const { repairTruncatedJson } = await import('../../src/employment/direction.js');
    const truncated = String.raw`{"instructions":[{"text":"Say \"without prejudice\" on top.","kind":"include"},{"text":"unfini`;
    const parsed = JSON.parse(repairTruncatedJson(truncated)!) as { instructions: Array<{ text: string }> };
    expect(parsed.instructions.length).toBe(1);
    expect(parsed.instructions[0].text).toContain('without prejudice');
  });

  it('returns null when nothing is salvageable', async () => {
    const { repairTruncatedJson } = await import('../../src/employment/direction.js');
    expect(repairTruncatedJson('I could not produce instructions.')).toBeNull();
    expect(repairTruncatedJson('{"instru')).toBeNull();
  });

  it('the extraction prompt states the hard output limits', async () => {
    const { DIRECTION_EXTRACTION_SYSTEM } = await import('../../src/employment/direction.js');
    expect(DIRECTION_EXTRACTION_SYSTEM).toContain('at most 20 instructions');
    expect(DIRECTION_EXTRACTION_SYSTEM).toContain('merge repeated points');
  });
});
