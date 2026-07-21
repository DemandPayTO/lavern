/**
 * Task inbox routes — the unified cross-matter task list.
 *
 * One list of everything the lawyer owes across every matter they own:
 * docket deadlines (court and negotiation clocks) plus debrief action items
 * (dated or not), normalized to TaskRow and banded by due date at read time.
 * Overdue is DERIVED, never stored: an open item with a past due date reads
 * as overdue on the next load, so "updates as things are missed" needs no
 * cron and no writes. Deterministic throughout — no LLM.
 *
 * The calendar feed is a TOKEN feed, not a cookie route: calendar apps
 * re-fetch on their own schedule with no browser session, so the URL itself
 * carries a per-user, revocable capability (intake-portal pattern, hashed at
 * rest). Feed events are minimized to the firm file number, never the client
 * name. See docs/specs/task-inbox-2026-07.md.
 */

import crypto from 'node:crypto';
import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import {
  getMattersByUser, getMatterById, saveMatter,
  saveFeedToken, getFeedTokenUser, getFeedTokenInfo,
} from '../../db/database.js';
import { collectDeadlines, type DeadlineItem } from '../../employment/deadlines.js';
import { actionItemId, type ActionItem, type DebriefEntry } from '../../employment/debrief.js';

// ── TaskRow ─────────────────────────────────────────────────────────────

type TaskBand = 'overdue' | 'today' | 'week' | 'later' | 'none';

interface TaskRow {
  /** Action items carry their stored id (PATCHable); deadlines a derived one. */
  id: string;
  matterId: string;
  matterLabel: string;
  /** DP-/firm file number for compact display. */
  fileNumber: string;
  title: string;
  source: 'action' | 'deadline';
  kind: ActionItem['kind'] | DeadlineItem['kind'];
  dueDate: string | null;
  isCourt: boolean;
  band: TaskBand;
  status: 'open' | 'done';
  emailSubject?: string;
  emailBody?: string;
}

function daysFromToday(isoDate: string): number {
  const target = new Date(`${isoDate}T00:00:00`);
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
}

function bandFor(dueDate: string | null, status: 'open' | 'done'): TaskBand {
  if (status === 'done' || !dueDate) return 'none';
  const days = daysFromToday(dueDate);
  if (isNaN(days)) return 'none';
  if (days < 0) return 'overdue';
  if (days === 0) return 'today';
  if (days <= 7) return 'week';
  return 'later';
}

// ── Matter parsing helpers ──────────────────────────────────────────────

interface ParsedMatter {
  m: Record<string, unknown>;
  matterLabel: string;
  fileNumber: string;
}

function parseMatterRow(row: { id: string; data_json: string }): ParsedMatter | null {
  let m: Record<string, unknown>;
  try {
    m = JSON.parse(row.data_json) as Record<string, unknown>;
  } catch {
    return null; // corrupt row — skip, never break the inbox
  }
  const employment = m.employmentData as { intake?: Record<string, unknown> } | undefined;
  const labour = m.labourData as { intake?: Record<string, unknown> } | undefined;
  const eIntake = employment?.intake;
  const lIntake = labour?.intake;
  const client = [eIntake?.client_first_name, eIntake?.client_last_name].filter(Boolean).join(' ')
    || [lIntake?.grievor_first_name, lIntake?.grievor_last_name].filter(Boolean).join(' ');
  const employer = String(eIntake?.employer_legal_name ?? eIntake?.employer_operating_name ?? lIntake?.employer_name ?? '');
  const matterLabel = client && employer ? `${client} v ${employer}` : client || employer || String(m.title ?? row.id);
  const fileNumber = String(m.firmFileNumber || m.matterNumber || row.id);
  return { m, matterLabel, fileNumber };
}

function actionRows(matterId: string, parsed: ParsedMatter): TaskRow[] {
  const out: TaskRow[] = [];
  const debriefs = (parsed.m.debriefs ?? []) as DebriefEntry[];
  for (const d of debriefs) {
    for (const it of d.actionItems ?? []) {
      if (!it?.id || !it.task) continue;
      const status: 'open' | 'done' = it.status === 'done' ? 'done' : 'open';
      const row: TaskRow = {
        id: it.id,
        matterId,
        matterLabel: parsed.matterLabel,
        fileNumber: parsed.fileNumber,
        title: it.task,
        source: 'action',
        kind: it.kind ?? 'task',
        dueDate: it.dueDate ?? null,
        isCourt: false,
        band: bandFor(it.dueDate ?? null, status),
        status,
      };
      if (it.kind === 'email') {
        if (it.emailSubject) row.emailSubject = it.emailSubject;
        if (it.emailBody) row.emailBody = it.emailBody;
      }
      out.push(row);
    }
  }
  return out;
}

