/**
 * Employment Intake Routes — Lawyer-facing intake for Ontario employment law matters.
 *
 * Routes:
 *   POST /api/employment/intake          — Save/update structured intake data on a matter
 *   POST /api/employment/extract         — Upload a document, extract facts via Claude
 *   POST /api/employment/analyze         — Run full analysis (timeline, gates, damages, Bardal, procedure)
 *   GET  /api/employment/:matterId       — Get employment data for a matter
 *   POST /api/employment/:matterId/issues — Approve/dismiss legal issues
 *   POST /api/employment/:matterId/timeline — Add a manual timeline event
 *
 * All routes require authentication (via auth middleware on the server).
 * Employment data is stored as JSON on the matter record (matter.data_json).
 */

import type { FastifyInstance } from 'fastify';
import { registerIntakeRoutes } from './employment/intake.js';
import { registerNegotiationRoutes } from './employment/negotiation.js';
import { registerDebriefRoutes } from './employment/debrief.js';
import { registerCaseAnalysisRoutes } from './employment/case-analysis.js';
import { registerExtractionRoutes } from './employment/extraction.js';
import { registerGeneratorRoutes } from './employment/generators.js';
import { registerDraftRoutes } from './employment/drafts.js';
import { registerSourceRoutes } from './employment/sources.js';
import { registerSocNodeRoutes } from './employment/soc-nodes.js';
import { registerFactumNodeRoutes } from './employment/factum-nodes.js';
import { registerReadinessRoutes } from './employment/readiness.js';
import { registerStyleTemplateRoutes } from './employment/style-templates.js';
import { registerRevisionRoutes } from './employment/revision.js';
import { registerMiscRoutes } from './employment/misc.js';

// Re-export the shared public helpers so existing importers keep working.
export {
  resolveFirmId,
  sanitiseHtml,
  loadEmploymentData,
  saveEmploymentData,
  backfillIntakeIdentity,
  findGeneratedDocKey,
  collectGeneratedDocuments,
  DOCUMENT_STATUSES,
} from './employment/shared.js';

// ── Route registration ───────────────────────────────────────────────────
// Composes the per-domain route modules. See docs/CODEMAP.md for the map.

export function registerEmploymentIntakeRoutes(fastify: FastifyInstance): void {
  registerIntakeRoutes(fastify);
  registerNegotiationRoutes(fastify);
  registerDebriefRoutes(fastify);
  registerCaseAnalysisRoutes(fastify);
  registerExtractionRoutes(fastify);
  registerGeneratorRoutes(fastify);
  registerDraftRoutes(fastify);
  registerSourceRoutes(fastify);
  registerSocNodeRoutes(fastify);
  registerFactumNodeRoutes(fastify);
  registerReadinessRoutes(fastify);
  registerStyleTemplateRoutes(fastify);
  registerRevisionRoutes(fastify);
  registerMiscRoutes(fastify);
}
