import { describe, it, expect } from 'vitest';
import { enforceHouseStyle } from '../../src/utils/house-style.js';

describe('enforceHouseStyle', () => {
  it('converts a spaced em dash to a comma', () => {
    expect(enforceHouseStyle('The grievor — a millwright — was discharged.'))
      .toBe('The grievor, a millwright, was discharged.');
  });

  it('converts an unspaced em dash to a hyphen', () => {
    expect(enforceHouseStyle('2015—2020')).toBe('2015-2020');
  });

  it('leaves clean text untouched', () => {
    const clean = '<p>The Union grieves the discharge of the grievor.</p>';
    expect(enforceHouseStyle(clean)).toBe(clean);
  });

  // The entity forms matter because the route sanitises generated HTML on the
  // way out, and sanitize-html decodes entities. An em dash written as
  // "&mdash;" survived this function and became a real em dash downstream,
  // after enforcement had already run.
  it('converts a spaced named entity to a comma', () => {
    expect(enforceHouseStyle('The grievor &mdash; a millwright &mdash; was discharged.'))
      .toBe('The grievor, a millwright, was discharged.');
  });

  it('converts an unspaced named entity to a hyphen', () => {
    expect(enforceHouseStyle('2015&mdash;2020')).toBe('2015-2020');
  });

  it('converts the decimal numeric entity', () => {
    expect(enforceHouseStyle('A &#8212; B')).toBe('A, B');
    expect(enforceHouseStyle('A&#8212;B')).toBe('A-B');
  });

  it('converts the hexadecimal numeric entity, in either case', () => {
    expect(enforceHouseStyle('A &#x2014; B')).toBe('A, B');
    expect(enforceHouseStyle('A &#X2014; B')).toBe('A, B');
  });

  it('leaves an en dash and a hyphen alone', () => {
    expect(enforceHouseStyle('pages 10–12 and re-employment')).toBe('pages 10–12 and re-employment');
  });

  it('leaves an escaped entity alone, which is literal text and not a dash', () => {
    expect(enforceHouseStyle('the string &amp;mdash; appears here'))
      .toBe('the string &amp;mdash; appears here');
  });

  it('survives sanitisation without reintroducing the character', () => {
    const enforced = enforceHouseStyle('<p>The applicant &mdash; then 64 &mdash; was dismissed.</p>');
    expect(enforced).not.toContain('&mdash;');
    expect(enforced).not.toContain('—');
  });
});
