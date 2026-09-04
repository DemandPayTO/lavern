/**
 * Employment routes — Draft lifecycle, client update, timetable package.
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

export function registerDraftRoutes(fastify: FastifyInstance): void {

  // ── POST /api/employment/:matterId/draft/replace ───────────────────────
  // The lawyer's own improved version becomes the version of record. Until
  // now an edited Word file could only donate its comments and tracked
  // changes; a lawyer who rewrote the prose directly saw their work stay
  // outside the system. The previous version is kept in draft history.

  const replaceDraftSchema = z.object({
    docType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    /** A Word file... */
    docxBase64: z.string().max(20_000_000).optional(),
    filename: z.string().trim().max(300).optional(),
    /** ...or the revised text pasted straight in. */
    pastedText: z.string().max(400_000).optional(),
  }).refine(b => Boolean(b.docxBase64 || b.pastedText), { message: 'Provide a file or pasted text' });

  fastify.post('/api/employment/:matterId/draft/replace', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = replaceDraftSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    // A draft prepared outside Starling can be ADOPTED: when no generated
    // document of this type exists yet, the upload creates it as the
    // version of record, and everything downstream (the revision loop,
    // the partner lane, the download pipeline) works on it as if Starling
    // had drafted it.
    let key = findGeneratedDocKey(matter, parsed.data.docType);
    let adopted = false;
    if (!key) {
      key = `generated_${parsed.data.docType}`;
      matter[key] = {
        documentType: parsed.data.docType,
        documentTitle: titleForDoc(parsed.data.docType, {}),
        html: '',
        citations: [],
        lawyerReviewFlags: [],
        generatedAt: new Date().toISOString(),
        costUsd: 0,
        status: 'draft',
      };
      adopted = true;
    }
    const doc = matter[key] as Record<string, unknown>;

    let html: string;
    if (parsed.data.pastedText) {
      // Pasted text arrives as plain paragraphs (or as HTML the lawyer
      // copied from the preview); sanitising covers both, and blank lines
      // become paragraph breaks so the structure survives.
      const raw = parsed.data.pastedText;
      html = /<(p|h[1-6]|div|table)[\s>]/i.test(raw)
        ? sanitiseHtml(raw)
        : sanitiseHtml(raw
            .split(/\n\s*\n/)
            .map(block => `<p>${block.trim().replace(/\n/g, '<br>')}</p>`)
            .join('\n'));
    } else {
      try {
        const buffer = Buffer.from(parsed.data.docxBase64!, 'base64');
        const mammoth = (await import('mammoth')).default;
        const { value } = await mammoth.convertToHtml({ buffer });
        html = sanitiseHtml(value ?? '');
      } catch {
        return reply.status(400).send({ ok: false, error: 'That file could not be read as a Word document.' });
      }
    }
    if (html.replace(/<[^>]+>/g, '').trim().length < 200) {
      return reply.status(400).send({ ok: false, error: 'That file has too little text to be the document. Is it the right file?' });
    }

    // Keep what is being replaced: the lawyer must be able to get back.
    // An adoption replaces nothing, so there is nothing to keep.
    if (!adopted) {
      recordDraftHistory(matter, {
        docType: parsed.data.docType,
        title: String(doc.documentTitle ?? parsed.data.docType),
        html: String(doc.html ?? ''),
        costUsd: 0,
        meta: { source: 'superseded_by_upload' },
      }, { userId, matterId });
    }

    doc.html = html;
    doc.revisedAt = new Date().toISOString();
    doc.lawyerEdited = {
      at: new Date().toISOString(),
      filename: parsed.data.pastedText ? 'pasted by the lawyer' : (parsed.data.filename ?? 'edited.docx'),
    };
    // A lawyer-edited version is the version of record; a stale uploaded
    // DOCX from the approval lane must not keep overriding the download.
    delete doc.uploadedDocx;
    await saveEmploymentData(userId, matterId, matter, employment);
    logger.info(adopted ? 'Outside draft adopted as version of record' : 'Draft replaced by lawyer version', { userId, matterId, docType: parsed.data.docType });
    return reply.send({ ok: true, html, adopted });
  });

  // ── POST /api/employment/:matterId/draft/review ────────────────────────
  // Starling reviews a finished document and reports what would weaken it.
  // Deterministic checks (figures against the record, missing firm
  // sections, length divergence) run first and are labelled "checked";
  // the model pass adds judgment findings, labelled as judgment. Every
  // finding is returned in the revision loop's item shape, so the lawyer
  // approves them through the same gate with the same byte-identity
  // guarantee.

  const draftReviewSchema = z.object({
    docType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    /** Stored brief sources to weigh in the review. */
    briefSourceIds: z.array(z.string().max(60)).max(8).optional(),
    /** Review against this firm style as well as the record. */
    styleProfileId: z.string().trim().max(100).optional(),
  });

  fastify.post('/api/employment/:matterId/draft/review', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = draftReviewSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const key = findGeneratedDocKey(matter, parsed.data.docType);
    if (!key) return reply.status(404).send({ ok: false, error: 'No generated document of that type on this matter.' });
    const doc = matter[key] as Record<string, unknown>;
    const html = typeof doc.html === 'string' ? doc.html : '';
    if (!html) return reply.status(409).send({ ok: false, error: 'That document has no content to review.' });

    const rl = await import('../../../employment/revision-loop.js');
    const dr = await import('../../../employment/draft-review.js');
    const paragraphs = rl.toParagraphs(html);
    const draftText = html.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();

    // Sources the lawyer chose, plus the served positions.
    const stored = (((matter as Record<string, unknown>).briefSources ?? []) as Array<{ id: string; name: string; text: string }>);
    const chosen = parsed.data.briefSourceIds
      ? stored.filter(sd => parsed.data.briefSourceIds!.includes(sd.id))
      : stored;
    const sources = chosen.map(sd => ({ title: sd.name, text: sd.text }));

    // The firm's style, when the lawyer picked one.
    let guide: import('../../../employment/style-profile.js').StyleGuide | null = null;
    if (parsed.data.styleProfileId) {
      const firmId = resolveFirmId(req);
      const profile = firmId ? getStyleProfile(firmId, parsed.data.styleProfileId) : undefined;
      if (profile) {
        const { styleGuideSchema, clampStyleGuide } = await import('../../../employment/style-profile.js');
        const validated = styleGuideSchema.safeParse(clampStyleGuide(JSON.parse(profile.guide_json)));
        if (validated.success) guide = validated.data;
      }
    }

    // Deterministic first: these are checked, not opined.
    const draftHeadings = [...html.matchAll(/<h[123][^>]*>([^<]{1,120})<\/h[123]>/gi)].map(m => m[1]);
    const checked = [
      ...dr.checkFigures(
        draftText, employment.intake, employment.analysis, sources.map(s => s.text),
        (((matter as Record<string, unknown>).negotiation ?? []) as Array<{ amountCad?: number | null }>)
          .map(e => e.amountCad ?? 0).filter(n => n > 0),
      ),
      ...dr.checkStyleDivergence(draftHeadings, guide),
      ...dr.reviewLengthFinding(draftText.split(/\s+/).filter(Boolean).length, guide),
    ];

    // The model pass.
    const intake = employment.intake as Record<string, unknown> | null;
    const analysis = employment.analysis;
    const intakeSummary = [
      `Client: ${[intake?.client_first_name, intake?.client_last_name].filter(Boolean).join(' ') || 'unknown'}`,
      `Employer: ${intake?.employer_legal_name ?? intake?.employer_operating_name ?? 'unknown'}`,
      `Position: ${intake?.job_title ?? 'unknown'}; hired ${intake?.hire_date ?? 'unknown'}; terminated ${intake?.termination_date ?? 'unknown'}`,
      `Salary: ${intake?.annual_salary ? `$${Number(intake.annual_salary).toLocaleString('en-CA')}` : 'unknown'}`,
      analysis ? `Assessed range: $${Math.round(analysis.damagesEstimate.totalEstimateLow).toLocaleString('en-CA')} to $${Math.round(analysis.damagesEstimate.totalEstimateHigh).toLocaleString('en-CA')} (${analysis.damagesEstimate.commonLawLowMonths} to ${analysis.damagesEstimate.commonLawHighMonths} months)` : 'No analysis on file.',
      `Approved issues: ${(employment.approvedIssues ?? []).join(', ') || 'none'}`,
    ].join('\n');

    const { crossProviderChat } = await import('../../../providers/cross-provider-chat.js');
    let judgment: Array<Record<string, unknown>> = [];
    let cost = 0;
    try {
      const result = await crossProviderChat({
        system: dr.buildReviewSystemPrompt(),
        user: dr.buildReviewUserPrompt({
          documentTitle: String(doc.documentTitle ?? parsed.data.docType),
          paragraphs: paragraphs.map(p => rl.paragraphText(p)),
          intakeSummary,
          sources,
          styleSummary: guide
            ? `Flow: ${guide.flow.map(f => f.heading).join(' | ')}\nVoice: ${guide.voice}\nHabits: ${guide.notes.join('; ')}`
            : undefined,
        }),
        tier: 'opus',
        maxTokens: 8192,
        maxRetries: 4,
        extendOnTruncation: true,
      });
      cost = result.cost;
      const raw = result.text.trim();
      const fenced = raw.match(/```(?:json)?\s*([\s\S]*?)```/);
      const payload = JSON.parse(fenced ? fenced[1] : raw) as { findings?: Array<Record<string, unknown>> };
      judgment = Array.isArray(payload.findings) ? payload.findings : [];
    } catch (err) {
      logger.warn('Draft review model pass failed; returning checked findings only', {
        error: err instanceof Error ? err.message : String(err),
      });
    }

    // Everything becomes a revision item the lawyer approves. Checked
    // findings first: they are verifiable, the rest are opinion.
    const maxIdx = paragraphs.length - 1;
    const items = [
      ...checked.map((f, i) => ({
        id: `rev-chk-${i}`,
        feedback: f.observation,
        kind: 'needs_lawyer' as const,
        paragraphIndices: f.paragraphIndices.filter(n => n >= 0 && n <= maxIdx),
        proposal: f.suggestion,
        reason: 'Checked against the matter record.',
        category: f.category,
        basis: 'checked' as const,
      })),
      ...judgment.slice(0, 20).map((f, i) => {
        const indices = Array.isArray(f.paragraphIndices)
          ? (f.paragraphIndices as unknown[]).map(Number).filter(n => Number.isInteger(n) && n >= 0 && n <= maxIdx)
          : [];
        return {
          id: `rev-obs-${i}`,
          feedback: String(f.observation ?? '').slice(0, 2000),
          kind: 'needs_lawyer' as const,
          paragraphIndices: indices,
          proposal: String(f.suggestion ?? '').slice(0, 2000),
          reason: "Starling's judgment, not a checked fact.",
          category: (dr.REVIEW_CATEGORIES as readonly string[]).includes(String(f.category))
            ? String(f.category) : 'unsupported_assertion',
          basis: 'judgment' as const,
        };
      }),
    ].filter(it => it.feedback);

    try { recordUsageEvent(userId, matterId, 'analysis', `draft_review_${parsed.data.docType}`, cost); }
    catch { /* metering must never fail the request */ }

    logger.info('Draft reviewed', { userId, matterId, docType: parsed.data.docType, checked: checked.length, judgment: judgment.length, costUsd: cost.toFixed(4) });
    return reply.send({
      ok: true,
      docType: parsed.data.docType,
      paragraphs: paragraphs.map((p, i) => ({ index: i, text: rl.paragraphText(p) })),
      items,
      costUsd: cost,
    });
  });

  // ── POST /api/employment/:matterId/timetable-package ───────────────────
  // The three timetable documents are prepared together in practice, from
  // one schedule. Generating them separately invites the model-written
  // parts to drift apart (a consent order saying seven days to vary while
  // the draft order says ten). One action, one set of inputs, generated in
  // PARALLEL and stored as SEPARATE documents so each keeps its own
  // template, review, redraft and download.

  fastify.post('/api/employment/:matterId/timetable-package', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const packageSchema = z.object({
      lawyerName: z.string().trim().min(1).max(200),
      firmName: z.string().trim().min(1).max(200),
      firmAddress: z.string().trim().max(500).optional(),
      courtLocation: z.string().trim().max(200).optional(),
      /** Which procedure the action is under; the motion adapts. */
      procedureType: z.enum(['simplified', 'ordinary']).default('simplified'),
      timetableRows: z.array(z.object({
        label: z.string().trim().min(1).max(300),
        date: z.string().trim().min(1).max(40),
      })).min(1).max(30),
      /** Style profile per document type, when the firm has taught one. */
      styleProfileIds: z.record(z.string().max(60), z.string().max(100)).optional(),
      /** Include the supporting affidavit for the motion. */
      includeAffidavit: z.boolean().default(true),
      affidavit: z.object({
        deponentName: z.string().trim().max(200),
        deponentCity: z.string().trim().max(120).optional(),
        capacity: z.enum(['plaintiff', 'lawyer', 'law_clerk', 'other']),
        capacityDescription: z.string().trim().max(300).optional(),
        knowledgeBasis: z.enum(['personal', 'information_and_belief', 'mixed']),
        informationSource: z.string().trim().max(300).optional(),
        sworn: z.enum(['sworn', 'affirmed']).default('sworn'),
        exhibits: z.array(z.object({
          letter: z.string().trim().max(4).optional(),
          description: z.string().trim().min(1).max(400),
        })).max(26).optional(),
      }).optional(),
    });

    const parsed = packageSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and analysis first.' });
    }
    ensureAnalysisFresh(employment);

    // Validate the schedule ONCE. Every document in the package carries
    // the same rows, so they cannot disagree.
    const tt = await import('../../../employment/timetable.js');
    const check = tt.validateCustomTimetable(parsed.data.timetableRows, {
      claimIssuedDate: tt.claimIssuedDate(employment.intake),
    });
    if (!check.ok) {
      return reply.status(400).send({
        ok: false,
        error: 'The proposed timetable needs fixing before the package can be drafted.',
        issues: check.issues.filter(i => i.severity === 'error').map(i => i.message),
      });
    }
    const timetableContext = tt.customTimetableForPrompt(check.rows);

    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);

    const types: LitigationDocumentType[] = [
      'sp_timetable_motion', 'consent_timetable_order', 'timetable_order',
      ...(parsed.data.includeAffidavit ? ['motion_affidavit' as LitigationDocumentType] : []),
    ];

    // Parallel: the package is one wait, not four.
    const results = await Promise.allSettled(types.map(async docType => {
      let styleContext: string | undefined;
      let styleIdentifiers: string[] = [];
      let styleLabel = '';
      const styleId = parsed.data.styleProfileIds?.[docType];
      if (styleId) {
        const style = await loadStyleForGeneration(req, styleId, docType);
        if (!('error' in style)) {
          styleContext = style.context;
          styleIdentifiers = style.identifiers;
          styleLabel = style.label;
        }
      }
      const result = await generateLitigationDocument({
        intake: employment.intake!,
        approvedIssues: employment.approvedIssues,
        analysis: employment.analysis!,
        documentType: docType,
        lawyerName: parsed.data.lawyerName,
        firmName: parsed.data.firmName,
        firmAddress: parsed.data.firmAddress,
        courtLocation: parsed.data.courtLocation,
        procedureType: parsed.data.procedureType,
        additionalContext: [
          timetableContext,
          docType === 'motion_affidavit'
            ? 'This affidavit supports a motion for an order fixing the timetable set out above. Depose to the steps taken to agree a timetable and what remains outstanding.'
            : undefined,
          styleContext,
        ].filter(Boolean).join('\n\n'),
        ...(docType === 'motion_affidavit' && parsed.data.affidavit
          ? { affidavit: { ...parsed.data.affidavit, title: 'Affidavit (Timetable Motion)' } }
          : {}),
      }, definedTerms);
      if (styleIdentifiers.length > 0) {
        result.lawyerReviewFlags = [
          ...result.lawyerReviewFlags,
          ...await styleReviewFlags(result.html, styleIdentifiers, styleLabel, employment.intake as unknown as Record<string, unknown>),
        ];
      }
      return { docType, result };
    }));

    const generated: Array<{ docType: string; title: string; costUsd: number }> = [];
    const failed: Array<{ docType: string; error: string }> = [];
    let totalCost = 0;

    for (let i = 0; i < results.length; i++) {
      const settled = results[i];
      if (settled.status === 'rejected') {
        failed.push({ docType: types[i], error: settled.reason instanceof Error ? settled.reason.message : 'Generation failed' });
        continue;
      }
      const { docType, result } = settled.value;
      const html = sanitiseHtml(result.html);
      recordDraftHistory(matter as Record<string, unknown>, {
        docType, title: result.documentTitle, html, costUsd: result.costUsd,
      }, { userId, matterId });
      (matter as Record<string, unknown>)[`generated_${docType}`] = {
        html,
        documentType: result.documentType,
        documentTitle: result.documentTitle,
        lawyerReviewFlags: result.lawyerReviewFlags,
        citations: result.citations,
        generatedAt: new Date().toISOString(),
        costUsd: result.costUsd,
        status: 'draft',
      };
      generated.push({ docType, title: result.documentTitle, costUsd: result.costUsd });
      totalCost += result.costUsd;
    }

    // Docket the schedule once, from the shared rows.
    const events = tt.customTimetableEvents(check.rows);
    const labels = new Set(events.map(e => e.label));
    employment.timeline = [
      ...employment.timeline.filter(ev => !labels.has(ev.label)),
      ...events,
    ].sort((a, b) => a.date.localeCompare(b.date));

    await saveEmploymentData(userId, matterId, matter, employment);
    logger.info('Timetable package generated', {
      userId, matterId, generated: generated.map(g => g.docType), failed: failed.map(f => f.docType), costUsd: totalCost.toFixed(4),
    });

    return reply.send({
      ok: generated.length > 0,
      generated,
      failed,
      docketedDates: events.length,
      cautions: check.issues.filter(i => i.severity === 'caution').map(i => i.message),
      costUsd: totalCost,
    });
  });


  // ── GET /api/employment/:matterId/drafts ────────────────────────────────
  // Draft version history — every generated document, newest first.

  fastify.get('/api/employment/:matterId/drafts', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const matter = JSON.parse(row.data_json) as Record<string, unknown>;
    const drafts = Array.isArray(matter.draftHistory) ? matter.draftHistory : [];
    return reply.send({ ok: true, drafts });
  });

  // ── POST /api/employment/:matterId/client-update ────────────────────────
  // Draft a plain-language client status update from the matter's timeline
  // and current state, in the client-communications voice. The lawyer
  // reviews and sends it themselves — Starling never contacts clients.

  const clientUpdateBodySchema = z.object({
    /** Anything the lawyer wants emphasised or added (optional). */
    additionalContext: z.string().trim().max(3000).optional(),
  });

  fastify.post('/api/employment/:matterId/client-update', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = clientUpdateBodySchema.safeParse(req.body ?? {});
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid request' });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const intake = employment.intake as Record<string, unknown> | undefined;
    if (!intake) {
      return reply.status(400).send({ ok: false, error: 'Complete intake before drafting a client update.' });
    }

    const clientFirst = String(intake.client_first_name ?? 'the client');
    const definedTerms: string[] = [];
    if (intake.client_first_name && intake.client_last_name) {
      definedTerms.push(`${intake.client_first_name} ${intake.client_last_name}`);
    }
    if (intake.employer_legal_name) definedTerms.push(String(intake.employer_legal_name));

    const recentEvents = (employment.timeline ?? []).slice(-8)
      .map(ev => `- ${ev.date}: ${ev.label}${ev.description ? ` (${ev.description})` : ''}`)
      .join('\n');
    const generated: string[] = [];
    if ((matter as Record<string, unknown>).generatedDemandLetter) generated.push('demand letter (drafted)');
    if ((matter as Record<string, unknown>).generatedSOC) generated.push('Statement of Claim (drafted)');
    if ((matter as Record<string, unknown>).generatedApplication) generated.push('application (drafted)');

    const { crossProviderChat } = await import('../../../providers/cross-provider-chat.js');
    try {
      const result = await crossProviderChat({
        system: `You draft client update emails for a plaintiff-side Ontario employment law firm. Voice: warm, professional, plain language; job loss is one of life's most stressful events and your reader is living it. Lead with the bottom line. Explain what happened, what it means, what happens next, and any dates the client must know. Use dollar amounts, not legal formulas. Never over-promise outcomes. Give no legal advice beyond describing the status of this matter. End by inviting questions. This is a DRAFT for the lawyer to review, edit, and send. Never reference Starling or AI. Do not use em dashes; use commas, colons, semicolons, or parentheses instead. Output clean HTML (p, strong, ul/li only).`,
        user: `Draft a status update email to ${clientFirst}.

MATTER STATE:
- Stage: ${String((matter as Record<string, unknown>).status ?? 'active')}
- Documents prepared so far: ${generated.join(', ') || 'none yet'}
${employment.analysis ? '- Analysis complete: entitlements assessed' : '- Analysis pending'}

RECENT TIMELINE:
${recentEvents || '- Matter opened; work is underway'}
${parsed.data.additionalContext ? `\nLAWYER'S NOTES FOR THIS UPDATE:\n${parsed.data.additionalContext}` : ''}`,
        tier: 'sonnet',
        maxTokens: 1500,
        temperature: 0.5,
        definedTerms,
      });

      const html = sanitiseHtml(result.text);
      (matter as Record<string, unknown>).generatedClientUpdate = {
        html,
        generatedAt: new Date().toISOString(),
        costUsd: result.cost,
      };
      await saveEmploymentData(userId, matterId, matter, employment);

      logger.info('Client update drafted', { userId, matterId, costUsd: result.cost.toFixed(4) });
      return reply.send({ ok: true, html, costUsd: result.cost });
    } catch (err) {
      logger.error('Client update generation failed', { matterId, error: err instanceof Error ? err.message : String(err) });
      return reply.status(500).send({ ok: false, error: 'Draft generation failed. Please try again.' });
    }
  });

  // ── POST /api/employment/:matterId/document-status ──────────────────────
  // Advance a generated document through its lifecycle: draft → reviewed →
  // sent or filed. The docket reacts where the status carries a real-world
  // date: marking a demand letter sent recomputes the response tickler from
  // the date of sending rather than the date of generation.

  const documentStatusSchema = z.object({
    docType: z.string().regex(/^[a-z0-9_]{1,60}$/),
    status: z.enum(DOCUMENT_STATUSES),
    /** The real-world date of the event (date sent, date filed). Defaults to today. */
    date: z.string().regex(/^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/).optional(),
  });

  fastify.post('/api/employment/:matterId/document-status', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = documentStatusSchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid status update' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const key = findGeneratedDocKey(matter as Record<string, unknown>, parsed.data.docType);
    if (!key) return reply.status(404).send({ ok: false, error: 'No generated document of that type on this matter.' });

    const doc = (matter as Record<string, unknown>)[key] as Record<string, unknown>;

    // Review lane guard: a document with an open review cannot be marked
    // sent or filed until the review is approved or withdrawn.
    // Only while the approval lane is switched ON. Otherwise a review left
    // open before it was turned off would strand the document forever, with
    // no queue in the UI to withdraw it from.
    if (config.starling?.approvalsEnabled && (parsed.data.status === 'sent' || parsed.data.status === 'filed')) {
      const { getOpenReviewForDoc } = await import('../../../employment/document-reviews.js');
      const open = getOpenReviewForDoc(matterId, parsed.data.docType);
      if (open && open.status !== 'approved') {
        return reply.status(409).send({ ok: false, error: 'This document is in the approval queue. It can be marked sent or filed once the review is approved or withdrawn.' });
      }
    }

    const statusDate = parsed.data.date ?? new Date().toISOString().slice(0, 10);
    doc.status = parsed.data.status;
    doc.statusDate = statusDate;
    const history = Array.isArray(doc.statusHistory) ? doc.statusHistory as Array<Record<string, unknown>> : [];
    history.push({ status: parsed.data.status, date: statusDate, recordedAt: new Date().toISOString() });
    doc.statusHistory = history.slice(-20);

    // Litigation event chains: a real-world date on one document starts
    // the clock on the next step. Each tickler replaces any earlier
    // system-set event of the same label; the docket, the calendar feed,
    // and the digest carry it automatically.
    const setTickler = (label: string, days: number, description: string) => {
      const due = new Date(`${statusDate}T00:00:00`);
      due.setDate(due.getDate() + days);
      const dueIso = due.toISOString().slice(0, 10);
      employment.timeline = [
        ...employment.timeline.filter(ev => ev.label !== label),
        { date: dueIso, label, description, category: 'legal' as const, source: 'system' as const },
      ].sort((a, b) => a.date.localeCompare(b.date));
    };

    // A demand letter marked sent starts the response clock from the date
    // of sending; the generation-time tickler was a conservative default.
    if (parsed.data.docType === 'demand_letter' && parsed.data.status === 'sent') {
      const deadlineDays = typeof doc.responseDeadlineDays === 'number' ? doc.responseDeadlineDays : 14;
      setTickler('Demand letter response due', deadlineDays,
        `${deadlineDays}-day response deadline from the demand letter sent on ${statusDate}. Follow up if no response.`);
    }

    // A Statement of Claim marked sent (served) starts the defence clock:
    // twenty days for a defendant served in Ontario (rule 18.01; forty
    // days elsewhere in Canada or the United States, sixty days beyond).
    if (parsed.data.docType === 'statement_of_claim' && parsed.data.status === 'sent') {
      setTickler('Statement of Defence due', 20,
        `Twenty days from service of the Statement of Claim on ${statusDate}, for a defendant served in Ontario (forty days elsewhere in Canada or the United States; sixty days beyond; a Notice of Intent to Defend adds ten). Consider noting default if nothing is delivered.`);
    }

    // A Notice of Action marked filed (issued) starts the thirty-day
    // clock to file the Statement of Claim (Form 14D).
    if (parsed.data.docType === 'notice_of_action' && parsed.data.status === 'filed') {
      setTickler('Statement of Claim (Form 14D) due', 30,
        `Thirty days from the issuance of the Notice of Action on ${statusDate} to file the Statement of Claim (Form 14D).`);
    }

    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Document status updated', { userId, matterId, docType: parsed.data.docType, status: parsed.data.status, statusDate });
    return reply.send({
      ok: true,
      docType: parsed.data.docType,
      status: parsed.data.status,
      statusDate,
      generatedDocuments: collectGeneratedDocuments(matter as Record<string, unknown>),
    });
  });
}
