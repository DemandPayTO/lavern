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
 *   GET  /api/labour/ca-profiles           — CA library: list profiles
 *   POST /api/labour/ca-profiles           — CA library: create/update a profile
 *   DELETE /api/labour/ca-profiles/:id     — CA library: delete a profile
 *   GET  /api/labour/:matterId             — get labour data
 *   POST /api/labour/:matterId/issues      — approve/dismiss issues
 *   POST /api/labour/:matterId/step-event  — record a step presentation/response
 *   POST /api/labour/:matterId/document    — generate a grievance document
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { grievanceIntakeSchema, stepEventSchema, caProfileSchema, createLabourMatterData } from '../../types/labour-intake.js';
import type { GrievanceIntakeData, GrievanceStepEvent, LabourMatterData } from '../../types/labour-intake.js';
import { evaluateLabourGates, buildGrievanceTimeline, computeGrievanceDeadlines } from '../../labour/gate-evaluator.js';
import { generateGrievanceDocument } from '../../labour/grievance-documents.js';
import type { GrievanceDocumentType } from '../../labour/grievance-documents.js';
import { buildRemedyWorksheet } from '../../labour/remedy-worksheet.js';
import { saveMatter, getMatterById, getMattersByUser, saveCaProfile, getCaProfiles, getCaProfile, deleteCaProfile , recordUsageEvent } from '../../db/database.js';
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

