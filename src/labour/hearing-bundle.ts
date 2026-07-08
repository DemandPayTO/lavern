/**
 * Hearing bundle skeleton — the arbitration binder, assembled deterministically.
 *
 * Pure arithmetic over the intake and the matter's generated documents: a
 * cover page, the tab index in hearing order, the witness list, a
 * hearing-day checklist, and an explicit gaps list naming every piece that
 * is still missing. No model call, no cost, loopable in tests.
 *
 * The bundle does not reproduce the documents themselves; it is the
 * organizing skeleton the representative assembles the binder from.
 */

import type { GrievanceIntakeData } from '../types/labour-intake.js';

export interface HearingBundleResult {
  html: string;
  documentTitle: string;
  reviewerFlags: string[];
}

interface TabSpec {
  label: string;
  source: string;
  present: boolean;
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

/**
 * Assemble the bundle skeleton.
 * `generatedDocTypes` is the set of generated_* document types present on
 * the matter (for example ['grievance_filing', 'will_say']).
 */
export function buildHearingBundle(
  intake: GrievanceIntakeData,
  generatedDocTypes: string[],
): HearingBundleResult {
  const generated = new Set(generatedDocTypes);
  const grievor = [intake.grievor_first_name, intake.grievor_last_name].filter(Boolean).join(' ') || '[Grievor]';
  const union = intake.union_name || '[Union]';
  const employer = intake.employer_name || '[Employer]';
  const isDischarge = intake.grievance_type === 'discharge';

  const tabs: TabSpec[] = [
    { label: 'Collective agreement (relevant articles flagged)', source: intake.ca_title ? `CA on file: ${intake.ca_title}` : 'CA not recorded on the intake', present: Boolean(intake.ca_title) },
    { label: `Grievance${intake.grievance_number ? ` #${intake.grievance_number}` : ''} and step responses`, source: intake.grievance_filed ? `Filed ${intake.grievance_filed_date ?? '[date]'}` : 'Grievance not yet filed', present: Boolean(intake.grievance_filed) },
    { label: 'Discipline letter and employer grounds', source: intake.discipline_letter_date ? `Letter dated ${intake.discipline_letter_date}` : 'No discipline letter date recorded', present: Boolean(intake.discipline_letter_date) || (intake.discipline_imposed ?? 'none') === 'none' },
    { label: 'Particulars of the grievance', source: 'Generated document', present: generated.has('particulars') },
    { label: 'Production request and employer disclosure', source: 'Generated document', present: generated.has('production_request') },
    { label: 'Will-say statements', source: 'Generated document', present: generated.has('will_say') },
    { label: 'Agreed statement of facts (proposed)', source: 'Generated document', present: generated.has('agreed_facts') },
    { label: 'Remedy worksheet (back pay and make-whole)', source: 'Generated document', present: generated.has('remedy_worksheet') },
    { label: 'Prior discipline record and sunset position', source: intake.prior_discipline ? 'Prior discipline exists; obtain the record' : 'No prior discipline per intake', present: !intake.prior_discipline || Boolean(intake.prior_discipline_details) },
    { label: 'Authorities (book of authorities)', source: generated.has('closing_argument') ? 'Start from the closing argument skeleton' : 'Assemble with the closing argument', present: generated.has('closing_argument') },
  ];

  const witnesses = intake.witnesses ?? [];
  const gaps = tabs.filter((t) => !t.present);

  const checklist = [
    'Confirm the hearing date, location or videoconference details, and the arbitrator',
    'Serve the will-say statements and any disclosure the CA or the arbitrator requires',
    'Exchange the proposed agreed statement of facts with the employer',
    isDischarge ? 'Prepare the grievor to testify first on the Wm. Scott factors' : 'Confirm the order of proceedings with the employer',
    'Confirm every witness attendance and prepare each from their will-say',
    'Bring three copies of the bundle: arbitrator, employer, union',
    intake.believes_discriminatory ? 'Human rights dimension: confirm the Code issues are squarely raised (Parry Sound)' : null,
    (intake.witnesses ?? []).length === 0 ? 'No witnesses recorded on the intake: confirm who testifies' : null,
  ].filter((item): item is string => Boolean(item));

  const parts: string[] = [];
  parts.push(`<h1>Hearing Bundle: ${esc(union)} and ${esc(employer)}</h1>`);
  parts.push(`<p><strong>Grievance of ${esc(grievor)}</strong>${intake.grievance_number ? ` (Grievance #${esc(intake.grievance_number)})` : ''}${intake.grievance_type ? ` &middot; ${esc(String(intake.grievance_type))}` : ''}</p>`);

  parts.push('<h2>Tab index</h2><ol>');
  for (const tab of tabs) {
    parts.push(`<li><strong>${esc(tab.label)}</strong> &middot; ${esc(tab.source)}${tab.present ? '' : ' &middot; <strong>MISSING</strong>'}</li>`);
  }
  parts.push('</ol>');

  parts.push('<h2>Witnesses</h2>');
  if (witnesses.length > 0) {
    parts.push('<ol>');
    for (const w of witnesses) {
      parts.push(`<li><strong>${esc(w.name)}</strong>${w.role ? `, ${esc(w.role)}` : ''}${w.topics ? ` &middot; speaks to: ${esc(w.topics)}` : ''}</li>`);
    }
    parts.push('</ol>');
  } else {
    parts.push('<p>No witnesses recorded on the intake. Add them on the Intake tab; the will-say generator uses the same list.</p>');
  }

  parts.push('<h2>Hearing-day checklist</h2><ol>');
  for (const item of checklist) parts.push(`<li>${esc(item)}</li>`);
  parts.push('</ol>');

  if (gaps.length > 0) {
    parts.push('<h2>Still missing from this bundle</h2><ol>');
    for (const gap of gaps) parts.push(`<li>${esc(gap.label)}</li>`);
    parts.push('</ol>');
  }

  return {
    html: parts.join('\n'),
    documentTitle: 'Hearing Bundle Skeleton',
    reviewerFlags: [
      'tab_contents_assembled_and_paginated',
      'disclosure_served_per_ca_or_directions',
      'witness_attendance_confirmed',
      ...(gaps.length > 0 ? ['missing_tabs_resolved'] : []),
    ],
  };
}
