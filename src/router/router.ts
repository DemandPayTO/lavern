/**
 * The Router — Classifies requests and selects the minimum viable workflow.
 *
 * v5: Deterministic classification rules.
 * v6: Two-tier routing — LLM-based with deterministic fallback.
 *
 * The Router:
 * 1. Reads the request (type, document path, text, context)
 * 2. Reads the available workflows from the registry
 * 3. Classifies the request using the LLM (or deterministic fallback)
 * 4. Validates the selected workflow exists
 * 5. Returns a RouterClassification with the selected workflow and specialists
 *
 * Falls back to deterministic rules if:
 * - LLM call fails for any reason
 * - LLM selects a non-existent workflow
 * - useLlm option is set to false
 */

import { query } from '@anthropic-ai/claude-agent-sdk';
import type { LegalRequest, RouterClassification } from '../types/index.js';
import type { SessionState } from '../session/session-state.js';
import { workflowRegistry } from '../workflows/registry.js';
import { routerPrompt } from './router-prompt.js';
import { RouterClassificationSchema } from './router-schema.js';
import { zodToOutputFormat } from '../types/output-schemas.js';
import { eventTimestamp } from '../events/event-bus.js';
import { config } from '../config.js';
import { createLogger } from '../utils/logger.js';
import { mistralChat } from '../providers/mistral.js';

const logger = createLogger('ROUTER');

// Ensure templates are registered
import '../workflows/index.js';

/**
 * Canonical workflow IDs.
 *
 * v12: Legacy templates (simple-query, contract-review, research-memo) removed.
 * The v11 names are now the canonical IDs. No mapping needed — the LLM output
 * matches the registry directly.
 */
const CANONICAL_WORKFLOWS = new Set([
  'counsel', 'review', 'adversarial', 'full-bench',
  'legal-design', 'pre-engagement', 'verification',
]);

export interface RouterOptions {
  /** Use LLM-based routing (default: true). Set to false for deterministic-only. */
  useLlm?: boolean;
  /** Model to use for LLM routing (default: claude-sonnet-4-5) */
  model?: string;
  /** v18: Per-session provider override. */
  provider?: 'anthropic' | 'mistral' | 'managed';
}

/**
 * Classify a request and select the appropriate workflow.
 *
 * Two-tier approach:
 * 1. If useLlm is true (default), try LLM-based classification
 * 2. If LLM fails or useLlm is false, use deterministic fallback
 * 3. Validate the selected workflow exists in the registry
 */
export async function routeRequest(
  request: LegalRequest,
  session: SessionState,
  options?: RouterOptions,
): Promise<RouterClassification> {

  let classification: RouterClassification;
  let routingMethod: 'llm' | 'deterministic' = 'deterministic';

  if (options?.useLlm !== false) {
    // Try LLM-based routing (provider-aware)
    // v18: Per-session provider override (options > global config)
    const provider = options?.provider ?? config.provider;
    try {
      const llmResult = provider === 'mistral'
        ? await mistralClassify(request)
        : await llmClassify(request, options?.model);

      // Validate the LLM's selected workflow actually exists
      const template = workflowRegistry.get(llmResult.selectedWorkflow);
      if (template) {
        classification = llmResult;
        routingMethod = 'llm';
      } else {
        // LLM hallucinated a workflow — fall back to deterministic
        logger.warn('llm_unknown_workflow', llmResult.selectedWorkflow);
        classification = classifyRequest(request);
      }
    } catch (err) {
      // LLM call failed — fall back to deterministic
      logger.warn('llm_classification_failed', err instanceof Error ? err.message : err);
      classification = classifyRequest(request);
    }
  } else {
    // Deterministic-only
    classification = classifyRequest(request);
  }

  // Store on the request for downstream use
  request.routerClassification = classification;

  // Emit routing decision event
  session.events.emitEvent({
    type: 'routing_decision',
    requestType: classification.requestType,
    selectedWorkflow: classification.selectedWorkflow,
    complexity: classification.complexity,
    reasoning: `[${routingMethod}] ${classification.reasoning}`,
    timestamp: eventTimestamp(),
  });

  return classification;
}

/**
 * LLM-based classification — calls the model with structured output.
 *
 * Uses query() with the RouterClassificationSchema as outputFormat.
 * Single-turn, no tools, no agents. Fast and cheap (~$0.01 per call).
 */
