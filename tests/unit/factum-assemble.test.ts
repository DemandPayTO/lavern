import { describe, it, expect } from 'vitest';
import { assembleFactum } from '../../src/employment/factum-assemble.js';
import type { EmploymentIntakeData } from '../../src/types/employment-intake.js';

const intake = { client_first_name: 'Aisha', client_last_name: 'Osei' } as EmploymentIntakeData;

const sections = [
  { kind: 'overview' as const, header: 'Overview', html: '<p>The Plaintiff moves for summary judgment.</p>' },
  { kind: 'facts' as const, header: 'The Facts', html: '<p>She was employed from 2019.</p><p>She was dismissed in 2026.</p>' },
  { kind: 'argument' as const, header: 'Reasonable Notice', html: '<p>Bardal governs.</p>', authorities: 'Bardal v Globe & Mail Ltd (1960), 24 DLR (2d) 140 (Ont HC)' },
  { kind: 'argument' as const, header: 'Statutory Entitlements', html: '<p>The ESA floor applies.</p>', authorities: 'Employment Standards Act, 2000, SO 2000, c 41' },
  { kind: 'order' as const, header: 'The Order Requested', html: '<p>Judgment for the amount claimed.</p>' },
];

describe('factum assembly', () => {
  it('lays out the parts with headings in order', () => {
    const r = assembleFactum({ sections, intake });
    const html = r.html;
    expect(html.indexOf('PART I - OVERVIEW')).toBeGreaterThan(-1);
    expect(html.indexOf('PART II - THE FACTS')).toBeGreaterThan(-1);
    expect(html.indexOf('PART III - THE ISSUES AND THE LAW')).toBeGreaterThan(-1);
    expect(html.indexOf('PART IV - THE ORDER REQUESTED')).toBeGreaterThan(-1);
    // Parts appear in order.
    expect(html.indexOf('PART I')).toBeLessThan(html.indexOf('PART II'));
    expect(html.indexOf('PART II')).toBeLessThan(html.indexOf('PART III'));
    expect(html.indexOf('PART III')).toBeLessThan(html.indexOf('PART IV'));
    // Title names the plaintiff.
    expect(html).toContain('Factum of the Plaintiff, Aisha Osei');
  });

  it('gives each argument a lettered sub-heading', () => {
    const r = assembleFactum({ sections, intake });
    expect(r.html).toContain('<h3>A. Reasonable Notice</h3>');
    expect(r.html).toContain('<h3>B. Statutory Entitlements</h3>');
  });

  it('numbers the body paragraphs consecutively across the parts, not the schedules', () => {
    const r = assembleFactum({ sections, intake });
    // 1 overview + 2 facts + 1 + 1 argument + 1 order = 6 numbered paragraphs.
    expect(r.html).toContain('1.&nbsp;&nbsp;The Plaintiff moves');
    expect(r.html).toContain('6.&nbsp;&nbsp;Judgment for the amount claimed');
    // The schedule entries are <li>, never numbered by the paragraph pass.
    expect(r.html).not.toMatch(/7\.&nbsp;/);
  });

  it('sorts authorities into cases (Schedule A) and legislation (Schedule B)', () => {
    const r = assembleFactum({ sections, intake });
    const a = r.html.indexOf('SCHEDULE "A"');
    const b = r.html.indexOf('SCHEDULE "B"');
    expect(a).toBeGreaterThan(-1);
    expect(b).toBeGreaterThan(a);
    // Bardal is a case: its Schedule listing sits in Schedule A (between A and B).
    expect(r.html.indexOf('Bardal', a)).toBeLessThan(b);
    // The ESA is legislation: its Schedule listing sits after Schedule B.
    expect(r.html.indexOf('Employment Standards Act', b)).toBeGreaterThan(b);
    // Schedule A does not list the ESA, and Schedule B does not list Bardal.
    const schedA = r.html.slice(a, b);
    const schedB = r.html.slice(b);
    expect(schedA).toContain('Bardal');
    expect(schedA).not.toContain('Employment Standards Act');
    expect(schedB).toContain('Employment Standards Act');
    expect(schedB).not.toContain('Bardal');
    expect(r.authorities).toHaveLength(2);
  });

  it('flags Schedule B for the lawyer to complete', () => {
    const r = assembleFactum({ sections, intake });
    expect(r.lawyerReviewFlags.some(f => /Schedule of Authorities/.test(f))).toBe(true);
    expect(r.documentTitle).toBe("Plaintiff's Factum (Summary Judgment)");
  });

  it('handles a factum with no legislation cited', () => {
    const r = assembleFactum({ sections: sections.filter(s => s.header !== 'Statutory Entitlements'), intake });
    expect(r.html).toContain('SCHEDULE "B"');
    expect(r.html).toMatch(/attach the text of any statutory provisions/);
  });
});
