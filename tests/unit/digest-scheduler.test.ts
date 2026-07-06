/**
 * Unit Tests — weekly digest scheduler timing and dedup.
 *
 * The scheduler fires on Monday 08:xx America/Toronto and must not double-send
 * within the same week. Time is injected so the test is deterministic; the
 * marker lives in a temp file. Email sends no-op without RESEND_API_KEY, so
 * these run offline.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase } from '../../src/db/database.js';
import { torontoNow, maybeSendWeeklyDigest } from '../../src/starling/digest-runner.js';

let markerPath: string;

beforeEach(() => {
  initDatabase(':memory:');
  markerPath = path.join(os.tmpdir(), `digest-marker-${process.pid}-${Math.floor(process.hrtime()[1])}`);
  try { fs.unlinkSync(markerPath); } catch { /* absent */ }
});

afterEach(() => {
  try { fs.unlinkSync(markerPath); } catch { /* absent */ }
});

describe('torontoNow', () => {
  it('maps a known UTC instant to Toronto weekday and hour', () => {
    // 2026-07-06 12:00Z is Monday; Toronto is UTC-4 in July → 08:00 local.
    const t = torontoNow(new Date('2026-07-06T12:00:00Z'));
    expect(t.weekday).toBe(1); // Monday
    expect(t.hour).toBe(8);
    expect(t.ymd).toBe('2026-07-06');
  });
});

describe('maybeSendWeeklyDigest', () => {
  it('does not fire outside the Monday 08:00 window', async () => {
    // Monday 09:00 Toronto (13:00Z in July)
    const sent = await maybeSendWeeklyDigest('x@example.com', markerPath, new Date('2026-07-06T13:00:00Z'));
    expect(sent).toBe(false);
    expect(fs.existsSync(markerPath)).toBe(false);
  });

  it('does not fire on a non-Monday', async () => {
    // Tuesday 08:00 Toronto
    const sent = await maybeSendWeeklyDigest('x@example.com', markerPath, new Date('2026-07-07T12:00:00Z'));
    expect(sent).toBe(false);
  });

  it('fires in the window and writes the marker', async () => {
    const sent = await maybeSendWeeklyDigest('x@example.com', markerPath, new Date('2026-07-06T12:00:00Z'));
    expect(sent).toBe(true);
    expect(fs.readFileSync(markerPath, 'utf8').trim()).toBe('2026-07-06');
  });

  it('does not double-send the same Monday', async () => {
    const now = new Date('2026-07-06T12:30:00Z');
    expect(await maybeSendWeeklyDigest('x@example.com', markerPath, now)).toBe(true);
    // A second tick within the same hour/day is suppressed by the marker.
    expect(await maybeSendWeeklyDigest('x@example.com', markerPath, now)).toBe(false);
  });

  it('sends again the following Monday', async () => {
    await maybeSendWeeklyDigest('x@example.com', markerPath, new Date('2026-07-06T12:00:00Z'));
    const nextWeek = await maybeSendWeeklyDigest('x@example.com', markerPath, new Date('2026-07-13T12:00:00Z'));
    expect(nextWeek).toBe(true);
    expect(fs.readFileSync(markerPath, 'utf8').trim()).toBe('2026-07-13');
  });
});
