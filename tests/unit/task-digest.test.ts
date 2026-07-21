/**
 * Unit Tests — weekly per-lawyer task digest runner.
 *
 * Own-data-only, opt-in, Monday-08:00 Toronto window with marker dedup,
 * file numbers only. Distinct from the disabled firm-wide digest.
 */

import { describe, it, expect, beforeAll, vi } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { initDatabase, saveMatter, createUser, setTaskDigestOptIn, isTaskDigestOptedIn } from '../../src/db/database.js';
import { buildUserTaskDigest, maybeSendTaskDigests } from '../../src/starling/task-digest-runner.js';

// Monday 2026-07-20, 08:30 America/Toronto (EDT, UTC-4) = 12:30Z.
const MONDAY_8AM = new Date('2026-07-20T12:30:00Z');
// Tuesday same week, same hour.
const TUESDAY_8AM = new Date('2026-07-21T12:30:00Z');

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

let lawyerId: string;
let quietId: string;

beforeAll(() => {
  initDatabase(':memory:');
  const lawyer = createUser('jane@smithlaw.ca', 'x', 'Jane Smith', 'Smith Law');
  lawyerId = lawyer.id;
  const quiet = createUser('raj@smithlaw.ca', 'x', 'Raj Patel', 'Smith Law');
  quietId = quiet.id;

  saveMatter(lawyerId, 'm-dig-1', JSON.stringify({
    title: 'm-dig-1',
    matterNumber: 'DP-2026-0009',
    employmentData: { intake: { client_first_name: 'Ana', client_last_name: 'Reyes', employer_legal_name: 'Beta Inc' } },
    debriefs: [{
      id: 'dbf-1', createdAt: '2026-07-01T00:00:00Z', callType: 'client', summary: 'Notes.',
      actionItems: [
        { id: 'ai-od', task: 'Send mitigation reminder', owner: 'lawyer', dueDate: isoDaysFromNow(-2), kind: 'email', context: '', status: 'open' },
        { id: 'ai-wk', task: 'Draft reply to offer', owner: 'lawyer', dueDate: isoDaysFromNow(4), kind: 'document', context: '', status: 'open' },
        { id: 'ai-later', task: 'Review disclosure', owner: 'lawyer', dueDate: isoDaysFromNow(30), kind: 'task', context: '', status: 'open' },
        { id: 'ai-done', task: 'Send retainer', owner: 'lawyer', dueDate: isoDaysFromNow(-5), kind: 'email', context: '', status: 'done' },
      ],
    }],
  }), 'active');
});

describe('buildUserTaskDigest', () => {
  it('splits outstanding (overdue) from the week ahead, file numbers only', () => {
    const digest = buildUserTaskDigest(lawyerId);
    expect(digest.outstanding.map(r => r.title)).toEqual(['Send mitigation reminder']);
    expect(digest.weekAhead.map(r => r.title)).toEqual(['Draft reply to offer']);
    // Later and done items stay out; rows carry the file number, not names.
    expect(digest.outstanding[0].fileNumber).toBe('DP-2026-0009');
    const all = [...digest.outstanding, ...digest.weekAhead];
    expect(JSON.stringify(all)).not.toContain('Ana');
    expect(JSON.stringify(all)).not.toContain('Beta Inc');
  });

  it('is empty for a user with no matters', () => {
    const digest = buildUserTaskDigest(quietId);
    expect(digest.outstanding).toHaveLength(0);
    expect(digest.weekAhead).toHaveLength(0);
  });
});

describe('maybeSendTaskDigests', () => {
  const markerDir = fs.mkdtempSync(path.join(os.tmpdir(), 'task-digest-'));

  it('sends only in the Monday-08:00 window, only to opted-in users, once per week', async () => {
    const sender = vi.fn().mockResolvedValue(true);
    const marker = path.join(markerDir, 'm1');

    // Nobody opted in yet: window open but no sends.
    expect(await maybeSendTaskDigests(marker, MONDAY_8AM, sender)).toBe(0);

    setTaskDigestOptIn(lawyerId, true);
    setTaskDigestOptIn(quietId, true); // opted in but empty digest — skipped

    // Outside the window: nothing.
    const marker2 = path.join(markerDir, 'm2');
    expect(await maybeSendTaskDigests(marker2, TUESDAY_8AM, sender)).toBe(0);
    expect(sender).not.toHaveBeenCalled();

    // In the window: exactly one send (the lawyer with content).
    expect(await maybeSendTaskDigests(marker2, MONDAY_8AM, sender)).toBe(1);
    expect(sender).toHaveBeenCalledOnce();
    expect(sender.mock.calls[0][0]).toBe('jane@smithlaw.ca');
    const digest = sender.mock.calls[0][1] as { outstanding: unknown[]; weekAhead: unknown[] };
    expect(digest.outstanding).toHaveLength(1);
    expect(digest.weekAhead).toHaveLength(1);

    // Same week, second tick: marker dedup, no double-send.
    expect(await maybeSendTaskDigests(marker2, MONDAY_8AM, sender)).toBe(0);
    expect(sender).toHaveBeenCalledOnce();
  });

  it('opt-out stops the send', async () => {
    setTaskDigestOptIn(lawyerId, false);
    expect(isTaskDigestOptedIn(lawyerId)).toBe(false);
    const sender = vi.fn().mockResolvedValue(true);
    const marker = path.join(markerDir, 'm3');
    expect(await maybeSendTaskDigests(marker, MONDAY_8AM, sender)).toBe(0);
    expect(sender).not.toHaveBeenCalled();
  });
});
