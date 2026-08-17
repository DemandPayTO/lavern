/**
 * Employment routes — SOC nodes and the firm node library.
 *
 * Split out of employment-intake.ts. Shared helpers live in ./shared.ts;
 * this module registers only its own route handlers.
 */


import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import sanitizeHtmlLib from 'sanitize-html';
import { config } from '../../../config.js';
import { employmentIntakeSchema, createEmploymentMatterData } from '../../../types/employment-intake.js';
import type { EmploymentMatterData, EmploymentIntakeData, TimelineEvent, DocumentExtractionResult } from '../../../types/employment-intake.js';
import { evaluateGates, getTriggeredIssueCodes } from '../../../employment/gate-evaluator.js';
import { DEMAND_SOURCE_KINDS, isDemandSourceKind } from '../../../employment/demand-sources.js';
import {
  INSTRUCTION_KINDS, MAX_NOTES_CHARS, MAX_INSTRUCTIONS,
  directionContext, effectiveInstructions, checkDirectionTerms, departureFlags,
  DEPARTURE_CHECK_SYSTEM, buildDepartureCheckPrompt, extractLawyerNote,
} from '../../../employment/direction.js';
import type { MatterFacts } from '../../../employment/precedent-alignment.js';
import { rebuildTimelinePreserving, computeLimitationDeadline, computeBardalFactors, recommendProcedure, addTimelineEvent } from '../../../employment/timeline-generator.js';
import { saveMatter, getMatterById, getMattersByUser, saveFirmTemplate, getFirmTemplates, getFirmTemplate, deleteFirmTemplate, setDefaultFirmTemplate, saveStyleProfile, getStyleProfiles, getStyleProfile, updateStyleProfile, deleteStyleProfile, recordUsageEvent, getUserById } from '../../../db/database.js';
import { collectDeadlines } from '../../../employment/deadlines.js';
import { createLogger } from '../../../utils/logger.js';
import { extractEmploymentDocument } from '../../briefing/employment-extractor.js';
import { UPLOADABLE_DOCUMENT_TYPES, TONE_OPTIONS, PROCEDURE_TYPES } from '../../../types/employment-intake.js';
import { generateDemandLetter } from '../../../employment/demand-letter-generator.js';
import { generateStatementOfClaim } from '../../../employment/soc-generator.js';
import { generateApplication } from '../../../employment/application-generator.js';
import type { ApplicationType } from '../../../employment/application-generator.js';
import { htmlToDocx } from '../../../employment/docx-export.js';
import { generateLitigationDocument } from '../../../employment/litigation-documents.js';
import type { DocxExportOptions } from '../../../employment/docx-export.js';
import type { LitigationDocumentType } from '../../../employment/litigation-documents.js';
import { detectPlaceholders, templateUploadSchema } from '../../../employment/firm-templates.js';
import type { FirmTemplate } from '../../../employment/firm-templates.js';
import {
  DOCUMENT_STATUSES,
  DRAFT_HISTORY_CAP,
  DocumentStatus,
  GeneratedDocumentSummary,
  LEGACY_DOC_KEYS,
  REVISION_KIND_VALUES,
  applyDirectionAftermath,
  backfillIntakeIdentity,
  buildAdditionalHeads,
  collectGeneratedDocuments,
  diffUnlockedCauses,
  directionDepartureFlags,
  directionForGeneration,
  ensureAnalysisFresh,
  findGeneratedDocKey,
  fromParagraphsSafe,
  loadEmploymentData,
  loadStyleForGeneration,
  logger,
  recomputeAnalysis,
  recordDraftHistory,
  resolveFirmId,
  sanitiseHtml,
  saveEmploymentData,
  styleReviewFlags,
  titleForDoc,
  extractBodySchema,
  logAuditForm1,
} from './shared.js';

