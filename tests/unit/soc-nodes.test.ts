/**
 * Unit Tests — the pleading nodes.
 *
 * The port has to be faithful twice over: the trigger grammar must behave
 * exactly as DemandPay evaluates it, and the three selection layers must
 * keep their order of authority (trigger computes, approval gates,
 * override beats both). A claim that pleads a dismissed cause, or numbers
 * its relief (a) (b) (e), is a court document that looks edited.
 */

import { describe, it, expect } from 'vitest';
import {
  loadSocNodes, evalTrigger, buildSocEvalContext, nodeStatuses,
  applyConditionals, reletter, renderNode, numberSocParagraphs,
  conditionFields, AI_NARRATIVE_BLOCK,
} from '../../src/employment/soc-nodes.js';

const baseIntake = {
  client_first_name: 'Aisha', client_last_name: 'Osei',
  employer_legal_name: 'Brightpath Financial Group Inc',
  job_title: 'Senior Portfolio Analyst',
  annual_salary: 110000,
  hire_date: '2019-09-03',
  termination_date: '2026-04-20',
  was_terminated: true,
  client_pronouns: 'they',
} as never;

const analysis = {
  damagesEstimate: {
    esaNoticeWeeks: 8, commonLawLowMonths: 8, commonLawHighMonths: 12,
    commonLawHighAmount: 110000, totalEstimateHigh: 135000,
  },
  bardalFactors: { age: 47, tenureYears: 6.6 },
} as never;

const ctxFor = (intake: object, approved: string[] = [], gates: Array<{ gate: string; triggered: boolean }> = []) =>
  buildSocEvalContext({
    intake: intake as never, analysis, gates: gates as never,
    approvedIssues: approved, claimAmount: 200000,
  });

describe('loadSocNodes', () => {
  const nodes = loadSocNodes();

  it('carries all twenty-one blocks in assembly order', () => {
    expect(nodes).toHaveLength(21);
    expect(nodes[0].blockId).toBe('SOC_CLAIM_01');
    expect(nodes.map(n => n.assemblyOrder)).toEqual([...nodes.map(n => n.assemblyOrder)].sort((a, b) => a - b));
  });

  it('reads "no section header" as an instruction, not a heading', () => {
    const statute = nodes.find(n => n.blockId === 'SOC_STATUTE_01')!;
    expect(statute.sectionHeader).toBe('');
  });

  it('keeps the trigger, dropping the human annotation after the dash', () => {
    const claim = nodes.find(n => n.blockId === 'SOC_CLAIM_01')!;
    expect(claim.triggerCondition).toBe('ALWAYS');
    const cd = nodes.find(n => n.blockId === 'SOC_CD_01')!;
    expect(cd.triggerCondition).toContain('separation_type = CONSTRUCTIVE');
  });

  it('keeps the firm’s review markings', () => {
    expect(nodes.find(n => n.blockId === 'SOC_TERM_CLAUSE_01')!.lawyerReview).toBe(true);
    expect(nodes.find(n => n.blockId === 'SOC_PARTIES_01')!.lawyerReview).toBe(false);
  });
});

