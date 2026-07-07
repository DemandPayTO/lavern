/**
 * Off-site backup — layer 3 of the backup strategy.
 *
 *   Layer 1: Fly volume snapshots (daily, 30-day retention, in-region yyz)
 *   Layer 2: in-app SQLite online backups to /data/backups (daily, 14 days)
 *   Layer 3: THIS — the layer-2 file uploaded to a Tigris bucket
 *            (S3-compatible object storage, provisioned via
 *            `fly storage create`), surviving loss of the Fly volume,
 *            the app, or the whole region.
 *
 * Credentials arrive as env (set by `fly storage create` as app secrets):
 * AWS_ACCESS_KEY_ID, AWS_SECRET_ACCESS_KEY, AWS_REGION,
 * AWS_ENDPOINT_URL_S3, BUCKET_NAME. When BUCKET_NAME is absent (local
 * dev), the off-site step is a no-op and layer 2 continues alone.
 *
 * Privacy note: Tigris stores globally with region affinity to where data
 * is written (yyz machine → North American placement). The privacy policy's
 * "backups maintained in Canada" commitment is satisfied by layers 1-2;
 * layer 3 is disaster recovery. Jordan reviews this trade-off (noted in the
 * production plan).
 */

import fs from 'node:fs';
import path from 'node:path';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('OFFSITE-BACKUP');

const OFFSITE_RETENTION_DAYS = 30;
const KEY_PREFIX = 'db-backups/';

export function offsiteConfigured(): boolean {
  return Boolean(process.env.BUCKET_NAME && process.env.AWS_ACCESS_KEY_ID);
}

/** Keys older than the retention window, given a listing. Pure for tests. */
export function keysToPrune(keys: string[], today: Date, retentionDays: number = OFFSITE_RETENTION_DAYS): string[] {
  const cutoff = new Date(today);
  cutoff.setDate(cutoff.getDate() - retentionDays);
  const cutoffStamp = cutoff.toISOString().slice(0, 10);
  return keys.filter((k) => {
    const m = k.match(/starling-(\d{4}-\d{2}-\d{2})\.db$/);
    return m !== null && m[1] < cutoffStamp;
  });
}

async function s3Client() {
  const { S3Client } = await import('@aws-sdk/client-s3');
  return new S3Client({
    region: process.env.AWS_REGION ?? 'auto',
    endpoint: process.env.AWS_ENDPOINT_URL_S3,
    forcePathStyle: false,
  });
}

/**
 * Upload a layer-2 backup file to the bucket and prune old objects.
 * Returns the object key, or null when unconfigured or on failure —
 * off-site problems must never break the local backup.
 */
export async function uploadBackupOffsite(filePath: string): Promise<string | null> {
  if (!offsiteConfigured()) {
    logger.info('Off-site backup not configured (BUCKET_NAME unset) — skipping');
    return null;
  }
  const bucket = process.env.BUCKET_NAME!;
  const key = `${KEY_PREFIX}${path.basename(filePath)}`;

  try {
    const { PutObjectCommand, ListObjectsV2Command, DeleteObjectCommand, HeadObjectCommand } =
      await import('@aws-sdk/client-s3');
    const client = await s3Client();

    await client.send(new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: fs.readFileSync(filePath),
      ContentType: 'application/vnd.sqlite3',
    }));

    const head = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: key }));
    logger.info('Off-site backup uploaded', { key, sizeKb: Math.round((head.ContentLength ?? 0) / 1024) });

    // Prune beyond retention
    const listing = await client.send(new ListObjectsV2Command({ Bucket: bucket, Prefix: KEY_PREFIX }));
    const keys = (listing.Contents ?? []).map((o) => o.Key ?? '').filter(Boolean);
    for (const stale of keysToPrune(keys, new Date())) {
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: stale }));
      logger.info('Off-site backup pruned', { key: stale });
    }

    return key;
  } catch (err) {
    logger.error('Off-site backup failed (local backup unaffected)', err);
    return null;
  }
}
