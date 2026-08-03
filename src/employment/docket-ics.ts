/**
 * Docket ICS Export — the deadline docket as an iCalendar file, so every
 * date Starling tracks lands in the firm's calendar (Outlook, Google,
 * Apple) as an all-day event.
 *
 * Deterministic: pure formatting over collectDeadlines output. UIDs are
 * stable per (matter, kind, date), so re-importing or subscribing updates
 * events instead of duplicating them.
 */

import type { DeadlineItem } from './deadlines.js';

function icsEscape(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');
}

/** Fold long lines at 75 octets per RFC 5545. */
function fold(line: string): string {
  if (line.length <= 75) return line;
  const parts: string[] = [];
  let rest = line;
  parts.push(rest.slice(0, 75));
  rest = rest.slice(75);
  while (rest.length > 0) {
    parts.push(' ' + rest.slice(0, 74));
    rest = rest.slice(74);
  }
  return parts.join('\r\n');
}

function dateBasic(iso: string): string {
  return iso.replace(/-/g, '');
}

function nextDay(iso: string): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + 1);
  return d.toISOString().slice(0, 10);
}

const KIND_LABELS: Record<DeadlineItem['kind'], string> = {
  limitation: 'Limitation',
  demand_response: 'Demand response',
  severance_offer: 'Severance offer',
  timeline: 'Deadline',
  client_email: 'Client email',
  grievance_filing: 'Grievance filing',
  grievance_referral: 'Referral to arbitration',
  grievance_step: 'Grievance step',
  action_item: 'Action item',
  approval: 'Approval due',
};

/**
 * Build an iCalendar document from docket items. `generatedAtIso` is the
 * DTSTAMP applied to every event (injectable for deterministic tests).
 */
export function buildDocketIcs(items: DeadlineItem[], generatedAtIso?: string): string {
  const stamp = (generatedAtIso ?? new Date().toISOString()).replace(/[-:]/g, '').replace(/\.\d{3}/, '');
  const lines: string[] = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//DemandPay Starling//Deadline Docket//EN',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    fold('X-WR-CALNAME:Starling Deadline Docket'),
  ];

  for (const item of items) {
    const uid = `${item.matterId}-${item.kind}-${item.date}@starling.demandpay.ca`;
    lines.push(
      'BEGIN:VEVENT',
      fold(`UID:${icsEscape(uid)}`),
      `DTSTAMP:${stamp}`,
      `DTSTART;VALUE=DATE:${dateBasic(item.date)}`,
      `DTEND;VALUE=DATE:${dateBasic(nextDay(item.date))}`,
      fold(`SUMMARY:${icsEscape(`${KIND_LABELS[item.kind] ?? 'Deadline'}: ${item.matterLabel}`)}`),
      fold(`DESCRIPTION:${icsEscape(`${item.label} (${item.matterLabel}). Starling deadline docket; verify against the file before relying on this date.`)}`),
      `CATEGORIES:${icsEscape(item.urgency.toUpperCase())}`,
      'TRANSP:TRANSPARENT',
      'END:VEVENT',
    );
  }

  lines.push('END:VCALENDAR');
  return lines.join('\r\n') + '\r\n';
}
