import { describe, it, expect } from 'vitest';
import {
  loadFactumNodes,
  buildFactumGateState,
  factumNodeStatuses,
  selectedFactumNodes,
  buildFactumArgumentGuidance,
  selectedFactumAuthorities,
  mergeFirmFactumNodes,
} from '../../src/employment/factum-nodes.js';
import type { GateResult } from '../../src/types/employment-intake.js';

function gate(id: string, triggered: boolean): GateResult {
  return { gate: id, triggered, reason: '', issueCodes: [], requiresLawyerReview: false };
}

describe('factum argument library', () => {
  it('loads the argument nodes, ALWAYS sections have no trigger gates', () => {
    const nodes = loadFactumNodes();
    expect(nodes.length).toBeGreaterThanOrEqual(10);
    const notice = nodes.find(n => n.blockId === 'FACTUM_NOTICE_01');
    expect(notice).toBeDefined();
    expect(notice!.triggerGates).toEqual([]); // ALWAYS
    const clause = nodes.find(n => n.blockId === 'FACTUM_CLAUSE_01');
    expect(clause!.triggerGates).toEqual(['G3']);
    // sorted by assembly order: SJ appropriateness leads.
    expect(nodes[0].blockId).toBe('FACTUM_SJ_APPROPRIATE_01');
  });

  it('ALWAYS sections fire; gated sections need the approved issue', () => {
    const nodes = loadFactumNodes();
    // G3 fired but not approved; nothing else.
    const state = buildFactumGateState({
      gates: [gate('G3', true), gate('G11', false)],
      approvedIssues: [],
    });
    const reports = factumNodeStatuses(nodes, state, {});
    const byId = new Map(reports.map(r => [r.blockId, r]));

    expect(byId.get('FACTUM_NOTICE_01')!.status).toBe('firing');       // ALWAYS
    expect(byId.get('FACTUM_MITIGATION_01')!.status).toBe('firing');   // ALWAYS
    expect(byId.get('FACTUM_CLAUSE_01')!.status).toBe('eligible_unapproved'); // G3 fired, not approved
    expect(byId.get('FACTUM_MORAL_01')!.status).toBe('off');           // G11 not fired
  });

  it('approving the issue fires its section', () => {
    const nodes = loadFactumNodes();
    const state = buildFactumGateState({
      gates: [gate('G3', true)],
      approvedIssues: ['waksdale_at_any_time'], // maps to G3
    });
    const reports = factumNodeStatuses(nodes, state, {});
    expect(reports.find(r => r.blockId === 'FACTUM_CLAUSE_01')!.status).toBe('firing');
  });

  it('lawyer overrides win over the trigger', () => {
    const nodes = loadFactumNodes();
    const state = buildFactumGateState({ gates: [], approvedIssues: [] });
    const reports = factumNodeStatuses(nodes, state, {
      FACTUM_MORAL_01: 'on',    // force an off section on
      FACTUM_NOTICE_01: 'off',  // force an ALWAYS section off
    });
    const byId = new Map(reports.map(r => [r.blockId, r]));
    expect(byId.get('FACTUM_MORAL_01')!.status).toBe('forced_on');
    expect(byId.get('FACTUM_NOTICE_01')!.status).toBe('forced_off');
  });

  it('selection includes firing and forced_on only, and builds the guidance + authorities', () => {
    const nodes = loadFactumNodes();
    const state = buildFactumGateState({
      gates: [gate('G3', true)],
      approvedIssues: ['machtinger_below_esa'], // G3 approved
    });
    const reports = factumNodeStatuses(nodes, state, { FACTUM_MORAL_01: 'off' });
    const selected = selectedFactumNodes(reports);
    const ids = selected.map(s => s.blockId);

    expect(ids).toContain('FACTUM_SJ_APPROPRIATE_01'); // ALWAYS
    expect(ids).toContain('FACTUM_NOTICE_01');         // ALWAYS
    expect(ids).toContain('FACTUM_CLAUSE_01');         // G3 approved
    expect(ids).not.toContain('FACTUM_MORAL_01');      // forced off
    expect(ids).not.toContain('FACTUM_CAUSE_01');      // G4 not in play

    const guidance = buildFactumArgumentGuidance(selected);
    expect(guidance).toContain('Reasonable Notice');
    expect(guidance).toContain('Bardal');
    expect(guidance).toContain('Argument:');

    const authorities = selectedFactumAuthorities(selected);
    expect(authorities.some(a => /Waksdale/.test(a))).toBe(true);
    expect(authorities.some(a => /Bardal/.test(a))).toBe(true);
    // deduped
    expect(new Set(authorities).size).toBe(authorities.length);
  });

  it('a firm guidance override replaces content only, not the trigger', () => {
    const merged = mergeFirmFactumNodes(loadFactumNodes(), [
      { block_id: 'FACTUM_CLAUSE_01', content: 'The firm argues the clause its own way.' },
    ]);
    const clause = merged.find((n: { blockId: string }) => n.blockId === 'FACTUM_CLAUSE_01')!;
    expect(clause.guidance).toBe('The firm argues the clause its own way.');
    expect(clause.triggerGates).toEqual(['G3']); // unchanged
  });
});
