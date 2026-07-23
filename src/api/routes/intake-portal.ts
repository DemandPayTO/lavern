/**
 * Client Intake Portal — the client fills their own facts, the lawyer
 * reviews and applies them. Employment matters only in this version.
 *
 * Flow: the lawyer generates a link for a matter (tokenized, expiring,
 * one active link per matter) → the client opens the public form and
 * submits → the submission sits as pending on the matter → the lawyer
 * reviews it on the Intake tab and applies it, which fills blank intake
 * fields only (the lawyer's entries are never overwritten) and re-runs
 * the analysis.
 *
 * Security posture for the public routes: tokens are 192-bit and stored
 * hashed; the public GET reveals only the firm name and the client's
 * first name; submissions are schema-bound to a safe field subset and
 * size-capped; expiry is enforced server-side.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import crypto from 'node:crypto';
import { getMatterById, saveMatter, savePortalToken, getPortalToken, deletePortalTokensForMatter, getUserById } from '../../db/database.js';
import { evaluateGates } from '../../employment/gate-evaluator.js';
import { rebuildTimelinePreserving } from '../../employment/timeline-generator.js';
import type { EmploymentMatterData, EmploymentIntakeData } from '../../types/employment-intake.js';
import { createEmploymentMatterData } from '../../types/employment-intake.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('INTAKE-PORTAL');

const TOKEN_TTL_DAYS = 14;

function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex');
}

/** The client-safe field subset. Everything else stays lawyer-entered. */
const clientIntakeSchema = z.object({
  client_first_name: z.string().trim().max(100).optional(),
  client_last_name: z.string().trim().max(100).optional(),
  client_email: z.string().trim().max(200).optional(),
  client_phone: z.string().trim().max(50).optional(),
  client_address: z.string().trim().max(300).optional(),
  client_age: z.number().int().min(14).max(120).optional(),
  employer_legal_name: z.string().trim().max(200).optional(),
  job_title: z.string().trim().max(200).optional(),
  hire_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  termination_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  annual_salary: z.number().nonnegative().max(99_999_999).optional(),
  termination_reasons: z.string().trim().max(2000).optional(),
  received_severance_offer: z.boolean().optional(),
  severance_deadline: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
  client_narrative: z.string().trim().max(5000).optional(),
}).strict();

