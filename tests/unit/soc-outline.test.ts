import { describe, it, expect } from 'vitest';
import { stripParaMarkers, ensureParaMarkers, buildSocOutline } from '../../src/employment/soc-outline.js';
import { loadSocNodes, buildSocEvalContext, numberSocParagraphs, renderNode, AI_NARRATIVE_BLOCK } from '../../src/employment/soc-nodes.js';
import type { EmploymentIntakeData, IntakeAnalysisResult } from '../../src/types/employment-intake.js';

const intake = {
  client_first_name: 'Aisha', client_last_name: 'Osei',
  employer_legal_name: 'Brightpath Financial Group Inc',
  hire_date: '2019-09-03', termination_date: '2026-04-20',
  job_title: 'Senior Client Advisor', annual_salary: 92000,
  was_terminated: true,
} as EmploymentIntakeData;

const analysis = { damagesEstimate: { esaNoticeWeeks: 8, esaNoticePay: 14000, esaSeverancePay: 6000, commonLawLowMonths: 6, commonLawHighMonths: 9, commonLawLowAmount: 46000, commonLawHighAmount: 69000 } } as unknown as IntakeAnalysisResult;

function ctx() {
  return buildSocEvalContext({ intake, analysis, gates: [], approvedIssues: ['wrongful_dismissal'], claimAmount: 120000 });
}

describe('soc paragraph markers', () => {
  it('strips {{para}} markers for reading', () => {
    expect(stripParaMarkers('<p>{{para}}. The Plaintiff pleads.</p>')).toBe('<p>The Plaintiff pleads.</p>');
    expect(stripParaMarkers('<p>{{para}}.&nbsp;&nbsp;A fact.</p>')).toBe('<p>A fact.</p>');
  });

  it('re-inserts a marker on each numbered paragraph, once', () => {
    expect(ensureParaMarkers('<p>Hello</p>')).toBe('<p>{{para}}. Hello</p>');
    // Idempotent: an existing marker is not doubled.
    expect(ensureParaMarkers('<p>{{para}}. Hello</p>')).toBe('<p>{{para}}. Hello</p>');
    // A hand-typed number is replaced by the marker.
    expect(ensureParaMarkers('<p>1. Hello</p>')).toBe('<p>{{para}}. Hello</p>');
  });

  it('leaves sub-paragraphs and markup blocks unnumbered', () => {
    expect(ensureParaMarkers('<p class="sub">(a) particulars</p>')).toBe('<p class="sub">(a) particulars</p>');
  });

  it('strip then ensure keeps the numbered paragraph count stable', () => {
    const original = '<p>{{para}}. One.</p>\n<p>{{para}}. Two.</p>\n<p class="sub">(a) sub.</p>';
    const round = ensureParaMarkers(stripParaMarkers(original));
    expect((round.match(/\{\{para\}\}/g) ?? []).length).toBe(2);
    // And it numbers cleanly 1, 2.
    const numbered = numberSocParagraphs(round);
    expect(numbered).toContain('<p>1. One.</p>');
    expect(numbered).toContain('<p>2. Two.</p>');
    expect(numbered).toContain('<p class="sub">(a) sub.</p>');
  });
});

describe('soc outline', () => {
  it('lists active pleading sections including the Background Facts', () => {
    const sections = buildSocOutline({ nodes: loadSocNodes(), ctx: ctx(), approvedIssues: ['wrongful_dismissal'], overrides: {} });
    expect(sections.length).toBeGreaterThan(1);
    const facts = sections.find(s => s.id === AI_NARRATIVE_BLOCK);
    expect(facts).toBeDefined();
    expect(facts!.kind).toBe('facts');
    expect(facts!.draftStatus).toBe('not_drafted');
    // Node sections default to 'rendered' and carry readable (marker-free) text.
    const node = sections.find(s => s.kind === 'node');
    expect(node!.draftStatus).toBe('rendered');
    expect(node!.html).not.toContain('{{para}}');
  });

  it('reflects a saved draft: approved and edited status', () => {
    const nodes = loadSocNodes();
    const c = ctx();
    const firstNode = buildSocOutline({ nodes, ctx: c, approvedIssues: ['wrongful_dismissal'], overrides: {} }).find(s => s.kind === 'node')!;
    const draft = {
      sections: {
        [AI_NARRATIVE_BLOCK]: { html: '<p>{{para}}. The facts.</p>', approved: true, edited: false, generatedAt: 't' },
        [firstNode.id]: { html: renderNode(nodes.find(n => n.blockId === firstNode.id)!, c).html, approved: false, edited: true, generatedAt: 't' },
      },
    };
    const sections = buildSocOutline({ nodes, ctx: c, approvedIssues: ['wrongful_dismissal'], overrides: {}, draft });
    expect(sections.find(s => s.id === AI_NARRATIVE_BLOCK)!.draftStatus).toBe('approved');
    expect(sections.find(s => s.id === AI_NARRATIVE_BLOCK)!.approved).toBe(true);
    const edited = sections.find(s => s.id === firstNode.id)!;
    expect(edited.edited).toBe(true);
    expect(edited.draftStatus).toBe('drafted');
    expect(edited.html).not.toContain('{{para}}');
  });
});
