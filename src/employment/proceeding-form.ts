/**
 * Action or application: the same case, brought two ways.
 *
 * A wrongful dismissal can be commenced as an action (Statement of Claim,
 * Form 14A) or, where the dispute turns on interpreting the contract rather
 * than on contested facts, as an application (Notice of Application, Form
 * 14E). The firm's pleading language is the same either way, which is why this
 * is a form toggle on the claim rather than a second generator: fifteen of the
 * twenty-one nodes carry over untouched.
 *
 * What changes is real, though, and most of it is not cosmetic:
 *
 * 1. An application is heard on affidavit evidence, with no discovery and no
 *    trial. Heads of relief that need findings about the employer's conduct or
 *    a witness's credibility cannot be pursued, so the nodes that plead them
 *    are suppressed and the lawyer is told which and why. Silently dropping a
 *    cause the lawyer had approved would be the worst possible behaviour here.
 * 2. Relief leads with declarations rather than damages heads. Judgment for
 *    the notice period still follows from the declaration; it is the
 *    trial-dependent heads (aggravated, moral, punitive) that are unavailable.
 * 3. The parties are the Applicant and the Respondent.
 *
 * Deterministic: no model call.
 */

export type ProceedingForm = 'action' | 'application';

export type PartyLabels = { claimant: string; opposite: string };

export function partyLabels(form: ProceedingForm): PartyLabels {
  return form === 'application'
    ? { claimant: 'Applicant', opposite: 'Respondent' }
    : { claimant: 'Plaintiff', opposite: 'Defendant' };
}

/**
 * Causes that cannot be pursued on an application, and the reason each one
 * cannot, in the words the lawyer should read.
 *
 * The test is not "is this a damages claim" but "does proving it need a trial".
 * Bad faith in the manner of dismissal turns on the employer's conduct and the
 * effect on the employee; misrepresentation turns on what was said and relied
 * on; defamation turns on publication and meaning. Each needs findings that an
 * application, decided on a paper record, cannot make.
 */
export const TRIAL_DEPENDENT_NODES: Record<string, string> = {
  SOC_BAD_FAITH_01: 'Bad faith in the manner of dismissal turns on the employer\'s conduct and its effect on the employee. An application is decided on affidavit evidence with no discovery and no trial, so aggravated and moral damages cannot be pursued this way.',
  SOC_MISREP_01: 'Negligent misrepresentation turns on what was represented and what was relied on, which needs findings of fact an application cannot make.',
  SOC_DEFAM_01: 'Defamation turns on publication, meaning and defences, none of which can be determined on a paper record.',
};

/**
 * Which of the currently active nodes an application cannot carry.
 *
 * Returns the suppressed ids alongside a lawyer-facing flag for each, so the
 * caller can drop them from the document AND say so on the draft. A cause the
 * lawyer approved and then does not see in the output must be accounted for.
 */
export function suppressedForApplication(
  activeNodeIds: string[],
  headers: Record<string, string> = {},
): { suppressed: string[]; flags: string[] } {
  const suppressed = activeNodeIds.filter(id => id in TRIAL_DEPENDENT_NODES);
  const flags = suppressed.map(id => {
    const header = headers[id] ? `"${headers[id]}"` : id;
    return `Not pleaded on this application: ${header}. ${TRIAL_DEPENDENT_NODES[id]} To pursue it, commence an action instead.`;
  });
  return { suppressed, flags };
}

export type ApplicationReliefInput = {
  /** The employer, as it should read in the relief. */
  respondent: string;
  /** Months of reasonable notice claimed. */
  noticeMonths?: number | null;
  /** The amount that follows from the notice period. */
  amountCad?: number | null;
  /** The matter pleads that the termination provision is unenforceable. */
  challengesTerminationClause: boolean;
  /** The matter pleads Human Rights Code damages. */
  humanRights: boolean;
};

const cad = (n: number): string => `$${Math.round(n).toLocaleString('en-CA')}`;

/**
 * The relief an application asks for: declarations first, then the judgment
 * that follows from them.
 *
 * This replaces the claim's CLAIM node rather than editing it, because the two
 * are different documents at this point: a claim opens "The Plaintiff claims
 * against the Defendant" and lists heads of damages, while an application
 * opens "THE APPLICANT MAKES APPLICATION FOR" and asks the court to declare
 * something.
 */
export function applicationRelief(input: ApplicationReliefInput): string {
  const items: string[] = [];

  if (input.challengesTerminationClause) {
    items.push('a declaration that the termination provision in the applicant\'s employment agreement is unenforceable and of no force or effect');
  }
  items.push(`a declaration that the applicant was wrongfully dismissed by ${input.respondent}`);

  const period = input.noticeMonths && input.noticeMonths > 0
    ? `${input.noticeMonths} months`
    : '[LAWYER: notice period]';
  items.push(`a declaration that the applicant was entitled to ${period} of notice of the termination of the applicant's employment, or pay in lieu of that notice`);

  items.push(input.amountCad && input.amountCad > 0
    ? `judgment in the amount of ${cad(input.amountCad)}, being pay in lieu of the notice to which the applicant was entitled, together with the value of all employment benefits and perquisites over that period`
    : 'judgment in the amount of the pay in lieu of notice to which the applicant was entitled, together with the value of all employment benefits and perquisites over that period, in an amount to be determined');

  if (input.humanRights) {
    items.push('damages under section 46.1 of the Human Rights Code for injury to dignity, feelings and self-respect');
  }

  items.push('prejudgment and postjudgment interest under sections 128 and 129 of the Courts of Justice Act');
  items.push('the costs of this application');
  items.push('such further and other relief as this Honourable Court considers just');

  const letters = 'abcdefghijklmnopqrstuvwxyz';
  const body = items
    .map((text, i) => `<p>({{para_alpha_${letters[i]}}}) ${text};</p>`)
    .join('\n');

  return `<h2>THE APPLICANT MAKES APPLICATION FOR:</h2>\n${body}`;
}

/** Lettered relief items are lettered, not numbered: the paragraph sequence
 *  belongs to the grounds. Applied after assembly so the two never collide. */
export function letterReliefItems(html: string): string {
  const letters = 'abcdefghijklmnopqrstuvwxyz';
  let i = 0;
  return html.replace(/\{\{para_alpha_[a-z]\}\}/g, () => letters[i++] ?? '?');
}

/**
 * The firm's pleading language names the Plaintiff and the Defendant, because
 * it was written for a claim. On an application the same sentences must name
 * the Applicant and the Respondent, including inside the defined terms the
 * nodes establish, so the document is consistent from the style of cause to
 * the backsheet.
 *
 * A deterministic relabel rather than a second node library: 171 mentions of
 * "Plaintiff" and 105 of "Defendant" across twenty-one nodes is not something
 * to maintain twice.
 */
export function relabelParties(html: string, form: ProceedingForm): string {
  if (form !== 'application') return html;
  return html
    .replace(/\bPlaintiffs\b/g, 'Applicants')
    .replace(/\bplaintiffs\b/g, 'applicants')
    .replace(/\bPlaintiff\b/g, 'Applicant')
    .replace(/\bplaintiff\b/g, 'applicant')
    .replace(/\bDefendants\b/g, 'Respondents')
    .replace(/\bdefendants\b/g, 'respondents')
    .replace(/\bDefendant\b/g, 'Respondent')
    .replace(/\bdefendant\b/g, 'respondent');
}
