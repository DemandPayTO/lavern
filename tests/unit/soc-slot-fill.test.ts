/**
 * Unit Tests — filling the claim's blanks from the file's documents.
 *
 * The properties: a fill without a quote that string-verifies against a
 * source is dropped; the model cannot volunteer slots nobody asked for;
 * the clamp keeps long output from failing; rewrites only touch the
 * prose slots given.
 */

import { describe, it, expect } from 'vitest';
import { clampSlotFill, enforceFillQuotes, PROSE_SLOTS } from '../../src/employment/soc-slot-fill.js';
import type { SlotFillResult } from '../../src/employment/soc-slot-fill.js';

const SOURCES = [{ name: 'the demand letter', text: 'Ms. Osei was entitled to 8 weeks of notice under section 57. Her territory was reduced without consultation in April 2026.' }];

describe('enforceFillQuotes', () => {
  it('keeps a fill whose quote verifies, drops one whose quote does not', () => {
    const result: SlotFillResult = {
      fills: {
        esa_notice_weeks: { value: '8', sourceQuote: 'entitled to 8 weeks of notice under section 57', sourceName: 'the demand letter' },
        cd_changes: { value: 'territory eliminated entirely', sourceQuote: 'her territory was eliminated entirely without notice' },
      },
      rewrites: {},
    };
    const { kept, droppedFills } = enforceFillQuotes(result, SOURCES);
    expect(Object.keys(kept.fills)).toEqual(['esa_notice_weeks']);
    expect(droppedFills).toEqual(['cd_changes']);
  });

  it('smart quotes and whitespace do not defeat verification', () => {
    const result: SlotFillResult = {
      fills: { cd_changes: { value: 'territory reduced', sourceQuote: 'Her territory  was reduced without consultation' } },
      rewrites: {},
    };
    const { kept } = enforceFillQuotes(result, SOURCES);
    expect(Object.keys(kept.fills)).toEqual(['cd_changes']);
  });
});

describe('clampSlotFill', () => {
  it('trims overlong values instead of failing them, and drops null names', () => {
    const clamped = clampSlotFill({
      fills: { a: { value: 'x'.repeat(900), sourceQuote: 'q'.repeat(1000), sourceName: null } },
      rewrites: { b: 'y'.repeat(3000), c: '' },
    }) as { fills: Record<string, { value: string; sourceQuote: string }>; rewrites: Record<string, string> };
    expect(clamped.fills.a.value.length).toBeLessThanOrEqual(600);
    expect(clamped.fills.a.sourceQuote.length).toBeLessThanOrEqual(800);
    expect('sourceName' in clamped.fills.a).toBe(false);
    expect(clamped.rewrites.b.length).toBeLessThanOrEqual(2000);
    expect('c' in clamped.rewrites).toBe(false);
  });
});

describe('PROSE_SLOTS', () => {
  it('covers the narrative intake answers that read wrong verbatim', () => {
    for (const slot of ['termination_reasons', 'cd_changes', 'bad_faith_termination_particulars', 'hrc_conduct_description']) {
      expect(PROSE_SLOTS.has(slot), slot).toBe(true);
    }
  });
});