async function llmClassify(
  request: LegalRequest,
  model?: string,
): Promise<RouterClassification> {
  const workflowSummary = workflowRegistry.getSummaryForRouter();

  const userPrompt = buildRouterUserPrompt(request);

  const systemPromptText = `${routerPrompt}\n\n## Currently Registered Workflows\n\n${workflowSummary}`;

  const result = query({
    prompt: userPrompt,
    options: {
      systemPrompt: systemPromptText,
      model: model ?? 'claude-sonnet-4-5',
      maxTurns: 1,
      outputFormat: zodToOutputFormat(RouterClassificationSchema),
    },
  });

  // Consume the async generator to get the result
  let classificationResult: RouterClassification | null = null;

  for await (const message of result) {
    if ('type' in message && message.type === 'result') {
      const resultMessage = message as Record<string, unknown>;
      if (resultMessage.subtype === 'success' && resultMessage.structured_output) {
        // Parse and validate the structured output
        const parsed = RouterClassificationSchema.safeParse(resultMessage.structured_output);
        if (parsed.success) {
          classificationResult = parsed.data;
        }
      }
    }
  }

  if (!classificationResult) {
    throw new Error('LLM router did not return a valid classification');
  }

  return classificationResult;
}

/**
 * Mistral-based classification — uses chat completion with JSON output.
 *
 * Mistral doesn't support structured output schemas like the Agent SDK,
 * so we ask for JSON in the prompt and parse the response.
 */
async function mistralClassify(
  request: LegalRequest,
): Promise<RouterClassification> {
  const workflowSummary = workflowRegistry.getSummaryForRouter();
  const userPrompt = buildRouterUserPrompt(request);

  const systemPromptText = `${routerPrompt}\n\n## Currently Registered Workflows\n\n${workflowSummary}\n\nRespond with ONLY valid JSON matching the RouterClassification schema. No other text.`;

  const result = await mistralChat({
    model: config.mistral.routerModel,
    messages: [
      { role: 'system', content: systemPromptText },
      { role: 'user', content: userPrompt },
    ],
    temperature: 0.1,
    maxTokens: 500,
  });

  const content = result.message.content ?? '';

  // Extract JSON from response
  const jsonMatch = content.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    throw new Error('Mistral router did not return valid JSON');
  }

  let jsonObj: unknown;
  try {
    jsonObj = JSON.parse(jsonMatch[0]);
  } catch {
    throw new Error('Mistral router returned malformed JSON');
  }

  const parsed = RouterClassificationSchema.safeParse(jsonObj);
  if (!parsed.success) {
    throw new Error(`Mistral router returned invalid classification: ${parsed.error.message}`);
  }

  return parsed.data;
}

/**
 * Build the user prompt for the Router from a LegalRequest.
 */
function buildRouterUserPrompt(request: LegalRequest): string {
  const parts: string[] = ['Classify this request:\n'];

  parts.push(`**Request Type**: ${request.type}`);

  if (request.documentPath) {
    parts.push(`**Document**: ${request.documentPath}`);
  }

  if (request.requestText) {
    parts.push(`**Request Text**: ${request.requestText}`);
  }

  if (request.matterId) {
    parts.push(`**Matter ID**: ${request.matterId} (existing client matter — check consistency)`);
  }

  if (request.context) {
    const ctx = request.context;
    if (ctx.moment) parts.push(`**Moment**: ${ctx.moment}`);
    if (ctx.audience) parts.push(`**Audience**: ${ctx.audience}`);
    if (ctx.jurisdiction) parts.push(`**Jurisdiction**: ${ctx.jurisdiction}`);
    if (ctx.documentType) parts.push(`**Document Type**: ${ctx.documentType}`);
    if (ctx.focus) parts.push(`**Focus**: ${ctx.focus}`);
  }

  parts.push('\nReturn your classification as structured JSON.');

  return parts.join('\n');
}

/**
 * Deterministic classification rules — matches the Router prompt's decision matrix.
 * This is the fallback when no LLM is available, and the primary classifier
 * during testing.
 */
