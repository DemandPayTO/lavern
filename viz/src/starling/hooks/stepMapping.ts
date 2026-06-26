/**
 * stepMapping.ts — Translates agent events into human-readable step labels.
 * The lawyer sees "Stress-testing from employer's perspective", not "red-team agent".
 */

// Agent role → human-readable step label
export const AGENT_STEP_LABELS: Record<string, string> = {
  'employment-counsel': 'Analysing your case',
  'contract-reviewer': 'Reviewing employment agreement',
  'contract-specialist': 'Analysing termination clause',
  'litigation-partner': 'Assessing litigation strategy',
  'litigation-associate': 'Calculating entitlements',
  'red-team': 'Stress-testing from employer\'s perspective',
  'synthesis-editor': 'Strengthening the document',
  'evaluator': 'Running quality checks',
  'paralegal': 'Checking procedural compliance',
  'plain-language-specialist': 'Ensuring clarity',
  'dispute-resolution': 'Analysing settlement options',
  'junior-associate': 'Extracting facts from documents',
  'arbitration-specialist': 'Reviewing tribunal options',
  'legal-researcher': 'Checking statutory requirements',
  'client-relations-partner': 'Preparing client summary',
  'ethics-reviewer': 'Checking compliance requirements',
};

// Workflow step → human-readable step label
export const WORKFLOW_STEP_LABELS: Record<string, string> = {
  'intake': 'Reading your documents',
  'specialist_analysis': 'Identifying legal issues',
  'build': 'Drafting the document',
  'attack': 'Stress-testing from employer\'s perspective',
  'synthesize': 'Strengthening weak points',
  'evaluator_gate': 'Running quality checks',
  'plain_language_review': 'Ensuring clarity',
  'verification_pipeline': 'Verifying accuracy (8 checks)',
  'report_compilation': 'Compiling results',
  'final_gate': 'Final quality review',
  'delivered': 'Complete',
  'decomposition': 'Breaking down the issues',
  'workstream_execution': 'Analysing each issue',
  'senior_review': 'Senior review',
  'synthesis': 'Combining analysis',
  'verification': 'Verifying accuracy',
};

// Source attribution tag config
export interface SourceTag {
  label: string;
  colour: string;
  trustLevel: 'high' | 'medium' | 'low';
}

export const SOURCE_TAGS: Record<string, SourceTag> = {
  'statute': { label: 'Verified statute', colour: '#16a34a', trustLevel: 'high' },
  'case_db': { label: 'Verified case law', colour: '#16a34a', trustLevel: 'high' },
  'firm_case': { label: 'Firm library', colour: '#0f1a2e', trustLevel: 'medium' },
  'ai_knowledge': { label: 'AI knowledge', colour: '#d97706', trustLevel: 'medium' },
  'web_search': { label: 'Web source — verify', colour: '#dc2626', trustLevel: 'low' },
};

// Finding severity → display config
export const SEVERITY_CONFIG = {
  RED: { label: 'Critical', colour: '#dc2626', bgColour: '#fce8e6' },
  YELLOW: { label: 'Moderate', colour: '#d97706', bgColour: '#fdf0dd' },
  GREEN: { label: 'Strong', colour: '#16a34a', bgColour: '#e7f6ec' },
} as const;

// Map a finding's evidence string to a source type
export function inferSourceType(evidence: string): string {
  if (!evidence) return 'ai_knowledge';
  const lower = evidence.toLowerCase();
  if (lower.includes('[source_type: statute]') || lower.includes('esa s.') || lower.includes('hrc s.')) return 'statute';
  if (lower.includes('[source_type: case_db]') || lower.includes('onca') || lower.includes('scc')) return 'case_db';
  if (lower.includes('[source_type: firm_case]')) return 'firm_case';
  if (lower.includes('[source_type: web_search]') || lower.includes('canlii.org')) return 'web_search';
  return 'ai_knowledge';
}
