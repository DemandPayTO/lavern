/**
 * Employment routes — Case review, synthesis, document analysis.
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

export function registerCaseAnalysisRoutes(fastify: FastifyInstance): void {

  // ── POST /api/employment/extract ───────────────────────────────────────
  // Extract structured facts from an uploaded document via Claude.
  // The lawyer reviews and confirms each extracted field before saving.


  // ── GET /api/employment/:matterId/case-review ────────────────────────
  // Cross-document aggregation for the bulk drop (Phase 3): the master
  // chronology (every dated fact, source-cited) and cross-document
  // conflicts. Deterministic — no LLM, no cost.
  fastify.get('/api/employment/:matterId/case-review', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { employment } = loadEmploymentData(row.data_json);
    const { buildChronology, findConflicts } = await import('../../../employment/case-file-review.js');
    const extractions = employment.documentExtractions ?? [];
    return reply.send({
      ok: true,
      extractionCount: extractions.length,
      chronology: buildChronology(extractions, employment.timeline),
      conflicts: findConflicts(extractions, employment.intake),
    });
  });

  // ── POST /api/employment/:matterId/case-review/timeline ──────────────
  // Apply APPROVED chronology entries to the matter timeline. Deterministic;
  // dedups against existing (date, label) pairs; events carry their source
  // document and survive intake rebuilds (source document_extraction).
  const chronologyApplySchema = z.object({
    events: z.array(z.object({
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
      label: z.string().trim().min(1).max(300),
      category: z.enum(['employment', 'termination', 'legal', 'mitigation', 'other']).default('other'),
      sourceDoc: z.string().trim().max(500).default(''),
    })).min(1).max(100),
  }).strict();

  fastify.post('/api/employment/:matterId/case-review/timeline', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = chronologyApplySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid events', details: parsed.error.issues.map(i => i.message) });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const existing = new Set((employment.timeline ?? []).map(e => `${e.date}|${e.label}`));
    const added: Array<{ date: string; label: string }> = [];
    for (const ev of parsed.data.events) {
      if (existing.has(`${ev.date}|${ev.label}`)) continue;
      employment.timeline = addTimelineEvent(employment.timeline ?? [], {
        date: ev.date,
        label: ev.label,
        description: ev.sourceDoc ? `From ${ev.sourceDoc} (case file review).` : 'From the case file review.',
        category: ev.category,
        source: 'document_extraction',
      });
      existing.add(`${ev.date}|${ev.label}`);
      added.push({ date: ev.date, label: ev.label });
    }
    (matter as Record<string, unknown>).employmentData = employment;
    await saveMatter(userId, matterId, JSON.stringify(matter), ((matter as Record<string, unknown>).status as string) ?? 'active');

    logger.info('Chronology applied', { userId, matterId, added: added.length, requested: parsed.data.events.length });
    return reply.send({ ok: true, added, skippedExisting: parsed.data.events.length - added.length });
  });

  // ── POST /api/employment/:matterId/case-synthesis ────────────────────
  // The one LLM pass of the bulk drop: a source-cited internal review memo
  // over the structured extractions. Stored and metered like any generated
  // document; never drafts anything outbound.
  fastify.post('/api/employment/:matterId/case-synthesis', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const extractions = employment.documentExtractions ?? [];
    if (extractions.length === 0) {
      return reply.status(400).send({ ok: false, error: 'No document extractions on this matter yet. Upload documents first.' });
    }

    const { buildChronology, findConflicts } = await import('../../../employment/case-file-review.js');
    const { generateCaseSynthesis } = await import('../../../employment/case-synthesis.js');
    const intake = employment.intake;
    const partyTerms = [intake.client_first_name, intake.client_last_name, intake.employer_legal_name, intake.employer_operating_name]
      .filter((s): s is string => Boolean(s));

    let result;
    try {
      result = await generateCaseSynthesis({
        intake,
        extractions,
        chronology: buildChronology(extractions, employment.timeline),
        conflicts: findConflicts(extractions, intake),
      }, partyTerms);
    } catch (err) {
      logger.error('Case synthesis failed', { matterId, error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'The case review memo could not be generated. Please try again.' });
    }

    const m = matter as Record<string, unknown>;
    const stored = {
      html: sanitiseHtml(result.html),
      documentType: 'case_synthesis',
      documentTitle: result.documentTitle,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: [],
      generatedAt: new Date().toISOString(),
      costUsd: result.costUsd,
      status: 'draft',
    };
    m.generated_case_synthesis = stored;
    recordDraftHistory(m, {
      docType: 'case_synthesis', title: result.documentTitle, html: stored.html, costUsd: result.costUsd,
    }, { userId, matterId });
    m.employmentData = employment;
    await saveMatter(userId, matterId, JSON.stringify(m), (m.status as string) ?? 'active');

    return reply.send({ ok: true, document: stored });
  });

  // ── Document analysis (the internal read lane) ───────────────────────
  // Read a bonus plan, agreement, termination letter, pay stub or client
  // summary: summary, kind checklist, the lawyer's questions, optional
  // comparison document. Quote-grounded; stored on the matter; never
  // drafts anything outbound. Separate from the partner review lane.

  const docAnalysisBodySchema = z.object({
    docName: z.string().trim().min(1).max(500),
    kind: z.enum(['bonus_plan', 'employment_agreement', 'termination_letter', 'pay_stub', 'client_summary', 'other']),
    docText: z.string().min(20).max(100_000),
    // Long lines are trimmed, not rejected: lawyers paste notes here.
    questions: z.array(z.string().trim().min(1).transform(q => q.slice(0, 600))).max(12).default([]),
    comparisonName: z.string().trim().max(500).optional(),
    comparisonText: z.string().max(100_000).optional(),
    definedTerms: z.array(z.string().max(200)).max(20).optional(),
  }).strict();

  fastify.post('/api/employment/:matterId/doc-analysis', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = docAnalysisBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      const where = issue?.path?.[0] ? ` (${String(issue.path[0])})` : '';
      return reply.status(400).send({ ok: false, error: `The read could not start${where}: ${issue?.message ?? 'the request was not understood'}.`, details: parsed.error.issues.map(i => i.message) });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const intake = employment.intake;
    const partyTerms = [
      ...(parsed.data.definedTerms ?? []),
      intake.client_first_name, intake.client_last_name,
      intake.employer_legal_name, intake.employer_operating_name,
    ].filter((s): s is string => Boolean(s));

    const { runDocAnalysis, DOC_ANALYSES_CAP } = await import('../../../employment/doc-analysis.js');
    let run;
    try {
      run = await runDocAnalysis({
        docName: parsed.data.docName,
        kind: parsed.data.kind,
        docText: parsed.data.docText,
        questions: parsed.data.questions,
        comparisonName: parsed.data.comparisonName,
        comparisonText: parsed.data.comparisonText,
        definedTerms: partyTerms.slice(0, 20),
      });
    } catch (err) {
      logger.error('Doc analysis failed', { matterId, kind: parsed.data.kind, error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: err instanceof Error ? err.message : 'The analysis could not be completed. Please try again.' });
    }

    const stored = {
      id: `da-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      createdAt: new Date().toISOString(),
      docName: parsed.data.docName,
      kind: parsed.data.kind,
      questions: parsed.data.questions,
      comparisonName: parsed.data.comparisonName,
      deterministicNotes: run.deterministicNotes,
      result: run.result,
      costUsd: run.costUsd,
    };
    employment.docAnalyses = [...(employment.docAnalyses ?? []), stored].slice(-DOC_ANALYSES_CAP);

    // One read, both effects. The pilot read three documents through this
    // lane and expected the intake to learn from them; it never did,
    // because only the upload lane extracted facts. The same text now
    // also goes through the fact extractor, and the proposals wait in the
    // same review table as every upload. Best effort: the analysis the
    // lawyer asked for never fails because the extraction hiccuped.
    let factsProposed = 0;
    try {
      const EXTRACT_KIND: Record<string, string> = {
        employment_agreement: 'employment_agreement', termination_letter: 'termination_letter',
        pay_stub: 'pay_stub', client_summary: 'correspondence', bonus_plan: 'other', other: 'other',
      };
      const extraction = await extractEmploymentDocument(
        parsed.data.docText, parsed.data.docName,
        EXTRACT_KIND[parsed.data.kind] as never, partyTerms.slice(0, 20),
      );
      extraction.id = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
      factsProposed = Object.values(extraction.extractedFields).filter(f => f && f.value !== null && f.value !== '').length;
      if (factsProposed > 0) {
        employment.documentExtractions.push(extraction);
        if ((extraction.costUsd ?? 0) > 0) {
          try { recordUsageEvent(userId, matterId, 'analysis', `extract_${parsed.data.kind}`, extraction.costUsd!); }
          catch { /* metering never blocks the flow */ }
        }
      }
    } catch (err) {
      logger.warn('Fact extraction alongside doc analysis failed (non-fatal)', { matterId, error: err instanceof Error ? err.message : String(err) });
    }

    (matter as Record<string, unknown>).employmentData = employment;
    await saveMatter(userId, matterId, JSON.stringify(matter), ((matter as Record<string, unknown>).status as string) ?? 'active');

    try { recordUsageEvent(userId, matterId, 'analysis', `doc_analysis_${parsed.data.kind}`, run.costUsd); }
    catch (err) { logger.warn('Usage event failed', { error: err instanceof Error ? err.message : String(err) }); }

    logger.info('Doc analysis stored', { userId, matterId, kind: parsed.data.kind, costUsd: run.costUsd, factsProposed });
    return reply.send({ ok: true, analysis: stored, factsProposed });
  });

  fastify.get('/api/employment/:matterId/doc-analyses', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { employment } = loadEmploymentData(row.data_json);
    return reply.send({ ok: true, analyses: [...(employment.docAnalyses ?? [])].reverse() });
  });

  fastify.delete('/api/employment/:matterId/doc-analyses/:analysisId', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId, analysisId } = req.params as { matterId: string; analysisId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    const before = (employment.docAnalyses ?? []).length;
    employment.docAnalyses = (employment.docAnalyses ?? []).filter(a => a.id !== analysisId);
    if (employment.docAnalyses.length === before) return reply.status(404).send({ ok: false, error: 'Analysis not found' });
    (matter as Record<string, unknown>).employmentData = employment;
    await saveMatter(userId, matterId, JSON.stringify(matter), ((matter as Record<string, unknown>).status as string) ?? 'active');
    return reply.send({ ok: true });
  });
}
