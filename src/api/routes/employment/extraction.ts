/**
 * Employment routes — Document classification and fact extraction.
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

export function registerExtractionRoutes(fastify: FastifyInstance): void {

  // ── POST /api/employment/classify ────────────────────────────────────
  // Detect the document type before extraction (Phase 2 of the document-
  // intelligence spec). The lawyer confirms or overrides the detected kind
  // before the type-specific extraction prompt runs; a failure degrades to
  // {other, low} so the upload flow never blocks on classification.

  const classifyBodySchema = z.object({
    matterId: z.string().min(1).max(200),
    documentContent: z.string().min(1).max(100_000),
    documentName: z.string().trim().min(1).max(500),
  });

  fastify.post('/api/employment/classify', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const parsed = classifyBodySchema.safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Invalid request' });

    const row = await getMatterById(parsed.data.matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { classifyEmploymentDocument } = await import('../../briefing/document-classifier.js');
    const result = await classifyEmploymentDocument(parsed.data.documentContent, parsed.data.documentName);
    if (result.costUsd > 0) {
      // Metered like every LLM step; 'analysis' kind so generation counts stay honest.
      try { recordUsageEvent(userId, parsed.data.matterId, 'analysis', 'classification', result.costUsd); }
      catch { /* metering never blocks the flow */ }
    }
    return reply.send({ ok: true, kind: result.kind, confidence: result.confidence, fallback: result.fallback });
  });

  fastify.post('/api/employment/extract', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';

    const parsed = extractBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn('Extract validation failed', { userId, issues: parsed.error.issues.map(i => i.path.join('.')) });
      return reply.status(400).send({ ok: false, error: 'Invalid request' });
    }

    const { matterId, documentContent, documentName, documentKind, definedTerms } = parsed.data;

    // Verify matter exists
    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }

    // Merge the matter's known party names into the anonymisation terms —
    // an uploaded termination letter contains the client's and employer's
    // names in plain text, and the caller may not have passed them.
    const { employment: existingEmployment } = loadEmploymentData(row.data_json);
    const partyTerms: string[] = [];
    const intake = existingEmployment.intake as Record<string, unknown> | undefined;
    if (intake?.client_first_name && intake?.client_last_name) {
      partyTerms.push(`${intake.client_first_name} ${intake.client_last_name}`);
      partyTerms.push(String(intake.client_last_name));
    }
    if (intake?.employer_legal_name) partyTerms.push(String(intake.employer_legal_name));
    if (intake?.employer_operating_name) partyTerms.push(String(intake.employer_operating_name));
    const mergedTerms = [...new Set([...(definedTerms ?? []), ...partyTerms])].slice(0, 20);

    // Extract facts via Claude (anonymised via crossProviderChat)
    const extraction = await extractEmploymentDocument(
      documentContent,
      documentName,
      documentKind,
      mergedTerms,
    );

    // Store extraction on the matter (lawyer reviews before confirming).
    // The id addresses this extraction in the apply loop.
    extraction.id = `ext-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
    if ((extraction.costUsd ?? 0) > 0) {
      // Metered like every LLM step; 'analysis' kind keeps generation counts honest.
      try { recordUsageEvent(userId, matterId, 'analysis', `extract_${documentKind}`, extraction.costUsd!); }
      catch { /* metering never blocks the flow */ }
    }
    const { matter, employment } = loadEmploymentData(row.data_json);
    employment.documentExtractions.push(extraction);

    // Collective agreements feed the grievance clocks: fill any blank CA
    // fields on the labour intake and recompute gates/timeline/deadlines.
    // Reviewer-entered values are never overwritten.
    let labourAutoFilled: string[] = [];
    const labour = matter.labourData as import('../../../types/labour-intake.js').LabourMatterData | undefined;
    if (documentKind === 'collective_agreement' && labour?.intake) {
      const { applyCaExtraction } = await import('../../../labour/ca-extraction.js');
      const { intake: updatedIntake, filled } = applyCaExtraction(labour.intake, extraction.extractedFields);
      if (filled.length > 0) {
        const { evaluateLabourGates, buildGrievanceTimeline, computeGrievanceDeadlines } = await import('../../../labour/gate-evaluator.js');
        labour.intake = updatedIntake;
        labour.gates = evaluateLabourGates(updatedIntake);
        labour.timeline = buildGrievanceTimeline(updatedIntake);
        labour.analysis = {
          ...(labour.analysis ?? {}),
          deadlines: computeGrievanceDeadlines(updatedIntake),
          evaluatedAt: new Date().toISOString(),
        };
        matter.labourData = labour;
        labourAutoFilled = filled;
      }
    }

    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Document extracted', {
      userId,
      matterId,
      documentName,
      documentKind,
      fieldsExtracted: Object.keys(extraction.extractedFields).length,
      keyFindings: extraction.keyFindings.length,
      labourAutoFilled: labourAutoFilled.length > 0 ? labourAutoFilled : undefined,
    });

    return reply.send({ ok: true, extraction, labourAutoFilled });
  });

  // ── POST /api/employment/:matterId/apply-extraction ─────────────────────
  // The apply loop: move the lawyer's SELECTED extracted fields onto the
  // intake. Deterministic (no LLM); blanks fill by default, non-blank fields
  // change only with per-field overwrite opt-in; gates and timeline recompute
  // through the same preserving path as every other intake mutation; the
  // response carries the consequence diff (which dated events appeared or
  // moved). See docs/specs/document-extraction-apply-2026-07.md.

  const applyExtractionBodySchema = z.object({
    extractionId: z.string().min(1).max(100),
    fields: z.array(z.string().min(1).max(100)).max(80).default([]),
    overwrite: z.array(z.string().min(1).max(100)).max(80).default([]),
    // Approved settlement offers, by index into the STORED extraction's
    // offers array. Only the date is client-supplied (the document may not
    // state it); party, kind, amount and terms come from the stored
    // proposal so the client cannot smuggle arbitrary ledger entries.
    offers: z.array(z.object({
      index: z.number().int().min(0).max(11),
      date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    })).max(12).default([]),
  }).strict().refine(b => b.fields.length + b.offers.length > 0, { message: 'Nothing selected' });

  fastify.post('/api/employment/:matterId/apply-extraction', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = applyExtractionBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid request', details: parsed.error.issues.map(i => i.message) });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);

    const { applyExtractionSelections, diffTimelines, resolveExtraction } = await import('../../../employment/extraction-apply.js');
    const extraction = resolveExtraction(employment.documentExtractions ?? [], parsed.data.extractionId);
    if (!extraction) return reply.status(404).send({ ok: false, error: 'Extraction not found on this matter' });
    if (extraction.documentType === 'collective_agreement') {
      return reply.status(400).send({ ok: false, error: 'Collective agreements apply automatically at extraction time.' });
    }

    const applyIntakeBefore = { ...employment.intake };
    const outcome = parsed.data.fields.length > 0
      ? applyExtractionSelections(
          employment.intake,
          extraction,
          parsed.data.fields,
          new Set(parsed.data.overwrite),
        )
      : { intake: employment.intake, applied: [] as string[], overwritten: [] as string[], skippedNotBlank: [] as string[], unmapped: [] as string[], analysisStale: false };
    if ('error' in outcome) {
      return reply.status(400).send({ ok: false, error: outcome.error, invalidFields: outcome.invalidFields });
    }

    // Approved offers land on the negotiation ledger. Values come from the
    // stored proposal; duplicates (same date, party, kind and amount as an
    // existing entry) are skipped so re-applying an extraction never
    // doubles the history the mediation brief presents.
    const appliedOffers: string[] = [];
    let skippedDuplicateOffers = 0;
    if (parsed.data.offers.length > 0) {
      const proposals = extraction.offers ?? [];
      const ledger = (((matter as Record<string, unknown>).negotiation ?? []) as Array<Record<string, unknown>>);
      const keyOf = (o: { date?: unknown; party?: unknown; kind?: unknown; amountCad?: unknown }) =>
        `${o.date}|${o.party}|${o.kind}|${o.amountCad ?? ''}`;
      const existing = new Set(ledger.map(e => keyOf(e)));
      for (const sel of parsed.data.offers) {
        const proposal = proposals[sel.index];
        if (!proposal) {
          return reply.status(400).send({ ok: false, error: `Offer ${sel.index + 1} is not on this extraction.` });
        }
        const entry = {
          id: `neg-${Date.now()}-${sel.index}-${Math.random().toString(36).slice(2, 7)}`,
          date: sel.date,
          party: proposal.party,
          kind: proposal.kind,
          amountCad: proposal.amountCad,
          ...(proposal.terms ? { terms: proposal.terms } : {}),
          note: `From ${extraction.filename}`,
          recordedAt: new Date().toISOString(),
        };
        if (existing.has(keyOf(entry))) { skippedDuplicateOffers++; continue; }
        existing.add(keyOf(entry));
        ledger.push(entry);
        appliedOffers.push(`${entry.party} ${entry.kind} (${entry.date})`);
      }
      (matter as Record<string, unknown>).negotiation = ledger;
    }

    const changed = [...outcome.applied, ...outcome.overwritten];
    if (changed.length === 0 && appliedOffers.length === 0 && skippedDuplicateOffers === 0) {
      return reply.send({ ok: true, ...outcome, appliedOffers: [], timelineDiff: { added: [], removed: [] } });
    }
    if (changed.length === 0) {
      // Offers only: no intake mutation, so gates and timeline stand.
      await saveEmploymentData(userId, matterId, matter, employment);
      logger.info('Extraction offers applied', { userId, matterId, extractionId: extraction.id, offers: appliedOffers.length, skippedDuplicateOffers });
      return reply.send({ ok: true, ...outcome, appliedOffers, skippedDuplicateOffers, timelineDiff: { added: [], removed: [] } });
    }

    const timelineBefore = employment.timeline ?? [];
    employment.intake = outcome.intake;
    employment.intakeRevisedAt = new Date().toISOString();
    employment.timeline = rebuildTimelinePreserving(timelineBefore, outcome.intake);
    employment.gates = evaluateGates(outcome.intake);
    // The analysis is deterministic and cheap: when the applied facts feed
    // it, recompute it here instead of sending the lawyer to another tab
    // to press a button whose only job was to run this line. On a fresh
    // matter this is also the FIRST computation, so the happy path
    // (upload, apply, draft) never detours through Run Analysis at all.
    if (outcome.analysisStale || !employment.analysis) {
      recomputeAnalysis(employment);
    }

    // Audit: the apply is a matter event, and the extraction records what
    // it contributed.
    employment.timeline = addTimelineEvent(employment.timeline, {
      date: new Date().toISOString().slice(0, 10),
      label: `Facts applied from ${extraction.filename}`,
      description: `Applied ${changed.length} field${changed.length === 1 ? '' : 's'} from the extracted document: ${changed.join(', ')}.`,
      category: 'legal',
      source: 'document_extraction',
    });
    extraction.appliedAt = new Date().toISOString();
    extraction.appliedFields = [...new Set([...(extraction.appliedFields ?? []), ...changed])];

    await saveEmploymentData(userId, matterId, matter, employment);

    const timelineDiff = diffTimelines(timelineBefore, employment.timeline);
    logger.info('Extraction applied', { userId, matterId, extractionId: extraction.id, applied: outcome.applied, overwritten: outcome.overwritten });
    // What did approving this arm? Every cause that moved from off to
    // eligible or firing is named in the response, so the consequence is
    // read here and not discovered at generation.
    const causesUnlocked = await diffUnlockedCauses(matter, applyIntakeBefore, employment.intake, employment);

    return reply.send({
      ok: true,
      applied: outcome.applied,
      overwritten: outcome.overwritten,
      skippedNotBlank: outcome.skippedNotBlank,
      unmapped: outcome.unmapped,
      analysisStale: outcome.analysisStale,
      appliedOffers,
      skippedDuplicateOffers,
      timelineDiff,
      gates: employment.gates,
      causesUnlocked,
    });
  });

  // Read the notes ONCE, here, and return the instructions for the lawyer
  // to approve. Nothing from this call binds a draft until it is saved.
  fastify.post('/api/employment/:matterId/direction/extract', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = z.object({
      notes: z.string().trim().min(1).max(MAX_NOTES_CHARS),
      documentType: z.string().trim().max(60).optional(),
      documentLabel: z.string().trim().max(120).optional(),
    }).safeParse(req.body);
    if (!parsed.success) {
      // Say what is actually wrong. This route once answered every invalid
      // input with "Paste the notes to read.", including notes that WERE
      // pasted but ran past the length cap: the pilot pasted a long client
      // email and was told, on every click, to paste it.
      const rawNotes = (req.body as { notes?: unknown })?.notes;
      const error = typeof rawNotes === 'string' && rawNotes.length > MAX_NOTES_CHARS
        ? `The notes are ${rawNotes.length.toLocaleString('en-CA')} characters and the reader takes ${MAX_NOTES_CHARS.toLocaleString('en-CA')}. Split the paste and read it in parts.`
        : 'Paste the notes to read.';
      return reply.status(400).send({ ok: false, error });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { employment } = loadEmploymentData(row.data_json);

    const { DIRECTION_EXTRACTION_SYSTEM, buildDirectionExtractionPrompt } = await import('../../../employment/direction.js');
    const { crossProviderChat } = await import('../../../providers/cross-provider-chat.js');

    let text: string;
    try {
      const result = await crossProviderChat({
        system: DIRECTION_EXTRACTION_SYSTEM,
        user: buildDirectionExtractionPrompt({
          notes: parsed.data.notes,
          documentLabel: parsed.data.documentLabel,
          intake: employment.intake,
          analysis: employment.analysis,
        }),
        tier: 'sonnet',
        // No extendOnTruncation here: that retry re-ran the WHOLE read at a
        // higher ceiling, doubling the wait exactly on long notes. A cut-off
        // reply is salvaged downstream instead, so one pass is enough.
        maxTokens: 6144,
        maxRetries: 4,
      });
      text = result.text;
    } catch (err) {
      logger.error('Direction extraction failed', { error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'The notes could not be read. Please try again.' });
    }

    let jsonText = text.trim();
    const fenced = jsonText.match(/```(?:json)?\s*([\s\S]*?)```/);
    if (fenced) jsonText = fenced[1].trim();
    const braced = jsonText.match(/\{[\s\S]*\}/);
    const extractionSchema = z.object({
      instructions: z.array(z.object({
        text: z.string().trim().min(1).max(600),
        kind: z.enum(INSTRUCTION_KINDS).catch('scope'),
        mustInclude: z.array(z.string().trim().max(120)).max(8).optional(),
        mustNotInclude: z.array(z.string().trim().max(120)).max(8).optional(),
      })).max(MAX_INSTRUCTIONS),
      withheld: z.array(z.string().trim().max(300)).max(20).optional(),
      proposedHeads: z.array(z.object({
        label: z.string().trim().min(1).max(200),
        basis: z.string().trim().max(300).optional(),
        amount: z.number().nonnegative().max(99_999_999).nullable().optional(),
      })).max(20).optional(),
    });
    let proposed;
    try {
      const { clampDirectionExtraction, repairTruncatedJson } = await import('../../../employment/direction.js');
      const candidate = braced ? braced[0] : jsonText;
      let parsedJson: unknown;
      try {
        parsedJson = JSON.parse(candidate);
      } catch {
        // A reply cut off mid-list still carries every completed
        // instruction; salvage the complete prefix rather than losing all.
        const repaired = repairTruncatedJson(jsonText);
        if (repaired === null) throw new Error('Model reply was not JSON and could not be repaired');
        parsedJson = JSON.parse(repaired);
        logger.warn('Direction extraction reply was truncated; salvaged the complete prefix', { matterId, replyChars: text.length });
      }
      proposed = extractionSchema.parse(clampDirectionExtraction(parsedJson));
    } catch (err) {
      // The reason goes to the log, not the lawyer: they cannot fix a Zod
      // path, but we cannot fix what we never see.
      logger.warn('Direction extraction did not fit the schema', {
        matterId,
        replyChars: text.length,
        error: err instanceof Error ? err.message.slice(0, 500) : String(err).slice(0, 500),
      });
      return reply.status(502).send({ ok: false, error: 'Could not turn those notes into instructions. Try again; if it repeats, split the paste or write the instruction yourself.' });
    }
    return reply.send({ ok: true, proposed });
  });
}
