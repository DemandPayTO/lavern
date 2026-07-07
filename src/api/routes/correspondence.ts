/**
 * Client correspondence routes — the scheduled-email layer for employment
 * matters. Starling drafts and alerts; the lawyer reviews and sends from
 * their own email. Nothing here sends mail.
 *
 *   POST   /api/employment/:matterId/correspondence/start   begin a sequence
 *   GET    /api/employment/:matterId/correspondence          list items
 *   POST   /api/employment/:matterId/correspondence/:itemId/draft   build draft
 *   PUT    /api/employment/:matterId/correspondence/:itemId/draft   lawyer edit
 *   POST   /api/employment/:matterId/correspondence/:itemId/status  sent/skipped
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getMatterById, saveMatter, getUserById } from '../../db/database.js';
import {
  startMitigationSequence,
  buildCorrespondenceDraft,
  type CorrespondenceItem,
} from '../../employment/correspondence.js';
import type { EmploymentMatterData } from '../../types/employment-intake.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('CORRESPONDENCE');

const startSchema = z.object({
  sequence: z.literal('mitigation'),
  followUpWeeks: z.number().int().min(6).max(8).default(6),
}).strict();

const editSchema = z.object({
  subject: z.string().trim().min(1).max(300),
  body: z.string().trim().min(1).max(20_000),
}).strict();

const statusSchema = z.object({
  status: z.enum(['sent', 'skipped']),
}).strict();

interface MatterShape {
  matter: Record<string, unknown>;
  employment: EmploymentMatterData | undefined;
  correspondence: CorrespondenceItem[];
}

async function loadMatter(
  req: FastifyRequest,
  reply: FastifyReply,
): Promise<{ userId: string; matterId: string; shape: MatterShape } | null> {
  const userId = (req as { userId?: string }).userId ?? 'local-user';
  const { matterId } = req.params as { matterId: string };
  const row = await getMatterById(matterId, userId);
  if (!row) {
    await reply.status(404).send({ ok: false, error: 'Matter not found' });
    return null;
  }
  const matter = JSON.parse(row.data_json) as Record<string, unknown>;
  return {
    userId,
    matterId,
    shape: {
      matter,
      employment: matter.employmentData as EmploymentMatterData | undefined,
      correspondence: (matter.correspondence as CorrespondenceItem[] | undefined) ?? [],
    },
  };
}

function firmProfile(userId: string): { firmName?: string } {
  try {
    const user = getUserById(userId);
    if (user?.profile_json) {
      const profile = JSON.parse(user.profile_json) as Record<string, unknown>;
      return { firmName: typeof profile.firmName === 'string' ? profile.firmName : undefined };
    }
  } catch { /* best-effort */ }
  return {};
}

