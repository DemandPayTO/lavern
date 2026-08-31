/**
 * Employment routes — the mediation brief outline (section by section).
 *
 * The mediation brief's narrative is model-written in sections around the
 * deterministic tables, so it follows the factum pattern: draft each section,
 * read it, edit it, approve it, then assemble. The standard section set is
 * used so the outline, draft, and assemble paths key off the same ids.
 */

import type { FastifyInstance, FastifyRequest, FastifyReply } from 'fastify';
import { z } from 'zod';
import { documentSources, documentSourcesText } from './document-sources.js';
import { getMatterById } from '../../../db/database.js';
import { loadEmploymentData, saveEmploymentData, logger } from './shared.js';
import { mediationSections, buildMediationOutline } from '../../../employment/mediation-outline.js';
import type { MediationDraftState } from '../../../employment/mediation-outline.js';

/** The state of play from the negotiation ledger, as prompt lines. */
async function negotiationStateText(matter: Record<string, unknown>, employment: { analysis?: import('../../../types/employment-intake.js').IntakeAnalysisResult | null }): Promise<string | undefined> {
  const entries = (matter.negotiation ?? null) as import('../../../employment/negotiation.js').NegotiationEntry[] | null;
  if (!entries?.length) return undefined;
  try {
    const { summarizeNegotiation } = await import('../../../employment/negotiation.js');
    const dmg = employment.analysis?.damagesEstimate;
    const ns = summarizeNegotiation(entries, {
      esaTotalCad: dmg ? (dmg.esaNoticePay ?? 0) + (dmg.esaSeverancePay ?? 0) : null,
      commonLawLowCad: dmg?.totalEstimateLow ?? null,
      commonLawHighCad: dmg?.totalEstimateHigh ?? null,
    });
    if (!ns.latestEmployerOffer) return undefined;
    const lines = [`- The employer's latest offer: $${ns.latestEmployerOffer.amountCad.toLocaleString('en-CA')} (${ns.latestEmployerOffer.date})`];
    if (ns.latestClientPosition) lines.push(`- The plaintiff's latest position: $${ns.latestClientPosition.amountCad.toLocaleString('en-CA')} (${ns.latestClientPosition.kind}, ${ns.latestClientPosition.date})`);
    if (ns.offerVsRange?.gapToLowCad != null) lines.push(`- Gap to the low end of the assessed range: $${ns.offerVsRange.gapToLowCad.toLocaleString('en-CA')}`);
    return lines.join('\n');
  } catch { return undefined; }
}

/** The matter's positions (demand letter, statement of claim) as plain text. */
/**
 * Drafted section by section, the brief reads exactly what it reads when it is
 * drafted whole. It did not: this passed `extraSources: []`, so every document
 * the lawyer attached was dropped on the section path while the whole-document
 * path read all six. The lawyer saw a brief that ignored the file and had no
 * way to tell why.
 */
function positionsText(matter: Record<string, unknown>, briefSourceIds?: string[]): string | undefined {
  try {
    const { sources } = documentSources(matter, {
      documentType: 'mediation_brief',
      briefSourceIds,
    });
    return documentSourcesText(sources);
  } catch { return undefined; }
}