describe('evalTrigger (DemandPay semantics)', () => {
  it('ALWAYS and empty are true', () => {
    expect(evalTrigger('ALWAYS', {})).toBe(true);
    expect(evalTrigger('', {})).toBe(true);
    expect(evalTrigger(undefined, {})).toBe(true);
  });

  it('= YES means boolean true, not truthiness', () => {
    expect(evalTrigger('privacy_breach = YES', { privacy_breach: true })).toBe(true);
    expect(evalTrigger('privacy_breach = YES', { privacy_breach: 'yes' })).toBe(false);
    expect(evalTrigger('privacy_breach = YES', {})).toBe(false);
  });

  it('IS NOT EMPTY answers strings, booleans and absence', () => {
    expect(evalTrigger('bad_faith_acts IS NOT EMPTY', { bad_faith_acts: 'ignored complaints' })).toBe(true);
    expect(evalTrigger('bad_faith_acts IS NOT EMPTY', { bad_faith_acts: '  ' })).toBe(false);
    expect(evalTrigger('bad_faith_acts IS NOT EMPTY', {})).toBe(false);
  });

  it('evaluates the real constructive dismissal trigger, parentheses and all', () => {
    const cond = 'separation_type = CONSTRUCTIVE OR (separation_type = TERMINATED AND cd_changes IS NOT EMPTY)';
    expect(evalTrigger(cond, { separation_type: 'CONSTRUCTIVE', cd_changes: '' })).toBe(true);
    expect(evalTrigger(cond, { separation_type: 'TERMINATED', cd_changes: 'demoted, pay cut' })).toBe(true);
    expect(evalTrigger(cond, { separation_type: 'TERMINATED', cd_changes: '' })).toBe(false);
    expect(evalTrigger(cond, { separation_type: 'RESIGNED', cd_changes: 'x' })).toBe(false);
  });

  it('AND binds both sides', () => {
    const cond = 'employer_initiated_recruitment = YES AND had_prior_secure_employment = YES';
    expect(evalTrigger(cond, { employer_initiated_recruitment: true, had_prior_secure_employment: true })).toBe(true);
    expect(evalTrigger(cond, { employer_initiated_recruitment: true })).toBe(false);
  });

  it('names the fields a condition reads', () => {
    expect(conditionFields('has_noncompete = YES OR has_nonsolicit = YES')).toEqual(['has_noncompete', 'has_nonsolicit']);
    expect(conditionFields('ALWAYS')).toEqual([]);
  });
});

describe('buildSocEvalContext', () => {
  it('computes separation_type from the Starling fields', () => {
    expect(ctxFor(baseIntake).separation_type).toBe('TERMINATED');
    expect(ctxFor({ ...(baseIntake as object), is_constructive_dismissal: true }).separation_type).toBe('CONSTRUCTIVE');
    expect(ctxFor({ ...(baseIntake as object), resigned: true }).separation_type).toBe('RESIGNED');
  });

  it('fires gate references from gates or approvals', () => {
    expect(ctxFor(baseIntake, [], [{ gate: 'G9', triggered: true }]).gate_G9_fired).toBe(true);
    expect(ctxFor(baseIntake, ['human_rights_overlay']).gate_G10_fired).toBe(true);
    expect(ctxFor(baseIntake).gate_G10_fired).toBe(false);
  });

  it('leaves a never-asked field undefined, distinct from NO', () => {
    const ctx = ctxFor(baseIntake);
    expect(ctx.privacy_breach).toBeUndefined();
    expect(ctx.common_employer).toBeUndefined();
  });

  it('resolves the pronoun placeholders from the client file', () => {
    const ctx = ctxFor(baseIntake);
    expect(ctx.pronoun_possessive).toBe('their');
    const named = ctxFor({ ...(baseIntake as object), client_pronouns: undefined });
    expect(named.pronoun_possessive).toBe("Aisha Osei's");
  });
});

