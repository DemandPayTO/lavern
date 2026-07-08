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
});