export function registerIntakePortalRoutes(fastify: FastifyInstance): void {

  // ── POST /api/employment/:matterId/intake-link (lawyer) ────────────────
  fastify.post('/api/employment/:matterId/intake-link', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const token = crypto.randomBytes(24).toString('base64url');
    const expiresAt = new Date(Date.now() + TOKEN_TTL_DAYS * 86_400_000).toISOString();
    savePortalToken(hashToken(token), matterId, userId, expiresAt);

    logger.info('Client intake link generated', { userId, matterId, expiresAt });
    return reply.send({
      ok: true,
      path: `/dashboard/#/client-intake/${token}`,
      expiresAt,
    });
  });

  // ── GET /api/intake-portal/:token (public) ──────────────────────────────
  // Reveals only what the form needs: the firm name and the client's
  // first name. Nothing else about the matter leaves the server.
  fastify.get('/api/intake-portal/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    const record = getPortalToken(hashToken(token));
    if (!record) return reply.status(404).send({ ok: false, error: 'This intake link is not valid.' });
    if (record.expires_at < new Date().toISOString()) {
      return reply.status(410).send({ ok: false, error: 'This intake link has expired. Ask your lawyer for a new one.' });
    }

    const row = await getMatterById(record.matter_id, record.user_id);
    if (!row) return reply.status(404).send({ ok: false, error: 'This intake link is not valid.' });
    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    const employment = matter.employmentData as EmploymentMatterData | undefined;

    let firmName = '';
    try {
      const user = getUserById(record.user_id);
      if (user?.profile_json) firmName = String((JSON.parse(user.profile_json) as Record<string, unknown>).firmName ?? '');
      if (!firmName && user?.display_name) firmName = user.display_name;
    } catch { /* best-effort */ }

    return reply.send({
      ok: true,
      firmName,
      clientFirstName: String(employment?.intake?.client_first_name ?? ''),
    });
  });

  // ── POST /api/intake-portal/:token (public) ─────────────────────────────
  fastify.post('/api/intake-portal/:token', async (req: FastifyRequest, reply: FastifyReply) => {
    const { token } = req.params as { token: string };
    const record = getPortalToken(hashToken(token));
    if (!record) return reply.status(404).send({ ok: false, error: 'This intake link is not valid.' });
    if (record.expires_at < new Date().toISOString()) {
      return reply.status(410).send({ ok: false, error: 'This intake link has expired. Ask your lawyer for a new one.' });
    }

    const parsed = clientIntakeSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Some answers could not be read. Review the form and try again.' });

    const row = await getMatterById(record.matter_id, record.user_id);
    if (!row) return reply.status(404).send({ ok: false, error: 'This intake link is not valid.' });
    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    matter.pendingClientIntake = {
      data: parsed.data,
      submittedAt: new Date().toISOString(),
    };
    await saveMatter(record.user_id, record.matter_id, JSON.stringify(matter), (matter.status as string) ?? 'active');

    logger.info('Client intake submitted', { matterId: record.matter_id, fields: Object.keys(parsed.data).length });
    return reply.send({ ok: true });
  });

  // ── POST /api/employment/:matterId/apply-client-intake (lawyer) ─────────
  // Fill-blanks-only merge: the client's answers complete the intake but
  // never overwrite what the lawyer has entered. Gates and timeline are
  // recomputed; the pending submission is retained as an applied record.
  fastify.post('/api/employment/:matterId/apply-client-intake', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    const pending = matter.pendingClientIntake as { data?: Record<string, unknown>; submittedAt?: string; appliedAt?: string } | undefined;
    if (!pending?.data || pending.appliedAt) {
      return reply.status(400).send({ ok: false, error: 'No client submission is pending on this matter.' });
    }

    const employment = (matter.employmentData as EmploymentMatterData) ?? createEmploymentMatterData();
    const intake = employment.intake as Record<string, unknown>;
    const applied: string[] = [];
    for (const [k, v] of Object.entries(pending.data)) {
      if (k === 'client_narrative') continue; // narrative goes to the record, not a field
      if (v === undefined || v === null || v === '') continue;
      if (intake[k] === undefined || intake[k] === null || intake[k] === '') {
        intake[k] = v;
        applied.push(k);
      }
    }
    employment.intake = intake as EmploymentIntakeData;
    employment.intakeRevisedAt = new Date().toISOString();
    employment.gates = evaluateGates(employment.intake);
    employment.timeline = rebuildTimelinePreserving(employment.timeline, employment.intake);
    matter.employmentData = employment;
    matter.pendingClientIntake = { ...pending, appliedAt: new Date().toISOString(), appliedFields: applied };
    await saveMatter(userId, matterId, JSON.stringify(matter), (matter.status as string) ?? 'active');
    deletePortalTokensForMatter(matterId);

    logger.info('Client intake applied', { userId, matterId, applied });
    return reply.send({ ok: true, appliedFields: applied, narrative: String(pending.data.client_narrative ?? '') });
  });

  // ── GET /api/employment/:matterId/client-intake (lawyer) ────────────────
  fastify.get('/api/employment/:matterId/client-intake', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    return reply.send({ ok: true, pending: matter.pendingClientIntake ?? null });
  });

  // ── DELETE /api/employment/:matterId/client-intake (lawyer) ─────────────
  fastify.delete('/api/employment/:matterId/client-intake', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    delete matter.pendingClientIntake;
    await saveMatter(userId, matterId, JSON.stringify(matter), (matter.status as string) ?? 'active');
    deletePortalTokensForMatter(matterId);
    return reply.send({ ok: true });
  });
}
