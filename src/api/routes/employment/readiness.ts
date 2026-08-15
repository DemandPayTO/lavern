/**
 * Employment routes — Readiness checks and Word download.
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

export function registerReadinessRoutes(fastify: FastifyInstance): void {

  // ── GET /api/employment/:matterId/demand-readiness ─────────────────────
  // What the demand letter will be missing, before generating. A demand
  // letter is the first thing the other side reads, so the checks are its
  // own: arguing a clause nobody attached, ignoring known mitigation, a
  // signed release, a limitation period a letter does not stop.

  fastify.get('/api/employment/:matterId/demand-readiness', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const { demandReadiness } = await import('../../../employment/demand-readiness.js');
    const { defaultDamageHeads } = await import('../../../employment/demand-letter-parts.js');
    const firmId = resolveFirmId(req);

    const sources = (((matter as Record<string, unknown>).briefSources ?? []) as Array<{ kind?: string }>);
    // Signature-block details live on the user profile; best-effort, since
    // a missing profile is a warn in the checklist rather than an error.
    let profile: Record<string, unknown> = {};
    try {
      const { getUserById } = await import('../../../db/database.js');
      const user = getUserById(userId);
      if (user?.profile_json) profile = JSON.parse(user.profile_json) as Record<string, unknown>;
    } catch { /* profile is best-effort */ }

    return reply.send({
      ok: true,
      // What the table will itemise unless the lawyer overrides it. Sent
      // here so the workspace prefills the real heads rather than its own
      // approximation of them.
      defaultHeads: employment.analysis ? defaultDamageHeads(employment.analysis) : [],
      items: demandReadiness({
        intake: employment.intake,
        analysis: employment.analysis,
        approvedIssues: employment.approvedIssues ?? [],
        sourceKinds: sources.map(sd => sd.kind ?? 'other'),
        styleProfilesCount: firmId ? getStyleProfiles(firmId, 'demand_letter').length : 0,
        firmContactComplete: Boolean(profile.firmAddress && (profile.firmPhone || profile.firmEmail)),
      }),
    });
  });

  // ── GET /api/employment/:matterId/brief-readiness ──────────────────────
  // What the mediation brief will be missing, before generating: every
  // check mirrors a decision the deterministic assemblers make, so the
  // lawyer fixes holes from a checklist instead of a paid draft.

  fastify.get('/api/employment/:matterId/brief-readiness', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const { matter, employment } = loadEmploymentData(row.data_json);
    const { briefReadiness } = await import('../../../employment/brief-readiness.js');
    const { caselawConfigured } = await import('../../../employment/case-comparables.js');
    const firmId = resolveFirmId(req);
    const dl = (matter as Record<string, unknown>).generatedDemandLetter as Record<string, unknown> | undefined;
    const soc = (matter as Record<string, unknown>).generatedSOC as Record<string, unknown> | undefined;

    return reply.send({
      ok: true,
      items: briefReadiness({
        intake: employment.intake,
        analysis: employment.analysis,
        approvedIssuesCount: employment.approvedIssues?.length ?? 0,
        negotiationCount: (((matter as Record<string, unknown>).negotiation ?? []) as unknown[]).length,
        caselawConfigured: caselawConfigured(),
        styleProfilesCount: firmId ? getStyleProfiles(firmId, 'mediation_brief').length : 0,
        sourcesCount: (dl?.html ? 1 : 0) + (soc?.html ? 1 : 0) + (((matter as Record<string, unknown>).briefSources ?? []) as unknown[]).length,
        mediationDocketed: (employment.timeline ?? []).some(e => e.label === 'Mediation'),
      }),
    });
  });

  // ── GET /api/employment/:matterId/download/:docType ────────────────────
  // Download a generated document as DOCX.

  fastify.get('/api/employment/:matterId/download/:docType', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string; firmId?: string }).userId ?? 'local-user';
    const { matterId, docType } = req.params as { matterId: string; docType: string };

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });

    const matterData = JSON.parse(row.data_json) as Record<string, unknown>;
    const employment = (matterData.employmentData as EmploymentMatterData) ?? null;

    const firmId = resolveFirmId(req) ?? '';
    let html: string | null = null;
    let title = '';

    // Firm and lawyer identity for the template's letterhead placeholders.
    // A generated demand letter or SOC carries what the lawyer typed at
    // generation time, so prefer that; otherwise fall back to the account
    // profile. Without the fallback these render as literal {{FIRM_NAME}}
    // markers on every document type that is not a demand letter or SOC.
    const genDL = matterData.generatedDemandLetter as Record<string, unknown> | undefined;
    const genSOC = matterData.generatedSOC as Record<string, unknown> | undefined;
    let firmName = (genDL?.firmName as string) || (genSOC?.firmName as string) || '';
    let lawyerName = (genDL?.lawyerName as string) || (genSOC?.lawyerName as string) || '';
    let firmAddress = '';
    try {
      const user = getUserById(userId);
      if (user) {
        firmName = firmName || user.firm_name || '';
        lawyerName = lawyerName || user.display_name || '';
        if (user.profile_json) {
          const profile = JSON.parse(user.profile_json) as Record<string, unknown>;
          firmAddress = [profile.firmAddress, profile.firmPhone, profile.firmEmail]
            .filter(v => typeof v === 'string' && v.trim())
            .join(' · ');
        }
      }
    } catch { /* profile is best-effort; markers simply stay visible */ }

    // The firm's own file number where set, otherwise the matter number.
    const fileNumber = String(
      (matterData.firmFileNumber as string) || (matterData.matterNumber as string) || '',
    );
    // Court name follows the forum: the lawyer's chosen procedure where set,
    // otherwise the analysis recommendation.
    // A generated claim exports under the procedure it was GENERATED for:
    // changing the matter's forum later must not reformat an existing
    // Superior Court claim as a Small Claims document.
    const generatedProcedure = docType === 'statement-of-claim'
      ? ((matterData.generatedSOC as { procedureType?: string } | undefined)?.procedureType ?? null)
      : null;
    const procedure = generatedProcedure
      ?? employment?.selectedProcedure
      ?? employment?.analysis?.recommendedProcedure
      ?? null;
    const courtName = procedure === 'small_claims'
      ? 'ONTARIO SUPERIOR COURT OF JUSTICE (SMALL CLAIMS COURT)'
      : 'ONTARIO SUPERIOR COURT OF JUSTICE';

    if (docType === 'demand-letter') {
      // An adopted outside letter lives under the pattern key; both count.
      const dlKey = findGeneratedDocKey(matterData, 'demand_letter');
      const dlDoc = (genDL ?? (dlKey ? matterData[dlKey] : undefined)) as Record<string, unknown> | undefined;
      if (!dlDoc?.html) return reply.status(404).send({ ok: false, error: 'No demand letter generated yet.' });
      html = dlDoc.html as string;
      const clientName = employment ? `${employment.intake?.client_last_name ?? ''}` : '';
      const employerName = employment?.intake?.employer_legal_name ?? '';
      title = `Demand Letter${clientName ? ` re ${clientName}` : ''}${employerName ? ` v. ${employerName}` : ''}`;
    } else if (docType === 'statement-of-claim') {
      // An adopted outside claim lives under the pattern key; both count.
      const socKey = findGeneratedDocKey(matterData, 'statement_of_claim');
      const soc = (matterData.generatedSOC ?? (socKey ? matterData[socKey] : undefined)) as Record<string, unknown> | undefined;
      if (!soc?.html) return reply.status(404).send({ ok: false, error: 'No statement of claim generated yet.' });
      html = soc.html as string;
      title = `Statement of Claim${employment?.intake?.client_last_name ? ` re ${employment.intake.client_last_name} v. ${employment.intake.employer_legal_name ?? 'Defendant'}` : ''}`;
    } else if (docType === 'application') {
      const app = matterData.generatedApplication as Record<string, unknown> | undefined;
      if (!app?.html) return reply.status(404).send({ ok: false, error: 'No application generated yet.' });
      html = app.html as string;
      title = (app.formName as string) ?? 'Application';
    } else if (['discovery-plan', 'affidavit-of-documents', 'mediation-brief', 'severance-assessment', 'counter-offer', 'rebuttal-letter', 'reply', 'rule49-offer', 'settlement-minutes', 'retainer-agreement', 'mitigation-log', 'settlement-conference-brief', 'hrto-schedule-a', 'grievance-filing', 'referral-to-arbitration', 'arbitration-brief', 'dfr-response', 'merits-assessment', 'decline-letter', 'member-update', 'remedy-worksheet', 'notice-of-action', 'sj-notice-of-motion', 'sj-affidavit', 'sj-factum', 'sp-timetable-motion', 'consent-timetable-order', 'timetable-order', 'undertakings-answers', 'affidavit-of-service', 'rule49-withdrawal', 'rule49-acceptance', 'costs-outline', 'esa-filing-sheet', 'scc-filing-sheet', 'notice-of-arbitration', 'particulars', 'production-request', 'settlement-memorandum', 'ohsa-reprisal-complaint'].includes(docType)) {
      const key = `generated_${docType.replace(/-/g, '_')}`;
      const litDoc = matterData[key] as Record<string, unknown> | undefined;
      if (!litDoc?.html) return reply.status(404).send({ ok: false, error: `No ${docType.replace(/-/g, ' ')} generated yet.` });
      html = litDoc.html as string;
      title = (litDoc.documentTitle as string) ?? docType.replace(/-/g, ' ');
    } else {
      return reply.status(400).send({ ok: false, error: 'Invalid document type. Use: demand-letter, statement-of-claim, application, discovery-plan, affidavit-of-documents, or mediation-brief.' });
    }

    const docTypeMap: Record<string, string> = {
      'demand-letter': 'demand_letter',
      'statement-of-claim': 'statement_of_claim',
      'application': 'notice_of_application',
      'discovery-plan': 'discovery_plan',
      'affidavit-of-documents': 'affidavit_of_documents',
      'mediation-brief': 'mediation_brief',
      'rebuttal-letter': 'rebuttal_letter',
      'severance-assessment': 'severance_assessment',
      'counter-offer': 'counter_offer',
      'reply': 'reply',
      'rule49-offer': 'rule49_offer',
      'settlement-minutes': 'settlement_minutes',
      'retainer-agreement': 'retainer_agreement',
      'mitigation-log': 'mitigation_log',
      'settlement-conference-brief': 'settlement_conference_brief',
      'hrto-schedule-a': 'hrto_schedule_a',
      'grievance-filing': 'grievance_filing',
      'referral-to-arbitration': 'referral_to_arbitration',
      'arbitration-brief': 'arbitration_brief',
      'dfr-response': 'dfr_response',
      'merits-assessment': 'merits_assessment',
      'decline-letter': 'decline_letter',
      'member-update': 'member_update',
      'remedy-worksheet': 'remedy_worksheet',
      'notice-of-action': 'notice_of_action',
      'notice-of-arbitration': 'notice_of_arbitration',
      'sj-notice-of-motion': 'sj_notice_of_motion',
      'sj-affidavit': 'sj_affidavit',
      'sj-factum': 'sj_factum',
      'sp-timetable-motion': 'sp_timetable_motion',
      'consent-timetable-order': 'consent_timetable_order',
      'timetable-order': 'timetable_order',
      'undertakings-answers': 'undertakings_answers',
      'affidavit-of-service': 'affidavit_of_service',
      'rule49-withdrawal': 'rule49_withdrawal',
      'rule49-acceptance': 'rule49_acceptance',
      'costs-outline': 'costs_outline',
      'esa-filing-sheet': 'esa_filing_sheet',
      'scc-filing-sheet': 'scc_filing_sheet',
      'particulars': 'particulars',
      'production-request': 'production_request',
      'settlement-memorandum': 'settlement_memorandum',
      'ohsa-reprisal-complaint': 'ohsa_reprisal_complaint',
    };

    // An approved review may carry a Word file the reviewer uploaded; that
    // file, not a regeneration from html, is the version of record.
    const canonicalType = docTypeMap[docType] ?? docType.replace(/-/g, '_');
    const docKey = findGeneratedDocKey(matterData, canonicalType);
    const uploaded = docKey ? (matterData[docKey] as Record<string, unknown>).uploadedDocx as { b64?: string; filename?: string } | undefined : undefined;
    if (uploaded?.b64) {
      const safe = `${(uploaded.filename ?? title).replace(/[^a-zA-Z0-9\-_. ]/g, '').trim() || 'document'}`;
      return reply
        .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
        .header('Content-Disposition', `attachment; filename="${safe.endsWith('.docx') ? safe : `${safe}.docx`}"`)
        .send(Buffer.from(uploaded.b64, 'base64'));
    }

    // The lawyer may pick which of the firm's templates for this document
    // type to render on; without one, the type's default is used.
    const { templateVariantId } = (req.query ?? {}) as { templateVariantId?: string };

    const socBacksheetOpt = (docKey ? ((matterData[docKey] as Record<string, unknown>).socBacksheet as DocxExportOptions['socBacksheet'] | undefined) : undefined);
    const buffer = await htmlToDocx(html, {
      socBacksheet: socBacksheetOpt,
      smallClaims: procedure === 'small_claims',
      title,
      firmName,
      lawyerName,
      firmAddress,
      matterNumber: fileNumber,
      courtName,
      firmId,
      documentType: docTypeMap[docType],
      templateVariantId,
      // The demand figure and recipient belong to the demand letter, and
      // come from the stored letter, not the matter-wide last-generated
      // value that bled into every document type's {{AMOUNT}} marker.
      demandAmount: docType === 'demand-letter' ? ((genDL?.demandAmount as number | undefined) ?? employment?.demandAmount ?? null) : null,
      recipientName: docType === 'demand-letter' ? (genDL?.recipientName as string | undefined) : undefined,
      responseDeadlineDays: docType === 'demand-letter' ? (genDL?.responseDeadlineDays as number | undefined) : undefined,
      intake: employment?.intake ? {
        client_first_name: employment.intake.client_first_name ?? undefined,
        client_last_name: employment.intake.client_last_name ?? undefined,
        client_address: employment.intake.client_address ?? undefined,
        employer_legal_name: employment.intake.employer_legal_name ?? undefined,
        employer_address: employment.intake.employer_address ?? undefined,
        job_title: employment.intake.job_title ?? undefined,
        hire_date: employment.intake.hire_date ?? undefined,
        termination_date: employment.intake.termination_date ?? undefined,
        annual_salary: employment.intake.annual_salary ?? undefined,
      } : undefined,
    });

    const filename = `${title.replace(/[^a-zA-Z0-9\-_ ]/g, '').trim()}.docx`;

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.wordprocessingml.document')
      .header('Content-Disposition', `attachment; filename="${filename}"`)
      .send(buffer);
  });
}
