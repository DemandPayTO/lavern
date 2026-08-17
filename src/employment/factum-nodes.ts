/**
 * Factum argument library — the firm's reusable Part III (Issues and the Law)
 * argument sections for a plaintiff-side wrongful-dismissal factum.
 *
 * Mirrors the SOC node library, but for a factum the argument is prose rather
 * than pleaded paragraphs, so a node "guides the model" rather than rendering
 * verbatim: the fired nodes' guidance and authorities are injected into the
 * factum prompt as the firm's settled argument for each approved issue, and the
 * generator applies the matter's facts to them.
 *
 * Selection is two layers, as with the SOC nodes:
 *   layer 1 — the trigger: which gate(s) the section belongs to (or ALWAYS);
 *   layer 2 — approval: the section fires when the lawyer has approved the
 *             issue that speaks for its gate, and the lawyer can force a
 *             section on or off from the picker.
 *
 * Firm overrides carry GUIDANCE ONLY. Trigger, order, header, authorities and
 * review marking stay from the ported defaults, so a language edit can never
 * change which issue argues what.
 */

import { ISSUE_TO_GATE } from './gate-evaluator.js';
import type { GateResult } from '../types/employment-intake.js';
import nodesData from './factum-nodes-data.json' with { type: 'json' };

// ── The nodes ────────────────────────────────────────────────────────────

export interface FactumNode {
  blockId: string;
  issueLabel: string;
  sectionHeader: string;
  /** Gate ids this section belongs to; empty means ALWAYS. */
  triggerGates: string[];
  assemblyOrder: number;
  authorities: string;
  /** The firm marked this section as needing lawyer review whenever used. */
  lawyerReview: boolean;
  /** The firm's settled argument for this issue; injected as guidance. */
  guidance: string;
  notes?: string;
}

interface RawFactumNode {
  blockId: string;
  issueLabel: string;
  sectionHeader: string;
  triggerGates: string;
  assemblyOrder: string;
  authorities: string;
  lawyerReview: string;
  guidance: string;
  notes?: string;
}

export function loadFactumNodes(): FactumNode[] {
  return (nodesData.nodes as RawFactumNode[]).map(n => ({
    blockId: n.blockId,
    issueLabel: n.issueLabel.trim(),
    sectionHeader: n.sectionHeader.trim(),
    // "ALWAYS" (or blank) means the section is always in play; otherwise a
    // comma-separated list of gate ids (any one approved fires it).
    triggerGates: /^\s*always\s*$/i.test(n.triggerGates) || !n.triggerGates.trim()
      ? []
      : n.triggerGates.split(',').map(g => g.trim().toUpperCase()).filter(Boolean),
    assemblyOrder: parseInt(n.assemblyOrder, 10) || 99,
    authorities: n.authorities.trim(),
    lawyerReview: /yes/i.test(n.lawyerReview),
    guidance: n.guidance,
    notes: n.notes || undefined,
  })).sort((a, b) => a.assemblyOrder - b.assemblyOrder);
}

/**
 * The firm's own argument language over the ported defaults. Guidance only;
 * trigger, order, header, authorities and review marking stay from the default.
 */
export function mergeFirmFactumNodes(
  defaults: FactumNode[],
  overrides: Array<{ block_id: string; content: string }>,
): FactumNode[] {
  const byId = new Map(overrides.map(o => [o.block_id, o.content]));
  return defaults.map(n => byId.has(n.blockId) ? { ...n, guidance: byId.get(n.blockId)! } : n);
}

// ── Selection ────────────────────────────────────────────────────────────

export interface FactumSelectionInput {
  gates: GateResult[];
  approvedIssues: string[];
}

export interface FactumGateState {
  firedGates: Set<string>;
  approvedGates: Set<string>;
}

