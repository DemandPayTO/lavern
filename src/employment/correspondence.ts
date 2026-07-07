/**
 * Client correspondence engine — scheduled, auto-drafted client emails the
 * lawyer reviews and sends. Starling drafts and alerts; it never sends to a
 * client. Every draft is deterministic ($0): merge fields over standing
 * templates, in professional Ontario legal register, with explicit
 * [LAWYER: ...] markers wherever firm judgment applies.
 *
 * First sequence: the mitigation series requested by the pilot firm.
 *   Step 1 (on enabling): the duty to mitigate explained, with the firm's
 *     guidance that a short recovery-and-planning period is reasonable
 *     before active applications begin (window configurable, 6-8 weeks).
 *   Step 2 (end of the window): the duty is now active; begin and document
 *     the search; the Mitigation Log from the Draft tab is the tracker.
 *
 * Due dates flow into the docket, the weekly digest, and the next-step
 * engine through collectCorrespondenceDeadlines.
 */

import type { EmploymentIntakeData } from '../types/employment-intake.js';

export type CorrespondenceStatus = 'scheduled' | 'drafted' | 'sent' | 'skipped';

export interface CorrespondenceDraft {
  subject: string;
  body: string;
  /** Instruction to the lawyer about what to attach, if anything. */
  attachmentHint?: string;
}

export interface CorrespondenceItem {
  id: string;
  sequence: string;
  step: number;
  title: string;
  /** ISO date the email should go out. */
  dueDate: string;
  status: CorrespondenceStatus;
  draft?: CorrespondenceDraft;
  statusHistory: Array<{ status: CorrespondenceStatus; at: string }>;
}

export interface FirmProfileLike {
  firmName?: string;
  firmEmail?: string;
}

const DAY_MS = 24 * 60 * 60 * 1000;

function isoDaysFrom(baseIso: string | undefined, days: number): string {
  const base = baseIso ? new Date(`${baseIso}T00:00:00`) : new Date();
  const d = new Date((isNaN(base.getTime()) ? new Date() : base).getTime() + days * DAY_MS);
  return d.toISOString().slice(0, 10);
}

/**
 * Start the mitigation series for a matter. followUpWeeks is the firm's
 * chosen window (6-8). The follow-up anchors on the termination date when
 * known (the duty runs from dismissal), otherwise on today.
 */
export function startMitigationSequence(
  intake: Partial<EmploymentIntakeData>,
  followUpWeeks: number,
): CorrespondenceItem[] {
  const weeks = Math.min(8, Math.max(6, Math.round(followUpWeeks)));
  const now = new Date().toISOString();
  const anchor = typeof intake.termination_date === 'string' && intake.termination_date
    ? intake.termination_date
    : undefined;
  // If the termination is already older than the window, the follow-up is
  // due now rather than in the past's shadow.
  let followUpDate = isoDaysFrom(anchor, weeks * 7);
  const today = new Date().toISOString().slice(0, 10);
  if (followUpDate < today) followUpDate = today;

  return [
    {
      id: 'mitigation-1',
      sequence: 'mitigation',
      step: 1,
      title: 'Duty to mitigate: initial client advice',
      dueDate: today,
      status: 'scheduled',
      statusHistory: [{ status: 'scheduled', at: now }],
    },
    {
      id: 'mitigation-2',
      sequence: 'mitigation',
      step: 2,
      title: `Mitigation follow-up and tracker (${weeks}-week mark)`,
      dueDate: followUpDate,
      status: 'scheduled',
      statusHistory: [{ status: 'scheduled', at: now }],
    },
  ];
}

/** Build the deterministic draft for a mitigation-series item. */
export function buildCorrespondenceDraft(
  item: CorrespondenceItem,
  intake: Partial<EmploymentIntakeData>,
  firm: FirmProfileLike,
  followUpWeeks: number,
): CorrespondenceDraft {
  const first = (intake.client_first_name ?? '').trim() || '[Client first name]';
  const firmName = (firm.firmName ?? '').trim() || '[Firm name]';
  const weeks = Math.min(8, Math.max(6, Math.round(followUpWeeks)));

  if (item.id === 'mitigation-1') {
    return {
      subject: 'Your matter: the duty to mitigate, and what to do first',
      body: [
        `Dear ${first},`,
        '',
        'We are writing to explain an obligation that applies in every wrongful dismissal matter: the duty to mitigate.',
        '',
        'In plain terms, the law expects a dismissed employee to take reasonable steps to find comparable employment. Income earned during the notice period can reduce the damages an employer must pay. A court will also consider whether the search itself was reasonable in scope and timing.',
        '',
        `That said, the duty does not require you to apply for the first available posting on day one. A short period to recover, take stock, and plan a proper search is generally reasonable. Our guidance in your circumstances is to use the next ${weeks} weeks for exactly that: rest, update your resume, gather references, and identify the roles and organizations that genuinely fit your experience and seniority. [LAWYER: confirm this window and guidance fit the client's circumstances before sending.]`,
        '',
        'Two things to do from today, regardless:',
        '',
        '1. Keep every document connected to your dismissal and your job search, including postings you review, applications you send, and responses you receive.',
        '2. Do not sign anything from your former employer, and do not accept any offer of new employment, before speaking with us.',
        '',
        `We will follow up with you at the end of this period with a simple tracker for recording your search. If anything changes in the meantime, or if an opportunity arises that you want to pursue sooner, contact us first: pursuing it may well be the right move, and we will confirm how it affects your claim.`,
        '',
        'Kind regards,',
        '',
        `[Lawyer name]`,
        firmName,
      ].join('\n'),
    };
  }

  if (item.id === 'mitigation-2') {
    return {
      subject: 'Your matter: beginning and documenting your job search',
      body: [
        `Dear ${first},`,
        '',
        `When we last wrote, we suggested using a ${weeks}-week period to recover and plan. That period has now ended, and the duty to mitigate calls for an active, documented search for comparable employment from this point forward.`,
        '',
        'What "comparable" means: roles of a similar nature, seniority, and compensation to the position you lost. You are not required to accept a demotion or a substantial pay cut, and you are not required to take the first offer that appears. You are required to search in good faith and to keep doing so while your claim is unresolved.',
        '',
        'What to do now:',
        '',
        '1. Begin applying to comparable roles, at a realistic and sustained pace.',
        '2. Record every step in the attached mitigation tracker: the date, the role, the employer, how you applied, and the outcome. Courts give real weight to a well-kept record, and gaps in the record are the most common way employers attack a claim.',
        '3. Send us the updated tracker at the end of each month, and tell us right away about any interview or offer. Do not accept or decline an offer before speaking with us.',
        '',
        'A documented search protects the full value of your claim. It is evidence that you did what the law asks, and it takes very little time if kept up as you go.',
        '',
        'Kind regards,',
        '',
        `[Lawyer name]`,
        firmName,
      ].join('\n'),
      attachmentHint: 'Generate the Mitigation Log on the Draft tab and attach it to this email before sending.',
    };
  }

  throw new Error(`Unknown correspondence item: ${item.id}`);
}

/** Correspondence items due soon or overdue, for docket/digest/next steps. */
export function collectCorrespondenceItems(
  correspondence: CorrespondenceItem[] | undefined,
): CorrespondenceItem[] {
  return (correspondence ?? []).filter(
    (c) => c.status === 'scheduled' || c.status === 'drafted',
  );
}