export function registerSocNodeRoutes(fastify: FastifyInstance): void {

  // ── The pleading nodes: what the claim will plead, and why ─────────────
  // The picker's data source and the lawyer's override switch. Overrides
  // persist on the matter so a regeneration keeps the lawyer's choices.

  fastify.get('/api/employment/:matterId/soc-nodes', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake) return reply.send({ ok: true, nodes: [] });

    const { loadSocNodes, buildSocEvalContext, nodeStatuses, mergeFirmNodes } = await import('../../../employment/soc-nodes.js');
    // The picker must preview the SAME language and figures generation
    // will use: the firm's taught nodes where they exist, and the claim's
    // own amount where one has been generated.
    const pickerFirmId = resolveFirmId(req);
    const { getFirmSocNodes } = await import('../../../db/database.js');
    const pickerNodes = pickerFirmId ? mergeFirmNodes(loadSocNodes(), getFirmSocNodes(pickerFirmId)) : loadSocNodes();
    const genSoc = (matter as Record<string, unknown>).generatedSOC as { claimAmount?: number } | undefined;
    const ctx = buildSocEvalContext({
      intake: employment.intake,
      analysis: employment.analysis ?? null,
      gates: employment.gates ?? [],
      approvedIssues: employment.approvedIssues ?? [],
      claimAmount: genSoc?.claimAmount ?? employment.demandAmount ?? 0,
    });
    const overrides = ((matter as Record<string, unknown>).socNodeOverrides ?? {}) as Record<string, 'on' | 'off'>;
    return reply.send({
      ok: true,
      nodes: nodeStatuses(pickerNodes, ctx, employment.approvedIssues ?? [], overrides),
    });
  });

  fastify.put('/api/employment/:matterId/soc-nodes', async (req: FastifyRequest, reply: FastifyReply) => {
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
    const overrides = ((matter as Record<string, unknown>).socNodeOverrides ?? {}) as Record<string, 'on' | 'off'>;
    if (parsed.data.override === null) delete overrides[parsed.data.blockId];
    else overrides[parsed.data.blockId] = parsed.data.override;
    (matter as Record<string, unknown>).socNodeOverrides = overrides;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true, overrides });
  });

  // ── The SOC outline: read, edit, approve the claim section by section ───
  // Every active pleading section (the firm's nodes, rendered) plus the
  // Background Facts. Reading and editing strip the {{para}} markers; a saved
  // edit re-inserts them so the document-wide numbering stays correct.

  const socOutlineCtx = async (req: FastifyRequest, matter: Record<string, unknown>, employment: { intake?: EmploymentIntakeData; analysis?: unknown; gates?: unknown; approvedIssues?: string[]; demandAmount?: number | null }) => {
    const { loadSocNodes, buildSocEvalContext, mergeFirmNodes } = await import('../../../employment/soc-nodes.js');
    const firmId = resolveFirmId(req);
    const { getFirmSocNodes } = await import('../../../db/database.js');
    const nodes = firmId ? mergeFirmNodes(loadSocNodes(), getFirmSocNodes(firmId)) : loadSocNodes();
    const genSoc = matter.generatedSOC as { claimAmount?: number } | undefined;
    const ctx = buildSocEvalContext({
      intake: employment.intake!,
      analysis: (employment.analysis as import('../../../types/employment-intake.js').IntakeAnalysisResult | undefined) ?? null,
      gates: (employment.gates as import('../../../types/employment-intake.js').GateResult[] | undefined) ?? [],
      approvedIssues: employment.approvedIssues ?? [],
      claimAmount: genSoc?.claimAmount ?? employment.demandAmount ?? 0,
    });
    return { nodes, ctx };
  };

  fastify.get('/api/employment/:matterId/soc-outline', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake) return reply.send({ ok: true, sections: [] });

    const { buildSocOutline } = await import('../../../employment/soc-outline.js');
    const { nodes, ctx } = await socOutlineCtx(req, matter as Record<string, unknown>, employment);
    const overrides = ((matter as Record<string, unknown>).socNodeOverrides ?? {}) as Record<string, 'on' | 'off'>;
    const draft = ((matter as Record<string, unknown>).socDraft ?? undefined) as import('../../../employment/soc-outline.js').SocDraftState | undefined;
    return reply.send({ ok: true, sections: buildSocOutline({ nodes, ctx, approvedIssues: employment.approvedIssues ?? [], overrides, draft }) });
  });

  // Draft the Background Facts (the SOC's one model-written section).
  fastify.post('/api/employment/:matterId/soc-section/draft', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = z.object({ sectionId: z.string().trim().min(1).max(60) }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Name the section to draft.' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and run analysis before drafting the claim.' });
    }
    const { isSocFactsSection } = await import('../../../employment/soc-outline.js');
    if (!isSocFactsSection(parsed.data.sectionId)) {
      return reply.status(400).send({ ok: false, error: 'Only the Background Facts are drafted by Starling. The other sections plead in the firm\'s settled language; read and edit them in place.' });
    }

    const { generateSocBackgroundFacts } = await import('../../../employment/soc-generator.js');
    const { loadSocNodes, mergeFirmNodes } = await import('../../../employment/soc-nodes.js');
    const firmId = resolveFirmId(req);
    const { getFirmSocNodes } = await import('../../../db/database.js');
    const customNodes = firmId ? mergeFirmNodes(loadSocNodes(), getFirmSocNodes(firmId)) : undefined;
    const genSoc = (matter as Record<string, unknown>).generatedSOC as { claimAmount?: number } | undefined;

    let result;
    try {
      result = await generateSocBackgroundFacts({
        intake: employment.intake,
        approvedIssues: employment.approvedIssues ?? [],
        analysis: employment.analysis,
        procedureType: (employment.analysis as { recommendedProcedure?: 'simplified' | 'ordinary' } | null)?.recommendedProcedure ?? 'ordinary',
        claimAmount: genSoc?.claimAmount ?? employment.demandAmount ?? 0,
        lawyerName: '', firmName: '', courtLocation: '',
        gates: employment.gates,
        timeline: (employment.timeline ?? []).map(e => ({ date: e.date, label: e.label, description: e.description })),
        nodeOverrides: ((matter as Record<string, unknown>).socNodeOverrides ?? {}) as Record<string, 'on' | 'off'>,
        customNodes,
      });
    } catch (err) {
      logger.error('SOC facts draft failed', { matterId, error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'The Background Facts could not be drafted. Please try again.' });
    }

    const draft = ((matter as Record<string, unknown>).socDraft ?? { sections: {} }) as import('../../../employment/soc-outline.js').SocDraftState;
    if (!draft.sections) draft.sections = {};
    draft.sections[parsed.data.sectionId] = { html: result.html, approved: false, edited: false, generatedAt: new Date().toISOString(), reviewFlags: result.reviewFlags };
    (matter as Record<string, unknown>).socDraft = draft;
    await saveEmploymentData(userId, matterId, matter, employment);
    const { stripParaMarkers } = await import('../../../employment/soc-outline.js');
    return reply.send({ ok: true, sectionId: parsed.data.sectionId, html: stripParaMarkers(result.html), reviewFlags: result.reviewFlags, costUsd: result.costUsd });
  });

  // Approve, edit by hand, or discard a section.
  fastify.put('/api/employment/:matterId/soc-section', async (req: FastifyRequest, reply: FastifyReply) => {
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
    const { ensureParaMarkers, stripParaMarkers, isSocFactsSection } = await import('../../../employment/soc-outline.js');

    const draft = ((matter as Record<string, unknown>).socDraft ?? { sections: {} }) as import('../../../employment/soc-outline.js').SocDraftState;
    if (!draft.sections) draft.sections = {};

    if (action === 'clear') {
      delete draft.sections[sectionId];
      (matter as Record<string, unknown>).socDraft = draft;
      await saveEmploymentData(userId, matterId, matter, employment);
      return reply.send({ ok: true, sectionId, cleared: true });
    }

    if (action === 'save') {
      if (!parsed.data.html || !parsed.data.html.trim()) {
        return reply.status(400).send({ ok: false, error: 'The edited section is empty. Add text or discard it.' });
      }
      // The lawyer's edit is arbitrary HTML rendered in the dashboard, so it
      // passes the review-version allowlist; markers are re-inserted so the
      // document-wide numbering stays correct.
      const { sanitiseReviewHtml } = await import('../../../employment/document-reviews.js');
      const { checkFillInPlaceholders } = await import('../../../employment/citation-canon.js');
      const withMarkers = ensureParaMarkers(sanitiseReviewHtml(parsed.data.html.trim()));
      draft.sections[sectionId] = {
        html: withMarkers,
        approved: false,
        edited: true,
        generatedAt: new Date().toISOString(),
        reviewFlags: checkFillInPlaceholders(withMarkers),
      };
      (matter as Record<string, unknown>).socDraft = draft;
      await saveEmploymentData(userId, matterId, matter, employment);
      return reply.send({ ok: true, sectionId, approved: false, edited: true, html: stripParaMarkers(withMarkers) });
    }

    // unapprove with no draft is a no-op.
    let sec = draft.sections[sectionId];
    if (!sec && action === 'unapprove') {
      return reply.send({ ok: true, sectionId, approved: false });
    }
    // approve a section never edited: seed its draft from the node's render
    // (with {{para}} markers intact) so approval locks exactly what was read.
    if (!sec && action === 'approve') {
      if (isSocFactsSection(sectionId)) {
        return reply.status(400).send({ ok: false, error: 'Draft the Background Facts before approving them.' });
      }
      const { renderNode } = await import('../../../employment/soc-nodes.js');
      const { nodes, ctx } = await socOutlineCtx(req, matter as Record<string, unknown>, employment);
      const node = nodes.find(n => n.blockId === sectionId);
      if (!node) return reply.status(400).send({ ok: false, error: 'That section is not in the claim.' });
      sec = { html: renderNode(node, ctx).html, approved: false, edited: false, generatedAt: new Date().toISOString() };
      draft.sections[sectionId] = sec;
    }
    if (!sec) return reply.status(400).send({ ok: false, error: 'Draft this section before approving it.' });
    sec.approved = action === 'approve';
    (matter as Record<string, unknown>).socDraft = draft;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true, sectionId, approved: sec.approved });
  });

  // ── The node library: the firm's pleading language ─────────────────────
  // Content only: triggers, order and headers stay in code, which is what
  // keeps a language edit from changing which claims plead what. Every
  // change passes the validation gate, and prior versions are kept.

  fastify.get('/api/employment/soc-node-library', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { loadSocNodes } = await import('../../../employment/soc-nodes.js');
    const { getFirmSocNodes } = await import('../../../db/database.js');
    const overrides = new Map(getFirmSocNodes(firmId).map(r => [r.block_id, r]));
    return reply.send({
      ok: true,
      nodes: loadSocNodes().map(n => {
        const o = overrides.get(n.blockId);
        return {
          blockId: n.blockId,
          sectionHeader: n.sectionHeader,
          tier: n.tier,
          triggerCondition: n.triggerCondition,
          lawyerReview: n.lawyerReview,
          content: o?.content ?? n.content,
          provenance: o ? o.provenance : 'default',
          version: o?.version ?? 0,
          updatedAt: o?.updated_at,
          updatedByName: o?.updated_by || undefined,
        };
      }),
    });
  });

  fastify.put('/api/employment/soc-node-library/:blockId', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { blockId } = req.params as { blockId: string };
    const parsed = z.object({
      content: z.string().min(1).max(30_000),
      provenance: z.enum(['edited', 'learned']).default('edited'),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid node content' });

    const { loadSocNodes } = await import('../../../employment/soc-nodes.js');
    if (!loadSocNodes().some(n => n.blockId === blockId)) {
      return reply.status(404).send({ ok: false, error: 'Unknown node.' });
    }

    // The gate. Structural failures do not save, whatever door they came
    // through: an unclosed conditional or an unanswerable condition field
    // fails silently on every future claim, which is the one failure a
    // pleading system must not allow.
    const { validateNodeContent } = await import('../../../employment/soc-node-validator.js');
    const validation = validateNodeContent(blockId, parsed.data.content);
    if (!validation.ok) {
      return reply.status(422).send({ ok: false, error: 'The edited language would break the node.', validation });
    }

    let updatedBy = '';
    try {
      const { getUserById } = await import('../../../db/database.js');
      updatedBy = getUserById(userId)?.display_name ?? '';
    } catch { /* attribution is best-effort */ }
    const { saveFirmSocNode } = await import('../../../db/database.js');
    const version = saveFirmSocNode(firmId, blockId, parsed.data.content, parsed.data.provenance, updatedBy);
    logger.info('SOC node updated', { firmId, blockId, version, provenance: parsed.data.provenance });
    return reply.send({ ok: true, version, validation });
  });

  fastify.delete('/api/employment/soc-node-library/:blockId', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { blockId } = req.params as { blockId: string };
    const { deleteFirmSocNode } = await import('../../../db/database.js');
    const removed = deleteFirmSocNode(firmId, blockId);
    if (!removed) return reply.status(404).send({ ok: false, error: 'No firm version of that node.' });
    return reply.send({ ok: true });
  });

  // ── POST /api/employment/soc-node-library/import ───────────────────────
  // The firm's node spreadsheet, diffed against the current library and
  // returned as proposals through the same gate as teaching. Content only:
  // a trigger that differs is reported, never applied.

  fastify.post('/api/employment/soc-node-library/import', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const parsed = z.object({
      xlsxBase64: z.string().min(1).max(15_000_000),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Upload the node spreadsheet as .xlsx.' });

    const { importNodeSpreadsheet } = await import('../../../employment/soc-import.js');
    const { mergeFirmNodes, loadSocNodes } = await import('../../../employment/soc-nodes.js');
    const { getFirmSocNodes } = await import('../../../db/database.js');
    try {
      const nodes = mergeFirmNodes(loadSocNodes(), getFirmSocNodes(firmId));
      const result = await importNodeSpreadsheet(Buffer.from(parsed.data.xlsxBase64, 'base64'), nodes);
      logger.info('Node spreadsheet read', {
        firmId,
        proposals: result.proposals.filter(p => p.proposed).length,
        unchanged: result.unchanged,
        unknown: result.unknownBlocks.length,
      });
      return reply.send({ ok: true, ...result });
    } catch (err) {
      logger.warn('Node spreadsheet import failed', { error: err instanceof Error ? err.message : String(err) });
      return reply.status(400).send({ ok: false, error: 'That file could not be read as the node spreadsheet. It needs the DemandPay column layout with Block_ID in column A and Content in column G.' });
    }
  });

  // ── POST /api/employment/soc-node-library/teach ────────────────────────
  // Upload the firm's own claims; get back a proposal per node in the
  // firm's wording, validated, for approval. Nothing binds here.

  fastify.post('/api/employment/soc-node-library/teach', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const parsed = z.object({
      precedents: z.array(z.object({
        name: z.string().trim().min(1).max(300),
        // A Word file arrives as base64; anything else (PDF, old .doc,
        // plain text) arrives already parsed to text by the browser.
        docxBase64: z.string().max(14_000_000).optional(),
        text: z.string().max(2_000_000).optional(),
      }).refine(pr => Boolean(pr.docxBase64 || pr.text), { message: 'Provide the file or its text' })).min(2).max(12),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Upload between two and twelve claims.' });

    const { readPrecedentBuffer } = await import('../../../employment/precedent-read.js');
    const claims: Array<{ name: string; text: string }> = [];
    for (const p of parsed.data.precedents) {
      if (p.text?.trim()) { claims.push({ name: p.name, text: p.text.trim() }); continue; }
      const read = await readPrecedentBuffer(p.name, p.docxBase64!);
      if (!read.ok) return reply.status(400).send({ ok: false, error: read.error });
      claims.push({ name: p.name, text: read.text });
    }
    if (claims.length < 2) return reply.status(400).send({ ok: false, error: 'At least two readable claims are needed.' });

    const { proposeNodeUpdates } = await import('../../../employment/soc-teach.js');
    const { mergeFirmNodes, loadSocNodes } = await import('../../../employment/soc-nodes.js');
    const { getFirmSocNodes } = await import('../../../db/database.js');
    const nodes = mergeFirmNodes(loadSocNodes(), getFirmSocNodes(firmId));
    try {
      const result = await proposeNodeUpdates(claims, nodes);
      logger.info('Node teaching complete', {
        firmId, claims: claims.length,
        proposals: result.proposals.filter(p => p.proposed).length,
        costUsd: result.totalCostUsd.toFixed(4),
      });
      return reply.send({
        ok: true,
        proposals: result.proposals,
        unmatched: result.unmatched.map(u => ({ heading: u.heading, sourceName: u.sourceName })),
        costUsd: result.totalCostUsd,
      });
    } catch (err) {
      logger.error('Node teaching failed', { error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'The claims could not be analysed. Please try again.' });
    }
  });
}