/** Which gates fired on the analysis, and which the lawyer has approved. */
export function buildFactumGateState(input: FactumSelectionInput): FactumGateState {
  const firedGates = new Set(input.gates.filter(g => g.triggered).map(g => g.gate));
  const approvedGates = new Set(input.approvedIssues.map(i => ISSUE_TO_GATE[i]).filter(Boolean));
  return { firedGates, approvedGates };
}

export type FactumNodeStatus =
  | 'firing'
  | 'eligible_unapproved'
  | 'off'
  | 'forced_on'
  | 'forced_off';

export interface FactumNodeReport {
  blockId: string;
  sectionHeader: string;
  issueLabel: string;
  authorities: string;
  status: FactumNodeStatus;
  reason: string;
  /** Every section can be forced on or off by the lawyer. */
  forceable: boolean;
  lawyerReview: boolean;
  guidance: string;
}

function gateNames(gates: string[]): string {
  return gates.join(' or ');
}

/**
 * The status of every argument section for this matter — the picker's data.
 * Override wins first, then trigger + approval.
 */
export function factumNodeStatuses(
  nodes: FactumNode[],
  state: FactumGateState,
  overrides: Record<string, 'on' | 'off'>,
): FactumNodeReport[] {
  return nodes.map(node => {
    const base = {
      blockId: node.blockId,
      sectionHeader: node.sectionHeader,
      issueLabel: node.issueLabel,
      authorities: node.authorities,
      forceable: true,
      lawyerReview: node.lawyerReview,
      guidance: node.guidance,
    };
    const override = overrides[node.blockId];
    if (override === 'off') {
      return { ...base, status: 'forced_off' as const, reason: 'You turned this argument off for this factum.' };
    }
    if (override === 'on') {
      return { ...base, status: 'forced_on' as const, reason: 'You turned this argument on for this factum.' };
    }
    // ALWAYS sections are the core of the argument and fire unless forced off.
    if (node.triggerGates.length === 0) {
      return { ...base, status: 'firing' as const, reason: 'Argued on every wrongful dismissal factum.' };
    }
    const approved = node.triggerGates.some(g => state.approvedGates.has(g));
    if (approved) {
      return { ...base, status: 'firing' as const, reason: `Argued because you approved the ${gateNames(node.triggerGates)} issue.` };
    }
    const fired = node.triggerGates.some(g => state.firedGates.has(g));
    if (fired) {
      return { ...base, status: 'eligible_unapproved' as const, reason: `The facts support this argument (${gateNames(node.triggerGates)}), but the issue is not approved on the Issues tab. Approve it, or force this section on.` };
    }
    return { ...base, status: 'off' as const, reason: `No approved issue argues this (${gateNames(node.triggerGates)}). Force it on to include the structure with markers.` };
  });
}

const ON_STATUSES: ReadonlySet<FactumNodeStatus> = new Set<FactumNodeStatus>(['firing', 'forced_on']);

/** The sections that will be argued, in assembly order. */
export function selectedFactumNodes(reports: FactumNodeReport[]): FactumNodeReport[] {
  return reports.filter(r => ON_STATUSES.has(r.status));
}

/**
 * The firm-argument block injected into the factum prompt. Lists each selected
 * section's heading, authorities and settled argument, in order, so the model
 * writes Part III following the firm's argument and applying the matter facts.
 */
export function buildFactumArgumentGuidance(selected: FactumNodeReport[]): string {
  if (selected.length === 0) return '';
  const sections = selected.map((r, i) => {
    const cites = r.authorities ? `\n   Authorities: ${r.authorities}` : '';
    return `${i + 1}. ${r.sectionHeader}${cites}\n   Argument: ${r.guidance.trim()}`;
  }).join('\n\n');
  return sections;
}

/** The distinct authorities across the selected sections, for Schedule A. */
export function selectedFactumAuthorities(selected: FactumNodeReport[]): string[] {
  const seen: string[] = [];
  for (const r of selected) {
    for (const a of r.authorities.split(';').map(s => s.trim()).filter(Boolean)) {
      if (!seen.includes(a)) seen.push(a);
    }
  }
  return seen;
}
