/**
 * Starling Digest Routes — status monitor + weekly digest email.
 *
 * GET /api/starling/status  — returns per-matter status inference
 * POST /api/starling/digest — triggers weekly digest email send
 *
 * The digest endpoint is designed to be called by an external cron
 * (e.g. Fly.io scheduled machine, or curl from a crontab) on Monday
 * mornings. Protected by X-Admin-Key header.
 */

import type { FastifyInstance } from 'fastify';
import { inferMatterStatuses } from '../../starling/status-monitor.js';
import { buildWeeklyDigest, sendWeeklyDigest } from '../../starling/digest-runner.js';
import { config } from '../../config.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('STARLING-DIGEST');

export function registerStarlingDigestRoutes(fastify: FastifyInstance): void {

  /**
   * GET /api/starling/status
   * Returns inferred status for the caller's own matters. The route is not
   * public: the auth middleware sets req.userId (the synthetic local-user in
   * LOCAL MODE, the logged-in user when auth is enabled). Scoping is enforced
   * so one tenant cannot read another tenant's matter titles or session ids.
   */
  fastify.get('/api/starling/status', async (request, reply) => {
    const userId = (request as { userId?: string }).userId;
    if (!userId) return reply.status(401).send({ ok: false, error: 'Unauthorized' });
    try {
      const statuses = inferMatterStatuses(userId);
      return reply.send({
        ok: true,
        matters: statuses,
        generated_at: new Date().toISOString(),
      });
    } catch (err) {
      logger.error('Status inference failed', err);
      return reply.status(500).send({ ok: false, error: 'Status inference failed' });
    }
  });

  /**
   * POST /api/starling/digest
   * Aggregates weekly statistics and sends digest email.
   * Requires X-Admin-Key header (same pattern as admin routes).
   *
   * Query params:
   *   email — recipient email address (required)
   *   dry_run — if "true", returns digest data without sending email
   */
  fastify.post('/api/starling/digest', async (request, reply) => {
    // Admin-key auth (same as admin routes)
    const adminKey = (request.headers as Record<string, string>)['x-admin-key'];
    const expectedKey = config.billableHours.adminKey;
    if (!expectedKey || adminKey !== expectedKey) {
      return reply.status(403).send({ ok: false, error: 'Forbidden' });
    }

    const query = request.query as Record<string, string>;
    const email = query.email;
    const dryRun = query.dry_run === 'true';

    if (!email && !dryRun) {
      return reply.status(400).send({ ok: false, error: 'email query parameter required' });
    }

    try {
      if (dryRun) {
        const { digest, deadlines } = buildWeeklyDigest();
        return reply.send({ ok: true, dry_run: true, digest, deadlines });
      }

      const { statsSent, digest } = await sendWeeklyDigest(email!);

      if (statsSent) {
        logger.info(`Weekly digest sent to ${email}`, {
          documentsProcessed: digest.documentsProcessed,
          costUsd: digest.costUsd,
        });
        return reply.send({ ok: true, sent: true, digest });
      } else {
        logger.warn(`Weekly digest send failed for ${email}`);
        return reply.status(500).send({ ok: false, error: 'Email send failed' });
      }
    } catch (err) {
      logger.error('Digest aggregation failed', err);
      return reply.status(500).send({ ok: false, error: 'Digest generation failed' });
    }
  });
}
