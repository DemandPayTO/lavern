/**
 * Unit Tests — the validation gate and the deterministic half of teaching.
 *
 * The gate is what lets the firm change pleading language safely: the
 * failures it catches are the silent ones. Matching is header plus topic
 * anchors, never case names, because this firm does not cite caselaw in
 * its claims.
 */

import { describe, it, expect } from 'vitest';
import { validateNodeContent, knownFields } from '../../src/employment/soc-node-validator.js';
import { splitClaimSections, matchSections } from '../../src/employment/soc-teach.js';
import { loadSocNodes, mergeFirmNodes } from '../../src/employment/soc-nodes.js';

describe('validateNodeContent', () => {
  it('passes every ported default, which is the baseline sanity check', () => {
    for (const node of loadSocNodes()) {
      if (node.blockId === 'SOC_FACTS_01') continue;
      const v = validateNodeContent(node.blockId, node.content);
      expect(v.ok, `${node.blockId}: ${v.errors.join('; ')}`).toBe(true);
    }
  });

  it('rejects an unclosed conditional, which would swallow the block', () => {
    const v = validateNodeContent('T', '{{para}}. Text. {{#if has_bonus}}bonus ground');
    expect(v.ok).toBe(false);
    expect(v.errors.some(e => e.includes('never closed'))).toBe(true);
  });

  it('rejects a condition field the engine cannot supply, the silent failure', () => {
    const v = validateNodeContent('T', '{{para}}. {{#if bonus_was_promised}}x{{/if}}');
    expect(v.ok).toBe(false);
    expect(v.errors.some(e => e.includes('bonus_was_promised') && e.includes('never appear'))).toBe(true);
  });

  it('warns on an unknown placeholder rather than failing, since it stays visible', () => {
    const v = validateNodeContent('T', '{{para}}. The sum of {{special_amount}} is claimed.');
    expect(v.ok).toBe(true);
    expect(v.warnings.some(w => w.includes('special_amount'))).toBe(true);
  });

  it('warns when nothing would be numbered', () => {
    const v = validateNodeContent('T', 'A paragraph with no marker.');
    expect(v.warnings.some(w => w.includes('{{para}}'))).toBe(true);
  });

  it('renders the candidate both ways so the lawyer reads real output', () => {
    const v = validateNodeContent('T', '{{para}}. {{client_name}} claims. {{#if has_bonus}}{{para}}. A bonus ground.{{/if}}');
    expect(v.renderAllOn).toContain('Jane Sample claims');
    expect(v.renderAllOn).toContain('A bonus ground');
    expect(v.renderAllOff).not.toContain('A bonus ground');
  });

  it('rejects a stray else, which reorders whatever follows it', () => {
    const v = validateNodeContent('T', '{{para}}. Text {{else}} more');
    expect(v.ok).toBe(false);
  });

  it('knows the vocabulary the engine actually supplies', () => {
    const known = knownFields();
    expect(known.has('client_name')).toBe(true);
    expect(known.has('has_bonus')).toBe(true);
    expect(known.has('pronoun_possessive')).toBe(true);
    expect(known.has('made_up_field')).toBe(false);
  });
});

describe('splitClaimSections', () => {
  const claim = [
    'CLAIM',
    '1. The Plaintiff claims against the Defendant damages for wrongful dismissal.',
    '',
    'THE PARTIES',
    '2. The Plaintiff is an individual residing in Toronto.',
    '3. The Defendant is a corporation.',
    '',
    'BAD FAITH IN THE MANNER OF DISMISSAL',
    '4. The Defendant acted in bad faith. The Plaintiff claims aggravated damages.',
  ].join('\n');

  it('splits on the capital headings pleadings carry', () => {
    const sections = splitClaimSections(claim);
    expect(sections.map(s => s.heading)).toEqual(['CLAIM', 'THE PARTIES', 'BAD FAITH IN THE MANNER OF DISMISSAL']);
    expect(sections[1].text).toContain('residing in Toronto');
  });

  it('does not mistake an ordinary sentence for a heading', () => {
    const sections = splitClaimSections('HEADING\nTHE PLAINTIFF WAS NOT TOLD WHY, AND ASKED REPEATEDLY OVER SEVERAL WEEKS FOLLOWING.\nbody');
    expect(sections).toHaveLength(1);
  });
});

describe('matchSections', () => {
  const nodes = loadSocNodes();

  const mkClaim = (name: string) => ({
    name,
    text: [
      'HUMAN RIGHTS VIOLATIONS',
      'The Defendant discriminated against the Plaintiff on the basis of a protected ground contrary to the Human Rights Code. The Plaintiff claims compensation for injury to dignity, feelings and self-respect.',
      '',
      'BAD FAITH',
      'The Defendant acted in bad faith in the manner of dismissal. The Plaintiff claims aggravated damages and punitive damages.',
      '',
      'A BESPOKE SECTION NOBODY ELSE HAS',
      'Entirely novel content about llamas that matches no pleading vocabulary at all.',
    ].join('\n'),
  });

  it('matches by heading and topic anchors, with no caselaw needed', () => {
    const { matches } = matchSections([mkClaim('c1.docx'), mkClaim('c2.docx')], nodes);
    expect(matches.get('SOC_HRC_01')?.length).toBe(2);
    expect(matches.get('SOC_BAD_FAITH_01')?.length).toBe(2);
  });

  it('reports what it cannot place rather than guessing', () => {
    const { unmatched } = matchSections([mkClaim('c1.docx')], nodes);
    expect(unmatched.some(u => u.heading.includes('BESPOKE'))).toBe(true);
  });

  it('never assigns anything to the facts block, which is per-file', () => {
    const { matches } = matchSections([mkClaim('c1.docx'), mkClaim('c2.docx')], nodes);
    expect(matches.has('SOC_FACTS_01')).toBe(false);
  });
});

describe('mergeFirmNodes', () => {
  it('overrides content only, keeping trigger and order from the defaults', () => {
    const defaults = loadSocNodes();
    const merged = mergeFirmNodes(defaults, [{ block_id: 'SOC_HRC_01', content: '{{para}}. The firm pleads it thus.' }]);
    const hrc = merged.find(n => n.blockId === 'SOC_HRC_01')!;
    const original = defaults.find(n => n.blockId === 'SOC_HRC_01')!;
    expect(hrc.content).toContain('The firm pleads it thus');
    expect(hrc.triggerCondition).toBe(original.triggerCondition);
    expect(hrc.assemblyOrder).toBe(original.assemblyOrder);
    expect(hrc.sectionHeader).toBe(original.sectionHeader);
    // Everything else untouched.
    expect(merged.filter(n => n.blockId !== 'SOC_HRC_01').every((n, i) =>
      n.content === defaults.filter(d => d.blockId !== 'SOC_HRC_01')[i].content)).toBe(true);
  });
});