export function registerCorrespondenceRoutes(fastify: FastifyInstance): void {

  fastify.post('/api/employment/:matterId/correspondence/start', async (req, reply) => {
    const ctx = await loadMatter(req, reply);
    if (!ctx) return;
    const parsed = startSchema.safeParse(req.body ?? {});
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request', details: parsed.error.issues.map(i => i.message) });

    const existing = ctx.shape.correspondence.filter(c => c.sequence === parsed.data.sequence);
    if (existing.length > 0) {
      return reply.status(409).send({ ok: false, error: 'This sequence is already active on the matter. Skip or complete its items instead of restarting.' });
    }

    const intake = (ctx.shape.employment?.intake ?? {}) as Record<string, unknown>;
    const items = startMitigationSequence(intake, parsed.data.followUpWeeks);
    ctx.shape.matter.correspondence = [...ctx.shape.correspondence, ...items];
    ctx.shape.matter.correspondenceConfig = { followUpWeeks: parsed.data.followUpWeeks };
    await saveMatter(ctx.userId, ctx.matterId, JSON.stringify(ctx.shape.matter), (ctx.shape.matter.status as string) ?? 'active');

    logger.info('Correspondence sequence started', { matterId: ctx.matterId, sequence: parsed.data.sequence, followUpWeeks: parsed.data.followUpWeeks });
    return reply.send({ ok: true, correspondence: ctx.shape.matter.correspondence });
  });

  fastify.get('/api/employment/:matterId/correspondence', async (req, reply) => {
    const ctx = await loadMatter(req, reply);
    if (!ctx) return;
    return reply.send({
      ok: true,
      correspondence: ctx.shape.correspondence,
      config: ctx.shape.matter.correspondenceConfig ?? null,
    });
  });

  fastify.post('/api/employment/:matterId/correspondence/:itemId/draft', async (req, reply) => {
    const ctx = await loadMatter(req, reply);
    if (!ctx) return;
    const { itemId } = req.params as { itemId: string };
    const item = ctx.shape.correspondence.find(c => c.id === itemId);
    if (!item) return reply.status(404).send({ ok: false, error: 'Correspondence item not found' });
    if (item.status === 'sent') return reply.status(400).send({ ok: false, error: 'This email is already marked sent.' });

    const weeks = Number((ctx.shape.matter.correspondenceConfig as { followUpWeeks?: number } | undefined)?.followUpWeeks ?? 6);
    const intake = (ctx.shape.employment?.intake ?? {}) as Record<string, unknown>;
    item.draft = buildCorrespondenceDraft(item, intake, firmProfile(ctx.userId), weeks);
    if (item.status === 'scheduled') {
      item.status = 'drafted';
      item.statusHistory.push({ status: 'drafted', at: new Date().toISOString() });
    }
    await saveMatter(ctx.userId, ctx.matterId, JSON.stringify(ctx.shape.matter), (ctx.shape.matter.status as string) ?? 'active');
    return reply.send({ ok: true, item });
  });

  fastify.put('/api/employment/:matterId/correspondence/:itemId/draft', async (req, reply) => {
    const ctx = await loadMatter(req, reply);
    if (!ctx) return;
    const { itemId } = req.params as { itemId: string };
    const parsed = editSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request', details: parsed.error.issues.map(i => i.message) });
    const item = ctx.shape.correspondence.find(c => c.id === itemId);
    if (!item) return reply.status(404).send({ ok: false, error: 'Correspondence item not found' });
    if (item.status === 'sent') return reply.status(400).send({ ok: false, error: 'This email is already marked sent.' });

    item.draft = { ...(item.draft ?? {}), subject: parsed.data.subject, body: parsed.data.body };
    if (item.status === 'scheduled') {
      item.status = 'drafted';
      item.statusHistory.push({ status: 'drafted', at: new Date().toISOString() });
    }
    await saveMatter(ctx.userId, ctx.matterId, JSON.stringify(ctx.shape.matter), (ctx.shape.matter.status as string) ?? 'active');
    return reply.send({ ok: true, item });
  });

  fastify.post('/api/employment/:matterId/correspondence/:itemId/status', async (req, reply) => {
    const ctx = await loadMatter(req, reply);
    if (!ctx) return;
    const { itemId } = req.params as { itemId: string };
    const parsed = statusSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });
    const item = ctx.shape.correspondence.find(c => c.id === itemId);
    if (!item) return reply.status(404).send({ ok: false, error: 'Correspondence item not found' });

    item.status = parsed.data.status;
    item.statusHistory.push({ status: parsed.data.status, at: new Date().toISOString() });

    // A sent client email is a matter event: it belongs on the timeline.
    if (parsed.data.status === 'sent' && ctx.shape.employment) {
      ctx.shape.employment.timeline = [
        ...(ctx.shape.employment.timeline ?? []),
        {
          date: new Date().toISOString().slice(0, 10),
          label: `Client email sent: ${item.title}`,
          source: 'system',
        } as EmploymentMatterData['timeline'][number],
      ];
      ctx.shape.matter.employmentData = ctx.shape.employment;
    }

    await saveMatter(ctx.userId, ctx.matterId, JSON.stringify(ctx.shape.matter), (ctx.shape.matter.status as string) ?? 'active');
    logger.info('Correspondence status changed', { matterId: ctx.matterId, itemId, status: parsed.data.status });
    return reply.send({ ok: true, item });
  });
}
