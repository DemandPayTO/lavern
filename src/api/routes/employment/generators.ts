/**
 * Employment routes — Document generators (demand letter, SOC, application, litigation).
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
import { buildFactumArgumentGuidance } from '../../../employment/factum-nodes.js';
import { loadSelectedFactumNodes } from './factum-selection.js';
import { generateApplication } from '../../../employment/application-generator.js';
import type { ApplicationType } from '../../../employment/application-generator.js';
import { htmlToDocx } from '../../../employment/docx-export.js';
import { generateLitigationDocument } from '../../../employment/litigation-documents.js';
import type { DocxExportOptions } from '../../../employment/docx-export.js';
import type { LitigationDocumentType, LitigationDocumentResult } from '../../../employment/litigation-documents.js';
import { buildFactumOutline, factumDraftReadiness, factumForumFromProcedure } from '../../../employment/factum-outline.js';
import type { FactumDraftState } from '../../../employment/factum-outline.js';
import { assembleFactum } from '../../../employment/factum-assemble.js';
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

export function registerGeneratorRoutes(fastify: FastifyInstance): void {

  // ── POST /api/employment/:matterId/demand-letter ───────────────────────
  // Generate a demand letter from the matter's intake data, approved issues,
  // and tone selection. The lawyer reviews and edits before finalising.

  const demandLetterBodySchema = z.object({
    tone: z.enum(TONE_OPTIONS).default('professional'),
    demandAmount: z.number().positive().max(99_999_999),
    lawyerName: z.string().trim().min(1).max(200),
    firmName: z.string().trim().min(1).max(200),
    firmAddress: z.string().trim().max(500).optional(),
    responseDeadlineDays: z.number().int().min(1).max(90).default(14),
    /** Draft in the firm's style, learned from its precedents. */
    styleProfileId: z.string().trim().max(100).optional(),
    /** Who the letter is addressed to; counsel where known. */
    recipientName: z.string().trim().max(300).optional(),
    /** Heads of damage the lawyer chose, overriding the analysis defaults. */
    damageHeads: z.array(z.object({
      label: z.string().trim().min(1).max(200),
      amount: z.number().nonnegative().max(99_999_999).nullable().optional(),
      basis: z.string().trim().max(300).optional(),
    })).max(20).optional(),
    /** Amounts already paid, netted off the claim. */
    amountsPaid: z.array(z.object({
      label: z.string().trim().min(1).max(200),
      amount: z.number().nonnegative().max(99_999_999),
    })).max(10).optional(),
    /** Mitigation earnings to date, netted off the claim. */
    mitigationEarnings: z.number().nonnegative().max(99_999_999).nullable().optional(),
    /** Which attached documents this letter reads. Omitted means all of them. */
    sourceIds: z.array(z.string().trim().max(100)).max(20).optional(),
  });

  fastify.post('/api/employment/:matterId/demand-letter', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = demandLetterBodySchema.safeParse(req.body);
    if (!parsed.success) {
      logger.warn('Demand letter validation failed', { userId, issues: parsed.error.issues.map(i => i.path.join('.')) });
      const detail = parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(400).send({ ok: false, error: `The letter was not generated. ${detail}.` });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) {
      return reply.status(404).send({ ok: false, error: 'Matter not found' });
    }

    const { matter, employment } = loadEmploymentData(row.data_json);

    // Verify intake and analysis exist
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and run analysis before generating a demand letter.' });
    }
    ensureAnalysisFresh(employment);

    // Verify at least one issue is approved
    if (employment.approvedIssues.length === 0) {
      return reply.status(400).send({ ok: false, error: 'Approve at least one legal issue before generating a demand letter.' });
    }

    // Build party names for anonymisation
    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);
    if (employment.intake.employer_operating_name) definedTerms.push(employment.intake.employer_operating_name);

    // The firm's style, when picked: context into the prompt, identifiers
    // into the bleed scan afterwards.
    let dlStyle: {
      context: string; identifiers: string[]; label: string; typicalWords?: number;
      guide?: import('../../../employment/style-profile.js').StyleGuide;
    } | undefined;
    if (parsed.data.styleProfileId) {
      const style = await loadStyleForGeneration(req, parsed.data.styleProfileId, 'demand_letter');
      if ('error' in style) return reply.status(style.status).send({ ok: false, error: style.error });
      dlStyle = style;
    }

    // The documents on the file. The letter argues about specific words,
    // so it reads the contract and the termination letter rather than the
    // intake form's summary of them.
    const { demandSourceContext } = await import('../../../employment/demand-sources.js');
    const attached = (((matter as Record<string, unknown>).briefSources ?? []) as Array<{
      name: string; text: string; kind?: string;
    }>);
    const requested = parsed.data.sourceIds;
    const chosen = requested
      ? attached.filter(sd => requested.includes((sd as { id?: string }).id ?? ''))
      : attached;
    const { context: caseDocumentContext, dropped: droppedSources } = demandSourceContext(
      chosen.map(sd => ({
        name: sd.name,
        kind: isDemandSourceKind(sd.kind) ? sd.kind : 'other',
        text: sd.text,
      })),
    );

    // The firm's own letter, where it has taught one. Its opening and
    // closing replace Starling's, and the drafting instruction becomes
    // reproduce rather than imitate.
    let houseForm: {
      openingHtml?: string; closingHtml?: string; context?: string;
    } | undefined;
    const houseFlags: string[] = [];
    let houseFitIssues: Array<{ part: string; message: string }> = [];
    if (dlStyle?.guide && dlStyle.guide.documentKind === 'letter') {
      const hf = await import('../../../employment/house-form.js');
      const guide = dlStyle.guide;
      const slots = hf.resolveSlots({
        intake: employment.intake,
        analysis: employment.analysis,
        recipientName: parsed.data.recipientName,
        salutation: parsed.data.recipientName ? 'Counsel' : undefined,
        lawyerName: parsed.data.lawyerName,
        firmName: parsed.data.firmName,
        fileNumber: ((matter as Record<string, unknown>).firmFileNumber as string)
          || ((matter as Record<string, unknown>).matterNumber as string) || undefined,
        demandAmount: parsed.data.demandAmount,
        responseDeadlineDays: parsed.data.responseDeadlineDays,
      });
      const opening = guide.openingBlock?.length
        ? hf.renderHouseOpening(guide.openingBlock, slots) : null;
      const closing = guide.closingBlock?.length
        ? hf.renderHouseClosing(guide.closingBlock, slots) : null;
      const fixed = (guide.fixedClauses ?? []).map((c: { part: string; text: string }) => ({
        part: c.part,
        text: hf.fillSlots(c.text, slots).text,
      }));

      houseForm = {
        openingHtml: opening?.html,
        closingHtml: closing?.html,
        context: hf.houseFormContext({
          label: dlStyle.label,
          fixedClauses: fixed,
          formStructure: guide.formStructure,
          voice: guide.voice,
          factWeaving: guide.factWeaving,
          pronouns: employment.intake.client_pronouns,
          // The firm's own median letter length, measured from its
          // precedents at teaching time. The house form dropped this
          // signal, which is why the first letters ran long.
          typicalWords: guide.typicalWords,
        }) || undefined,
      };

      const missing = [...new Set([...(opening?.missing ?? []), ...(closing?.missing ?? [])])];
      if (missing.length > 0) {
        houseFlags.push(`Your standard opening needs ${missing.map(m => m.toLowerCase()).join(', ')}, which this file does not have. Each is marked in the letter for you to complete.`);
      }
      // Standard language carries assumptions: one written for a dismissal,
      // used where the client resigned, is fluent, confident and wrong. The
      // drafter is told to rewrite such a passage, so this is the backstop
      // for the case where it did not. It goes to the audit bundle rather
      // than the review flags, at the lawyer's direction: every letter here
      // is read before it is sent, and a flag on every letter is a flag
      // nobody reads.
      houseFitIssues = hf.checkHouseFormFit(guide.fixedClauses ?? [], employment.intake);
    }

    // What the partner said to do on this file, and on this letter.
    const direction = directionForGeneration(matter, 'demand_letter');

    // Direction governs the FIGURES too, not only the prose. A letter that
    // demands four weeks in its narrative while its table itemises eight to
    // twelve months of pay in lieu is worse than no direction at all, and
    // the table is ours, not the model's. Where the direction settled what
    // is being claimed and the lawyer has not overridden the heads
    // themselves, the table follows the direction.
    const directionRecord = ((matter as Record<string, unknown>).direction ?? {}) as {
      matter?: { proposedHeads?: Array<{ label: string; basis?: string; amount?: number | null }> };
      byDocument?: Record<string, { proposedHeads?: Array<{ label: string; basis?: string; amount?: number | null }> }>;
    };
    const directionHeads = directionRecord.byDocument?.demand_letter?.proposedHeads
      ?? directionRecord.matter?.proposedHeads;
    const headsFromDirection = (parsed.data.damageHeads?.length ?? 0) === 0
      && (directionHeads?.length ?? 0) > 0;
    const effectiveHeads = headsFromDirection ? directionHeads : parsed.data.damageHeads;

    // Generate the demand letter
    const result = await generateDemandLetter({
      intake: employment.intake,
      gates: employment.gates,
      approvedIssues: employment.approvedIssues,
      analysis: employment.analysis,
      tone: parsed.data.tone,
      demandAmount: parsed.data.demandAmount,
      lawyerName: parsed.data.lawyerName,
      firmName: parsed.data.firmName,
      firmAddress: parsed.data.firmAddress,
      responseDeadlineDays: parsed.data.responseDeadlineDays,
      recipientName: parsed.data.recipientName,
      fileNumber: ((matter as Record<string, unknown>).firmFileNumber as string)
        || ((matter as Record<string, unknown>).matterNumber as string) || undefined,
      damageHeads: effectiveHeads,
      amountsPaid: parsed.data.amountsPaid,
      mitigationEarnings: parsed.data.mitigationEarnings,
      caseDocumentContext: caseDocumentContext || undefined,
      directionContext: direction.context || undefined,
      houseForm,
      styleContext: dlStyle?.context,
      styleTypicalWords: dlStyle?.typicalWords,
    }, definedTerms);
    if (houseFlags.length > 0) {
      result.lawyerReviewFlags = [...result.lawyerReviewFlags, ...houseFlags];
    }
    if (headsFromDirection) {
      result.lawyerReviewFlags = [
        ...result.lawyerReviewFlags,
        `The damages table itemises the heads from your direction rather than the analysis defaults: ${directionHeads!.map(h => h.label).join(', ')}. Edit the heads beside Generate to change that.`,
      ];
    }
    await applyDirectionAftermath(result, direction);
    if (droppedSources.length > 0) {
      result.lawyerReviewFlags = [
        ...result.lawyerReviewFlags,
        `More documents are attached than the letter can read at once. These were not used: ${droppedSources.join(', ')}. Detach what the letter does not need.`,
      ];
    }
    if (dlStyle) {
      result.lawyerReviewFlags = [
        ...result.lawyerReviewFlags,
        ...await styleReviewFlags(result.html, dlStyle.identifiers, dlStyle.label, employment.intake as Record<string, unknown>, parsed.data.demandAmount),
      ];
    }

    // Store the generated letter on the matter
    recordDraftHistory(matter as Record<string, unknown>, {
      docType: 'demand_letter', title: 'Demand Letter', html: sanitiseHtml(result.html),
      costUsd: result.costUsd,
      meta: {
        tone: parsed.data.tone,
        demandAmount: parsed.data.demandAmount,
        // Recorded rather than surfaced: where the firm's standard language
        // assumed facts this file does not have. Kept retrievable so a
        // letter can be explained later, without adding a warning to a
        // review the lawyer performs on every draft anyway.
        ...(houseFitIssues.length > 0 ? { houseFormFitIssues: houseFitIssues } : {}),
      },
    }, { userId, matterId });
    // A letter already marked sent keeps that record and its uploaded Word
    // file across a regeneration: the fact of service, the tickler it set,
    // and the reviewer's marked-up copy must not be lost to a typo fix.
    const priorDL = (matter as Record<string, unknown>).generatedDemandLetter as Record<string, unknown> | undefined;
    const preserved = priorDL && priorDL.status && priorDL.status !== 'draft'
      ? { status: priorDL.status, statusDate: priorDL.statusDate, statusHistory: priorDL.statusHistory, uploadedDocx: priorDL.uploadedDocx }
      : {};
    (matter as Record<string, unknown>).generatedDemandLetter = {
      html: sanitiseHtml(result.html),
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      tone: parsed.data.tone,
      demandAmount: parsed.data.demandAmount,
      recipientName: parsed.data.recipientName,
      responseDeadlineDays: parsed.data.responseDeadlineDays,
      generatedAt: new Date().toISOString(),
      costUsd: result.costUsd,
      status: 'draft', // lawyer must review before finalising
      ...preserved,
      // Recorded, not surfaced: where the firm's standard language assumed
      // facts this file does not have. Kept so a letter can be explained
      // later without adding a warning the lawyer sees on every draft.
      ...(houseFitIssues.length > 0 ? { houseFormFitIssues: houseFitIssues } : {}),
    };
    employment.selectedTone = parsed.data.tone;
    employment.demandAmount = parsed.data.demandAmount;
    employment.selectedDocumentType = 'demand_letter';

    // Tickler: the response deadline goes on the matter timeline so the
    // dashboard docket and weekly digest can surface it
    const responseDue = new Date();
    responseDue.setDate(responseDue.getDate() + parsed.data.responseDeadlineDays);
    employment.timeline = addTimelineEvent(employment.timeline, {
      date: responseDue.toISOString().slice(0, 10),
      label: 'Demand letter response due',
      description: `${parsed.data.responseDeadlineDays}-day response deadline from the demand letter generated today. Follow up if no response.`,
      category: 'legal',
      source: 'system',
    });

    // The demand opens the negotiation: record it on the ledger so the
    // matter reads as a position put to the employer, and the mediation
    // brief's history is not blank after a demand was served.
    {
      const ledger = (((matter as Record<string, unknown>).negotiation ?? []) as Array<Record<string, unknown>>);
      const today = new Date().toISOString().slice(0, 10);
      const already = ledger.some(e => e.kind === 'demand' && e.party === 'client' && e.date === today && e.amountCad === parsed.data.demandAmount);
      if (!already) {
        ledger.push({
          id: `neg-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          date: today, party: 'client', kind: 'demand',
          amountCad: parsed.data.demandAmount,
          terms: `Demand letter served; ${parsed.data.responseDeadlineDays}-day response deadline`,
          note: 'Recorded automatically when the demand letter was generated.',
          recordedAt: new Date().toISOString(),
        });
        (matter as Record<string, unknown>).negotiation = ledger;
      }
    }

    await saveEmploymentData(userId, matterId, matter, employment);

    logger.info('Demand letter generated', {
      userId,
      matterId,
      tone: parsed.data.tone,
      demandAmount: parsed.data.demandAmount,
      htmlLength: result.html.length,
      reviewFlags: result.lawyerReviewFlags.length,
    });

    return reply.send({
      ok: true,
      html: sanitiseHtml(result.html),
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      costUsd: result.costUsd,
      demandAmount: parsed.data.demandAmount,
      responseDueDate: responseDue.toISOString().slice(0, 10),
      docketedResponseDeadline: true,
      recordedOnLedger: true,
    });
  });

  // ── POST /api/employment/:matterId/statement-of-claim ──────────────────
  // Generate a Statement of Claim (Form 14A or 7A) or override procedure type.

  const socBodySchema = z.object({
    procedureType: z.enum(PROCEDURE_TYPES),
    claimAmount: z.number().positive().max(99_999_999),
    lawyerName: z.string().trim().min(1).max(200),
    firmName: z.string().trim().min(1).max(200),
    firmAddress: z.string().trim().max(500).optional(),
    /** One lawyer per line, exactly as the counsel block should read. */
    lawyerBlock: z.string().trim().max(600).optional(),
    courtLocation: z.string().trim().min(1).max(200),
    /** Draft in the firm's style, learned from its precedents. */
    styleProfileId: z.string().trim().max(100).optional(),
  });

  fastify.post('/api/employment/:matterId/statement-of-claim', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = socBodySchema.safeParse(req.body);
    if (!parsed.success) {
      const detail = parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(400).send({ ok: false, error: `The claim was not generated. ${detail}.` });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and analysis first.' });
    }
    ensureAnalysisFresh(employment);
    if (employment.approvedIssues.length === 0) {
      return reply.status(400).send({ ok: false, error: 'Approve at least one legal issue first.' });
    }

    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);

    let socStyle: { context: string; identifiers: string[]; label: string; typicalWords?: number } | undefined;
    if (parsed.data.styleProfileId) {
      const style = await loadStyleForGeneration(req, parsed.data.styleProfileId, 'statement_of_claim');
      if ('error' in style) return reply.status(style.status).send({ ok: false, error: style.error });
      socStyle = style;
    }

    const socDirection = directionForGeneration(matter, 'statement_of_claim');
    const socOverrides = ((matter as Record<string, unknown>).socNodeOverrides ?? {}) as Record<string, 'on' | 'off'>;
    // The firm's own node language where it has taught or edited any;
    // the ported defaults otherwise.
    const socFirmId = resolveFirmId(req);
    const { loadSocNodes: loadDefaults, mergeFirmNodes } = await import('../../../employment/soc-nodes.js');
    const { getFirmSocNodes } = await import('../../../db/database.js');
    const customNodes = socFirmId
      ? mergeFirmNodes(loadDefaults(), getFirmSocNodes(socFirmId))
      : undefined;
    let socLso = '';
    try {
      const { getUserById } = await import('../../../db/database.js');
      const u = getUserById(userId);
      if (u?.profile_json) socLso = String((JSON.parse(u.profile_json) as Record<string, unknown>).lsoNumber ?? '');
    } catch { /* best-effort */ }
    // The claim reads the file's own documents: the demand letter on the
    // matter (generated or adopted) rides along automatically, plus any
    // document the lawyer attached to the claim workspace. Blanks fill
    // from them with verified quotes; every fill is flagged on the draft.
    const socSources: Array<{ name: string; content: string }> = [];
    const dlKey = findGeneratedDocKey(matter, 'demand_letter');
    if (dlKey) {
      const dlHtml = String(((matter as Record<string, unknown>)[dlKey] as Record<string, unknown>)?.html ?? '');
      const dlText = dlHtml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim();
      if (dlText.length > 200) socSources.push({ name: 'the demand letter on this matter', content: dlText.slice(0, 60_000) });
    }
    const attached = (matter as Record<string, unknown>).socSource as { name?: string; text?: string } | undefined;
    if (attached?.text) socSources.push({ name: String(attached.name ?? 'attached document'), content: attached.text.slice(0, 80_000) });

    const result = await generateStatementOfClaim({
      intake: employment.intake,
      approvedIssues: employment.approvedIssues,
      analysis: employment.analysis,
      procedureType: parsed.data.procedureType,
      claimAmount: parsed.data.claimAmount,
      lawyerName: parsed.data.lawyerName,
      lawyerBlock: parsed.data.lawyerBlock,
      firmName: parsed.data.firmName,
      firmAddress: parsed.data.firmAddress,
      courtLocation: parsed.data.courtLocation,
      styleContext: [socStyle?.context, socDirection.context].filter(Boolean).join('\n\n') || undefined,
      styleTypicalWords: socStyle?.typicalWords,
      gates: employment.gates,
      timeline: (employment.timeline ?? []).map(e => ({ date: e.date, label: e.label, description: e.description })),
      nodeOverrides: socOverrides,
      customNodes,
      courtFileNumber: ((matter as Record<string, unknown>).courtFileNumber as string) || undefined,
      lsoNumber: socLso || undefined,
      sourceDocuments: socSources.length > 0 ? socSources : undefined,
      // Section-by-section: the lawyer's approved or edited pleading sections
      // (and Background Facts) override the standard render at assembly.
      socDraft: (matter as Record<string, unknown>).socDraft as import('../../../employment/soc-outline.js').SocDraftState | undefined,
    }, definedTerms);
    await applyDirectionAftermath(result, socDirection);
    if (socStyle) {
      result.lawyerReviewFlags = [
        ...result.lawyerReviewFlags,
        ...await styleReviewFlags(result.html, socStyle.identifiers, socStyle.label, employment.intake as Record<string, unknown>, parsed.data.claimAmount),
      ];
    }

    recordDraftHistory(matter as Record<string, unknown>, {
      docType: 'statement_of_claim', title: 'Statement of Claim', html: sanitiseHtml(result.html),
      costUsd: result.costUsd, meta: { procedureType: result.procedureType, claimAmount: parsed.data.claimAmount },
    }, { userId, matterId });
    (matter as Record<string, unknown>).generatedSOC = {
      html: sanitiseHtml(result.html),
      procedureType: result.procedureType,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      claimAmount: parsed.data.claimAmount,
      generatedAt: new Date().toISOString(),
      costUsd: result.costUsd,
      status: 'draft',
      // What each pleading node did and why: the record of selection, for
      // the picker and for explaining the claim later.
      ...(result.nodeReport ? { nodeReport: result.nodeReport } : {}),
      // The structured Form 4C backsheet; the Word export renders it landscape.
      ...(result.backsheet ? { socBacksheet: result.backsheet } : {}),
    };
    employment.selectedProcedure = parsed.data.procedureType;
    employment.selectedDocumentType = 'statement_of_claim';

    await saveEmploymentData(userId, matterId, matter, employment);

    return reply.send({
      ok: true,
      html: sanitiseHtml(result.html),
      procedureType: result.procedureType,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      costUsd: result.costUsd,
nodeReport: result.nodeReport,
      socBacksheet: result.backsheet,
    });
  });

  // ── POST /api/employment/:matterId/application ─────────────────────────
  // Generate a Notice of Application, HRTO Application, or ESA Complaint.

  const APPLICATION_TYPES = ['notice_of_application', 'hrto_application', 'esa_complaint'] as const;

  const applicationBodySchema = z.object({
    applicationType: z.enum(APPLICATION_TYPES),
    claimAmount: z.number().positive().max(99_999_999).optional(),
    lawyerName: z.string().trim().min(1).max(200),
    firmName: z.string().trim().min(1).max(200),
    firmAddress: z.string().trim().max(500).optional(),
    courtLocation: z.string().trim().max(200).optional(),
  });

  fastify.post('/api/employment/:matterId/application', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = applicationBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return reply.status(400).send({ ok: false, error: 'Invalid request' });
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and analysis first.' });
    }
    ensureAnalysisFresh(employment);

    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);

    const result = await generateApplication({
      intake: employment.intake,
      approvedIssues: employment.approvedIssues,
      analysis: employment.analysis,
      applicationType: parsed.data.applicationType as ApplicationType,
      claimAmount: parsed.data.claimAmount,
      lawyerName: parsed.data.lawyerName,
      firmName: parsed.data.firmName,
      firmAddress: parsed.data.firmAddress,
      courtLocation: parsed.data.courtLocation,
    }, definedTerms);

    recordDraftHistory(matter as Record<string, unknown>, {
      docType: parsed.data.applicationType, title: result.formName, html: sanitiseHtml(result.html),
      costUsd: result.costUsd,
    }, { userId, matterId });
    (matter as Record<string, unknown>).generatedApplication = {
      html: sanitiseHtml(result.html),
      applicationType: result.applicationType,
      formName: result.formName,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      generatedAt: new Date().toISOString(),
      costUsd: result.costUsd,
      status: 'draft',
    };
    employment.selectedDocumentType = parsed.data.applicationType === 'notice_of_application'
      ? 'notice_of_application'
      : parsed.data.applicationType === 'hrto_application'
        ? 'hrto_application'
        : 'esa_complaint';

    await saveEmploymentData(userId, matterId, matter, employment);

    return reply.send({
      ok: true,
      html: sanitiseHtml(result.html),
      applicationType: result.applicationType,
      formName: result.formName,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      costUsd: result.costUsd,
    });
  });

  // ── POST /api/employment/:matterId/litigation-document ──────────────────
  // Generate a discovery plan, affidavit of documents, or mediation brief.

  const LITIGATION_DOC_TYPES = ['discovery_plan', 'affidavit_of_documents', 'mediation_brief', 'severance_assessment', 'counter_offer', 'rebuttal_letter', 'reply', 'rule49_offer', 'settlement_minutes', 'retainer_agreement', 'mitigation_log', 'settlement_conference_brief', 'hrto_schedule_a', 'notice_of_action', 'notice_of_arbitration', 'sj_notice_of_motion', 'sj_affidavit', 'sj_factum', 'sp_timetable_motion', 'consent_timetable_order', 'timetable_order', 'undertakings_answers', 'affidavit_of_service', 'rule49_withdrawal', 'rule49_acceptance', 'costs_outline', 'esa_filing_sheet', 'scc_filing_sheet'] as const;

  const litigationDocBodySchema = z.object({
    documentType: z.enum(LITIGATION_DOC_TYPES),
    claimAmount: z.number().positive().max(99_999_999).optional(),
    lawyerName: z.string().trim().min(1).max(200),
    /** The counsel block for court documents, one lawyer per line. */
    lawyerBlock: z.string().trim().max(600).optional(),
    firmName: z.string().trim().min(1).max(200),
    firmAddress: z.string().trim().max(500).optional(),
    courtLocation: z.string().trim().max(200).optional(),
    additionalContext: z.string().trim().max(5000).optional(),
    /** Draft in the firm's style, learned from its precedents. */
    styleProfileId: z.string().trim().max(100).optional(),
    /** Reply only: comparison item ids the Reply addresses. */
    replyItemIds: z.array(z.string().max(40)).max(40).optional(),
    /** Which procedure the action is under; the timetable motion adapts. */
    procedureType: z.enum(['simplified', 'ordinary']).optional(),
    /** Structured inputs for the deterministic court forms. */
    formFields: z.record(z.string().max(60), z.union([z.string().max(3000), z.number()])).optional(),
    /**
     * Documents attached at generation time to ground the brief (an
     * externally-drafted SOC, a demand letter, a list of authorities).
     * Text is parsed client-side via /api/documents/parse.
     */
    extraSources: z.array(z.object({
      name: z.string().trim().min(1).max(300),
      text: z.string().trim().min(1).max(60_000),
    })).max(6).optional(),
    /** Stored brief sources to include, by id (attach once, reuse). */
    briefSourceIds: z.array(z.string().max(60)).max(8).optional(),
    /** Affidavit furniture: who swears, in what capacity, on what basis. */
    affidavit: z.object({
      deponentName: z.string().trim().max(200),
      deponentCity: z.string().trim().max(120).optional(),
      capacity: z.enum(['plaintiff', 'lawyer', 'law_clerk', 'other']),
      capacityDescription: z.string().trim().max(300).optional(),
      knowledgeBasis: z.enum(['personal', 'information_and_belief', 'mixed']),
      informationSource: z.string().trim().max(300).optional(),
      sworn: z.enum(['sworn', 'affirmed']).default('sworn'),
      title: z.string().trim().max(200).optional(),
      exhibits: z.array(z.object({
        letter: z.string().trim().max(4).optional(),
        description: z.string().trim().min(1).max(400),
      })).max(26).optional(),
    }).optional(),
    /**
     * The lawyer's own timetable rows: their wording, their order. Takes
     * precedence over the fixed-step formFields when present.
     */
    timetableRows: z.array(z.object({
      label: z.string().trim().min(1).max(300),
      date: z.string().trim().min(1).max(40),
    })).max(30).optional(),
    /** Include the matter's generated positions (default yes, when they exist). */
    includeGeneratedDemand: z.boolean().default(true),
    includeGeneratedSoc: z.boolean().default(true),
  });

  fastify.post('/api/employment/:matterId/litigation-document', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };

    const parsed = litigationDocBodySchema.safeParse(req.body);
    if (!parsed.success) {
      {
      const detail = parsed.error.issues.slice(0, 3).map(i => `${i.path.join('.')}: ${i.message}`).join('; ');
      return reply.status(400).send({ ok: false, error: `The request was refused. ${detail}.` });
    }
    }

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and analysis first.' });
    }
    // Facts changed since the analysis ran? Recompute before drafting so
    // the damages table and clocks reflect the current intake, and say so.
    const analysisRefreshed = ensureAnalysisFresh(employment);

    const definedTerms: string[] = [];
    if (employment.intake.client_first_name && employment.intake.client_last_name) {
      definedTerms.push(`${employment.intake.client_first_name} ${employment.intake.client_last_name}`);
    }
    if (employment.intake.employer_legal_name) definedTerms.push(employment.intake.employer_legal_name);

    const COURT_FORM_TYPES = ['affidavit_of_service', 'rule49_withdrawal', 'rule49_acceptance', 'costs_outline', 'esa_filing_sheet', 'scc_filing_sheet'];

    // Mediation brief: load the deterministic table inputs from the matter
    // record (comparables from the case library; offers from the negotiation
    // ledger). Both are best-effort; the generator omits a table and flags
    // it when the data is missing.
    let comparables: import('../../../employment/case-comparables.js').ComparableCase[] | null = null;
    let comparableRange: import('../../../employment/case-comparables.js').CaseBasedRange | null = null;
    let negotiationEntries: import('../../../employment/negotiation.js').NegotiationEntry[] | null = null;
    let negotiationSummary: import('../../../employment/negotiation.js').NegotiationSummary | null = null;
    // The brief is built FROM the positions already served: the matter's
    // demand letter and statement of claim ground the story and figures,
    // and double as citation sources so claims attribute to them.
    let positionDocuments: Array<{ title: string; text: string }> = [];
    let droppedSources: string[] = [];
    // Schedule "A" is grounded the same way: the allegations it pleads were
    // already stated in the civil pleading, so the lawyer attaches that
    // pleading and the narrative is drawn from it rather than re-derived
    // from the intake fields.
    const SOURCE_GROUNDED_TYPES = ['mediation_brief', 'hrto_schedule_a'];
    if (SOURCE_GROUNDED_TYPES.includes(parsed.data.documentType)) {
      const { assembleBriefSources } = await import('../../../employment/brief-sources.js');
      const dl = (matter as Record<string, unknown>).generatedDemandLetter as Record<string, unknown> | undefined;
      const soc = (matter as Record<string, unknown>).generatedSOC as Record<string, unknown> | undefined;
      const stored = (((matter as Record<string, unknown>).briefSources ?? []) as Array<{ id: string; name: string; text: string }>);
      const selectedStored = parsed.data.briefSourceIds
        ? stored.filter(sd => parsed.data.briefSourceIds!.includes(sd.id))
        : [];
      const assembled = assembleBriefSources({
        generatedDemandHtml: dl?.html,
        generatedSocHtml: soc?.html,
        includeGeneratedDemand: parsed.data.includeGeneratedDemand,
        includeGeneratedSoc: parsed.data.includeGeneratedSoc,
        extraSources: [
          ...selectedStored.map(sd => ({ name: sd.name, text: sd.text })),
          ...(parsed.data.extraSources ?? []),
        ],
      });
      positionDocuments = assembled.sources;
      droppedSources = assembled.dropped;
    }
    if (parsed.data.documentType === 'mediation_brief') {
      negotiationEntries = ((matter as Record<string, unknown>).negotiation ?? null) as import('../../../employment/negotiation.js').NegotiationEntry[] | null;
      if (negotiationEntries?.length) {
        try {
          const { summarizeNegotiation } = await import('../../../employment/negotiation.js');
          const dmg = employment.analysis?.damagesEstimate;
          negotiationSummary = summarizeNegotiation(negotiationEntries, {
            esaTotalCad: dmg ? (dmg.esaNoticePay ?? 0) + (dmg.esaSeverancePay ?? 0) : null,
            commonLawLowCad: dmg?.totalEstimateLow ?? null,
            commonLawHighCad: dmg?.totalEstimateHigh ?? null,
          });
        } catch (err) {
          logger.warn('Negotiation summary failed (brief generates without it)', { matterId, error: err instanceof Error ? err.message : String(err) });
        }
      }
      try {
        const { computeBardalFactors } = await import('../../../employment/timeline-generator.js');
        const { findComparables } = await import('../../../employment/case-comparables.js');
        const bardal = computeBardalFactors(employment.intake);
        if (bardal.tenureYears != null) {
          const found = await findComparables({ years: bardal.tenureYears, age: bardal.age, seniority: bardal.character ?? null });
          if (found) {
            comparables = found.comparables;
            comparableRange = found.range;
          }
        }
      } catch (err) {
        // Comparables are additive; the brief generates without them, but
        // a misconfigured caselaw connection must not fail silently.
        logger.warn('Comparables lookup failed (brief generates without the table)', { matterId, error: err instanceof Error ? err.message : String(err) });
      }
    }

    // Timetable documents: the lawyer's proposed dates are validated here
    // (readable, future, correctly ordered, Rule 48.14 checked) and passed
    // into the generator so Schedule A carries real dates rather than
    // [DATE] placeholders. They are docketed after a successful generation.
    const TIMETABLE_TYPES = ['sp_timetable_motion', 'consent_timetable_order', 'timetable_order'];
    let timetableContext: string | undefined;
    let timetableDates: import('../../../employment/timetable.js').TimetableDates | undefined;
    let timetableCautions: string[] = [];
    let customRows: Array<{ label: string; date: string }> | undefined;
    if (TIMETABLE_TYPES.includes(parsed.data.documentType)) {
      const tt = await import('../../../employment/timetable.js');
      const claimIssued = tt.claimIssuedDate(employment.intake);

      if (parsed.data.timetableRows && parsed.data.timetableRows.length > 0) {
        // The lawyer wrote their own steps: their wording and their order
        // govern, and the checks are the ones that stay meaningful.
        const check = tt.validateCustomTimetable(parsed.data.timetableRows, { claimIssuedDate: claimIssued });
        if (!check.ok) {
          return reply.status(400).send({
            ok: false,
            error: 'The proposed timetable needs fixing before the document can be drafted.',
            issues: check.issues.filter(i => i.severity === 'error').map(i => i.message),
          });
        }
        if (check.rows.length > 0) {
          timetableContext = tt.customTimetableForPrompt(check.rows);
          customRows = check.rows;
        }
        timetableCautions = check.issues.filter(i => i.severity === 'caution').map(i => i.message);
      } else {
        const raw = Object.fromEntries(
          Object.entries(parsed.data.formFields ?? {}).map(([k, v]) => [k, String(v ?? '')]),
        );
        const check = tt.validateTimetable(raw, { claimIssuedDate: claimIssued });
        if (!check.ok) {
          return reply.status(400).send({
            ok: false,
            error: 'The proposed timetable needs fixing before the document can be drafted.',
            issues: check.issues.filter(i => i.severity === 'error').map(i => i.message),
          });
        }
        if (Object.keys(check.dates).length > 0) {
          timetableContext = tt.timetableForPrompt(check.dates);
          timetableDates = check.dates;
        }
        timetableCautions = check.issues.filter(i => i.severity === 'caution').map(i => i.message);
      }
    }

    // The firm's style profile, when the lawyer picked one: its guide is
    // folded into the drafting prompt, and its identifier list drives the
    // deterministic precedent-bleed scan after generation.
    let styleContext: string | undefined;
    let styleIdentifiers: string[] = [];
    let styleLabel = '';
    let styleTypicalWords: number | undefined;
    let styleProfileTableRows: string[] | undefined;
    let styleFlowHeadings: string[] | undefined;
    if (parsed.data.styleProfileId) {
      const style = await loadStyleForGeneration(req, parsed.data.styleProfileId, parsed.data.documentType);
      if ('error' in style) return reply.status(style.status).send({ ok: false, error: style.error });
      styleContext = style.context;
      styleIdentifiers = style.identifiers;
      styleLabel = style.label;
      styleTypicalWords = style.typicalWords;
      styleProfileTableRows = style.profileTableRows;
      styleFlowHeadings = style.flowHeadings;
    }

    // Mediation logistics: the date is validated like every other
    // lawyer-typed date (ambiguity refused, never guessed) and docketed
    // below as a real scheduled proceeding.
    let mediationDateIso: string | undefined;
    if (parsed.data.documentType === 'mediation_brief' && parsed.data.formFields?.mediation_date) {
      const { normaliseDate } = await import('../../../employment/date-normalise.js');
      const norm = normaliseDate(String(parsed.data.formFields.mediation_date));
      if (!norm.value) {
        return reply.status(400).send({ ok: false, error: `Mediation date: ${norm.reason}` });
      }
      mediationDateIso = norm.value;
      parsed.data.formFields.mediation_date = norm.value;
    }

    // The rebuttal is built FROM opposing counsel's letter; without it the
    // generator would be answering a letter it has not read.
    let rebuttalContext: string | undefined;
    let rebuttalFeedbackContext: string | undefined;
    let rebuttalSourceDoc: { name: string; content: string } | undefined;
    if (parsed.data.documentType === 'rebuttal_letter') {
      const src = (matter as Record<string, unknown>).rebuttalSource as { name?: string; text?: string } | undefined;
      if (!src?.text) {
        return reply.status(400).send({ ok: false, error: 'Attach the letter you are responding to first. The workspace has a place for it.' });
      }
      rebuttalSourceDoc = { name: String(src.name ?? 'Letter from opposing counsel'), content: src.text };
      const fb = (matter as Record<string, unknown>).rebuttalFeedback as { name?: string; text?: string } | undefined;
      if (fb?.text) {
        rebuttalFeedbackContext = [
          'THE CLIENT\'S FEEDBACK (binding). Follow the instructions in it and correct the record with the facts in it. It is raw and unfiltered: anything in it that is personal, confidential, about the client\'s health or finances, or about what the client would actually accept in settlement must NEVER appear in the letter.',
          '"""',
          fb.text,
          '"""',
        ].join('\n');
      }
      rebuttalContext = `THE LETTER BEING ANSWERED (from opposing counsel, ${JSON.stringify(rebuttalSourceDoc.name)}):\n"""\n${src.text}\n"""`;
    }

    // The Reply answers the pleaded Defence, so it must have read it.
    let defenceContext: string | undefined;
    let defenceSourceDoc: { name: string; content: string } | undefined;
    if (parsed.data.documentType === 'reply') {
      // The Rules of the Small Claims Court (O. Reg. 258/98) provide no
      // Reply: the pleadings end with the Defence. Producing one anyway
      // would hand the lawyer a document no court accepts.
      const forum = employment.selectedProcedure
        ?? ((employment.analysis as { recommendedProcedure?: string } | null)?.recommendedProcedure ?? null);
      if (forum === 'small_claims') {
        return reply.status(400).send({ ok: false, error: 'This matter is in the Small Claims Court, and its rules provide no Reply to a Defence. The Defence is answered at the settlement conference. If the Defendant has served a Defendant’s Claim, the answer is a Defence (Form 9A) within 20 days of service.' });
      }
      const src = (matter as Record<string, unknown>).defenceSource as { name?: string; text?: string } | undefined;
      if (!src?.text) {
        return reply.status(400).send({ ok: false, error: 'Attach the Statement of Defence first. The Reply workspace has a place for it.' });
      }
      defenceSourceDoc = { name: String(src.name ?? 'Statement of Defence'), content: src.text };
      defenceContext = `THE STATEMENT OF DEFENCE BEING ANSWERED (${defenceSourceDoc.name}):\n` + '"'.repeat(3) + `\n${src.text}\n` + '"'.repeat(3) + `\nRespond ONLY to the NEW MATTERS actually raised in this Defence (cause particulars, mitigation allegations, after-acquired cause, set-off, limitation defences). Do not use [CONFIRM AGAINST DEFENCE] markers: the Defence is in front of you. Cite its paragraph numbers when responding.`;
      // The lawyer's picks from the comparison narrow the Reply to exactly
      // the new matters they chose to answer.
      const comparison = (matter as Record<string, unknown>).replyComparison as { items?: Array<{ id: string; defenceParagraph: string; summary: string; quote: string; why?: string }> } | undefined;
      if (comparison?.items?.length && parsed.data.replyItemIds?.length) {
        const chosen = comparison.items.filter(i => parsed.data.replyItemIds!.includes(i.id));
        if (chosen.length > 0) {
          defenceContext += '\n\nTHE LAWYER REVIEWED THE DEFENCE AGAINST THE CLAIM AND CHOSE THESE NEW MATTERS FOR THE REPLY TO ADDRESS. Address exactly these, and no others:\n' +
            chosen.map(i => `- [Defence para ${i.defenceParagraph}] ${i.summary}${i.why ? ` (the answer should address: ${i.why})` : ''} Quote: "${i.quote.slice(0, 200)}"`).join('\n');
        }
      }
    }

    const litDirection = directionForGeneration(matter, parsed.data.documentType);

    // Factum: assemble Part III from the firm's argument library, selecting the
    // sections the matter's approved issues argue (plus any the lawyer forced
    // on), so the factum argues in the firm's settled way.
    let factumArgumentGuidance: string | undefined;
    const factumForum = factumForumFromProcedure(employment.selectedProcedure ?? (employment.analysis as { recommendedProcedure?: string } | null)?.recommendedProcedure);
    let result: LitigationDocumentResult | undefined;
    if (parsed.data.documentType === 'sj_factum') {
      const factumOverrides = ((matter as Record<string, unknown>).factumNodeOverrides ?? {}) as Record<string, 'on' | 'off'>;
      const selected = loadSelectedFactumNodes({
        firmId: resolveFirmId(req),
        gates: employment.gates ?? [],
        approvedIssues: employment.approvedIssues ?? [],
        overrides: factumOverrides,
        forum: factumForum,
      });
      // Section-by-section path: when the lawyer has drafted sections, the
      // factum is assembled from their approved text, not generated whole.
      const draft = ((matter as Record<string, unknown>).factumDraft ?? undefined) as FactumDraftState | undefined;
      const outline = buildFactumOutline(selected, draft, factumForum);
      const readiness = factumDraftReadiness(outline);
      const factumWord = factumForum === 'small_claims' ? 'written argument' : 'factum';
      if (readiness.drafted > 0) {
        if (!readiness.allApproved) {
          const remaining = readiness.total - readiness.approved;
          return reply.status(400).send({ ok: false, error: `You are drafting this ${factumWord} section by section. Approve the remaining ${remaining} section${remaining === 1 ? '' : 's'} in the outline, then generate to assemble them. To generate the whole ${factumWord} in one pass instead, discard the section drafts.` });
        }
        const assembled = assembleFactum({
          sections: outline.map(s => ({ kind: s.kind, header: s.header, html: s.html ?? '', authorities: s.authorities })),
          intake: employment.intake,
          claimAmount: parsed.data.claimAmount,
          forum: factumForum,
        });
        result = {
          html: assembled.html,
          documentType: 'sj_factum',
          documentTitle: assembled.documentTitle,
          lawyerReviewFlags: assembled.lawyerReviewFlags,
          citations: [],
          costUsd: 0,
        };
      } else {
        factumArgumentGuidance = buildFactumArgumentGuidance(selected) || undefined;
      }
    }

    // Mediation brief: when the lawyer drafts section by section, the narrative
    // is assembled from their approved sections and wrapped in the standard
    // cover, tables, and sign-off, with no model call.
    let mediationNarrativeOverride: string | undefined;
    if (parsed.data.documentType === 'mediation_brief') {
      const { mediationSections, buildMediationOutline, mediationDraftReadiness, assembleMediationNarrative } = await import('../../../employment/mediation-outline.js');
      // Section-by-section uses the standard section set, so the outline,
      // draft, and assemble paths all key off the same section ids. The firm's
      // own flow headings still shape the whole-document generation below.
      const secDefs = mediationSections();
      const mDraft = ((matter as Record<string, unknown>).mediationDraft ?? undefined) as import('../../../employment/mediation-outline.js').MediationDraftState | undefined;
      const outline = buildMediationOutline(secDefs, mDraft);
      const readiness = mediationDraftReadiness(outline);
      if (readiness.drafted > 0) {
        if (!readiness.allApproved) {
          const remaining = readiness.total - readiness.approved;
          return reply.status(400).send({ ok: false, error: `You are drafting this mediation brief section by section. Approve the remaining ${remaining} section${remaining === 1 ? '' : 's'} in the outline, then generate to assemble them. To generate the whole brief in one pass instead, discard the section drafts.` });
        }
        mediationNarrativeOverride = assembleMediationNarrative(outline);
      }
    }

    if (!result) try {
      result = await generateLitigationDocument({
        intake: employment.intake,
        approvedIssues: employment.approvedIssues,
        analysis: employment.analysis,
        documentType: parsed.data.documentType as LitigationDocumentType,
        factumArgumentGuidance,
        factumForum,
        mediationNarrativeOverride,
        claimAmount: parsed.data.claimAmount,
        lawyerName: parsed.data.lawyerName,
        firmName: parsed.data.firmName,
        firmAddress: parsed.data.firmAddress,
        courtLocation: parsed.data.courtLocation,
        // The direction goes last in the context: it is what overrides
        // the rest, so it is read with the rest still in view.
        additionalContext: [parsed.data.additionalContext, timetableContext, styleContext, rebuttalContext, rebuttalFeedbackContext, defenceContext, litDirection.context]
          .filter(Boolean).join('\n\n') || undefined,
        formFields: parsed.data.formFields,
        procedureType: parsed.data.procedureType,
        comparables,
        comparableRange,
        negotiationEntries,
        negotiationSummary,
        styleTypicalWords,
        styleProfileTableRows,
        styleFlowHeadings,
        affidavit: parsed.data.affidavit,
        positionDocuments: positionDocuments.length > 0 ? positionDocuments : undefined,
        sourceDocuments: (() => {
          const docs = positionDocuments.map(d => ({ name: d.title, content: d.text }));
          if (rebuttalSourceDoc) docs.push(rebuttalSourceDoc);
          if (defenceSourceDoc) docs.push(defenceSourceDoc);
          return docs.length > 0 ? docs : undefined;
        })(),
      }, definedTerms);
    } catch (err) {
      // Deterministic court forms validate their inputs and fail with a
      // plain message the lawyer can act on.
      if (COURT_FORM_TYPES.includes(parsed.data.documentType)) {
        return reply.status(400).send({ ok: false, error: err instanceof Error ? err.message : 'Form inputs are incomplete.' });
      }
      throw err;
    }

    if (rebuttalFeedbackContext) {
      result.lawyerReviewFlags = [
        'The client\'s feedback was read raw while drafting. Check the letter repeats nothing said in confidence: health, finances, or what the client would accept.',
        ...(result.lawyerReviewFlags ?? []),
      ];
    }

    // The Reply files under Form 25A: the general heading, the title, the
    // closing blocks and the consecutive paragraph numbers are assembled
    // here, deterministically, around the pleading paragraphs the model
    // wrote. The model never touches the shell.
    if (parsed.data.documentType === 'reply') {
      const { assembleReply } = await import('../../../employment/reply-shell.js');
      result.html = assembleReply(result.html, {
        courtFileNumber: ((matter as Record<string, unknown>).courtFileNumber as string) || undefined,
        courtLocation: parsed.data.courtLocation,
        plaintiffName: [employment.intake.client_first_name, employment.intake.client_last_name].filter(Boolean).join(' ') || '[LAWYER: client name]',
        defendantName: String(employment.intake.employer_legal_name ?? employment.intake.employer_operating_name ?? '[LAWYER: employer name]'),
        lawyerName: parsed.data.lawyerName,
        lawyerBlock: parsed.data.lawyerBlock,
        firmName: parsed.data.firmName,
        firmAddress: parsed.data.firmAddress,
      });
    }

    await applyDirectionAftermath(result, litDirection);

    // Deterministic precedent-bleed scan: the precedents' names and
    // amounts must not surface in this matter's draft. This matter's own
    // parties and figures are excluded first.
    if (styleIdentifiers.length > 0) {
      result.lawyerReviewFlags = [
        ...result.lawyerReviewFlags,
        ...await styleReviewFlags(result.html, styleIdentifiers, styleLabel, employment.intake as Record<string, unknown>, parsed.data.claimAmount),
      ];
    }

    // Store on the matter
    recordDraftHistory(matter as Record<string, unknown>, {
      docType: parsed.data.documentType, title: result.documentTitle, html: sanitiseHtml(result.html),
      costUsd: result.costUsd,
    }, { userId, matterId });
    const docKey = `generated_${parsed.data.documentType}`;
    (matter as Record<string, unknown>)[docKey] = {
      html: sanitiseHtml(result.html),
      documentType: result.documentType,
      documentTitle: result.documentTitle,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      generatedAt: new Date().toISOString(),
      costUsd: result.costUsd,
      status: 'draft',
      // A Reply files like the claim files: same Form 4C backsheet.
      ...(parsed.data.documentType === 'reply' ? {
        socBacksheet: {
          plaintiff: [employment.intake.client_first_name, employment.intake.client_last_name].filter(Boolean).join(' ').toUpperCase() || '[LAWYER: client name]',
          defendant: String(employment.intake.employer_legal_name ?? employment.intake.employer_operating_name ?? '[LAWYER: employer name]').toUpperCase(),
          plaintiffRole: 'Plaintiff', defendantRole: 'Defendant',
          courtFileNo: String((matter as Record<string, unknown>).courtFileNumber ?? ''),
          city: (parsed.data.courtLocation ?? 'Toronto').toUpperCase(),
          docTitle: 'REPLY',
          firmLines: [
            [parsed.data.firmName.toUpperCase(), ...(parsed.data.firmAddress ? parsed.data.firmAddress.split(/\r?\n/) : [])],
            parsed.data.lawyerBlock?.trim()
              ? parsed.data.lawyerBlock.trim().split(/\r?\n/).map(l => l.trim()).filter(Boolean)
              : [parsed.data.lawyerName],
            ['Lawyers for the Plaintiff'],
          ],
        },
      } : {}),
    };

    // Docket the proposed timetable. These are the lawyer's own dates, not
    // yet ordered by a court, so they go on as ordinary docket items rather
    // than court deadlines and are replaced (not duplicated) if the document
    // is regenerated with different dates.
    let docketed = 0;
    if (parsed.data.documentType === 'mediation_brief' && (mediationDateIso || parsed.data.formFields?.mediator_name)) {
      // MERGE: regenerating with only a mediator named must not erase the
      // stored date, and no other document type owns these fields.
      (matter as Record<string, unknown>).mediationLogistics = {
        ...(((matter as Record<string, unknown>).mediationLogistics ?? {}) as Record<string, unknown>),
        ...(mediationDateIso ? { date: mediationDateIso } : {}),
        ...(typeof parsed.data.formFields?.mediator_name === 'string' && parsed.data.formFields.mediator_name
          ? { mediator: parsed.data.formFields.mediator_name } : {}),
      };
    }
    if (mediationDateIso) {
      // A scheduled mediation is a commitment, not a proposal: it goes on
      // as a real deadline, replaced (not duplicated) on regeneration.
      const mediatorName = typeof parsed.data.formFields?.mediator_name === 'string' ? parsed.data.formFields.mediator_name : '';
      const label = 'Mediation';
      employment.timeline = [
        ...employment.timeline.filter(ev => ev.label !== label),
        {
          date: mediationDateIso,
          label,
          description: `Mediation${mediatorName ? ` before ${mediatorName}` : ''}. Serve the brief in good time beforehand.`,
          category: 'legal' as const,
          source: 'system' as const,
          courtDeadline: true,
        },
      ].sort((a, b) => a.date.localeCompare(b.date));
      docketed += 1;
    }
    if (customRows && customRows.length > 0) {
      const tt = await import('../../../employment/timetable.js');
      const events = tt.customTimetableEvents(customRows);
      const labels = new Set(events.map(e => e.label));
      employment.timeline = [
        ...employment.timeline.filter(ev => !labels.has(ev.label)),
        ...events,
      ].sort((a, b) => a.date.localeCompare(b.date));
      docketed += events.length;
    }
    if (timetableDates && Object.keys(timetableDates).length > 0) {
      const tt = await import('../../../employment/timetable.js');
      const events = tt.timetableTimelineEvents(timetableDates);
      const proposedLabels = new Set(events.map(e => e.label));
      employment.timeline = [
        ...employment.timeline.filter(ev => !proposedLabels.has(ev.label)),
        ...events,
      ].sort((a, b) => a.date.localeCompare(b.date));
      docketed = events.length;
    }

    await saveEmploymentData(userId, matterId, matter, employment);

    return reply.send({
      ok: true,
      html: sanitiseHtml(result.html),
      documentType: result.documentType,
      documentTitle: result.documentTitle,
      lawyerReviewFlags: result.lawyerReviewFlags,
      citations: result.citations,
      costUsd: result.costUsd,
      ...(positionDocuments.length > 0 ? { positionsUsed: positionDocuments.map(d => d.title) } : {}),
      ...(droppedSources.length > 0 ? { droppedSources } : {}),
      ...(docketed > 0 ? { docketedDates: docketed } : {}),
      ...(timetableCautions.length > 0 || analysisRefreshed ? {
        cautions: [
          ...(analysisRefreshed ? ['The facts changed after the last analysis, so the analysis was recomputed from the current intake before drafting.'] : []),
          ...timetableCautions,
        ],
      } : {}),
    });
  });
}
