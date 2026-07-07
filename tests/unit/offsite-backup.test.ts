/**
 * Unit Tests — off-site backup pruning and configuration gating.
 */

import { describe, it, expect } from 'vitest';
import { keysToPrune, offsiteConfigured, uploadBackupOffsite } from '../../src/db/offsite-backup.js';

describe('keysToPrune', () => {
  const today = new Date('2026-07-07T12:00:00Z');

  it('prunes only dated backup keys older than retention', () => {
    const keys = [
      'db-backups/starling-2026-07-06.db',   // 1 day old — keep
      'db-backups/starling-2026-06-08.db',   // 29 days — keep
      'db-backups/starling-2026-06-06.db',   // 31 days — prune
      'db-backups/starling-2026-01-01.db',   // ancient — prune
      'db-backups/notes.txt',                // non-matching — never touched
      'db-backups/starling-invalid.db',      // non-matching — never touched
    ];
    expect(keysToPrune(keys, today, 30)).toEqual([
      'db-backups/starling-2026-06-06.db',
      'db-backups/starling-2026-01-01.db',
    ]);
  });

  it('returns nothing when all keys are recent', () => {
    expect(keysToPrune(['db-backups/starling-2026-07-07.db'], today, 30)).toEqual([]);
  });
});

describe('offsite gating', () => {
  it('is unconfigured without BUCKET_NAME and upload is a safe no-op', async () => {
    const saved = { bucket: process.env.BUCKET_NAME, key: process.env.AWS_ACCESS_KEY_ID };
    delete process.env.BUCKET_NAME;
    delete process.env.AWS_ACCESS_KEY_ID;
    try {
      expect(offsiteConfigured()).toBe(false);
      expect(await uploadBackupOffsite('/tmp/does-not-matter.db')).toBeNull();
    } finally {
      if (saved.bucket) process.env.BUCKET_NAME = saved.bucket;
      if (saved.key) process.env.AWS_ACCESS_KEY_ID = saved.key;
    }
  });
});
