/**
 * Labour Routes — union-side grievance matters.
 *
 * Mirrors the employment-intake route pattern on the same matter store:
 * labour data lives at matter.labourData, so a matter is EITHER an
 * employment matter or a grievance (the dashboard treats them uniformly).
 *
 *   POST /api/labour/intake                — save grievance intake, run gates + timeline
 *   POST /api/labour/analyze               — re-run gates/timeline/deadlines
 *   GET  /api/labour/deadlines             — grievance docket across matters (CA clocks)
 *   GET  /api/labour/:matterId             — get labour data
 *   POST /api/labour/:matterId/issues      — approve/dismiss issues
 *   POST /api/labour/:matterId/document    — generate a grievance document
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { grievanceIntakeSchema, createLabourMatterData } from '../../types/labour-intake.js';
import type { GrievanceIntakeData, LabourMatterData } from '../../types/labour-intake.js';
import { evaluateLabourGates, buildGrievanceTimeline, computeGrievanceDeadlines } from '../../labour/gate-evaluator.js';
import { generateGrievanceDocument } from '../../labour/grievance-documents.js';
import type { GrievanceDocumentType } from '../../labour/grievance-documents.js';
import { saveMatter, getMatterById, getMattersByUser } from '../../db/database.js';
import { createLogger } from '../../utils/logger.js';

const logger = createLogger('LABOUR');

function sanitiseHtml(html: string): string {
  return html
    .replace(/<script[\s\S]*?<\/script>/gi, '')
    .replace(/<script[^>]*>/gi, '')
    .replace(/\bon\w+\s*=\s*"[^"]*"/gi, '')
    .replace(/\bon\w+\s*=\s*'[^']*'/gi, '');
}

function loadLabourData(dataJson: string): { matter: Record<string, unknown>; labour: LabourMatterData } {
  const matter = JSON.parse(dataJson) as Record<string, unknown>;
  const labour = (matter.labourData as LabourMatterData) ?? createLabourMatterData();
  return { matter, labour };
}

async function saveLabourData(
  userId: string, matterId: string,
  matter: Record<string, unknown>, labour: LabourMatterData,
): Promise<void> {
  matter.labourData = labour;
  matter.practiceArea = 'labour_union';
  await saveMatter(userId, matterId, JSON.stringify(matter), (matter.status as string) ?? 'active');
}

const GRIEVANCE_DOC_TYPES = ['grievance_filing', 'referral_to_arbitration', 'arbitration_brief', 'dfr_response'] as const;

export function registerLabourRoutes(fastify: FastifyInstance): void {

  // ── POST /api/labour/intake ────────────────────────────────────────────
  const intakeBodySchema = z.object({
    matterId: z.string().min(1).max(200),
    intake: grievanceIntakeSchema,
  });

  fastify.post('/api/labour/intake', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const parsed = intakeBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn('Grievance intake validation failed', { userId, issues: parsed.error.issues.map(i => i.path.join('.')) });
      return reply.status(400).send({ ok: false, error: 'Invalid intake data' });
    }

    const { matterId, intake } = parsed.data;
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, labour } = loadLabourData(row.data_json);
    labour.intake = intake as GrievanceIntakeData;
    labour.gates = evaluateLabourGates(labour.intake);
    labour.timeline = buildGrievanceTimeline(labour.intake);
    labour.analysis = {
      deadlines: computeGrievanceDeadlines(labour.intake),
      evaluatedAt: new Date().toISOString(),
    };

    await saveLabourData(userId, matterId, matter, labour);

    logger.info('Grievance intake saved', {
      userId, matterId,
      triggeredGates: labour.gates.filter(g => g.triggered).map(g => g.gate),
      deadlines: (labour.analysis.deadlines as unknown[]).length,
    });

    return reply.send({
      ok: true,
      gates: labour.gates,
      timeline: labour.timeline,
      deadlines: labour.analysis.deadlines,
    });
  });

  // ── POST /api/labour/analyze ───────────────────────────────────────────
  fastify.post('/api/labour/analyze', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const parsed = z.object({ matterId: z.string().min(1).max(200) }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(parsed.data.matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, labour } = loadLabourData(row.data_json);
    labour.gates = evaluateLabourGates(labour.intake);
    labour.timeline = buildGrievanceTimeline(labour.intake);
    labour.analysis = {
      deadlines: computeGrievanceDeadlines(labour.intake),
      evaluatedAt: new Date().toISOString(),
    };
    await saveLabourData(userId, parsed.data.matterId, matter, labour);

    return reply.send({ ok: true, gates: labour.gates, timeline: labour.timeline, deadlines: labour.analysis.deadlines });
  });

  // ── GET /api/labour/deadlines ──────────────────────────────────────────
  // Grievance docket: CA clocks across all the user's labour matters.
  // Grievance time limits are days-scale, so no horizon filter — everything
  // pending is actionable.
  fastify.get('/api/labour/deadlines', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const rows = getMattersByUser(userId);
    const items: Array<Record<string, unknown>> = [];

    for (const row of rows) {
      try {
        const matter = JSON.parse(row.data_json) as Record<string, unknown>;
        const labour = matter.labourData as LabourMatterData | undefined;
        if (!labour?.intake) continue;
        const grievor = [labour.intake.grievor_first_name, labour.intake.grievor_last_name].filter(Boolean).join(' ');
        const label = grievor
          ? `${grievor}${labour.intake.grievance_number ? ` (#${labour.intake.grievance_number})` : ''} — ${labour.intake.employer_name ?? ''}`
          : row.id;
        for (const d of computeGrievanceDeadlines(labour.intake)) {
          items.push({ matterId: row.id, matterLabel: label, ...d });
        }
      } catch { /* skip corrupt rows */ }
    }

    items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return reply.send({ ok: true, deadlines: items, generatedAt: new Date().toISOString() });
  });

  // ── GET /api/labour/:matterId ──────────────────────────────────────────
  fastify.get('/api/labour/:matterId', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter } = loadLabourData(row.data_json);
    const labour = matter.labourData as LabourMatterData | undefined;
    if (!labour) return reply.status(404).send({ ok: false, error: 'No labour data on this matter' });
    return reply.send({ ok: true, data: labour });
  });

  // ── POST /api/labour/:matterId/issues ──────────────────────────────────
  const issueSchema = z.object({
    approved: z.array(z.string().max(100)).max(50),
    dismissed: z.array(z.string().max(100)).max(50),
  });

  fastify.post('/api/labour/:matterId/issues', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = issueSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid issue decisions' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, labour } = loadLabourData(row.data_json);
    labour.approvedIssues = parsed.data.approved;
    labour.dismissedIssues = parsed.data.dismissed;
    await saveLabourData(userId, matterId, matter, labour);

    return reply.send({ ok: true, approved: labour.approvedIssues, dismissed: labour.dismissedIssues });
  });

  // ── POST /api/labour/:matterId/document ────────────────────────────────
  const docBodySchema = z.object({
    documentType: z.enum(GRIEVANCE_DOC_TYPES),
    representativeName: z.string().trim().min(1).max(200),
    organizationName: z.string().trim().min(1).max(200),
    additionalContext: z.string().trim().max(5000).optional(),
  });

  fastify.post('/api/labour/:matterId/document', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = docBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, labour } = loadLabourData(row.data_json);
    if (!labour.intake || Object.keys(labour.intake).length === 0) {
      return reply.status(400).send({ ok: false, error: 'Complete grievance intake before generating documents.' });
    }

    // Anonymisation terms: grievor + employer + union names
    const definedTerms: string[] = [];
    const grievor = [labour.intake.grievor_first_name, labour.intake.grievor_last_name].filter(Boolean).join(' ');
    if (grievor) definedTerms.push(grievor);
    if (labour.intake.employer_name) definedTerms.push(labour.intake.employer_name);
    if (labour.intake.union_name) definedTerms.push(labour.intake.union_name);

    const result = await generateGrievanceDocument({
      intake: labour.intake,
      approvedIssues: labour.approvedIssues,
      documentType: parsed.data.documentType as GrievanceDocumentType,
      representativeName: parsed.data.representativeName,
      organizationName: parsed.data.organizationName,
      additionalContext: parsed.data.additionalContext,
    }, definedTerms);

    // Store + draft history (same shape as employment)
    const history = Array.isArray(matter.draftHistory) ? matter.draftHistory as Array<Record<string, unknown>> : [];
    history.unshift({
      docType: parsed.data.documentType, title: result.documentTitle,
      html: sanitiseHtml(result.html), costUsd: result.costUsd,
      generatedAt: new Date().toISOString(),
    });
    matter.draftHistory = history.slice(0, 10);
    (matter as Record<string, unknown>)[`generated_${parsed.data.documentType}`] = {
      html: sanitiseHtml(result.html),
      documentTitle: result.documentTitle,
      reviewerFlags: result.reviewerFlags,
      generatedAt: new Date().toISOString(),
      costUsd: result.costUsd,
      status: 'draft',
    };
    await saveLabourData(userId, matterId, matter, labour);

    return reply.send({
      ok: true,
      html: sanitiseHtml(result.html),
      documentTitle: result.documentTitle,
      reviewerFlags: result.reviewerFlags,
      costUsd: result.costUsd,
    });
  });
}
