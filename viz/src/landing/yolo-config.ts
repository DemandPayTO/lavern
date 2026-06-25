/**
 * YOLO Express Lane — tier configurations.
 *
 * Three service levels for the client who trusts the machine:
 *   Counsel:     solo expert, direct answer, medium effort, $10 budget
 *   Review:      dedicated team, debate + quality checks, max effort, $40 budget
 *   Full Bench:  every specialist, senior oversight at both ends, max effort, $125 budget
 *
 * All set yoloMode: true (auto-approve all gates).
 *
 * The `effort` field maps to Claude's API effort parameter:
 *   'medium' = balanced token spend (counsel tier)
 *   'max'    = no token limits, deepest reasoning (Opus 4.7 only)
 */

export type YoloTier = 'standard' | 'white-shoe' | 'elite';

export type EffortLevel = 'low' | 'medium' | 'high' | 'max';

export interface YoloConfig {
  tier: YoloTier;
  label: string;
  workflowId: string;
  requestType: string;
  intensity: string;
  /** Claude API effort level — controls thinking depth and token spend */
  effort: EffortLevel;
  budgetUsd: number;
  yoloMode: true;
  teamPreset: string;
  teamSize: number;
  teamRoles: string[];
}

/**
 * Team roles are from DEMO_PRESETS in staffing/data/demoProfiles.ts.
 * Counsel = 1 dispatched, Review = 14 agents, Full Bench = 23 agents.
 */
export const YOLO_CONFIGS: Record<YoloTier, YoloConfig> = {
  standard: {
    tier: 'standard',
    label: 'Counsel',
    workflowId: 'counsel',
    requestType: 'legal_question',
    intensity: 'standard',
    effort: 'medium',
    budgetUsd: 10,
    yoloMode: true,
    teamPreset: 'balanced',
    teamSize: 8,
    teamRoles: [
      'litigation-partner', 'contract-specialist', 'junior-associate',
      'plain-language-specialist', 'evaluator', 'contract-reviewer',
    ],
  },
  'white-shoe': {
    tier: 'white-shoe',
    label: 'Review',
    workflowId: 'review',
    requestType: 'contract_review',
    intensity: 'maximal',
    effort: 'max',
    budgetUsd: 40,
    yoloMode: true,
    teamPreset: 'full-service',
    teamSize: 12,
    teamRoles: [
      'litigation-partner', 'contract-specialist', 'contract-reviewer',
      'privacy-counsel', 'service-designer', 'plain-language-specialist',
      'evaluator', 'red-team',
    ],
  },
  elite: {
    tier: 'elite',
    label: 'Full Bench',
    workflowId: 'full-bench',
    requestType: 'general',
    intensity: 'maximum',
    effort: 'max',
    budgetUsd: 125,
    yoloMode: true,
    teamPreset: 'elite',
    teamSize: 21,
    teamRoles: [
      // Senior
      'litigation-partner', 'contract-reviewer',
      // Practice specialists
      'contract-specialist', 'privacy-counsel', 'employment-counsel',
      'litigation-associate', 'arbitration-specialist',
      // Design & accessibility
      'service-designer', 'plain-language-specialist', 'design-reviewer',
      // Advisory & risk
      'ai-ethics-specialist', 'red-team',
      // Operations & control
      'evaluator', 'synthesis-editor',
      // Research & support
      'legal-researcher', 'junior-associate',
    ],
  },
};