const GRIEVANCE_DOC_TYPES = [
  'grievance_filing', 'referral_to_arbitration', 'arbitration_brief', 'dfr_response',
  'merits_assessment', 'decline_letter', 'member_update', 'remedy_worksheet',
  'particulars', 'production_request', 'settlement_memorandum', 'ohsa_reprisal_complaint',
] as const;

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
          ? `${grievor}${labour.intake.grievance_number ? ` (#${labour.intake.grievance_number})` : ''} v ${labour.intake.employer_name ?? ''}`
          : row.id;
        for (const d of computeGrievanceDeadlines(labour.intake)) {
          items.push({ matterId: row.id, matterLabel: label, ...d });
        }
      } catch { /* skip corrupt rows */ }
    }

    items.sort((a, b) => String(a.date).localeCompare(String(b.date)));
    return reply.send({ ok: true, deadlines: items, generatedAt: new Date().toISOString() });
  });

  // ── CA library ─────────────────────────────────────────────────────────
  // One profile per bargaining unit; copied onto grievances at intake.
  // NOTE: these static routes must not be shadowed by /api/labour/:matterId
  // (find-my-way prefers static segments, so ordering is safe either way).

  fastify.get('/api/labour/ca-profiles', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = (req as { firmId?: string }).firmId ?? 'local-firm';
    const rows = getCaProfiles(firmId);
    const profiles = rows.map(r => {
      try {
        return { id: r.id, name: r.name, updatedAt: r.updated_at, data: JSON.parse(r.data_json) as Record<string, unknown> };
      } catch {
        return { id: r.id, name: r.name, updatedAt: r.updated_at, data: {} };
      }
    });
    return reply.send({ ok: true, profiles });
  });

  const caProfileBodySchema = z.object({
    id: z.string().trim().min(1).max(100).optional(),
    profile: caProfileSchema,
  });

  fastify.post('/api/labour/ca-profiles', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = (req as { firmId?: string }).firmId ?? 'local-firm';
    const parsed = caProfileBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn('CA profile validation failed', { firmId, issues: parsed.error.issues.map(i => i.path.join('.')) });
      return reply.status(400).send({ ok: false, error: 'Invalid CA profile' });
    }

    // Updates must target a profile this firm owns; otherwise create fresh.
    let id = parsed.data.id;
    if (id && !getCaProfile(id, firmId)) {
      return reply.status(404).send({ ok: false, error: 'CA profile not found' });
    }
    if (!id) id = `ca-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    saveCaProfile(id, firmId, parsed.data.profile.name, JSON.stringify(parsed.data.profile));
    logger.info('CA profile saved', { firmId, id, name: parsed.data.profile.name });
    return reply.send({ ok: true, id });
  });

  fastify.delete('/api/labour/ca-profiles/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = (req as { firmId?: string }).firmId ?? 'local-firm';
    const { id } = req.params as { id: string };
    const removed = deleteCaProfile(id, firmId);
    if (!removed) return reply.status(404).send({ ok: false, error: 'CA profile not found' });
    return reply.send({ ok: true });
  });

  // ── POST /api/labour/:matterId/step-event ──────────────────────────────
  // Record a presentation or employer response at a procedure step. The
  // event replaces any existing event for the same step, then the gates,
  // timeline, and clocks are recomputed.

  fastify.post('/api/labour/:matterId/step-event', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = stepEventSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid step event' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, labour } = loadLabourData(row.data_json);
    if (!labour.intake || Object.keys(labour.intake).length === 0) {
      return reply.status(400).send({ ok: false, error: 'Complete grievance intake before recording step events.' });
    }

    const events: GrievanceStepEvent[] = (labour.intake.step_events ?? []).filter(e => e.step_label !== parsed.data.step_label);
    events.push(parsed.data);
    // Keep events in procedure order (the clock engine reads the last
    // event as the current position in the procedure)
    const steps = labour.intake.procedure_steps ?? [];
    const orderOf = (label: string): number => {
      const idx = steps.findIndex(s => s.label === label);
      return idx === -1 ? steps.length : idx;
    };
    events.sort((a, b) => orderOf(a.step_label) - orderOf(b.step_label));
    labour.intake.step_events = events.slice(-20);

    labour.gates = evaluateLabourGates(labour.intake);
    labour.timeline = buildGrievanceTimeline(labour.intake);
    labour.analysis = {
      ...(labour.analysis ?? {}),
      deadlines: computeGrievanceDeadlines(labour.intake),
      evaluatedAt: new Date().toISOString(),
    };
    await saveLabourData(userId, matterId, matter, labour);

    logger.info('Step event recorded', { userId, matterId, step: parsed.data.step_label });
    return reply.send({
      ok: true,
      stepEvents: labour.intake.step_events,
      gates: labour.gates,
      timeline: labour.timeline,
      deadlines: labour.analysis.deadlines,
    });
  });

  // ── GET /api/labour/:matterId/form/:formId ──────────────────────────────
  // Datasets XML that pre-fills the official OLRB forms (A-30 DFR response,
  // A-53 reprisal application). The representative opens the pristine
  // official form and imports this file (Acrobat: Prepare Form → More →
  // Import Data). Narrative questions are deliberately left blank; the
  // generated documents are the substantive schedules.

  fastify.get('/api/labour/:matterId/form/:formId', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId, formId } = req.params as { matterId: string; formId: string };
    if (formId !== 'a30-data' && formId !== 'a53-data') {
      return reply.status(400).send({ ok: false, error: 'Unknown form. Available: a30-data, a53-data.' });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { labour } = loadLabourData(row.data_json);
    if (!labour.intake || Object.keys(labour.intake).length === 0) {
      return reply.status(400).send({ ok: false, error: 'Complete grievance intake before generating the form data file.' });
    }

    // Representative details from the user profile where available
    let rep: Record<string, string | undefined> = {};
    try {
      const { getUserById } = await import('../../db/database.js');
      const user = getUserById(userId);
      if (user?.profile_json) {
        const profile = JSON.parse(user.profile_json) as Record<string, unknown>;
        rep = {
          representativeName: user.display_name ?? undefined,
          organizationName: (profile.firmName as string) || undefined,
          phone: (profile.firmPhone as string) || undefined,
          email: (profile.firmEmail as string) || undefined,
          address: (profile.firmAddress as string) || undefined,
        };
      }
    } catch { /* profile is best-effort */ }

    const { buildA30DatasetsXml, buildA53DatasetsXml, olrbDataFilename } = await import('../../labour/olrb-form-data.js');
    const form = formId === 'a30-data' ? 'a30' as const : 'a53' as const;
    const xml = form === 'a30' ? buildA30DatasetsXml(labour.intake, rep) : buildA53DatasetsXml(labour.intake, rep);

    logger.info('OLRB form data file generated', { userId, matterId, form });
    return reply
      .header('Content-Type', 'application/xml; charset=utf-8')
      .header('Content-Disposition', `attachment; filename="${olrbDataFilename(form, labour.intake)}"`)
      .send(xml);
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
    const { deriveLabourStage } = await import('../../employment/stage-model.js');
    const { recommendLabourNextSteps } = await import('../../employment/next-steps.js');
    const stage = deriveLabourStage(matter, labour);
    return reply.send({
      ok: true,
      data: labour,
      stage,
      nextSteps: recommendLabourNextSteps(matter, labour, stage),
    });
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

    let result: { html: string; documentTitle: string; reviewerFlags: string[]; costUsd: number };

    if (parsed.data.documentType === 'remedy_worksheet') {
      // Deterministic: arithmetic over the intake, no model call, no cost.
      try {
        const worksheet = buildRemedyWorksheet(labour.intake);
        result = { ...worksheet, costUsd: 0 };
      } catch (err) {
        return reply.status(400).send({ ok: false, error: err instanceof Error ? err.message : 'Remedy worksheet inputs are incomplete.' });
      }
    } else {
      // Anonymisation terms: grievor + employer + union names
      const definedTerms: string[] = [];
      const grievor = [labour.intake.grievor_first_name, labour.intake.grievor_last_name].filter(Boolean).join(' ');
      if (grievor) definedTerms.push(grievor);
      if (labour.intake.employer_name) definedTerms.push(labour.intake.employer_name);
      if (labour.intake.union_name) definedTerms.push(labour.intake.union_name);

      result = await generateGrievanceDocument({
        intake: labour.intake,
        approvedIssues: labour.approvedIssues,
        documentType: parsed.data.documentType as GrievanceDocumentType,
        representativeName: parsed.data.representativeName,
        organizationName: parsed.data.organizationName,
        additionalContext: parsed.data.additionalContext,
      }, definedTerms);
    }

    // Store + draft history (same shape as employment)
    const history = Array.isArray(matter.draftHistory) ? matter.draftHistory as Array<Record<string, unknown>> : [];
    history.unshift({
      docType: parsed.data.documentType, title: result.documentTitle,
      html: sanitiseHtml(result.html), costUsd: result.costUsd,
      generatedAt: new Date().toISOString(),
    });
    matter.draftHistory = history.slice(0, 10);
    // Durable usage ledger for usage-based pricing (draftHistory caps at 10).
    try {
      recordUsageEvent(userId, matterId, 'generation', parsed.data.documentType, result.costUsd);
    } catch { /* metering must never fail a generation */ }
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
