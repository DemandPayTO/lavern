import { describe, it, expect } from 'vitest';
import { buildIssueCatalog, issueLabel, ISSUE_LABELS } from '../../src/employment/issue-catalog.js';
import { ISSUE_TO_GATE } from '../../src/employment/gate-evaluator.js';

describe('issue catalogue', () => {
  it('labels every issue code the gates can raise', () => {
    for (const code of Object.keys(ISSUE_TO_GATE)) {
      expect(ISSUE_LABELS[code], `missing label for ${code}`).toBeTruthy();
    }
  });

  it('groups the catalogue by gate in gate order with names', () => {
    const cat = buildIssueCatalog();
    expect(cat.length).toBeGreaterThanOrEqual(13);
    // Gate order is numeric: G1 before G2 before ... G14.
    const nums = cat.map(g => parseInt(g.gate.slice(1), 10));
    expect(nums).toEqual([...nums].sort((a, b) => a - b));
    const g3 = cat.find(g => g.gate === 'G3')!;
    expect(g3.gateName).toBe('Termination Clause Validity');
    expect(g3.issues.some(i => i.code === 'waksdale_at_any_time')).toBe(true);
  });

  it('covers every code exactly once across the groups', () => {
    const cat = buildIssueCatalog();
    const codes = cat.flatMap(g => g.issues.map(i => i.code));
    expect(new Set(codes).size).toBe(codes.length);
    expect(new Set(codes)).toEqual(new Set(Object.keys(ISSUE_TO_GATE)));
  });

  it('falls back to a de-slugged label for an unknown code', () => {
    expect(issueLabel('some_unknown_code')).toBe('some unknown code');
    expect(issueLabel('waksdale_at_any_time')).toBe('Termination clause void (Waksdale)');
  });
});
