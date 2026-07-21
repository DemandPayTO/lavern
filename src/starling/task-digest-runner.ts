/**
 * Weekly per-lawyer task digest runner.
 *
 * Every Monday 08:00 America/Toronto, each OPTED-IN lawyer gets one email
 * with their OWN outstanding items and the week ahead — nothing firm-wide,
 * nothing about other lawyers' matters, file numbers only. This is
 * deliberately distinct from the disabled firm digest (which broadcast
 * client matter labels across the firm); it is per-user, own-data-only,
 * and off by default.
 *
 * Deterministic: pure aggregation over the task inbox, no LLM.
 */

import fs from 'node:fs';
import { buildInbox } from '../api/routes/tasks.js';
import { torontoNow } from './digest-runner.js';
import { getTaskDigestOptIns, getUserById } from '../db/database.js';
import { sendTaskDigestEmail, type TaskDigestRow } from '../email/send.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TASK-DIGEST');

export interface UserTaskDigest {
  outstanding: TaskDigestRow[];
  weekAhead: TaskDigestRow[];
}

/** The user's own overdue items and the week ahead, minimized to file numbers. */
export function buildUserTaskDigest(userId: string): UserTaskDigest {
  const { tasks } = buildInbox(userId);
  const open = tasks.filter(t => t.status === 'open');
  const toRow = (t: (typeof tasks)[number]): TaskDigestRow => ({
    title: t.title, fileNumber: t.fileNumber, dueDate: t.dueDate, isCourt: t.isCourt,
  });
  return {
    outstanding: open.filter(t => t.band === 'overdue').map(toRow),
    weekAhead: open.filter(t => t.band === 'today' || t.band === 'week').map(toRow),
  };
}

type Sender = typeof sendTaskDigestEmail;

/**
 * Send each opted-in lawyer their digest if the Monday-08:00 window has
 * arrived and this week's send has not already gone out (marker-file dedup,
 * same pattern as the firm digest). Users with no email and empty digests
 * are skipped. Returns the number of digests sent this call.
 */
export async function maybeSendTaskDigests(
  markerPath: string,
  now: Date = new Date(),
  sender: Sender = sendTaskDigestEmail,
): Promise<number> {
  const { weekday, hour, ymd } = torontoNow(now);
  if (weekday !== 1 || hour !== 8) return 0;

  let last = '';
  try { last = fs.readFileSync(markerPath, 'utf8').trim(); } catch { /* no marker yet */ }
  if (last === ymd) return 0;

  // Marker first: a slow send must not re-trigger on the next tick, and a
  // failed week skips rather than retrying into a mailbox flood.
  try { fs.writeFileSync(markerPath, ymd); }
  catch (err) { logger.warn('Could not write task-digest marker; sending anyway', err); }

  let sent = 0;
  for (const userId of getTaskDigestOptIns()) {
    try {
      if (userId === 'local-user') continue; // synthetic account, placeholder inbox
      const user = getUserById(userId);
      if (!user?.email || user.email === 'local@localhost') continue;
      const digest = buildUserTaskDigest(userId);
      if (digest.outstanding.length === 0 && digest.weekAhead.length === 0) continue; // no noise
      if (await sender(user.email, digest)) {
        sent += 1;
        logger.info('Task digest sent', { userId, outstanding: digest.outstanding.length, weekAhead: digest.weekAhead.length });
      }
    } catch (err) {
      // One user's failure never blocks the rest of the send list.
      logger.warn('Task digest failed for user', { userId, error: err instanceof Error ? err.message : String(err) });
    }
  }
  return sent;
}
