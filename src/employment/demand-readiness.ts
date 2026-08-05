/**
 * Demand letter readiness — what the letter will be missing, BEFORE the
 * lawyer pays for a generation to find out.
 *
 * The same idea as brief-readiness.ts, but a demand letter fails in its own
 * ways. It is the first thing the other side reads, so its specific risks
 * are arguing a termination clause without having the clause, ignoring what
 * has already been paid, and claiming a full notice period for a client who
 * has been working somewhere else for months. Each check below mirrors a
 * decision the generator or the deterministic table actually makes.
 *
 * Deterministic: no model call, no remote lookups.
 */

import type { EmploymentIntakeData, IntakeAnalysisResult } from '../types/employment-intake.js';
import type { ReadinessItem } from './brief-readiness.js';

export type { ReadinessItem };

/** Issues whose argument rests on the exact words of the clause. */
const CLAUSE_ISSUES = [
  'termination_clause_invalidity',
  'waksdale_at_any_time',
  'machtinger_below_esa',
  'no_fresh_consideration',
  'dufault_language',
];

export function demandReadiness(args: {
  intake: EmploymentIntakeData | null;
  analysis: IntakeAnalysisResult | null;
  approvedIssues: string[];
  /** Source documents attached for this letter, by kind. */
  sourceKinds: string[];
  styleProfilesCount: number;
  /** Firm contact block from the user profile, for the signature. */
  firmContactComplete: boolean;
}): ReadinessItem[] {
  const items: ReadinessItem[] = [];
  const { intake, analysis } = args;

  if (!intake || !analysis) {
    items.push({
      level: 'warn',
      label: 'Intake and analysis are the foundation; run the analysis first.',
      goTo: 'issues',
    });
    return items;
  }

  // ── What the letter argues ─────────────────────────────────────────────

  if (args.approvedIssues.length === 0) {
    items.push({
      level: 'warn',
      label: 'No approved issues.',
      hint: 'The letter demands on the issues you have approved; right now it would demand on none.',
      goTo: 'issues',
    });
  } else {
    items.push({ level: 'ok', label: `Demanding on ${args.approvedIssues.length} approved issue${args.approvedIssues.length === 1 ? '' : 's'}.` });
  }

  // The clause arguments are the ones that turn on exact wording. Without
  // the text the prompt says "[not provided]" and the letter argues about a
  // clause it has never read.
  const arguesClause = args.approvedIssues.some(i => CLAUSE_ISSUES.includes(i));
  if (arguesClause) {
    if (!intake.termination_clause_text?.trim()) {
      items.push({
        level: 'warn',
        label: 'Arguing the termination clause without the clause text.',
        hint: 'The argument stands or falls on the exact words. Paste the clause on the Intake tab, or attach the employment agreement below.',
        goTo: 'intake',
      });
    } else {
      items.push({ level: 'ok', label: 'Termination clause text on file; the letter can quote it.' });
    }
  }

  // ── What the figures need ──────────────────────────────────────────────

  if (!intake.annual_salary) {
    items.push({
      level: 'warn',
      label: 'No compensation on the intake.',
      hint: 'The damages table is omitted entirely without it, and the letter demands a number it cannot show its work for.',
      goTo: 'intake',
    });
  } else {
    items.push({ level: 'ok', label: 'Compensation present; the damages table will itemise.' });
  }

  const hasService = (intake.hire_date ?? intake.first_day_of_work) && intake.termination_date;
  if (!hasService) {
    items.push({
      level: 'warn',
      label: 'Service dates incomplete.',
      hint: 'Length of service drives the notice range the demand rests on.',
      goTo: 'intake',
    });
  }

  // Mitigation: the other side will know about the new job whether or not
  // the letter does, and a demand that ignores it reads as unserious.
  if (intake.new_employment_found) {
    const since = intake.new_employment_start_date
      ? ` since ${intake.new_employment_start_date}`
      : '';
    items.push({
      level: 'warn',
      label: `Client re-employed${since}.`,
      hint: 'Enter the mitigation earnings beside Generate so the table nets them off. A demand that ignores known mitigation invites the reply that it is unserious.',
      goTo: 'draft',
    });
  }

  // Amounts already paid: same reasoning, from the other direction.
  if (intake.received_severance_offer) {
    const weeks = intake.severance_weeks_offered
      ? `${intake.severance_weeks_offered} weeks offered`
      : 'an offer was made';
    items.push({
      level: 'info',
      label: `Severance offer on the intake (${weeks}).`,
      hint: 'If any of it has been paid, enter it under "Already paid by the employer" so the table nets it and the demand is the net number.',
      goTo: 'draft',
    });
  }

  // ── Things that change what letter this is ─────────────────────────────

  if (intake.signed_release) {
    items.push({
      level: 'warn',
      label: 'The client has signed a release.',
      hint: 'A demand letter that does not address the release will be answered with it. Confirm the grounds for setting it aside before sending.',
      goTo: 'intake',
    });
  }

  const daysToLimitation = analysis.limitationDeadline?.daysRemaining;
  if (typeof daysToLimitation === 'number' && daysToLimitation <= 90) {
    items.push({
      level: 'warn',
      label: `Limitation period expires in ${daysToLimitation} day${daysToLimitation === 1 ? '' : 's'}.`,
      hint: 'A demand letter does not stop the clock. Consider issuing the claim alongside it.',
      goTo: 'draft',
    });
  }

  // ── What the letter is built from ──────────────────────────────────────

  const has = (kind: string) => args.sourceKinds.includes(kind);
  if (has('employment_agreement')) {
    items.push({ level: 'ok', label: 'Employment agreement attached; the letter quotes the operative wording.' });
  } else {
    items.push({
      level: 'info',
      label: 'No employment agreement attached.',
      hint: 'Attach it below and the letter argues from the words the parties actually signed.',
      goTo: 'draft',
    });
  }

  if (has('termination_letter')) {
    items.push({ level: 'ok', label: 'Termination letter attached; the letter answers what the employer actually said.' });
  } else {
    items.push({
      level: 'info',
      label: 'No termination letter attached.',
      hint: 'Attach it so the letter answers the employer’s stated reason rather than a paraphrase of it.',
      goTo: 'draft',
    });
  }

  if (intake.roe_wrong_or_missing && !has('roe')) {
    items.push({
      level: 'info',
      label: 'The intake says the ROE is wrong or missing, but no ROE is attached.',
      hint: 'Attach it and the letter can put the specific coding in issue.',
      goTo: 'draft',
    });
  }

  // ── How it will read ───────────────────────────────────────────────────

  items.push(args.firmContactComplete
    ? { level: 'ok', label: 'Firm contact details will fill the signature block.' }
    : {
        level: 'warn',
        label: 'Firm address, phone or email missing.',
        hint: 'The signature block on a letter you are about to send will carry fill-ins. Complete them on My Page.',
        goTo: 'draft',
      });

  items.push(args.styleProfilesCount > 0
    ? { level: 'ok', label: `${args.styleProfilesCount} firm style${args.styleProfilesCount === 1 ? '' : 's'} available; pick one beside Generate.` }
    : {
        level: 'info',
        label: 'No firm style yet for demand letters.',
        hint: 'Teach your style from two or more precedents and the letter follows your flow and voice.',
        goTo: 'draft',
      });

  return items;
}
