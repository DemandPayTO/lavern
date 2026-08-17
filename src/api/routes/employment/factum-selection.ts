/**
 * Shared factum argument selection.
 *
 * Both the whole-factum generator and the section-by-section outline need the
 * same list of selected Part III argument sections: the firm's argument
 * library merged with the firm's own language and custom sections, gated by the
 * matter's approved issues, with the lawyer's per-matter overrides applied.
 * This keeps the two paths from diverging.
 */

import type { GateResult } from '../../../types/employment-intake.js';
import {
  loadFactumNodes, mergeFirmFactumNodes, buildFactumGateState, factumNodeStatuses,
  selectedFactumNodes, firmCustomSectionsToNodes,
} from '../../../employment/factum-nodes.js';
import type { FactumNodeReport } from '../../../employment/factum-nodes.js';
import { SJ_ONLY_ARGUMENT_BLOCK } from '../../../employment/factum-outline.js';
import type { FactumForum } from '../../../employment/factum-outline.js';
import { getFirmFactumNodes, getFirmFactumCustomSections } from '../../../db/database.js';

export function loadSelectedFactumNodes(input: {
  firmId?: string;
  gates: GateResult[];
  approvedIssues: string[];
  overrides: Record<string, 'on' | 'off'>;
  /** Small Claims factums drop the summary-judgment appropriateness argument. */
  forum?: FactumForum;
}): FactumNodeReport[] {
  const base = input.firmId
    ? mergeFirmFactumNodes(loadFactumNodes(), getFirmFactumNodes(input.firmId))
    : loadFactumNodes();
  const custom = input.firmId ? firmCustomSectionsToNodes(getFirmFactumCustomSections(input.firmId)) : [];
  let nodes = [...base, ...custom];
  // A Small Claims trial has no summary-judgment motion, so the argument that
  // summary judgment is appropriate does not belong in its written argument.
  if (input.forum === 'small_claims') {
    nodes = nodes.filter(n => n.blockId !== SJ_ONLY_ARGUMENT_BLOCK);
  }
  const state = buildFactumGateState({ gates: input.gates, approvedIssues: input.approvedIssues });
  return selectedFactumNodes(factumNodeStatuses(nodes, state, input.overrides));
}
