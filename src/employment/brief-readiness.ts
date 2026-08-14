/**
 * Brief readiness — what the mediation brief will be missing, BEFORE the
 * lawyer pays for a generation to find out.
 *
 * Every check here mirrors a decision the deterministic assemblers make at
 * generation time (a table omitted, a row rendered [LAWYER: complete], an
 * honest "no negotiations to date"). Running them up front turns a
 * generate-inspect-fix-regenerate loop into a checklist with jump links.
 *
 * Deterministic: no model call, no remote lookups.
 */

import type { EmploymentIntakeData, IntakeAnalysisResult } from '../types/employment-intake.js';

export interface ReadinessItem {
  /** ok: will render fully; warn: a visible hole in the brief; info: an honest omission the lawyer may accept. */
  level: 'ok' | 'warn' | 'info';
  label: string;
  hint?: string;
  /** Matter tab that fixes it. */
  goTo?: 'intake' | 'issues' | 'negotiation' | 'docs' | 'draft';
}

export function briefReadiness(args: {
  intake: EmploymentIntakeData | null;
  analysis: IntakeAnalysisResult | null;
  approvedIssuesCount: number;
  negotiationCount: number;
  caselawConfigured: boolean;
  styleProfilesCount: number;
  sourcesCount: number;
  mediationDocketed: boolean;
}): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const { intake, analysis } = args;

  if (!intake || !analysis) {
    items.push({ level: 'warn', label: 'Intake and analysis are the foundation; run the analysis first.', goTo: 'issues' });
    return items;
  }

  if (args.approvedIssuesCount === 0) {
    items.push({
      level: 'warn',
      label: 'No approved issues.',
      hint: 'The brief argues only issues you have approved; right now it would argue none.',
      goTo: 'issues',
    });
  } else {
    items.push({ level: 'ok', label: `Arguing ${args.approvedIssuesCount} approved issue${args.approvedIssuesCount === 1 ? '' : 's'}.` });
  }

  if (analysis.bardalFactors?.age == null) {
    items.push({
      level: 'warn',
      label: 'Client age unknown.',
      hint: 'The profile table’s age row will read [LAWYER: complete]. Add the date of birth on the Intake tab.',
      goTo: 'intake',
    });
  } else {
    items.push({ level: 'ok', label: `Age at dismissal: ${analysis.bardalFactors.age}.` });
  }

  if (!intake.annual_salary) {
    items.push({
      level: 'warn',
      label: 'No salary on the intake.',
      hint: 'The damages table cannot be built without compensation.',
      goTo: 'intake',
    });
  } else {
    items.push({ level: 'ok', label: 'Compensation present; damages table will render.' });
  }

  const hasService = (intake.hire_date ?? intake.first_day_of_work) && intake.termination_date;
  if (!hasService) {
    items.push({
      level: 'warn',
      label: 'Service dates incomplete.',
      hint: 'Length of service drives the notice range; add hire and termination dates.',
      goTo: 'intake',
    });
  }

  if (args.negotiationCount === 0) {
    items.push({
      level: 'info',
      label: 'No offers on the ledger.',
      hint: 'The brief will honestly say there have been no substantive negotiations. If offers HAVE been exchanged, record them first; mediators expect the full history.',
      goTo: 'negotiation',
    });
  } else {
    items.push({ level: 'ok', label: `Negotiation history: ${args.negotiationCount} entr${args.negotiationCount === 1 ? 'y' : 'ies'}.` });
  }

  // The route only runs the lookup when the tenure is computable, so the
  // promise here has to carry the same condition or the brief arrives
  // without the table the checklist swore was coming.
  const tenureKnown = Boolean(args.intake && ((args.intake.hire_date ?? args.intake.first_day_of_work) && args.intake.termination_date
    || args.intake.years_of_service_estimate != null));
  items.push(!args.caselawConfigured
    ? { level: 'info', label: 'Case library not configured; the comparables table will be omitted with a flag.' }
    : tenureKnown
      ? { level: 'ok', label: 'Comparable cases will be looked up from the case library.' }
      : { level: 'info', label: 'Comparables need the length of service: add the hire and termination dates (or the years of service estimate) on the Intake tab.', goTo: 'intake' });

  items.push(args.styleProfilesCount > 0
    ? { level: 'ok', label: `${args.styleProfilesCount} firm style${args.styleProfilesCount === 1 ? '' : 's'} available; pick one beside Generate.` }
    : { level: 'info', label: 'No firm style yet. Teach your style from two or more precedents and the brief follows your flow and voice.', goTo: 'draft' });

  items.push(args.sourcesCount > 0
    ? { level: 'ok', label: `${args.sourcesCount} position source${args.sourcesCount === 1 ? '' : 's'} will ground the story.` }
    : { level: 'info', label: 'No position documents. Attach the statement of claim or demand letter so the brief argues what you served.', goTo: 'draft' });

  items.push(args.mediationDocketed
    ? { level: 'ok', label: 'Mediation date is on the docket.' }
    : { level: 'info', label: 'No mediation date set. Enter it with the mediator’s name and it goes on your docket.', goTo: 'draft' });

  return items;
}
