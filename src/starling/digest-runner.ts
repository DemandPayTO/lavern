/**
 * Weekly digest runner — shared by the admin HTTP route and the in-app
 * scheduler so both build and send the digest identically.
 *
 * The digest is two emails: the weekly statistics (documents, findings,
 * spend) and the deadline docket across every user's matters. The recipient
 * is the firm principal, so the aggregation deliberately spans all users
 * (it runs behind X-Admin-Key on the route, and behind a server-side
 * environment setting in the scheduler).
 */

import fs from 'node:fs';
import { aggregateWeeklyDigest, type WeeklyDigest } from './status-monitor.js';
import { collectDeadlines, type DeadlineItem } from '../employment/deadlines.js';
import { getAllUserIds, getMattersByUser } from '../db/database.js';
import { sendClawDigestEmail, sendDeadlineDigestEmail } from '../email/send.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DIGEST-RUNNER');

export interface DigestPayload {
  digest: WeeklyDigest;
  deadlines: DeadlineItem[];
}

/** Aggregate the weekly statistics and the firm-wide deadline docket. */
export function buildWeeklyDigest(): DigestPayload {
  const digest = aggregateWeeklyDigest();
  const deadlines = getAllUserIds()
    .flatMap(uid => collectDeadlines(getMattersByUser(uid)))
    .sort((a, b) => a.date.localeCompare(b.date));
  return { digest, deadlines };
}

/** Build and email the weekly digest to a single recipient. */
export async function sendWeeklyDigest(email: string): Promise<{
  statsSent: boolean;
  deadlinesSent: boolean;
} & DigestPayload> {
  const { digest, deadlines } = buildWeeklyDigest();
  const statsSent = await sendClawDigestEmail(email, digest);
  const deadlinesSent = await sendDeadlineDigestEmail(email, deadlines);
  if (!deadlinesSent) logger.warn('Deadline digest email failed (stats digest may still have sent)');
  return { statsSent, deadlinesSent, digest, deadlines };
}

/** Current weekday (0=Sun) and hour in America/Toronto, plus the local date. */
export function torontoNow(now: Date): { weekday: number; hour: number; ymd: string } {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Toronto',
    weekday: 'long', hour: '2-digit', hourCycle: 'h23',
    year: 'numeric', month: '2-digit', day: '2-digit',
  }).formatToParts(now);
  const get = (t: string): string => parts.find(p => p.type === t)?.value ?? '';
  const weekdayMap: Record<string, number> = {
    Sunday: 0, Monday: 1, Tuesday: 2, Wednesday: 3, Thursday: 4, Friday: 5, Saturday: 6,
  };
  return {
    weekday: weekdayMap[get('weekday')] ?? -1,
    hour: parseInt(get('hour'), 10),
    ymd: `${get('year')}-${get('month')}-${get('day')}`,
  };
}

/**
 * Send the weekly digest if the moment has arrived and it has not already
 * gone out this week. Fires on Monday between 08:00 and 08:59 America/Toronto.
 * The marker file (on the persistent data volume in production) records the
 * Toronto date of the last send so a redeploy inside the window does not
 * double-send. Returns true when a send was attempted this call.
 */
export async function maybeSendWeeklyDigest(
  email: string,
  markerPath: string,
  now: Date = new Date(),
): Promise<boolean> {
  const { weekday, hour, ymd } = torontoNow(now);
  if (weekday !== 1 || hour !== 8) return false;

  let last = '';
  try { last = fs.readFileSync(markerPath, 'utf8').trim(); } catch { /* no marker yet */ }
  if (last === ymd) return false;

  // Write the marker before sending so a slow send cannot be re-triggered by
  // the next tick, and a failed send skips the week rather than retrying into
  // a mailbox flood.
  try { fs.writeFileSync(markerPath, ymd); }
  catch (err) { logger.warn('Could not write digest marker; sending anyway', err); }

  logger.info(`Sending scheduled weekly digest to ${email}`);
  const res = await sendWeeklyDigest(email);
  return res.statsSent || res.deadlinesSent;
}
