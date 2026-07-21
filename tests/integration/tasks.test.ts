/**
 * Integration Tests — unified task inbox + token calendar feed.
 *
 * The inbox aggregates deadlines and debrief action items across every
 * matter the user owns, banded by due date at read time. The calendar feed
 * authorizes by revocable token (no cookie) and minimizes event text to
 * file numbers. See docs/specs/task-inbox-2026-07.md.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import type { FastifyInstance } from 'fastify';
import { initDatabase, saveMatter, createUser } from '../../src/db/database.js';
import { registerTaskRoutes } from '../../src/api/routes/tasks.js';

let app: FastifyInstance;
const USER = 'local-user';

function isoDaysFromNow(days: number): string {
  const d = new Date();
  d.setHours(12, 0, 0, 0);
  d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}

interface TaskRow {
  id: string; matterId: string; matterLabel: string; fileNumber: string;
  title: string; source: 'action' | 'deadline'; kind: string;
  dueDate: string | null; isCourt: boolean;
  band: 'overdue' | 'today' | 'week' | 'later' | 'none';
  status: 'open' | 'done';
}

interface InboxResponse {
  ok: boolean;
  tasks: TaskRow[];
  counts: { overdue: number; today: number; week: number; later: number; none: number; done: number };
}

async function fetchInbox(): Promise<InboxResponse> {
  const res = await app.inject({ method: 'GET', url: '/api/tasks' });
  expect(res.statusCode).toBe(200);
  return res.json() as InboxResponse;
}

beforeAll(async () => {
  initDatabase(':memory:');
  app = Fastify({ logger: false });
  registerTaskRoutes(app);
  await app.ready();

  // Matter 1: intake + a court timeline deadline + debrief items across bands.
  saveMatter(USER, 'm-task-1', JSON.stringify({
    title: 'm-task-1',
    matterNumber: 'DP-2026-0001',
    firmFileNumber: 'SL-441',
    employmentData: {
      intake: { client_first_name: 'Ana', client_last_name: 'Reyes', employer_legal_name: 'Beta Inc' },
      timeline: [
        { date: isoDaysFromNow(4), label: 'Statement of Defence due', source: 'system' },
      ],
    },
    debriefs: [{
      id: 'dbf-1', createdAt: '2026-07-01T00:00:00Z', callType: 'client', summary: 'Call notes.',
      actionItems: [
        { id: 'ai-overdue', task: 'Send mitigation reminder', owner: 'lawyer', dueDate: isoDaysFromNow(-2), kind: 'email', context: '', status: 'open', emailSubject: 'Mitigation update', emailBody: 'Draft body' },
        { id: 'ai-today', task: 'Call client re offer', owner: 'lawyer', dueDate: isoDaysFromNow(0), kind: 'call', context: '', status: 'open' },
        { id: 'ai-week', task: 'Draft reply affidavit', owner: 'lawyer', dueDate: isoDaysFromNow(5), kind: 'document', context: '', status: 'open' },
        { id: 'ai-later', task: 'Review disclosure', owner: 'lawyer', dueDate: isoDaysFromNow(30), kind: 'task', context: '', status: 'open' },
        { id: 'ai-undated', task: 'Consider expert report', owner: 'lawyer', dueDate: null, kind: 'task', context: '', status: 'open' },
        { id: 'ai-done', task: 'Send retainer', owner: 'lawyer', dueDate: isoDaysFromNow(-5), kind: 'email', context: '', status: 'done' },
      ],
    }],
  }), 'active');

  // Matter 2: second matter, one dated item — proves cross-matter aggregation.
  saveMatter(USER, 'm-task-2', JSON.stringify({
    title: 'm-task-2',
    matterNumber: 'DP-2026-0002',
    employmentData: { intake: { client_first_name: 'Omar', client_last_name: 'Diallo', employer_legal_name: 'Gamma Corp' } },
    debriefs: [{
      id: 'dbf-2', createdAt: '2026-07-02T00:00:00Z', callType: 'client', summary: 'Notes.',
      actionItems: [
        { id: 'ai-m2', task: 'File HRTO application', owner: 'lawyer', dueDate: isoDaysFromNow(2), kind: 'filing', context: '', status: 'open' },
      ],
    }],
  }), 'active');

  // Another user's matter must never surface for local-user.
  const other = createUser('other@test.local', 'x', 'Other User', 'Other Firm');
  saveMatter(other.id, 'm-other', JSON.stringify({
    title: 'm-other',
    matterNumber: 'DP-2026-9999',
    debriefs: [{
      id: 'dbf-x', createdAt: '2026-07-01T00:00:00Z', callType: 'client', summary: 'Notes.',
      actionItems: [
        { id: 'ai-other', task: 'Other user task', owner: 'lawyer', dueDate: isoDaysFromNow(1), kind: 'task', context: '', status: 'open' },
      ],
    }],
  }), 'active');
});

afterAll(async () => {
  await app.close();
});

describe('task inbox aggregation', () => {
  it('aggregates action items and deadlines across matters, scoped to the user', async () => {
    const body = await fetchInbox();
    const ids = body.tasks.map(t => t.id);
    expect(ids).toContain('ai-overdue');
    expect(ids).toContain('ai-m2');                          // second matter present
    expect(ids).not.toContain('ai-other');                   // other user's task invisible
    const sod = body.tasks.find(t => t.source === 'deadline' && /Statement of Defence/.test(t.title));
    expect(sod).toBeDefined();
    expect(sod!.isCourt).toBe(true);
    expect(sod!.matterId).toBe('m-task-1');
  });

  it('bands by due date at read time (overdue/today/week/later/none)', async () => {
    const body = await fetchInbox();
    const byId = new Map(body.tasks.map(t => [t.id, t]));
    expect(byId.get('ai-overdue')!.band).toBe('overdue');
    expect(byId.get('ai-today')!.band).toBe('today');
    expect(byId.get('ai-week')!.band).toBe('week');
    expect(byId.get('ai-later')!.band).toBe('later');
    expect(byId.get('ai-undated')!.band).toBe('none');
    expect(byId.get('ai-done')!.band).toBe('none');          // done never counts as overdue
    expect(byId.get('ai-done')!.status).toBe('done');
    expect(body.counts.overdue).toBeGreaterThanOrEqual(1);
    expect(body.counts.done).toBeGreaterThanOrEqual(1);
  });

  it('sorts overdue first and carries the firm file number', async () => {
    const body = await fetchInbox();
    expect(body.tasks[0].band).toBe('overdue');
    const m1 = body.tasks.find(t => t.matterId === 'm-task-1')!;
    expect(m1.fileNumber).toBe('SL-441');                    // firmFileNumber wins over matterNumber
    const m2 = body.tasks.find(t => t.matterId === 'm-task-2')!;
    expect(m2.fileNumber).toBe('DP-2026-0002');
  });

  it('returns a matter directory with file numbers and recency for the glance', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks' });
    const body = res.json() as { matters: Array<{ matterId: string; matterLabel: string; fileNumber: string; status: string; updatedAt: string }> };
    const m1 = body.matters.find(m => m.matterId === 'm-task-1')!;
    expect(m1.matterLabel).toBe('Ana Reyes v Beta Inc');
    expect(m1.fileNumber).toBe('SL-441');
    expect(m1.status).toBe('active');
    expect(m1.updatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(body.matters.some(m => m.matterId === 'm-other')).toBe(false); // scoped
  });

  it('quick-add round-trips into the inbox as a manual action item', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/tasks',
      payload: { matterId: 'm-task-2', title: 'Chase medical records', dueDate: isoDaysFromNow(3) },
    });
    expect(res.statusCode).toBe(200);
    const { task } = res.json() as { task: TaskRow };
    expect(task.source).toBe('action');
    expect(task.band).toBe('week');

    const body = await fetchInbox();
    const added = body.tasks.find(t => t.id === task.id);
    expect(added).toBeDefined();
    expect(added!.title).toBe('Chase medical records');
  });

  it('rejects quick-add to a matter the user does not own', async () => {
    const res = await app.inject({
      method: 'POST', url: '/api/tasks',
      payload: { matterId: 'm-other', title: 'Should fail' },
    });
    expect(res.statusCode).toBe(404);
  });

  it('PATCH checks off, reopens, and reschedules an action item', async () => {
    let res = await app.inject({ method: 'PATCH', url: '/api/tasks/m-task-1/ai-week', payload: { status: 'done' } });
    expect(res.statusCode).toBe(200);
    expect((res.json() as { task: TaskRow }).task.status).toBe('done');

    res = await app.inject({ method: 'PATCH', url: '/api/tasks/m-task-1/ai-week', payload: { status: 'open', dueDate: isoDaysFromNow(1) } });
    expect(res.statusCode).toBe(200);
    const task = (res.json() as { task: TaskRow }).task;
    expect(task.status).toBe('open');
    expect(task.dueDate).toBe(isoDaysFromNow(1));
    expect(task.band).toBe('week');
  });

  it('PATCH 404s for unknown items (deadlines are read-only here)', async () => {
    const res = await app.inject({ method: 'PATCH', url: '/api/tasks/m-task-1/no-such-item', payload: { status: 'done' } });
    expect(res.statusCode).toBe(404);
  });
});

describe('weekly digest opt-in', () => {
  it('is unavailable for the synthetic local user (no inbox to send to)', async () => {
    const res = await app.inject({ method: 'GET', url: '/api/tasks/digest' });
    expect(res.statusCode).toBe(200);
    const body = res.json() as { available: boolean; optedIn: boolean };
    expect(body.available).toBe(false);
    expect(body.optedIn).toBe(false);

    const post = await app.inject({ method: 'POST', url: '/api/tasks/digest', payload: { optIn: true } });
    expect(post.statusCode).toBe(400);
  });
});

describe('calendar feed (token)', () => {
  let feedPath: string;

  it('mints a feed URL and reports feed status', async () => {
    const before = await app.inject({ method: 'GET', url: '/api/tasks/feed' });
    expect((before.json() as { active: boolean }).active).toBe(false);

    const res = await app.inject({ method: 'POST', url: '/api/tasks/feed' });
    expect(res.statusCode).toBe(200);
    feedPath = (res.json() as { path: string }).path;
    expect(feedPath).toMatch(/^\/api\/tasks\/calendar\/[A-Za-z0-9_-]+\.ics$/);

    const after = await app.inject({ method: 'GET', url: '/api/tasks/feed' });
    expect((after.json() as { active: boolean }).active).toBe(true);
  });

  it('serves a live text/calendar feed minimized to file numbers', async () => {
    const res = await app.inject({ method: 'GET', url: feedPath });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toContain('text/calendar');
    expect(res.headers['content-disposition']).toBeUndefined();   // a feed, not a download
    expect(res.body).toContain('BEGIN:VCALENDAR');
    expect(res.body).toContain('BEGIN:VEVENT');
    expect(res.body).toContain('SL-441');                         // file number present
    expect(res.body).not.toContain('Ana');                        // client name never in the feed
    expect(res.body).not.toContain('Reyes');
    expect(res.body).not.toContain('Beta Inc');
  });

  it('404s an unknown token and revokes the old URL on regenerate', async () => {
    const bogus = await app.inject({ method: 'GET', url: '/api/tasks/calendar/not-a-real-token.ics' });
    expect(bogus.statusCode).toBe(404);

    const res = await app.inject({ method: 'POST', url: '/api/tasks/feed' });
    const newPath = (res.json() as { path: string }).path;
    expect(newPath).not.toBe(feedPath);

    const old = await app.inject({ method: 'GET', url: feedPath });
    expect(old.statusCode).toBe(404);                             // old token revoked
    const fresh = await app.inject({ method: 'GET', url: newPath });
    expect(fresh.statusCode).toBe(200);
  });
});
