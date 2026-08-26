/**
 * Unit Tests — Citation Canon integrity check (src/employment/citation-canon.ts)
 *
 * The generation prompts forbid invented citations; this module is the
 * verification layer. It must flag case names outside the plaintiff-side
 * Ontario employment canon and canon cases carrying wrong citations,
 * while never flagging the matter's own style of cause.
 */

import { describe, it, expect } from 'vitest';
import { checkCitationIntegrity, checkFillInPlaceholders, checkScheduleACivilRelief, checkSourceDateFidelity } from '../../src/employment/citation-canon.js';

describe('checkCitationIntegrity — known canon', () => {
  it('accepts canon cases with correct citations', () => {
    const html = `<p>The termination clause is void under <em>Waksdale v Swegon North America Inc</em>, 2020 ONCA 391,
      and the notice period is assessed under Bardal v Globe & Mail, [1960] OJ No 149.</p>`;
    expect(checkCitationIntegrity(html)).toEqual([]);
  });

  it('accepts canon cases cited by name alone (no pinpoint)', () => {
    const html = '<p>Applying the proportionality standard from McKinley v BC Tel, dismissal for cause fails.</p>';
    expect(checkCitationIntegrity(html)).toEqual([]);
  });

  it('flags a canon case with a mismatched citation', () => {
    const html = '<p>Waksdale v Swegon North America Inc, 2019 ONCA 123 renders the clause void.</p>';
    const flags = checkCitationIntegrity(html);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('Citation mismatch');
    expect(flags[0]).toContain('Waksdale');
    expect(flags[0]).toContain('2019 ONCA 123');
  });
});

describe('checkCitationIntegrity — unknown cases', () => {
  it('flags a case name outside the canon', () => {
    const html = '<p>As held in Thompson v Maple Industries Ltd, 2021 ONCA 555, the employee is entitled to 24 months.</p>';
    const flags = checkCitationIntegrity(html);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('outside the known canon');
    expect(flags[0]).toContain('Thompson');
  });

  it('deduplicates repeated unknown citations', () => {
    const html = `<p>Thompson v Maple Industries Ltd applies. As Thompson v Maple Industries Ltd makes clear...</p>`;
    expect(checkCitationIntegrity(html)).toHaveLength(1);
  });
});

describe('checkCitationIntegrity — matter parties', () => {
  it('does not flag the matter\'s own style of cause', () => {
    const html = '<h1>JANE SMITH v ACME CORPORATION</h1><p>The Plaintiff claims damages under Bardal v Globe & Mail.</p>';
    const flags = checkCitationIntegrity(html, ['Jane Smith', 'Acme Corporation']);
    expect(flags).toEqual([]);
  });

  it('still flags unknown cases even when parties are excluded', () => {
    const html = '<h1>SMITH v ACME CORP</h1><p>Relying on Fakename v Nonexistent Co, 2023 ONSC 999.</p>';
    const flags = checkCitationIntegrity(html, ['Smith', 'Acme Corp']);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('Fakename');
  });
});

describe('checkFillInPlaceholders', () => {
  it('flags signature-block fill-ins the lawyer must complete', () => {
    const html = '<p>Jordan Whitfield<br>[Address]<br>Tel: [Telephone]<br>Email: [Email]</p>';
    const flags = checkFillInPlaceholders(html);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('[Address]');
    expect(flags[0]).toContain('[Telephone]');
  });

  it('ignores anonymisation-style tokens ([PARTY_1]) — different failure mode', () => {
    const html = '<p>[PARTY_1] was employed by [PARTY_2].</p>';
    expect(checkFillInPlaceholders(html)).toEqual([]);
  });

  it('ignores all-caps court-form directives like [TO BE ASSIGNED]', () => {
    const html = '<p>Court File No: [TO BE ASSIGNED]</p>';
    expect(checkFillInPlaceholders(html)).toEqual([]);
  });

  it('returns no flags for complete documents', () => {
    const html = '<p>Jordan Whitfield, 10 Dundas St W, Toronto. Tel: 416-555-0100.</p>';
    expect(checkFillInPlaceholders(html)).toEqual([]);
  });
});