export function registerMediationSectionRoutes(fastify: FastifyInstance): void {

  fastify.get('/api/employment/:matterId/mediation-outline', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter } = loadEmploymentData(row.data_json);
    const draft = ((matter as Record<string, unknown>).mediationDraft ?? undefined) as MediationDraftState | undefined;
    return reply.send({ ok: true, sections: buildMediationOutline(mediationSections(), draft) });
  });

  fastify.post('/api/employment/:matterId/mediation-section/draft', async (req: FastifyRequest, reply: FastifyReply) => {
    const userId = (req as { userId?: string }).userId ?? 'local-user';
    const { matterId } = req.params as { matterId: string };
    const parsed = z.object({
      sectionId: z.string().trim().min(1).max(60),
      claimAmount: z.number().positive().max(99_999_999).optional(),
      /** The documents the lawyer ticked, so a section reads what the whole
       *  brief reads. */
      briefSourceIds: z.array(z.string().max(60)).max(8).optional(),
    }).safeParse(req.body);
    if (!parsed.success) return reply.status(400).send({ ok: false, error: 'Name the section to draft.' });

    const row = await getMatterById(matterId, userId);
    if (!row) return reply.status(404).send({ ok: false, error: 'Matter not found' });
    const { matter, employment } = loadEmploymentData(row.data_json);
    if (!employment.intake || !employment.analysis) {
      return reply.status(400).send({ ok: false, error: 'Complete intake and run analysis before drafting the brief.' });
    }
    const sec = mediationSections().find(s => s.id === parsed.data.sectionId);
    if (!sec) return reply.status(400).send({ ok: false, error: 'That section is not in the brief.' });

    const { generateMediationSection } = await import('../../../employment/mediation-section-generator.js');
    let result;
    try {
      result = await generateMediationSection({
        header: sec.header,
        guidance: sec.guidance,
        intake: employment.intake,
        analysis: employment.analysis,
        approvedIssues: employment.approvedIssues ?? [],
        claimAmount: parsed.data.claimAmount,
        negotiationStateText: await negotiationStateText(matter as Record<string, unknown>, employment),
        positionsText: positionsText(matter as Record<string, unknown>, parsed.data.briefSourceIds),
      });
    } catch (err) {
      logger.error('Mediation section draft failed', { matterId, sectionId: parsed.data.sectionId, error: err instanceof Error ? err.message : String(err) });
      return reply.status(502).send({ ok: false, error: 'This section could not be drafted. Please try again.' });
    }

    // The model's HTML is rendered in the dashboard via dangerouslySetInnerHTML
    // and its facts can originate from the public intake portal, so the drafted
    // section passes the same allowlist as a section the lawyer edits by hand.
    const { sanitiseReviewHtml } = await import('../../../employment/document-reviews.js');
    const cleanHtml = sanitiseReviewHtml(result.html);
    const draft = ((matter as Record<string, unknown>).mediationDraft ?? { sections: {} }) as MediationDraftState;
    if (!draft.sections) draft.sections = {};
    draft.sections[parsed.data.sectionId] = { html: cleanHtml, approved: false, generatedAt: new Date().toISOString(), reviewFlags: result.reviewFlags };
    (matter as Record<string, unknown>).mediationDraft = draft;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true, sectionId: parsed.data.sectionId, html: cleanHtml, reviewFlags: result.reviewFlags, costUsd: result.costUsd });
  });

  fastify.put('/api/employment/:matterId/mediation-section', async (req: FastifyRequest, reply: FastifyReply) => {
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
    const draft = ((matter as Record<string, unknown>).mediationDraft ?? { sections: {} }) as MediationDraftState;
    if (!draft.sections) draft.sections = {};

    if (action === 'clear') {
      delete draft.sections[sectionId];
      (matter as Record<string, unknown>).mediationDraft = draft;
      await saveEmploymentData(userId, matterId, matter, employment);
      return reply.send({ ok: true, sectionId, cleared: true });
    }

    const sec = draft.sections[sectionId];
    if (!sec) return reply.status(400).send({ ok: false, error: 'Draft this section before approving it.' });

    if (action === 'approve') { sec.approved = true; }
    else if (action === 'unapprove') { sec.approved = false; }
    else if (action === 'save') {
      if (!parsed.data.html || !parsed.data.html.trim()) {
        return reply.status(400).send({ ok: false, error: 'The edited section is empty. Add text or discard it.' });
      }
      const { sanitiseReviewHtml } = await import('../../../employment/document-reviews.js');
      const { mediationSectionReviewFlags } = await import('../../../employment/mediation-section-generator.js');
      const clean = sanitiseReviewHtml(parsed.data.html.trim());
      sec.html = clean;
      sec.reviewFlags = mediationSectionReviewFlags(clean);
      sec.approved = false;
      sec.generatedAt = new Date().toISOString();
    }
    (matter as Record<string, unknown>).mediationDraft = draft;
    await saveEmploymentData(userId, matterId, matter, employment);
    return reply.send({ ok: true, sectionId, approved: sec.approved, html: sec.html, reviewFlags: sec.reviewFlags ?? [] });
  });
}