describe('nodeStatuses (the three layers)', () => {
  const nodes = loadSocNodes();

  it('tier 1 skeleton fires without approval', () => {
    const st = nodeStatuses(nodes, ctxFor(baseIntake), [], {});
    expect(st.find(s => s.blockId === 'SOC_PARTIES_01')!.status).toBe('firing');
    expect(st.find(s => s.blockId === 'SOC_NOTICE_01')!.status).toBe('firing');
  });

  it('an eligible cause without an approved issue does not plead, and says so', () => {
    const intake = { ...(baseIntake as object), is_constructive_dismissal: true, constructive_dismissal_details: 'pay cut' };
    const st = nodeStatuses(nodes, ctxFor(intake), [], {});
    const cd = st.find(s => s.blockId === 'SOC_CD_01')!;
    expect(cd.status).toBe('eligible_unapproved');
    expect(cd.reason).toContain('not');
  });

  it('the approved issue opens the gate', () => {
    const intake = { ...(baseIntake as object), is_constructive_dismissal: true };
    const st = nodeStatuses(nodes, ctxFor(intake, ['constructive_dismissal']), ['constructive_dismissal'], {});
    expect(st.find(s => s.blockId === 'SOC_CD_01')!.status).toBe('firing');
  });

  it('a cause the intake never asked about is off, with the field named', () => {
    const st = nodeStatuses(nodes, ctxFor(baseIntake), [], {});
    const intrusion = st.find(s => s.blockId === 'SOC_INTRUSION_01')!;
    expect(intrusion.status).toBe('off');
    expect(intrusion.reason).toContain('privacy_breach');
    expect(intrusion.unanswered).toContain('privacy_breach');
  });

  it('the override beats everything, both ways', () => {
    const st = nodeStatuses(nodes, ctxFor(baseIntake), [], {
      SOC_INTRUSION_01: 'on', SOC_NOTICE_01: 'off',
    });
    const forced = st.find(s => s.blockId === 'SOC_INTRUSION_01')!;
    expect(forced.status).toBe('forced_on');
    expect(forced.reason).toContain('[LAWYER: ...]');
    expect(st.find(s => s.blockId === 'SOC_NOTICE_01')!.status).toBe('forced_off');
  });
});

describe('rendering', () => {
  it('drops a conditional ground and reletters the survivors', () => {
    const body = [
      '{{para}}. The Plaintiff claims:',
      '',
      '(a) first head;',
      '',
      '{{#if has_bonus}}',
      '(b) bonus head;',
      '{{/if}}',
      '',
      '(c) always head;',
    ].join('\n');
    const out = reletter(applyConditionals(body, { has_bonus: false }));
    expect(out).toContain('(a) first head');
    expect(out).toContain('(b) always head');
    expect(out).not.toContain('bonus head');
    expect(out).not.toMatch(/\(c\)/);
  });

  it('keeps the ground when its condition holds', () => {
    const out = applyConditionals('{{#if has_bonus}}bonus{{/if}}', { has_bonus: true });
    expect(out).toContain('bonus');
  });

  it('supports else', () => {
    const out = applyConditionals('{{#if x}}yes{{else}}no{{/if}}', {});
    expect(out.trim()).toBe('no');
  });

  it('fills placeholders and marks what the matter cannot fill', () => {
    const node = {
      blockId: 'T', tier: 2 as const, sectionHeader: 'TEST', triggerCondition: 'ALWAYS',
      assemblyOrder: 1, lawyerReview: false,
      content: '{{para}}. {{client_name}} worked at {{employer_name}}. {{para}}. Damages of {{unknown_amount}} are claimed.',
    };
    const rendered = renderNode(node, ctxFor(baseIntake));
    expect(rendered.html).toContain('Aisha Osei worked at Brightpath Financial Group Inc');
    expect(rendered.html).toContain('[LAWYER: unknown amount]');
    expect(rendered.missing).toEqual(['unknown_amount']);
  });

  it('escapes the values, not the firm’s own markup', () => {
    const node = {
      blockId: 'T', tier: 2 as const, sectionHeader: 'TEST', triggerCondition: 'ALWAYS',
      assemblyOrder: 1, lawyerReview: false,
      content: '{{#if term_clause_text}}<blockquote>{{term_clause_text}}</blockquote>{{/if}}',
    };
    const rendered = renderNode(node, { term_clause_text: 'may terminate <at any time>' });
    expect(rendered.html).toContain('<blockquote>');
    expect(rendered.html).toContain('&lt;at any time&gt;');
  });

  it('numbers the paragraphs document-wide, in order', () => {
    const html = '<p>{{para}}. One.</p>\n<p>{{para}}. Two.</p>\n<p>{{para}}. Three.</p>';
    const out = numberSocParagraphs(html);
    expect(out).toContain('1. One');
    expect(out).toContain('2. Two');
    expect(out).toContain('3. Three');
    expect(out).not.toContain('{{para}}');
  });

  it('renders the real relief block against a real matter without leftovers', () => {
    const nodes = loadSocNodes();
    const claim = nodes.find(n => n.blockId === 'SOC_CLAIM_01')!;
    const rendered = renderNode(claim, ctxFor(baseIntake));
    expect(rendered.html).toContain('200,000');
    expect(rendered.html).not.toContain('{{#if');
    expect(rendered.html).not.toContain('{{/if}}');
    // Lettering is contiguous after conditional resolution.
    const letters = [...rendered.html.matchAll(/\(([a-z])\)/g)].map(m => m[1]);
    const expected = letters.map((_, i) => String.fromCharCode(97 + i));
    expect(letters).toEqual(expected);
  });

  it('the AI narrative block is the only one that renders no template text', () => {
    expect(AI_NARRATIVE_BLOCK).toBe('SOC_FACTS_01');
    const facts = loadSocNodes().find(n => n.blockId === AI_NARRATIVE_BLOCK)!;
    expect(facts.content).toContain('[AI-GENERATED BLOCK');
  });
});

