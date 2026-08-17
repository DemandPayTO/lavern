/**
 * Employment routes — the factum argument library.
 *
 * The per-firm Part III argument sections for a wrongful-dismissal factum: the
 * matter picker (which arguments fire, force on/off), and the library (edit the
 * firm's argument language, teach it from the firm's own factums). Mirrors the
 * SOC node routes; a factum argument is prose guidance, so there is no
 * conditional-validation gate, only a length bound.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { getMatterById } from '../../../db/database.js';
import { getFirmFactumNodes, saveFirmFactumNode, deleteFirmFactumNode, getUserById } from '../../../db/database.js';
import { getFirmFactumCustomSections, saveFirmFactumCustomSection, deleteFirmFactumCustomSection } from '../../../db/database.js';
import {
  loadFactumNodes, mergeFirmFactumNodes, buildFactumGateState, factumNodeStatuses, firmCustomSectionsToNodes,
} from '../../../employment/factum-nodes.js';
import { buildFactumOutline, isStructuralSectionId, structuralSectionKind, factumForumFromProcedure } from '../../../employment/factum-outline.js';
import type { FactumDraftState } from '../../../employment/factum-outline.js';
import { generateFactumSection, factumSectionReviewFlags } from '../../../employment/factum-section-generator.js';
import type { FactumSectionRequest } from '../../../employment/factum-section-generator.js';
import { sanitiseReviewHtml } from '../../../employment/document-reviews.js';
import { loadSelectedFactumNodes } from './factum-selection.js';
import { loadEmploymentData, saveEmploymentData, resolveFirmId, logger } from './shared.js';

function customBlockId(): string {
  return 'FACTUM_CUSTOM_' + Math.random().toString(36).slice(2, 10);
}

export function registerFactumNodeRoutes(fastify: FastifyInstance): void {

  // ── The argument sections: what the factum will argue, and why ─────────
  // The picker's data source and the lawyer's override switch. Overrides
  // persist on the matter so a regeneration keeps the lawyer's choices.

  fastify.get('/api/employment/:matterId/factum-nodes', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);

    const firmId = resolveFirmId(req);
    const base = firmId ? mergeFirmFactumNodes(loadFactumNodes(), getFirmFactumNodes(firmId)) : loadFactumNodes();
    const custom = firmId ? firmCustomSectionsToNodes(getFirmFactumCustomSections(firmId)) : [];
    const nodes = [...base, ...custom];
    const state = buildFactumGateState({ gates: employment.gates ?? [], approvedIssues: employment.approvedIssues ?? [] });
    const overrides = ((matter as Record<string, unknown>).factumNodeOverrides ?? {}) as Record<string, 'on' | 'off'>;
    return reply.send({ ok: true, nodes: factumNodeStatuses(nodes, state, overrides) });
  });

  fastify.put('/api/employment/:matterId/factum-nodes', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = z.object({
      blockId: z.string().trim().min(1).max(60),
      override: z.enum(['on', 'off']).nullable(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid override' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const overrides = ((matter as Record<string, unknown>).factumNodeOverrides ?? {}) as Record<string, 'on' | 'off'>;
    if (parsed.data.override === null) delete overrides[parsed.data.blockId];
    else overrides[parsed.data.blockId] = parsed.data.override;
    (matter as Record<string, unknown>).factumNodeOverrides = overrides;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true, overrides });
  });

  // ── The factum outline: draft and approve the factum section by section ──
  // The outline is every part of the factum as a section the lawyer drafts,
  // reads, and approves: Overview, the Facts, each Part III argument, and the
  // Order. The approved sections assemble into the numbered factum.

  fastify.get('/api/employment/:matterId/factum-outline', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);

    const overrides = ((matter as Record<string, unknown>).factumNodeOverrides ?? {}) as Record<string, 'on' | 'off'>;
    const forum = factumForumFromProcedure(employment.selectedProcedure ?? (employment.analysis as { recommendedProcedure?: string } | null)?.recommendedProcedure);
    const selected = loadSelectedFactumNodes({
      firmId: resolveFirmId(req),
      gates: employment.gates ?? [],
      approvedIssues: employment.approvedIssues ?? [],
      overrides,
      forum,
    });
    const draft = ((matter as Record<string, unknown>).factumDraft ?? undefined) as FactumDraftState | undefined;
    return reply.send({ ok: true, sections: buildFactumOutline(selected, draft, forum) });
  });

  fastify.post('/api/employment/:matterId/factum-section/draft', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = z.object({
      sectionId: z.string().trim().min(1).max(60),
      claimAmount: z.number().positive().max(99_999_999).optional(),
      lawyerName: z.string().trim().max(200).optional(),
      firmName: z.string().trim().max(200).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Name the section to draft.' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and run analysis before drafting factum sections.' });
    }

    // Resolve the section: a structural part, or one of the currently selected
    // Part III arguments (so its guidance reflects any library edit or override).
    const overrides = ((matter as Record<string, unknown>).factumNodeOverrides ?? {}) as Record<string, 'on' | 'off'>;
    const forum = factumForumFromProcedure(employment.selectedProcedure ?? (employment.analysis as { recommendedProcedure?: string } | null)?.recommendedProcedure);
    const selected = loadSelectedFactumNodes({
      firmId: resolveFirmId(req),
      gates: employment.gates ?? [],
      approvedIssues: employment.approvedIssues ?? [],
      overrides,
      forum,
    });
    const { sectionId } = parsed.data;

    let sectionReq: FactumSectionRequest;
    const structuralKind = structuralSectionKind(sectionId);
    if (structuralKind) {
      sectionReq = {
        kind: structuralKind,
        forum,
        sectionHeader: sectionId === 'OVERVIEW' ? 'Overview' : sectionId === 'FACTS' ? 'The Facts' : (forum === 'small_claims' ? 'The Judgment Requested' : 'The Order Requested'),
        intake: employment.intake,
        analysis: employment.analysis,
        approvedIssues: employment.approvedIssues ?? [],
        claimAmount: parsed.data.claimAmount,
        lawyerName: parsed.data.lawyerName,
        firmName: parsed.data.firmName,
      };
    } else {
      const node = selected.find(s => s.blockId === sectionId);
      if (!node) {
        return reply.status(400).send({ ok: false, error: 'That section is not in the factum outline. Turn it on in the outline first.' });
      }
      sectionReq = {
        kind: 'argument',
        forum,
        sectionHeader: node.sectionHeader,
        guidance: node.guidance,
        authorities: node.authorities,
        intake: employment.intake,
        analysis: employment.analysis,
        approvedIssues: employment.approvedIssues ?? [],
        claimAmount: parsed.data.claimAmount,
        lawyerName: parsed.data.lawyerName,
        firmName: parsed.data.firmName,
      };
    }

    let result;
    try {
      result = await generateFactumSection(sectionReq);
    } catch (err) {
      logger.error('Factum section draft failed', { matterId, sectionId, error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'This section could not be drafted. Please try again.' });
    }

    // Persist the section's draft on the matter. Redrafting replaces the draft
    // and clears its approval, so the lawyer re-reads what changed.
    const draft = ((matter as Record<string, unknown>).factumDraft ?? { sections: {} }) as FactumDraftState;
    if (!draft.sections) draft.sections = {};
    draft.sections[sectionId] = { html: result.html, approved: false, generatedAt: new Date().toISOString(), reviewFlags: result.reviewFlags };
    (matter as Record<string, unknown>).factumDraft = draft;
    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Factum section drafted', { matterId, sectionId, costUsd: result.costUsd.toFixed(4) });
    return reply.send({ ok: true, sectionId, html: result.html, reviewFlags: result.reviewFlags, costUsd: result.costUsd });
  });

  // Approve a drafted section, edit it by hand, un-approve it, or discard it.
  // Approve binds the section into the assembled factum; editing a section
  // un-approves it so the lawyer re-reads the changed text before approving.
  fastify.put('/api/employment/:matterId/factum-section', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = z.object({
      sectionId: z.string().trim().min(1).max(60),
      action: z.enum(['approve', 'unapprove', 'save', 'clear']),
      html: z.string().max(200_000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid section change.' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const { sectionId, action } = parsed.data;

    const draft = ((matter as Record<string, unknown>).factumDraft ?? { sections: {} }) as FactumDraftState;
    if (!draft.sections) draft.sections = {};

    if (action === 'clear') {
      delete draft.sections[sectionId];
      (matter as Record<string, unknown>).factumDraft = draft;
      await saveEmploymentData(userId, matterId, matter, employment);
      return reply.send({ ok: true, sectionId, cleared: true });
    }

    const sec = draft.sections[sectionId];
    if (!sec) return reply.status(400).send({ ok: false, error: 'Draft this section before approving it.' });

    if (action === 'approve') {
      sec.approved = true;
    } else if (action === 'unapprove') {
      sec.approved = false;
    } else if (action === 'save') {
      if (!parsed.data.html || !parsed.data.html.trim()) {
        return reply.status(400).send({ ok: false, error: 'The edited section is empty. Add text or discard it.' });
      }
      // The lawyer's edit is arbitrary HTML rendered in the dashboard, so it
      // passes the same allowlist as an adopted review version.
      const clean = sanitiseReviewHtml(parsed.data.html.trim());
      sec.html = clean;
      sec.reviewFlags = factumSectionReviewFlags(clean);
      sec.approved = false; // an edit needs a fresh read before it binds.
      sec.generatedAt = new Date().toISOString();
    }

    (matter as Record<string, unknown>).factumDraft = draft;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true, sectionId, approved: sec.approved, html: sec.html, reviewFlags: sec.reviewFlags ?? [] });
  });

  // ── The argument library: the firm's settled argument language ─────────
  // Guidance only: triggers, order, headers and authorities stay in code, so
  // a language edit can never change which issue argues what. Prior versions
  // are kept.

  fastify.get('/api/employment/factum-node-library', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const overrides = new Map(getFirmFactumNodes(firmId).map(r => [r.block_id, r]));
    return reply.send({
      ok: true,
      nodes: loadFactumNodes().map(n => {
        const o = overrides.get(n.blockId);
        return {
          blockId: n.blockId,
          sectionHeader: n.sectionHeader,
          issueLabel: n.issueLabel,
          authorities: n.authorities,
          triggerGates: n.triggerGates.join(', ') || 'ALWAYS',
          lawyerReview: n.lawyerReview,
          content: o?.content ?? n.guidance,
          provenance: o ? o.provenance : 'default',
          version: o?.version ?? 0,
          updatedAt: o?.updated_at,
          updatedByName: o?.updated_by || undefined,
        };
      }),
    });
  });

  fastify.put('/api/employment/factum-node-library/:blockId', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { blockId } = req.params as { blockId: string };
    const parsed = z.object({
      content: z.string().min(1).max(20_000),
      provenance: z.enum(['edited', 'learned']).default('edited'),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid argument guidance' });

    if (!loadFactumNodes().some(n => n.blockId === blockId)) {
      return reply.status(404).send({ ok: false, error: 'Unknown argument section.' });
    }

    let updatedBy = '';
    try { updatedBy = getUserById(userId)?.display_name ?? ''; } catch { /* attribution is best-effort */ }
    const version = saveFirmFactumNode(firmId, blockId, parsed.data.content, parsed.data.provenance, updatedBy);
    logger.info('Factum argument updated', { firmId, blockId, version, provenance: parsed.data.provenance });
    return reply.send({ ok: true, version });
  });

  fastify.delete('/api/employment/factum-node-library/:blockId', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { blockId } = req.params as { blockId: string };
    const removed = deleteFirmFactumNode(firmId, blockId);
    if (!removed) return reply.status(404).send({ ok: false, error: 'No firm version of that argument.' });
    return reply.send({ ok: true });
  });

  // ── Custom argument sections (the lawyer's own outline additions) ───────
  // Adding a section creates a reusable firm section; the caller forces it on
  // for the current matter through the override route above. It appears on
  // future matters as an off section the lawyer can force on.

  fastify.post('/api/employment/factum-node-library/custom', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const parsed = z.object({
      sectionHeader: z.string().trim().min(2).max(200),
      guidance: z.string().trim().min(10).max(20_000),
      authorities: z.string().trim().max(2_000).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues.slice(0, 2).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(400).send({ ok: false, error: `The section was not added. ${detail}. A heading and a note on what it argues are required.` });
    }
    const blockId = customBlockId();
    let updatedBy = '';
    try { updatedBy = getUserById(userId)?.display_name ?? ''; } catch { /* attribution is best-effort */ }
    saveFirmFactumCustomSection(firmId, blockId, parsed.data.sectionHeader, parsed.data.authorities ?? '', parsed.data.guidance, updatedBy);
    logger.info('Factum custom section added', { firmId, blockId });
    return reply.send({ ok: true, blockId, sectionHeader: parsed.data.sectionHeader });
  });

  fastify.delete('/api/employment/factum-node-library/custom/:blockId', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { blockId } = req.params as { blockId: string };
    const removed = deleteFirmFactumCustomSection(firmId, blockId);
    if (!removed) return reply.status(404).send({ ok: false, error: 'No such custom section.' });
    return reply.send({ ok: true });
  });

  // ── POST /api/employment/factum-node-library/teach ─────────────────────
  // Upload the firm's own factums; get back a proposed argument guidance per
  // section in the firm's approach, for approval. Nothing binds here.

  fastify.post('/api/employment/factum-node-library/teach', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const parsed = z.object({
      precedents: z.array(z.object({
        name: z.string().trim().min(1).max(300),
        docxBase64: z.string().max(14_000_000).optional(),
        text: z.string().max(2_000_000).optional(),
      }).refine(pr => Boolean(pr.docxBase64 || pr.text), { message: 'Provide the file or its text' })).min(1).max(8),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Upload between one and eight of the firm\'s factums.' });

    const { readPrecedentBuffer } = await import('../../../employment/precedent-read.js');
    const factums: Array<{ name: string; text: string }> = [];
    for (const p of parsed.data.precedents) {
      if (p.text?.trim()) { factums.push({ name: p.name, text: p.text.trim() }); continue; }
      const read = await readPrecedentBuffer(p.name, p.docxBase64!);
      if (!read.ok) return reply.status(400).send({ ok: false, error: read.error });
      factums.push({ name: p.name, text: read.text });
    }
    if (factums.length < 1) return reply.status(400).send({ ok: false, error: 'At least one readable factum is needed.' });

    const { proposeFactumArgumentUpdates } = await import('../../../employment/factum-teach.js');
    const nodes = mergeFirmFactumNodes(loadFactumNodes(), getFirmFactumNodes(firmId));
    try {
      const result = await proposeFactumArgumentUpdates(factums, nodes);
      logger.info('Factum teaching complete', {
        firmId, factums: factums.length,
        proposals: result.proposals.filter(p => p.proposed).length,
        costUsd: result.totalCostUsd.toFixed(4),
      });
      return reply.send({ ok: true, proposals: result.proposals, costUsd: result.totalCostUsd });
    } catch (err) {
      logger.error('Factum teaching failed', { error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'The factums could not be analysed. Please try again.' });
    }
  });
}
