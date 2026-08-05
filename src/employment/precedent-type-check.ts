/**
 * Does this precedent look like the document it is being taught for?
 *
 * A firm's timetable materials are three documents that live in the same
 * folder: the notice of motion, the consent order, and the draft order.
 * Uploading the wrong three to the wrong card builds a profile that then
 * shapes every later draft of that type, silently and wrongly. Nothing
 * checked this before.
 *
 * The check is deliberately CONSERVATIVE. It speaks only when a precedent
 * carries the strong markers of a DIFFERENT known document type and none
 * of the target's: a warning that is wrong is worse than no warning,
 * because the lawyer stops reading them. A precedent it cannot classify
 * passes without comment.
 *
 * Deterministic: no model call.
 */

export interface TypeSignature {
  label: string;
  /** Any of these present is a strong signal of this type. */
  markers: RegExp[];
  /** These must be ABSENT for the type to match (a consent order is not a contested order). */
  disqualifiers?: RegExp[];
}

const SIGNATURES: Record<string, TypeSignature> = {
  sp_timetable_motion: {
    label: 'a notice of motion',
    markers: [/notice of motion/i, /the motion is for/i, /the grounds for (the|this) motion/i, /will make a motion/i],
  },
  consent_timetable_order: {
    label: 'a consent order',
    markers: [/on consent/i, /the parties consent/i, /consent of (all )?(the )?parties/i, /consent order/i],
  },
  timetable_order: {
    label: 'an order',
    markers: [/this court orders/i, /^order\b/im, /was heard this/i, /on hearing the submissions/i],
    // A consent order is a different document, and it is the one most
    // likely to be uploaded here by mistake.
    disqualifiers: [/on consent/i, /the parties consent/i, /consent order/i],
  },
  motion_affidavit: {
    label: 'an affidavit',
    markers: [/make oath and say/i, /affirm and say/i, /sworn before me/i, /affirmed before me/i],
  },
  mediation_brief: {
    label: 'a mediation brief',
    markers: [/mediation brief/i, /brief of the plaintiff/i],
  },
  statement_of_claim: {
    label: 'a statement of claim',
    markers: [/statement of claim/i, /the plaintiff claims/i],
  },
  demand_letter: {
    label: 'a demand letter',
    markers: [/without prejudice/i, /we act for/i, /demand (is made|that your client)/i],
  },
  rule49_offer: {
    label: 'an offer to settle',
    markers: [/offer to settle/i, /rule 49/i, /form 49a/i],
  },
  settlement_minutes: {
    label: 'minutes of settlement',
    markers: [/minutes of settlement/i, /full and final release/i],
  },
};

export interface PrecedentTypeIssue {
  name: string;
  message: string;
}

function matches(sig: TypeSignature, text: string): boolean {
  if (sig.disqualifiers?.some(d => d.test(text))) return false;
  return sig.markers.some(m => m.test(text));
}

/**
 * Report precedents that look like a different document type. Returns one
 * issue per suspect file, naming what it appears to be.
 */
export function checkPrecedentTypes(
  precedents: Array<{ name: string; text: string }>,
  documentType: string,
): PrecedentTypeIssue[] {
  const target = SIGNATURES[documentType];
  if (!target) return [];

  const issues: PrecedentTypeIssue[] = [];
  for (const p of precedents) {
    // The opening pages carry the identifying markers; a later mention of
    // "notice of motion" inside an order should not confuse the check.
    const head = p.text.slice(0, 4_000);
    if (matches(target, head)) continue;

    // It does not look like the target. Does it strongly look like
    // something else we know?
    const otherHit = Object.entries(SIGNATURES)
      .filter(([key]) => key !== documentType)
      .find(([, sig]) => matches(sig, head));

    if (otherHit) {
      issues.push({
        name: p.name,
        message: `"${p.name}" looks like ${otherHit[1].label}, not ${target.label}.`,
      });
    }
    // Unclassifiable precedents pass without comment: silence beats a
    // warning the lawyer learns to ignore.
  }
  return issues;
}