describe('forceable', () => {
  it('every triggered node is forceable; the ALWAYS blocks are not', async () => {
    const { loadSocNodes, buildSocEvalContext, nodeStatuses } = await import('../../src/employment/soc-nodes.js');
    const ctx = buildSocEvalContext({ intake: { client_first_name: 'A', was_terminated: true } as never, analysis: null, gates: [], approvedIssues: [] });
    const statuses = nodeStatuses(loadSocNodes(), ctx, [], {});
    const byId = new Map(statuses.map(s => [s.blockId, s]));
    expect(byId.get('SOC_CLAIM_01')!.forceable).toBe(false);
    expect(byId.get('SOC_TERM_CLAUSE_01')!.forceable).toBe(true);
    expect(byId.get('SOC_BAD_FAITH_01')!.forceable).toBe(true);
    expect(byId.get('SOC_CD_01')!.forceable).toBe(true);
  });
});

describe('applyConditionals: branches never cross block boundaries', () => {
  it('a plain if cannot steal a sibling block\'s else', async () => {
    const { applyConditionals } = await import('../../src/employment/soc-nodes.js');
    const body = 'A{{#if hwc}} dated X{{/if}}. {{#if perf}}GOOD{{else}}PLAIN{{/if}}.';
    expect(applyConditionals(body, { hwc: false, perf: true } as never)).toBe('A. GOOD.');
    expect(applyConditionals(body, { hwc: true, perf: false } as never)).toBe('A dated X. PLAIN.');
    // The exact leak the pilot pasted from a real claim: no literal
    // markers may ever survive rendering.
    for (const ctx of [{ hwc: false, perf: false }, { hwc: true, perf: true }]) {
      expect(applyConditionals(body, ctx as never)).not.toMatch(/\{\{/);
    }
  });

  it('nested conditionals resolve inner-first', async () => {
    const { applyConditionals } = await import('../../src/employment/soc-nodes.js');
    const body = '{{#if outer}}O1 {{#if inner}}I{{/if}} O2{{/if}}';
    expect(applyConditionals(body, { outer: true, inner: true } as never)).toBe('O1 I O2');
    expect(applyConditionals(body, { outer: true, inner: false } as never)).toBe('O1  O2');
    expect(applyConditionals(body, { outer: false, inner: true } as never)).toBe('');
  });

  it('the employment facts node renders clean in every branch state', async () => {
    const { loadSocNodes, applyConditionals } = await import('../../src/employment/soc-nodes.js');
    const node = loadSocNodes().find(n => n.blockId === 'SOC_EMPLOY_FACTS_01')!;
    for (const flags of [
      { has_written_contract: false, positive_performance: true, has_bonus: false },
      { has_written_contract: true, positive_performance: false, has_bonus: true },
    ]) {
      const out = applyConditionals(node.content, flags as never);
      expect(out).not.toMatch(/\{\{[#/]/);
      expect(out).not.toMatch(/\{\{else\}\}/);
    }
  });
});