const BAND_ORDER: Record<TaskBand, number> = { overdue: 0, today: 1, week: 2, later: 3, none: 4 };

function buildInbox(userId: string): TaskRow[] {
  const rows = getMattersByUser(userId);
  const tasks: TaskRow[] = [];
  const parsedById = new Map<string, ParsedMatter>();
  for (const row of rows) {
    const parsed = parseMatterRow(row);
    if (!parsed) continue;
    parsedById.set(row.id, parsed);
    tasks.push(...actionRows(row.id, parsed));
  }
  // Deadlines from the shared collector; its action_item entries are skipped
  // because the debrief walk above already emitted them with their real ids.
  for (const d of collectDeadlines(rows)) {
    if (d.kind === 'action_item') continue;
    const parsed = parsedById.get(d.matterId);
    tasks.push({
      id: `${d.matterId}-${d.kind}-${d.date}`,
      matterId: d.matterId,
      matterLabel: d.matterLabel,
      fileNumber: parsed?.fileNumber ?? d.matterId,
      title: d.label,
      source: 'deadline',
      kind: d.kind,
      dueDate: d.date,
      isCourt: d.isCourt,
      band: bandFor(d.date, 'open'),
      status: 'open',
    });
  }
  // Default order: band, then court-first, then date, then title.
  tasks.sort((a, b) =>
    BAND_ORDER[a.band] - BAND_ORDER[b.band]
    || Number(b.isCourt) - Number(a.isCourt)
    || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999')
    || a.title.localeCompare(b.title));
  return tasks;
}

// ── Feed helpers ────────────────────────────────────────────────────────

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

const MANUAL_DEBRIEF_ID = 'dbf-manual';