describe('checkCitationIntegrity — plain text handling', () => {
  it('strips HTML tags before matching', () => {
    const html = '<p><strong>Honda Canada Inc</strong> v <em>Keays</em>, 2008 SCC 39</p>';
    expect(checkCitationIntegrity(html)).toEqual([]);
  });

  it('returns no flags for documents with no case citations', () => {
    const html = '<p>The Plaintiff was employed for eight years and earned $95,000 per year.</p>';
    expect(checkCitationIntegrity(html)).toEqual([]);
  });
});


describe('checkFillInPlaceholders catches [LAWYER: ...] markers', () => {
  it('flags a served letter still carrying a [LAWYER: ...] marker', () => {
    const flags = checkFillInPlaceholders('<p>Dear [LAWYER: salutation]:</p><p>Re: the matter</p>');
    expect(flags.length).toBeGreaterThan(0);
    expect(flags[0]).toContain('Do not send');
  });
  it('is silent on a clean document', () => {
    expect(checkFillInPlaceholders('<p>Dear Counsel:</p><p>Yours truly</p>')).toEqual([]);
  });
});

describe('checkScheduleACivilRelief', () => {
  it('says nothing when the narrative pleads the Code alone', () => {
    const html = '<p>The applicant was 64 years of age. Her age was a factor in the decision to eliminate her position, contrary to section 5(1) of the Code. She seeks compensation for injury to dignity, feelings and self-respect under section 45.2.</p>';
    expect(checkScheduleACivilRelief(html)).toEqual([]);
  });

  it('flags common law notice carried over from the civil pleading', () => {
    const html = '<p>The applicant claims damages in lieu of reasonable notice at common law, having regard to the Bardal factors.</p>';
    const flags = checkScheduleACivilRelief(html);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('reasonable notice');
    expect(flags[0]).toContain('common law');
    expect(flags[0]).toContain('Bardal');
  });

  it('flags statutory entitlements that belong to the civil proceeding', () => {
    const flags = checkScheduleACivilRelief('<p>The applicant seeks severance pay under the Employment Standards Act, 2000.</p>');
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('severance pay');
    expect(flags[0]).toContain('the Employment Standards Act');
  });

  it('reports one flag naming every carry-over, not one flag each', () => {
    const html = '<p>Wrongful dismissal. Reasonable notice. Severance pay.</p>';
    expect(checkScheduleACivilRelief(html)).toHaveLength(1);
  });

  it('reads the text, not the markup', () => {
    expect(checkScheduleACivilRelief('<p class="reasonable notice">The respondent discriminated.</p>')).toEqual([]);
  });
});

describe('checkSourceDateFidelity', () => {
  const source = 'The board minute of January 19, 2026 records the request. Employment ended February 12, 2026.';

  it('says nothing when every sourced date is pleaded', () => {
    const html = '<p>On January 19, 2026 the board recorded it. The applicant was dismissed on February 12, 2026.</p>';
    expect(checkSourceDateFidelity(source, html)).toEqual([]);
  });

  it('flags a dated particular generalised away', () => {
    const html = '<p>The respondent\'s records state that it sought a fresh perspective. The applicant was dismissed on February 12, 2026.</p>';
    const flags = checkSourceDateFidelity(source, html);
    expect(flags).toHaveLength(1);
    expect(flags[0]).toContain('January 19, 2026');
    expect(flags[0]).not.toContain('February 12, 2026');
  });

  it('reports one flag naming each missing date', () => {
    expect(checkSourceDateFidelity(source, '<p>Nothing dated here.</p>')).toHaveLength(1);
  });

  it('ignores dates the narrative adds of its own', () => {
    expect(checkSourceDateFidelity('Ended February 12, 2026.', '<p>Filed March 3, 2026 about February 12, 2026.</p>')).toEqual([]);
  });

  it('reads the narrative text, not its markup', () => {
    expect(checkSourceDateFidelity('On January 19, 2026.', '<p title="January 19, 2026">Nothing.</p>')).toHaveLength(1);
  });
});
