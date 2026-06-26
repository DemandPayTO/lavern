/**
 * Status Monitor — Matter status inference and weekly digest aggregation.
 *
 * Reads from session_archive (SQLite) to infer per-matter status and
 * aggregate weekly statistics for the digest email. No LLM calls —
 * pure timestamp/state logic.
 *
 * Used by:
 *   GET /api/starling/digest — triggers weekly digest email
 *   GET /api/starling/status — returns all matter statuses
 */

import { getDb } from '../db/database.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('STATUS-MONITOR');

// ── Types ───────────────────────────────────────────────────────────────

export interface MatterStatus {
  id: string;
  title: string;
  status: 'active' | 'processing' | 'completed' | 'stale' | 'urgent';
  lastActivity: string | null;
  completedSessions: number;
  totalCost: number;
  daysInactive: number;
  urgencyReason: string | null;
}

export interface WeeklyDigest {
  period: string;
  documentsProcessed: number;
  findingsSummary: { critical: number; major: number; minor: number };
  costUsd: number;
  precedentsLearned: number;
  budgetRemainingUsd: number;
  mattersSummary: {
    total: number;
    active: number;
    completed: number;
    urgent: number;
  };
}

// ── Status Inference ────────────────────────────────────────────────────

/** Staleness thresholds (days). */
const STALE_THRESHOLD_DAYS = 14;

/**
 * Infer the status of all matters from session_archive data.
 * Pure logic — no LLM, no external calls.
 */
export function inferMatterStatuses(): MatterStatus[] {
  const db = getDb();
  const now = Date.now();

  // Get all sessions grouped by their effective matter ID.
  // In Starling, the session title contains the matter context.
  // We use the session_archive data to build per-matter status.
  const sessions = db.prepare(`
    SELECT
      id,
      title,
      status,
      cost_usd,
      findings_count,
      created_at,
      completed_at,
      assembled_document
    FROM session_archive
    ORDER BY COALESCE(completed_at, created_at) DESC
  `).all() as Array<{
    id: string;
    title: string;
    status: string;
    cost_usd: number;
    findings_count: number;
    created_at: string;
    completed_at: string | null;
    assembled_document: string | null;
  }>;

  // Group sessions by title (rough matter grouping).
  // A more robust approach would use an explicit matter_id column
  // if the session_archive schema is extended.
  const matterMap = new Map<string, typeof sessions>();
  for (const session of sessions) {
    const key = session.title || 'Untitled';
    const existing = matterMap.get(key) ?? [];
    existing.push(session);
    matterMap.set(key, existing);
  }

  const results: MatterStatus[] = [];

  for (const [title, matterSessions] of matterMap) {
    const completedSessions = matterSessions.filter(s => s.status === 'completed').length;
    const totalCost = matterSessions.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);

    // Find most recent activity
    const lastActivityStr = matterSessions[0]?.completed_at ?? matterSessions[0]?.created_at ?? null;
    const lastActivityMs = lastActivityStr ? new Date(lastActivityStr).getTime() : 0;
    const daysInactive = lastActivityMs > 0
      ? Math.floor((now - lastActivityMs) / (1000 * 60 * 60 * 24))
      : 999;

    // Check for active (in-progress) sessions
    const hasActiveSession = matterSessions.some(s =>
      s.status !== 'completed' && s.status !== 'error' && s.status !== 'cancelled'
    );

    // Determine status
    let status: MatterStatus['status'];
    let urgencyReason: string | null = null;

    if (hasActiveSession) {
      status = 'processing';
    } else if (daysInactive > STALE_THRESHOLD_DAYS) {
      status = 'stale';
      urgencyReason = `No activity for ${daysInactive} days`;
    } else if (completedSessions > 0 && matterSessions.every(s =>
      s.status === 'completed' || s.status === 'error' || s.status === 'cancelled'
    )) {
      status = 'completed';
    } else {
      status = 'active';
    }

    // Check for urgency markers in recent sessions
    const recentFindings = matterSessions
      .filter(s => s.findings_count > 0)
      .reduce((sum, s) => sum + s.findings_count, 0);

    if (recentFindings > 20 && status !== 'processing') {
      status = 'urgent';
      urgencyReason = `${recentFindings} findings require review`;
    }

    results.push({
      id: matterSessions[0]?.id ?? title,
      title,
      status,
      lastActivity: lastActivityStr,
      completedSessions,
      totalCost: Math.round(totalCost * 100) / 100,
      daysInactive,
      urgencyReason,
    });
  }

  // Sort: urgent first, then by last activity (most recent first)
  results.sort((a, b) => {
    const urgencyOrder = { urgent: 0, processing: 1, active: 2, stale: 3, completed: 4 };
    const aOrder = urgencyOrder[a.status] ?? 5;
    const bOrder = urgencyOrder[b.status] ?? 5;
    if (aOrder !== bOrder) return aOrder - bOrder;
    return b.daysInactive - a.daysInactive;
  });

  return results;
}

