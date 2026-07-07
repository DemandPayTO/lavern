/**
 * Database backup — daily consistent SQLite snapshots.
 *
 * Layer 2 of the backup strategy (layer 1 is Fly volume snapshots,
 * daily, 30-day retention, stored in-region/yyz):
 *
 *   - Uses better-sqlite3's online backup API (`db.backup()`), which
 *     produces a consistent copy even while the app is writing.
 *   - Writes to <data-dir>/backups/starling-YYYY-MM-DD.db next to the
 *     live database, so backups ride along in every volume snapshot —
 *     a corrupted live DB can be restored from an earlier good copy
 *     inside the SAME snapshot.
 *   - Prunes backups older than BACKUP_RETENTION_DAYS.
 *
 * Off-site (out-of-Fly) replication is a separate, deliberate step —
 * see the production plan.
 */

import fs from 'node:fs';
import path from 'node:path';
import { getDb } from './database.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('DB-BACKUP');

const BACKUP_RETENTION_DAYS = 14;
const BACKUP_INTERVAL_MS = 24 * 60 * 60 * 1000;

function backupDir(): string {
  return path.join(path.dirname(path.resolve(config.dbPath)), 'backups');
}

/** Run one backup now. Returns the backup file path, or null on failure. */
export async function runDbBackup(): Promise<string | null> {
  const dir = backupDir();
  const stamp = new Date().toISOString().slice(0, 10);
  const dest = path.join(dir, `starling-${stamp}.db`);

  try {
    fs.mkdirSync(dir, { recursive: true });
    // Same-day rerun (e.g. server restart): overwrite for a fresher copy
    if (fs.existsSync(dest)) fs.rmSync(dest);

    await getDb().backup(dest);

    const sizeKb = Math.round(fs.statSync(dest).size / 1024);
    logger.info('Database backup written', { dest, sizeKb });

    pruneOldBackups(dir);

    // Layer 3: replicate off-site (no-op when unconfigured; failures are
    // logged inside and never break the local backup).
    const { uploadBackupOffsite } = await import('./offsite-backup.js');
    await uploadBackupOffsite(dest);

    return dest;
  } catch (err) {
    logger.error('Database backup FAILED', {
      dest,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

function pruneOldBackups(dir: string): void {
  const cutoff = Date.now() - BACKUP_RETENTION_DAYS * 24 * 60 * 60 * 1000;
  try {
    for (const file of fs.readdirSync(dir)) {
      if (!/^starling-\d{4}-\d{2}-\d{2}\.db$/.test(file)) continue;
      const full = path.join(dir, file);
      if (fs.statSync(full).mtimeMs < cutoff) {
        fs.rmSync(full);
        logger.info('Pruned old backup', { file });
      }
    }
  } catch (err) {
    logger.warn('Backup prune failed (non-fatal)', {
      error: err instanceof Error ? err.message : String(err),
    });
  }
}

/**
 * Start the daily backup timer. Runs one backup shortly after boot
 * (30s, so startup isn't slowed), then every 24 hours. Returns the
 * timer so callers/tests can clear it.
 */
export function startDbBackupSchedule(): NodeJS.Timeout {
  setTimeout(() => { void runDbBackup(); }, 30_000).unref();
  const timer = setInterval(() => { void runDbBackup(); }, BACKUP_INTERVAL_MS);
  timer.unref();
  logger.info('Daily database backup scheduled', {
    retentionDays: BACKUP_RETENTION_DAYS,
    dir: backupDir(),
  });
  return timer;
}
