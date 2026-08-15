/**
 * Employment routes — Firm style profiles and templates.
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

export function registerStyleTemplateRoutes(fastify: FastifyInstance): void {

  // ── Style profiles ─────────────────────────────────────────────────────
  // The complement to templates for flowing prose: Starling reads several
  // of the firm's precedents ONCE, describes how the firm writes that
  // document (flow, voice, recurring language), and stores the description.
  // Every later generation can draft in that style for the current
  // matter's facts. Two precedents suffice here (unlike alignment, which
  // needs three to tell boilerplate from coincidence), because the model
  // describes rather than diffs.

  /**
   * Document types that are FORMS, not prose: orders, notices of motion,
   * court forms. Their precedents are read for fixed wording and part
   * order, never for voice.
   */
  const FORM_DOCUMENT_TYPES = new Set([
    'sp_timetable_motion', 'consent_timetable_order', 'timetable_order',
    'sj_notice_of_motion', 'affidavit_of_service', 'rule49_offer',
    'rule49_withdrawal', 'rule49_acceptance', 'costs_outline',
    'esa_filing_sheet', 'scc_filing_sheet', 'notice_of_action',
    'settlement_minutes', 'undertakings_answers',
  ]);

  // Correspondence is built on firm boilerplate: the same opening block,
  // the same first paragraph, letter after letter, with the facts swapped.
  // Prose mode learns voice and flow and deliberately writes fresh
  // language, which is wrong for a letter whose worth is that it reads
  // exactly like the last one the firm sent.
  const LETTER_DOCUMENT_TYPES = new Set([
    'demand_letter', 'counter_offer', 'reply', 'decline_letter', 'member_update',
  ]);

  const styleBuildSchema = z.object({
    documentType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    label: z.string().trim().min(1).max(120),
    /** Override the automatic prose/form choice. */
    documentKind: z.enum(['prose', 'form', 'letter']).optional(),
    /** Proceed even though a precedent looks like a different document. */
    ignoreTypeMismatch: z.boolean().optional(),
    // Two precedents suffice for prose and form styles, matching the
    // panel's copy. LETTER styles need three, enforced below: the fixed-
    // passage extractor treats a passage as boilerplate when it recurs,
    // and with exactly two letters nearly everything recurs.
    precedents: z.array(z.object({
      name: z.string().trim().min(1).max(300),
      docxBase64: z.string().max(14_000_000).optional(),
      text: z.string().max(2_000_000).optional(),
    }).refine(pr => Boolean(pr.docxBase64 || pr.text), { message: 'Provide the file or its text' })).min(2).max(8),
  });

  fastify.post('/api/employment/style-profiles/build', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });

    const parsed = styleBuildSchema.safeParse(req.body);
    if (!parsed.success) {
      // Name the field and the rule. "Invalid style profile request" left
      // the pilot guessing which of eight files the schema disliked.
      const body = req.body as { precedents?: Array<{ name?: string }> } | null;
      const detail = parsed.error.issues.slice(0, 3).map(i => {
        const [head, idx, leaf] = i.path;
        const fileName = head === 'precedents' && typeof idx === 'number' ? body?.precedents?.[idx]?.name : undefined;
        const where = fileName ? `"${fileName}" (${String(leaf ?? 'file')})` : i.path.join('.');
        return `${where}: ${i.message}`;
      }).join('; ');
      return reply.status(400).send({ ok: false, error: `The style could not be learned. ${detail}.` });
    }

    const { readPrecedentBuffer } = await import('../../../employment/precedent-read.js');
    const texts: Array<{ name: string; text: string }> = [];
    for (const p of parsed.data.precedents) {
      let value = p.text ?? '';
      if (!value.trim()) {
        const read = await readPrecedentBuffer(p.name, p.docxBase64!);
        if (!read.ok) return reply.status(400).send({ ok: false, error: read.error });
        value = read.text;
      }
      if (value.trim().length < 150) {
        return reply.status(400).send({ ok: false, error: `"${p.name}" has too little text to learn from. Is it the right file?` });
      }
      texts.push({ name: p.name, text: value });
    }

    // Does each precedent look like the document it is being taught for?
    // The firm's timetable materials are three documents in one folder;
    // teaching the motion from consent orders would shape every later
    // motion, silently. Checked BEFORE the model call, so a mistake costs
    // nothing.
    const { checkPrecedentTypes } = await import('../../../employment/precedent-type-check.js');
    const typeIssues = checkPrecedentTypes(texts, parsed.data.documentType);
    if (typeIssues.length > 0 && !parsed.data.ignoreTypeMismatch) {
      return reply.status(409).send({
        ok: false,
        error: 'Some of those precedents look like a different document.',
        typeIssues: typeIssues.map(i => i.message),
        canOverride: true,
      });
    }

    const { analyseStyle, extractIdentifiers } = await import('../../../employment/style-profile.js');
    const documentKind = parsed.data.documentKind
      ?? (FORM_DOCUMENT_TYPES.has(parsed.data.documentType) ? 'form'
        : LETTER_DOCUMENT_TYPES.has(parsed.data.documentType) ? 'letter'
        : 'prose');
    if (documentKind === 'letter' && texts.length < 3) {
      return reply.status(400).send({ ok: false, error: 'Letter styles need at least three example letters: with only two, the boilerplate extractor cannot tell the firm\'s standard passages from wording particular to those files.' });
    }
    let guide;
    let costUsd = 0;
    try {
      const analysed = await analyseStyle(texts, documentKind);
      guide = analysed.guide;
      costUsd = analysed.costUsd;
    } catch (err) {
      logger.error('Style analysis failed', { documentType: parsed.data.documentType, error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'The style could not be learned from those files. Try again; if it keeps failing, try fewer or shorter precedents.' });
    }

    const id = `style-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    saveStyleProfile({
      id,
      firm_id: firmId,
      document_type: parsed.data.documentType,
      label: parsed.data.label,
      guide_json: JSON.stringify(guide),
      identifiers_json: JSON.stringify(extractIdentifiers(texts.map(t => t.text))),
      source_count: texts.length,
      source_names: JSON.stringify(texts.map(t => t.name)),
      cost_usd: costUsd,
    });
    try { recordUsageEvent(userId, 'firm', 'analysis', `style_profile_${parsed.data.documentType}`, costUsd); } catch { /* metering is best-effort */ }
    logger.info('Style profile built', { userId, firmId, documentType: parsed.data.documentType, sources: texts.length, costUsd: costUsd.toFixed(4) });
    return reply.send({ ok: true, id, label: parsed.data.label, guide, documentKind, sourceCount: texts.length, costUsd });
  });

  fastify.get('/api/employment/style-profiles', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.send({ ok: true, profiles: [] });
    const { documentType } = (req.query ?? {}) as { documentType?: string };
    const rows = getStyleProfiles(firmId, documentType && /^[a-z0-9_]{1,60}$/.test(documentType) ? documentType : undefined);
    return reply.send({
      ok: true,
      profiles: rows.map(r => ({
        id: r.id, documentType: r.document_type, label: r.label,
        sourceCount: r.source_count, createdAt: r.created_at,
      })),
    });
  });

  fastify.get('/api/employment/style-profiles/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { id } = req.params as { id: string };
    const row = getStyleProfile(firmId, id);
    if (!row) return reply.status(404).send({ ok: false, error: 'Style profile not found.' });
    let guide: unknown = null;
    try { guide = JSON.parse(row.guide_json); } catch { /* shown as unreadable below */ }
    return reply.send({
      ok: true,
      profile: {
        id: row.id, documentType: row.document_type, label: row.label,
        guide, sourceCount: row.source_count, createdAt: row.created_at,
      },
    });
  });

  // The tweak that persists: the lawyer edits the guide (flow, voice,
  // language, depth, table rows) and the SAME profile improves for every
  // later draft — no rebuilding, no repeating the same correction.
  fastify.put('/api/employment/style-profiles/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { id } = req.params as { id: string };
    const existing = getStyleProfile(firmId, id);
    if (!existing) return reply.status(404).send({ ok: false, error: 'Style profile not found.' });

    const { styleGuideSchema } = await import('../../../employment/style-profile.js');
    const bodySchema = z.object({
      label: z.string().trim().min(1).max(120),
      guide: styleGuideSchema,
    });
    const parsed = bodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'The edited style profile is invalid: ' + parsed.error.issues.map(i => `${i.path.join('.')} ${i.message}`).slice(0, 3).join('; '),
      });
    }
    updateStyleProfile(firmId, id, parsed.data.label, JSON.stringify(parsed.data.guide));
    logger.info('Style profile edited', { firmId, id });
    return reply.send({ ok: true });
  });

  fastify.delete('/api/employment/style-profiles/:id', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { id } = req.params as { id: string };
    const removed = deleteStyleProfile(firmId, id);
    if (!removed) return reply.status(404).send({ ok: false, error: 'Style profile not found.' });
    return reply.send({ ok: true });
  });

  // ── POST /api/employment/templates/align ───────────────────────────────
  // Turn several of the firm's precedents into a template proposal by
  // diffing them: recurring text is the firm's boilerplate, varying text
  // becomes a placeholder. Deterministic and free — no model call, and the
  // precedents never leave this server. The lawyer reviews the proposal
  // before anything is saved (POST .../align/save).

  const alignSchema = z.object({
    documentType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    precedents: z.array(z.object({
      name: z.string().trim().min(1).max(300),
      docxBase64: z.string().max(14_000_000).optional(),
      text: z.string().max(2_000_000).optional(),
      /** Optional: the matter this precedent came from. Naming placeholders
       *  from real intake data is exact, where pattern matching guesses. */
      matterId: z.string().trim().max(200).optional(),
    }).refine(pr => Boolean(pr.docxBase64 || pr.text), { message: 'Provide the file or its text' })).min(3).max(8),
  });

  fastify.post('/api/employment/templates/align', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });

    const parsed = alignSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({
        ok: false,
        error: 'Provide a document type and at least three precedents (up to eight).',
      });
    }

    const { readPrecedentBuffer } = await import('../../../employment/precedent-read.js');
    const { alignPrecedents } = await import('../../../employment/precedent-alignment.js');

    const inputs: Array<{ name: string; text: string }> = [];
    const facts: Array<MatterFacts | undefined> = [];
    for (const p of parsed.data.precedents) {
      let text = '';
      if (p.text?.trim()) {
        text = p.text;
      } else {
        const read = await readPrecedentBuffer(p.name, p.docxBase64!);
        if (!read.ok) return reply.status(400).send({ ok: false, error: read.error });
        text = read.text;
      }
      if (!text.trim()) {
        return reply.status(400).send({ ok: false, error: `“${p.name}” appears to contain no text.` });
      }
      inputs.push({ name: p.name, text });

      // Matter facts are read under the CALLER's id, so a precedent can
      // only be tied to a matter the caller already owns.
      let matterFacts: MatterFacts | undefined;
      if (p.matterId) {
        const row = getMatterById(p.matterId, userId);
        if (row) {
          const { employment } = loadEmploymentData(row.data_json);
          const i = employment.intake;
          if (i) {
            matterFacts = {
              client_first_name: i.client_first_name ?? undefined, client_last_name: i.client_last_name ?? undefined,
              client_address: i.client_address ?? undefined, employer_legal_name: i.employer_legal_name ?? undefined,
              employer_address: i.employer_address ?? undefined, job_title: i.job_title ?? undefined,
              hire_date: i.hire_date ?? undefined, termination_date: i.termination_date ?? undefined,
              annual_salary: i.annual_salary,
            };
          }
        }
      }
      facts.push(matterFacts);
    }

    try {
      const result = alignPrecedents(inputs, facts);
      logger.info('Precedents aligned', {
        firmId, documentType: parsed.data.documentType,
        precedents: inputs.length, slots: result.slots.length,
      });
      return reply.send({ ok: true, documentType: parsed.data.documentType, alignment: result });
    } catch (err) {
      return reply.status(400).send({
        ok: false,
        error: err instanceof Error ? err.message : 'Alignment failed.',
      });
    }
  });

  // ── POST /api/employment/templates/align/save ──────────────────────────
  // Save a reviewed alignment as a template variant. The lawyer's decisions
  // arrive as slot id → placeholder name (or null to keep the original
  // wording). The rendered template is verified to contain no invented
  // prose before it is stored.

  const alignSaveSchema = z.object({
    documentType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    variantLabel: z.string().trim().min(1).max(80),
    isDefault: z.boolean().optional(),
    alignment: z.object({
      lines: z.array(z.object({
        index: z.number(), presentIn: z.array(z.number()),
        skeleton: z.string(), stable: z.boolean(),
      })).max(2000),
      slots: z.array(z.object({
        id: z.string().max(20), kind: z.string().max(20), lineIndex: z.number(),
        observedValues: z.array(z.string().max(4000)).max(8),
        suggestedPlaceholder: z.string().max(60).nullable(),
        basis: z.string().max(20),
      })).max(500),
      stableLineCount: z.number(), optionalLineCount: z.number(),
      precedentNames: z.array(z.string().max(300)).max(8),
      warnings: z.array(z.string().max(500)).max(20),
    }),
    decisions: z.record(z.string().max(20), z.string().max(60).nullable()),
    includeOptionalLines: z.boolean().optional(),
  });

  fastify.post('/api/employment/templates/align/save', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });

    const parsed = alignSaveSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid template to save.' });

    const { renderTemplate } = await import('../../../employment/precedent-alignment.js');
    const { Document, Packer, Paragraph, TextRun } = await import('docx');

    const alignment = parsed.data.alignment as unknown as Parameters<typeof renderTemplate>[0];
    const templateText = renderTemplate(alignment, parsed.data.decisions, {
      includeOptionalLines: parsed.data.includeOptionalLines ?? true,
    });
    if (!templateText.trim()) {
      return reply.status(400).send({ ok: false, error: 'The reviewed template is empty.' });
    }

    // Build a DOCX carrying the firm's own words plus the confirmed
    // placeholders. Formatting comes from the firm's later edits; the point
    // here is that the language is theirs, verbatim.
    const doc = new Document({
      sections: [{
        children: templateText.split('\n').map(line =>
          new Paragraph({ children: [new TextRun({ text: line, font: 'Times New Roman', size: 24 })] })),
      }],
    });
    const buffer = await Packer.toBuffer(doc);
    const templateBase64 = buffer.toString('base64');

    const placeholders = detectPlaceholders(templateText);
    const label = parsed.data.variantLabel.trim();
    const variantId = `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'variant'}-${Math.random().toString(36).slice(2, 6)}`;
    const id = `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;

    saveFirmTemplate(id, firmId, parsed.data.documentType, `${label}.docx`, templateBase64, placeholders,
      { variantId, variantLabel: label, isDefault: parsed.data.isDefault });

    logger.info('Aligned template saved', {
      firmId, documentType: parsed.data.documentType, variantId, placeholders: placeholders.length,
    });
    return reply.send({ ok: true, templateId: id, variantId, variantLabel: label, placeholders });
  });

  // ── POST /api/employment/templates ─────────────────────────────────────
  // Upload or update a firm's DOCX template for a specific document type.

  fastify.post('/api/employment/templates', async (req: FastifyRequest, reply: FastifyReply) => {
    const parsed = templateUploadSchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid template upload' });
    }

    const { documentType, name, templateBase64, variantLabel, isDefault } = parsed.data;
    // The firm comes from the authenticated identity ONLY. A body-supplied
    // firmId let any caller overwrite another firm's template (the same
    // tenant-isolation hole the legacy /:firmId routes were removed for).
    const firmId = resolveFirmId(req);
    if (!firmId) {
      return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    }

    // Detect placeholders from the DOCX's actual text. A .docx is a zip, so
    // reading the raw bytes as utf-8 finds nothing (the text is compressed) —
    // that made every upload report zero placeholders. Unzip and read the
    // document body plus any headers and footers, which is where letterhead
    // markers usually live.
    let placeholders: string[] = [];
    let templateNotice: string | null = null;
    try {
      const JSZip = (await import('jszip')).default;
      const zip = await JSZip.loadAsync(Buffer.from(templateBase64, 'base64'));
      const parts = Object.keys(zip.files).filter(f =>
        f === 'word/document.xml' || f.startsWith('word/header') || f.startsWith('word/footer'));
      const chunks: string[] = [];
      for (const part of parts) {
        const file = zip.file(part);
        if (file) chunks.push(await file.async('string'));
      }
      // Markers split across XML runs by Word would otherwise be missed:
      // strip the tags between braces before detecting.
      const joined = chunks.join('\n').replace(/(\{\{[A-Z_]*)(<[^>]+>)+([A-Z_]*\}\})/g, '$1$3');
      placeholders = detectPlaceholders(joined);
      // A template with no markers is about to behave in a way the lawyer
      // has to know about, and reporting "0 placeholders detected" is not
      // telling them. Say what will happen, and name the notation they
      // appear to be using where there is one.
      if (placeholders.length === 0) {
        const { detectForeignMarkerStyle } = await import('../../../employment/docx-splice.js');
        const plainText = joined.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
        const foreign = detectForeignMarkerStyle(plainText);
        templateNotice = foreign
          ? `No Starling markers found. This template appears to use ${foreign}, which Starling does not read. It will be used as letterhead: your header, footer, fonts and margins are kept, and the generated document replaces the body. To place content yourself, put {{LEGAL_ANALYSIS}} where the body should go.`
          : 'No Starling markers found. This template will be used as letterhead: your header, footer, fonts and margins are kept, and the generated document replaces the body. To control placement, put {{LEGAL_ANALYSIS}} where the body should go.';
      }
    } catch {
      // Not a readable DOCX: store it anyway, but report no placeholders
      // rather than guessing from the raw bytes.
      placeholders = [];
    }

    // The variant id is derived from the lawyer's label so it stays
    // readable, with a short suffix so two similar labels cannot collide.
    const label = variantLabel?.trim() || 'Standard';
    const variantId = parsed.data.variantId?.trim()
      || `${label.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'variant'}-${Math.random().toString(36).slice(2, 6)}`;

    const id = `tpl-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    saveFirmTemplate(id, firmId, documentType, name, templateBase64, placeholders,
      { variantId, variantLabel: label, isDefault });

    logger.info('Template uploaded', { firmId, documentType, name, variantId, placeholders: placeholders.length });

    return reply.send({
      ok: true,
      templateId: id,
      variantId,
      variantLabel: label,
      placeholders,
      notice: templateNotice,
    });
  });

  // ── POST /api/employment/templates/:documentType/default ───────────────
  // Make one variant the default for its document type.

  fastify.post('/api/employment/templates/:documentType/default', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { documentType } = req.params as { documentType: string };
    const body = z.object({ variantId: z.string().trim().min(1).max(80) }).safeParse(req.body);
    if (!body.success) return reply.status(400).send({ ok: false, error: 'A variant is required.' });

    const ok = setDefaultFirmTemplate(firmId, documentType, body.data.variantId);
    if (!ok) return reply.status(404).send({ ok: false, error: 'That template variant was not found.' });
    logger.info('Template default changed', { firmId, documentType, variantId: body.data.variantId });
    return reply.send({ ok: true });
  });

  // ── GET /api/employment/templates ──────────────────────────────────────
  // List the requesting user's firm templates. Once uploaded, a template is
  // the firm default for its document type across ALL matters.

  fastify.get('/api/employment/templates', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req) ?? '';
    const templates = getFirmTemplates(firmId);

    return reply.send({
      ok: true,
      templates: templates.map(t => ({
        id: t.id,
        documentType: t.document_type,
        variantId: t.variant_id,
        variantLabel: t.variant_label,
        isDefault: t.is_default === 1,
        name: t.name,
        placeholders: JSON.parse(t.placeholders),
        uploadedAt: t.created_at,
        updatedAt: t.updated_at,
      })),
    });
  });

  // ── DELETE /api/employment/templates/:documentType ─────────────────────
  // Remove one variant (?variantId=...), or every variant of a type.
  // Deleting the default promotes the most recently updated survivor so a
  // type is never left without one.

  fastify.delete('/api/employment/templates/:documentType', async (req: FastifyRequest, reply: FastifyReply) => {
    const firmId = resolveFirmId(req);
    if (!firmId) return reply.status(403).send({ ok: false, error: 'No firm is associated with this account.' });
    const { documentType } = req.params as { documentType: string };
    const { variantId } = (req.query ?? {}) as { variantId?: string };
    deleteFirmTemplate(firmId, documentType, variantId);
    logger.info('Template deleted', { firmId, documentType, variantId: variantId ?? 'ALL' });
    return reply.send({ ok: true });
  });
}
