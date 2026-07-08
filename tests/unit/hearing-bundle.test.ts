/**
 * Hearing bundle skeleton — deterministic assembly must reflect exactly what
 * the matter has and name exactly what it is missing.
 */

import { describe, it, expect } from 'vitest';
import { buildHearingBundle } from '../../src/labour/hearing-bundle.js';
import type { GrievanceIntakeData } from '../../src/types/labour-intake.js';

const baseIntake = {
  grievor_first_name: 'Dana',
  grievor_last_name: 'Woo',
  union_name: 'Example Union',
  union_local: '100',
  employer_name: 'Acme Manufacturing Ltd.',
  grievance_type: 'discharge',
  grievance_filed: true,
  grievance_filed_date: '2026-05-01',
  grievance_number: 'G-2026-014',
  ca_title: 'Acme Manufacturing CA 2024-2027',
  discipline_imposed: 'discharge',
  discipline_letter_date: '2026-04-20',
  prior_discipline: false,
  witnesses: [
    { name: 'Dana Woo', role: 'Grievor', topics: 'The meeting of April 18 and the events on the floor' },
    { name: 'Sam Ortiz', role: 'Steward', topics: 'The disciplinary meeting and the denial of representation' },
  ],
} as unknown as GrievanceIntakeData;

describe('buildHearingBundle', () => {
  it('lists every tab and marks generated documents present', () => {
    const r = buildHearingBundle(baseIntake, ['particulars', 'will_say', 'remedy_worksheet']);
    expect(r.documentTitle).toBe('Hearing Bundle Skeleton');
    expect(r.html).toContain('Particulars of the grievance');
    expect(r.html).toContain('Will-say statements');
    // Present tabs are not marked missing.
    expect(r.html.split('Will-say statements')[1].slice(0, 60)).not.toContain('MISSING');
    // Absent generated docs are flagged.
    expect(r.html).toContain('Agreed statement of facts (proposed)');
    expect(r.html).toContain('MISSING');
  });

  it('names the gaps explicitly and adds the resolution flag', () => {
    const r = buildHearingBundle(baseIntake, []);
    expect(r.html).toContain('Still missing from this bundle');
    expect(r.reviewerFlags).toContain('missing_tabs_resolved');
  });

  it('renders the witness list with roles and topics', () => {
    const r = buildHearingBundle(baseIntake, []);
    expect(r.html).toContain('Sam Ortiz');
    expect(r.html).toContain('denial of representation');
  });

  it('prompts for witnesses when none are recorded', () => {
    const r = buildHearingBundle({ ...baseIntake, witnesses: [] } as GrievanceIntakeData, []);
    expect(r.html).toContain('No witnesses recorded');
  });

  it('orders the discharge checklist around Wm. Scott and escapes HTML in names', () => {
    const spicy = { ...baseIntake, employer_name: 'Acme <script>alert(1)</script> Ltd.' } as GrievanceIntakeData;
    const r = buildHearingBundle(spicy, []);
    expect(r.html).toContain('Wm. Scott');
    expect(r.html).not.toContain('<script>alert(1)</script>');
    expect(r.html).toContain('&lt;script&gt;');
  });

  it('contains no em-dashes and no contractions', () => {
    const r = buildHearingBundle(baseIntake, ['will_say']);
    expect(r.html).not.toMatch(/—/);
    expect(r.html).not.toMatch(/\b(don't|can't|won't|isn't|doesn't)\b/i);
  });
});
