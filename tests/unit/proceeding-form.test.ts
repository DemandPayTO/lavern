/**
 * Unit Tests — action or application.
 *
 * The consequential rule here is that a cause the lawyer approved and cannot
 * pursue on an application must be reported, never silently dropped. These pin
 * that, the relief shape, and the party labels.
 */

import { describe, it, expect } from 'vitest';
import {
  partyLabels, suppressedForApplication, applicationRelief, letterReliefItems,
  relabelParties, TRIAL_DEPENDENT_NODES,
} from '../../src/employment/proceeding-form.js';

describe('partyLabels', () => {
  it('names the parties as an action names them', () => {
    expect(partyLabels('action')).toEqual({ claimant: 'Plaintiff', opposite: 'Defendant' });
  });

  it('names the parties as an application names them', () => {
    expect(partyLabels('application')).toEqual({ claimant: 'Applicant', opposite: 'Respondent' });
  });
});

describe('suppressedForApplication', () => {
  it('suppresses nothing where no trial-dependent cause is pleaded', () => {
    const out = suppressedForApplication(['SOC_TERM_CLAUSE_01', 'SOC_ESA_01']);
    expect(out.suppressed).toEqual([]);
    expect(out.flags).toEqual([]);
  });

  it('suppresses bad faith, and says why', () => {
    const out = suppressedForApplication(['SOC_BAD_FAITH_01'], { SOC_BAD_FAITH_01: 'BAD FAITH IN THE MANNER OF DISMISSAL' });
    expect(out.suppressed).toEqual(['SOC_BAD_FAITH_01']);
    expect(out.flags[0]).toContain('BAD FAITH IN THE MANNER OF DISMISSAL');
    expect(out.flags[0]).toContain('no discovery and no trial');
  });

  // The failure worth preventing: a cause quietly missing from the output.
  it('tells the lawyer how to pursue a suppressed cause instead', () => {
    const out = suppressedForApplication(['SOC_DEFAM_01']);
    expect(out.flags[0]).toContain('commence an action instead');
  });

  it('suppresses every trial-dependent cause at once', () => {
    const out = suppressedForApplication(['SOC_BAD_FAITH_01', 'SOC_MISREP_01', 'SOC_DEFAM_01', 'SOC_ESA_01']);
    expect(out.suppressed).toHaveLength(3);
    expect(out.suppressed).not.toContain('SOC_ESA_01');
    expect(out.flags).toHaveLength(3);
  });

  it('carries a reason for every node it suppresses', () => {
    for (const id of Object.keys(TRIAL_DEPENDENT_NODES)) {
      expect(TRIAL_DEPENDENT_NODES[id].length).toBeGreaterThan(40);
    }
  });

  it('falls back to the node id where no header is supplied', () => {
    expect(suppressedForApplication(['SOC_MISREP_01']).flags[0]).toContain('SOC_MISREP_01');
  });
});

describe('applicationRelief', () => {
  const base = {
    respondent: 'Cartwright Industrial Services Inc.',
    noticeMonths: 18,
    amountCad: 222000,
    challengesTerminationClause: true,
    humanRights: false,
  };

  it('leads with the declarations, not with damages', () => {
    const html = applicationRelief(base);
    expect(html).toContain('THE APPLICANT MAKES APPLICATION FOR:');
    const firstItem = html.split('<p>')[1];
    expect(firstItem).toContain('a declaration');
  });

  it('asks for the three declarations an employment application asks for', () => {
    const html = applicationRelief(base);
    expect(html).toContain('termination provision');
    expect(html).toContain('wrongfully dismissed');
    expect(html).toContain('18 months');
  });

  // Judgment for the notice period is available; it is the trial-dependent
  // heads that are not.
  it('still asks for judgment in the amount that follows', () => {
    expect(applicationRelief(base)).toContain('$222,000');
  });

  it('never asks for aggravated, moral or punitive damages', () => {
    const html = applicationRelief({ ...base, humanRights: true });
    expect(html).not.toMatch(/aggravated|punitive|moral damages|bad faith/i);
  });

  it('omits the clause declaration where no clause is challenged', () => {
    const html = applicationRelief({ ...base, challengesTerminationClause: false });
    expect(html).not.toContain('termination provision');
    expect(html).toContain('wrongfully dismissed');
  });

  it('asks for Code damages only where the matter pleads them', () => {
    expect(applicationRelief({ ...base, humanRights: true })).toContain('Human Rights Code');
    expect(applicationRelief(base)).not.toContain('Human Rights Code');
  });

  it('marks a missing notice period rather than inventing one', () => {
    expect(applicationRelief({ ...base, noticeMonths: null })).toContain('[LAWYER: notice period]');
  });

  it('asks for an amount to be determined where the figure is unknown', () => {
    const html = applicationRelief({ ...base, amountCad: null });
    expect(html).toContain('to be determined');
    expect(html).not.toContain('$');
  });

  it('always asks for interest, costs and further relief', () => {
    const html = applicationRelief(base);
    expect(html).toContain('Courts of Justice Act');
    expect(html).toContain('costs of this application');
    expect(html).toContain('further and other relief');
  });
});

describe('letterReliefItems', () => {
  it('letters the relief items in order', () => {
    const out = letterReliefItems(applicationRelief({
      respondent: 'Acme', noticeMonths: 12, amountCad: 100000,
      challengesTerminationClause: true, humanRights: false,
    }));
    expect(out).toContain('(a)');
    expect(out).toContain('(b)');
    expect(out).not.toContain('{{para_alpha_');
  });

  it('letters from a where the first item is dropped', () => {
    const out = letterReliefItems(applicationRelief({
      respondent: 'Acme', noticeMonths: 12, amountCad: 100000,
      challengesTerminationClause: false, humanRights: false,
    }));
    expect(out).toContain('(a) a declaration that the applicant was wrongfully dismissed');
  });

  it('leaves a document with no relief markers untouched', () => {
    expect(letterReliefItems('<p>Nothing here.</p>')).toBe('<p>Nothing here.</p>');
  });
});

describe('relabelParties', () => {
  it('leaves an action exactly as the firm wrote it', () => {
    const html = '<p>The Plaintiff claims against the Defendant.</p>';
    expect(relabelParties(html, 'action')).toBe(html);
  });

  it('renames both parties on an application', () => {
    const out = relabelParties('<p>The Plaintiff claims against the Defendant.</p>', 'application');
    expect(out).toBe('<p>The Applicant claims against the Respondent.</p>');
  });

  it('renames inside the defined term the nodes establish', () => {
    const out = relabelParties('<p>Ruth Delacroix (the "Plaintiff")</p>', 'application');
    expect(out).toContain('(the "Applicant")');
  });

  it('keeps the plural plural', () => {
    const out = relabelParties('<p>The Defendants are jointly liable to the Plaintiffs.</p>', 'application');
    expect(out).toContain('Respondents');
    expect(out).toContain('Applicants');
    expect(out).not.toContain('Respondentss');
  });

  it('renames the lower-case forms too', () => {
    expect(relabelParties('<p>the plaintiff and the defendant</p>', 'application'))
      .toBe('<p>the applicant and the respondent</p>');
  });

  it('leaves a word that merely contains the name alone', () => {
    const out = relabelParties('<p>The Plaintiffs counsel is indefensible.</p>', 'application');
    expect(out).toContain('indefensible');
  });
});