// ── Weekly Digest Aggregation ───────────────────────────────────────────

/**
 * Aggregate weekly statistics for the digest email.
 * Looks at sessions completed in the last 7 days.
 */
export function aggregateWeeklyDigest(): WeeklyDigest {
  const db = getDb();
  const oneWeekAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();

  // Sessions completed this week
  const weekSessions = db.prepare(`
    SELECT
      status,
      cost_usd,
      findings_count,
      summary_json,
      assembled_document
    FROM session_archive
    WHERE completed_at >= ?
    ORDER BY completed_at DESC
  `).all(oneWeekAgo) as Array<{
    status: string;
    cost_usd: number;
    findings_count: number;
    summary_json: string;
    assembled_document: string | null;
  }>;

  // Count documents (sessions with assembled output)
  const documentsProcessed = weekSessions.filter(s =>
    s.assembled_document && s.assembled_document.length > 100
  ).length;

  // Aggregate cost
  const costUsd = weekSessions.reduce((sum, s) => sum + (s.cost_usd ?? 0), 0);

  // Parse findings from summary_json to get severity breakdown
  let critical = 0;
  let major = 0;
  let minor = 0;

  for (const session of weekSessions) {
    try {
      const summary = JSON.parse(session.summary_json || '{}');
      // Try to extract severity counts from various summary formats
      if (summary.findingsBySeverity) {
        critical += summary.findingsBySeverity.critical ?? 0;
        major += summary.findingsBySeverity.major ?? 0;
        minor += summary.findingsBySeverity.minor ?? 0;
      } else {
        // Rough estimate from total findings count
        const total = session.findings_count ?? 0;
        critical += Math.floor(total * 0.1);
        major += Math.floor(total * 0.3);
        minor += total - Math.floor(total * 0.1) - Math.floor(total * 0.3);
      }
    } catch {
      // Invalid JSON — use findings_count as minor
      minor += session.findings_count ?? 0;
    }
  }

  // Get matter statuses for summary
  const matterStatuses = inferMatterStatuses();

  // Format period label
  const endDate = new Date();
  const startDate = new Date(oneWeekAgo);
  const formatDate = (d: Date) =>
    `${d.toLocaleString('en-CA', { month: 'short' })} ${d.getDate()}`;
  const period = `${formatDate(startDate)} – ${formatDate(endDate)}, ${endDate.getFullYear()}`;

  return {
    period,
    documentsProcessed,
    findingsSummary: { critical, major, minor },
    costUsd: Math.round(costUsd * 100) / 100,
    precedentsLearned: 0, // Placeholder — would read from precedent board if available
    budgetRemainingUsd: 0, // Placeholder — would read from config
    mattersSummary: {
      total: matterStatuses.length,
      active: matterStatuses.filter(m => m.status === 'active' || m.status === 'processing').length,
      completed: matterStatuses.filter(m => m.status === 'completed').length,
      urgent: matterStatuses.filter(m => m.status === 'urgent').length,
    },
  };
}
