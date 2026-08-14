/**
 * Unit Tests — Citation Canon integrity check (src/employment/citation-canon.ts)
 *
 * The generation prompts forbid invented citations; this module is the
 * verification layer. It must flag case names outside the plaintiff-side
 * Ontario employment canon and canon cases carrying wrong citations,
 * while never flagging the matter's own style of cause.
 */

import { describe, it, expect } from 'vitest';
import { checkCitationIntegrity, checkFillInPlaceholders } from '../../src/employment/citation-canon.js';

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
