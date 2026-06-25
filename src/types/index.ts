/**
 * Shared types for The Shem multi-agent system.
 *
 * v2: Added multidisciplinary agent roles, operational
 * confidence scoring, tiered human review.
 */

export type Severity = 'RED' | 'YELLOW' | 'GREEN';

export type RiskLevel = 'Low' | 'REVIEW' | 'CRITICAL';

export type Audience = 'consumer' | 'smb' | 'enterprise' | 'employee';

export type Jurisdiction = 'US' | 'EU' | 'UK' | 'CA' | 'AU';

export type Moment = 'signup' | 'checkout' | 'exit' | 'dispute' | 'renewal' | 'onboarding' | 'routine';

export type AgentRole =
  | 'orchestrator'
  | 'design-reviewer'
  | 'synthesis-editor'
  // Multidisciplinary agents (v2)
  | 'service-designer'
  | 'plain-language-specialist'
  // v5: Adaptive pipeline roles
  | 'router'
  | 'evaluator'
  | 'contract-reviewer'
  // v6: Legal core, risk, and adversarial roles
  | 'legal-researcher'
  | 'red-team'
  // v8: Law Firm — Corporate & Transactional
  | 'contract-specialist'
  // v8: Law Firm — Disputes & Litigation (4)
  | 'litigation-partner'
  | 'litigation-associate'
  | 'arbitration-specialist'
  | 'dispute-resolution'
  // v8: Law Firm — Specialist Practice
  | 'privacy-counsel'
  | 'employment-counsel'
  // v8: Law Firm — Junior Talent
  | 'junior-associate'
  | 'paralegal'
  // v8: Experts — User Research & Testing
  | 'accessibility-specialist'
  | 'user-researcher'
  | 'behavioral-scientist'
  // v8: Experts — Technology & Data
  | 'legal-engineer'
  | 'ai-ethics-specialist';

// ── v5: Request & Routing Types ──────────────────────────────────────────

/**
 * A legal request — the universal input to the firm.
 * Replaces the document-only input model.
 */
export interface LegalRequest {
  type: 'document_redesign' | 'contract_review' | 'legal_question' | 'legal_research' | 'risk_assessment' | 'general'
    | 'intake_analysis' | 'employment_agreement' | 'demand_letter' | 'statement_of_claim'
    | 'settlement' | 'mediation' | 'case_assessment';
  /** Document path — required for document_redesign/contract_review */
  documentPath?: string;
  /** Free-form request text — for questions, instructions, descriptions */
  requestText?: string;
  /** Context — reuses existing DocumentContext fields */
  context?: Partial<DocumentContext>;
  /** Client/matter identifier for consistency checks */
  matterId?: string;
  /** Classification from the router (set after routing) */
  routerClassification?: RouterClassification;
}

/**
 * The Router's structured classification of a request.
 * Determines which workflow template and specialists to use.
 */
export interface RouterClassification {
  requestType: 'direct_answer' | 'single_specialist' | 'multi_specialist' | 'full_pipeline' | 'debate_pattern' | 'adversarial' | 'hierarchical';
  complexity: 'low' | 'medium' | 'high';
  riskLevel: 'low' | 'medium' | 'high';
  selectedWorkflow: string;
  selectedSpecialists: string[];
  requiresDebate: boolean;
  requiresEthicsFirst: boolean;
  requiresConsistencyCheck: boolean;
  reasoning: string;
}

export interface DocumentContext {
  moment: Moment;
  audience: Audience;
  jurisdiction: Jurisdiction;
  documentType?: string;
  focus?: string;
}

export interface DimensionScore {
  dimension: 'readability' | 'findability' | 'clarity' | 'visual-design' | 'ethics';
  score: number;
  classification: Severity;
  evidence: string[];
  notes: string;
}

export interface ComplexityTax {
  wordCount: number;
  fkGrade: number;
  difficultyMultiplier: number;
  rereadFactor: number;
  minutesPerReader: number;
  currentTax: number;
  achievableTax: number;
}

export interface ChangeLogEntry {
  number: number;
  section: string;
  original: string;
  transformed: string;
  intent: string;
  risk: RiskLevel;
}

export interface AmbiguityFlag {
  number: number;
  section: string;
  topic: string;
  original: string;
  transformed: string;
  concern: string;
  recommendation: string;
}

export interface NonNegotiableCheck {
  element: string;
  category: 'amounts' | 'time' | 'jurisdiction' | 'mechanisms' | 'definitions' | 'insurance' | 'compliance';
  originalValue: string;
  preserved: boolean;
  notes: string;
}

export interface HumanGateDecision {
  gateType: 'ethics_critical' | 'meaning_critical' | 'final_delivery' | 'engagement_acceptance' | 'team_selection';
  timestamp: string;
  summary: string;
  decision: 'approve' | 'reject' | 'modify';
  notes?: string;
}

/**
 * Confidence scoring — operational signals, not self-reported.
 *
 * Don't ask the model "how sure are you?" — measure:
 * - Retrieval quality (source authority, recency)
 * - Source agreement (cross-reference consistency)
 * - Validation success (schema/citation verification)
 * - Tool reliability (API success rates)
 * - Self-consistency (agreement across checks)
 */
export interface ConfidenceSignals {
  retrievalQuality: number;
  sourceAgreement: number;
  validationSuccess: number;
  toolReliability: number;
  selfConsistency: number;
}

export function computeOverallConfidence(signals: ConfidenceSignals): number {
  const weights = {
    retrievalQuality: 0.2,
    sourceAgreement: 0.25,
    validationSuccess: 0.25,
    toolReliability: 0.15,
    selfConsistency: 0.15,
  };
  return (
    signals.retrievalQuality * weights.retrievalQuality +
    signals.sourceAgreement * weights.sourceAgreement +
    signals.validationSuccess * weights.validationSuccess +
    signals.toolReliability * weights.toolReliability +
    signals.selfConsistency * weights.selfConsistency
  );
}

/**
 * Confidence tiers for routing human review:
 * >0.90 = auto-approve with audit note
 * 0.70-0.90 = quick human review
 * <0.70 = full human review with context
 */
export type ConfidenceTier = 'high' | 'medium' | 'low';

export function getConfidenceTier(confidence: number): ConfidenceTier {
  if (confidence > 0.90) return 'high';
  if (confidence >= 0.70) return 'medium';
  return 'low';
}