export function registerTaskRoutes(fastify: FastifyInstance): void {
  // ── GET /api/tasks — the unified inbox ────────────────────────────────
  fastify.get('/api/tasks', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const tasks = buildInbox(userId);
    const counts = { overdue: 0, today: 0, week: 0, later: 0, none: 0, done: 0 };
    for (const t of tasks) {
      if (t.status === 'done') counts.done += 1;
      else counts[t.band] += 1;
    }
    return reply.send({ ok: true, tasks, counts });
  });

  // ── POST /api/tasks — quick-add a manual task to a matter ─────────────
  fastify.post('/api/tasks', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const schema = z.object({
      matterId: z.string().min(1),
      title: z.string().trim().min(1).max(500),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
      kind: z.enum(['task', 'email', 'call', 'filing', 'document']).default('task'),
    }).strict();
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid task', details: parsed.error.issues.map(i => i.message) });
    }
    const row = getMatterById(parsed.data.matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const pm = parseMatterRow(row);
    if (!pm) return reply.status(500).send({ ok: false, error: 'Matter data unreadable' });

    const item: ActionItem = {
      id: actionItemId(parsed.data.kind),
      task: parsed.data.title,
      owner: 'lawyer',
      dueDate: parsed.data.dueDate ?? null,
      kind: parsed.data.kind,
      context: 'Added from the task inbox.',
      status: 'open',
    };
    // Quick-adds accumulate on one rolling synthetic debrief entry so they
    // flow through the same action-item pipeline (docket, feed, digest).
    const debriefs = (pm.m.debriefs ?? []) as DebriefEntry[];
    let entry = debriefs.find((d) => d.id === MANUAL_DEBRIEF_ID);
    if (!entry) {
      entry = {
        id: MANUAL_DEBRIEF_ID,
        createdAt: new Date().toISOString(),
        callType: 'other',
        summary: 'Quick-added tasks from the task inbox.',
        actionItems: [],
      };
      debriefs.push(entry);
    }
    entry.actionItems.push(item);
    pm.m.debriefs = debriefs;
    await saveMatter(userId, row.id, JSON.stringify(pm.m), (pm.m.status as string) ?? 'active');

    const task: TaskRow = {
      id: item.id, matterId: row.id, matterLabel: pm.matterLabel, fileNumber: pm.fileNumber,
      title: item.task, source: 'action', kind: item.kind, dueDate: item.dueDate,
      isCourt: false, band: bandFor(item.dueDate, 'open'), status: 'open',
    };
    return reply.send({ ok: true, task });
  });

  // ── PATCH /api/tasks/:matterId/:itemId — check off / reopen / reschedule ──
  // Action items only. Deadlines derive from matter facts and are read-only
  // here (change the underlying date on the matter instead).
  fastify.patch('/api/tasks/:matterId/:itemId', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId, itemId } = req.params as { matterId: string; itemId: string };
    const schema = z.object({
      status: z.enum(['open', 'done']).optional(),
      dueDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    }).strict().refine((b) => b.status !== undefined || b.dueDate !== undefined, {
      message: 'Provide status or dueDate',
    });
    const parsed = schema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid update', details: parsed.error.issues.map(i => i.message) });
    }
    const row = getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const pm = parseMatterRow(row);
    if (!pm) return reply.status(500).send({ ok: false, error: 'Matter data unreadable' });

    const debriefs = (pm.m.debriefs ?? []) as DebriefEntry[];
    let found: ActionItem | undefined;
    for (const d of debriefs) {
      found = (d.actionItems ?? []).find((it) => it.id === itemId);
      if (found) break;
    }
    if (!found) return reply.status(404).send({ ok: false, error: 'Task not found on this matter' });

    if (parsed.data.status !== undefined) found.status = parsed.data.status;
    if (parsed.data.dueDate !== undefined) found.dueDate = parsed.data.dueDate;
    pm.m.debriefs = debriefs;
    await saveMatter(userId, row.id, JSON.stringify(pm.m), (pm.m.status as string) ?? 'active');

    const status: 'open' | 'done' = found.status === 'done' ? 'done' : 'open';
    return reply.send({
      ok: true,
      task: {
        id: found.id, matterId: row.id, matterLabel: pm.matterLabel, fileNumber: pm.fileNumber,
        title: found.task, source: 'action', kind: found.kind, dueDate: found.dueDate,
        isCourt: false, band: bandFor(found.dueDate, status), status,
      } satisfies TaskRow,
    });
  });

  // ── GET /api/tasks/feed — feed status (never the token) ───────────────
  fastify.get('/api/tasks/feed', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const info = getFeedTokenInfo(userId);
    return reply.send({ ok: true, active: Boolean(info), createdAt: info?.created_at ?? null });
  });

  // ── POST /api/tasks/feed — mint (or regenerate) the subscribe URL ─────
  // Returns the token exactly once; only its hash is stored. Regenerating
  // revokes the previous URL (existing calendar subscriptions go stale).
  fastify.post('/api/tasks/feed', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const token = crypto.randomBytes(24).toString('base64url');
    saveFeedToken(hashToken(token), userId);
    return reply.send({ ok: true, path: `/api/tasks/calendar/${token}.ics` });
  });

  // ── GET /api/tasks/calendar/:token.ics — the subscribable feed ────────
  // PUBLIC path (calendar apps carry no cookie); the token is the auth.
  // Served without Content-Disposition so clients treat it as a live feed.
  // Event text is minimized to the firm file number, never the client name.
  fastify.get('/api/tasks/calendar/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const raw = (req.params as { token: string }).token;
    const token = raw.endsWith('.ics') ? raw.slice(0, -4) : raw;
    const userId = token ? getFeedTokenUser(hashToken(token)) : undefined;
    if (!userId) return reply.status(404).send({ ok: false, error: 'Unknown feed' });

    const rows = getMattersByUser(userId);
    const fileNumbers = new Map<string, string>();
    for (const row of rows) {
      const parsed = parseMatterRow(row);
      if (parsed) fileNumbers.set(row.id, parsed.fileNumber);
    }
    const items = collectDeadlines(rows).map((d) => ({
      ...d,
      matterLabel: fileNumbers.get(d.matterId) ?? d.matterId,
    }));
    const { buildDocketIcs } = await import('../../employment/docket-ics.js');
    return reply
      .header('Content-Type', 'text/calendar; charset=utf-8')
      .header('Cache-Control', 'no-cache')
      .send(buildDocketIcs(items));
  });
}