export function classifyRequest(request: LegalRequest): RouterClassification {
  const text = (request.requestText ?? '').toLowerCase();

  // Rule 1: Intake analysis — client uploads transcript or intake notes
  if (request.type === 'intake_analysis' || text.includes('intake') || text.includes('transcript')) {
    return {
      requestType: 'single_specialist',
      complexity: 'low',
      riskLevel: 'low',
      selectedWorkflow: 'counsel',
      selectedSpecialists: ['employment-counsel', 'tabulate', 'junior-associate'],
      requiresDebate: false,
      requiresEthicsFirst: false,
      requiresConsistencyCheck: !!request.matterId,
      reasoning: 'Intake analysis uses counsel pipeline with employment counsel lead, tabulate for data extraction, junior associate for fact organization.',
    };
  }

  // Rule 2: Employment agreement review — client uploads employment contract
  if (request.type === 'contract_review' || request.type === 'employment_agreement') {
    return {
      requestType: 'single_specialist',
      complexity: 'medium',
      riskLevel: 'medium',
      selectedWorkflow: 'review',
      selectedSpecialists: ['contract-reviewer', 'contract-specialist', 'employment-counsel'],
      requiresDebate: false,
      requiresEthicsFirst: false,
      requiresConsistencyCheck: !!request.matterId,
      reasoning: 'Employment agreement review: broad scan by reviewer, deep clause analysis by specialist, employment law assessment by counsel.',
    };
  }

  // Rule 3: Demand letter generation
  if (request.type === 'demand_letter' || text.includes('demand letter')) {
    return {
      requestType: 'adversarial',
      complexity: 'high',
      riskLevel: 'high',
      selectedWorkflow: 'adversarial',
      selectedSpecialists: ['employment-counsel', 'litigation-associate', 'red-team', 'synthesis-editor'],
      requiresDebate: true,
      requiresEthicsFirst: false,
      requiresConsistencyCheck: !!request.matterId,
      reasoning: 'Demand letter uses adversarial pipeline: employment counsel drafts, red team attacks from employer perspective, synthesis editor resolves.',
    };
  }

  // Rule 4: Statement of claim generation
  if (
    request.type === 'statement_of_claim'
    || text.includes('statement of claim')
    || text.includes('soc')
  ) {
    return {
      requestType: 'adversarial',
      complexity: 'high',
      riskLevel: 'high',
      selectedWorkflow: 'adversarial',
      selectedSpecialists: ['employment-counsel', 'litigation-partner', 'litigation-associate', 'paralegal', 'red-team'],
      requiresDebate: true,
      requiresEthicsFirst: false,
      requiresConsistencyCheck: !!request.matterId,
      reasoning: 'SOC uses adversarial pipeline with full litigation team. Paralegal checks procedural compliance.',
    };
  }

  // Rule 5: Settlement / mediation analysis
  if (
    request.type === 'settlement'
    || request.type === 'mediation'
    || text.includes('settlement')
    || text.includes('mediation')
  ) {
    return {
      requestType: 'multi_specialist',
      complexity: 'medium',
      riskLevel: 'medium',
      selectedWorkflow: 'counsel',
      selectedSpecialists: ['dispute-resolution', 'employment-counsel', 'litigation-partner'],
      requiresDebate: false,
      requiresEthicsFirst: false,
      requiresConsistencyCheck: !!request.matterId,
      reasoning: 'Settlement analysis uses counsel pipeline with dispute resolution lead.',
    };
  }

  // Rule 6: Case assessment — general "what are my options" type questions
  if (request.type === 'case_assessment' || request.type === 'risk_assessment' || request.type === 'legal_question') {
    return {
      requestType: 'direct_answer',
      complexity: 'low',
      riskLevel: 'low',
      selectedWorkflow: 'counsel',
      selectedSpecialists: ['employment-counsel', 'evaluator'],
      requiresDebate: false,
      requiresEthicsFirst: false,
      requiresConsistencyCheck: !!request.matterId,
      reasoning: 'Quick case assessment uses counsel pipeline with employment counsel.',
    };
  }

  // Rule 7: Document with upload (fallback for any document upload)
  if (request.documentPath) {
    return {
      requestType: 'single_specialist',
      complexity: 'medium',
      riskLevel: 'medium',
      selectedWorkflow: 'review',
      selectedSpecialists: ['employment-counsel', 'contract-reviewer', 'evaluator'],
      requiresDebate: false,
      requiresEthicsFirst: false,
      requiresConsistencyCheck: !!request.matterId,
      reasoning: 'Document uploaded — defaulting to employment law review.',
    };
  }

  // Default fallback
  return {
    requestType: 'direct_answer',
    complexity: 'low',
    riskLevel: 'low',
    selectedWorkflow: 'counsel',
    selectedSpecialists: ['employment-counsel'],
    requiresDebate: false,
    requiresEthicsFirst: false,
    requiresConsistencyCheck: false,
    reasoning: 'General employment law question — counsel pipeline with employment counsel.',
  };
}

/**
 * Get the Router prompt with available workflow context.
 * Used when wiring the LLM-based router.
 */
export function getRouterPromptWithContext(): string {
  const workflowSummary = workflowRegistry.getSummaryForRouter();
  return `${routerPrompt}\n\n## Available Workflows\n\n${workflowSummary}`;
}
