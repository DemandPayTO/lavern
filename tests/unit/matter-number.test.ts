/**
 * Unit Tests — matter number prefix (src/types/matter.ts)
 *
 * The auto-generated number must use the configurable prefix (default DP,
 * never the SHEM codename) and firmFileNumber must be an optional field on
 * the record.
 */

import { describe, it, expect, afterEach } from 'vitest';
import { generateMatterNumber, createMatterRecord } from '../../src/types/matter.js';

describe('generateMatterNumber', () => {
  const prev = process.env.STARLING_MATTER_PREFIX;
  afterEach(() => {
    if (prev === undefined) delete process.env.STARLING_MATTER_PREFIX;
    else process.env.STARLING_MATTER_PREFIX = prev;
  });

  it('defaults to the DP prefix, never SHEM', () => {
    delete process.env.STARLING_MATTER_PREFIX;
    const n = generateMatterNumber();
    expect(n).toMatch(/^DP-\d{4}-\d{3}$/);
    expect(n).not.toContain('SHEM');
  });

  it('honours a configured prefix', () => {
    process.env.STARLING_MATTER_PREFIX = 'HAW';
    expect(generateMatterNumber()).toMatch(/^HAW-\d{4}-\d{3}$/);
  });

  it('createMatterRecord has no firmFileNumber until set, and a non-SHEM number', () => {
    delete process.env.STARLING_MATTER_PREFIX;
    const rec = createMatterRecord('client-1', 'Test', 'desc');
    expect(rec.firmFileNumber).toBeUndefined();
    expect(rec.matterNumber).not.toContain('SHEM');
  });
});
