/**
 * Mediation brief outline — the section-by-section skeleton of the narrative.
 *
 * The mediation brief is deterministic tables (profile, damages, comparables,
 * negotiation) wrapped around a model-written narrative, with a fixed cover and
 * sign-off. Like the factum, the narrative sections are all model-drafted, so
 * the outline follows the factum pattern: draft each section, read it, edit it,
 * approve it, then assemble. The deterministic tables and the cover/sign-off
 * are furniture, not sections; assembly wraps the approved narrative with them.
 *
 * The section set is the firm's own flow headings where a style profile
 * supplies them, or the eight standard sections otherwise.
 */

export type MediationSectionDraftStatus = 'not_drafted' | 'drafted' | 'approved';

export interface MediationSection {
  id: string;
  header: string;
  /** What the section covers; guides the per-section draft. */
  guidance: string;
}

export interface MediationOutlineSection extends MediationSection {
  draftStatus: MediationSectionDraftStatus;
  hasDraft: boolean;
  approved: boolean;
  generatedAt?: string;
  html?: string;
  reviewFlags?: string[];
}

export interface MediationSectionDraft {
  html: string;
  approved: boolean;
  generatedAt: string;
  reviewFlags?: string[];
}

export interface MediationDraftState {
  sections: Record<string, MediationSectionDraft>;
}

/** The eight standard sections, in order, with what each covers. Mirrors the
 *  mediation-brief system prompt so a section agrees with the whole-document
 *  path. */
export const MEDIATION_SECTIONS: MediationSection[] = [
  { id: 'OVERVIEW', header: 'Overview', guidance: 'Two or three sentences: who the plaintiff is, what happened, and what this case is really about. A mediator should understand the case from this paragraph alone.' },
  { id: 'FACTUAL_BACKGROUND', header: 'Factual Background', guidance: 'A chronological narrative of the employment relationship, the dismissal, and post-termination events. State facts, not arguments. Keep it tight; facts that do not move the assessment do not belong.' },
  { id: 'ISSUES_IN_DISPUTE', header: 'Issues in Dispute', guidance: 'Each live issue with the plaintiff\'s position AND the anticipated defence position, stated fairly. Do not argue settled law; spend analysis only on genuinely contested questions (for example an enforceability challenge to a termination clause).' },
  { id: 'RESPONSE_TO_DEFENCES', header: 'Response to Anticipated Defences', guidance: 'Address the real weaknesses head-on and first. If just cause is alleged, put the plaintiff\'s version on the table squarely. Where a position is weak, be candid; where a defence position is weak, say why calmly.' },
  { id: 'MITIGATION', header: 'Mitigation', guidance: 'Summarize the plaintiff\'s mitigation efforts and any earnings to date. If a mitigation log or chart exists, refer to it as an attachment. Never overstate.' },
  { id: 'SETTLEMENT_POSITION', header: 'Settlement Position', guidance: 'Tie the numbers to the litigation alternative: where the action stands, what steps and costs lie ahead for both sides, and why resolving now beats that alternative. Present the plaintiff\'s realistic range grounded in the damages and comparable cases, with statutory entitlements as the floor. Realistic, not aspirational; never propose a range at or beneath the employer\'s standing offer.' },
  { id: 'MEDIATION_OBJECTIVES', header: 'Mediation Objectives', guidance: 'What the plaintiff seeks, monetary and non-monetary (reference letter, benefits continuation, non-disparagement, tax structuring of the settlement).' },
  { id: 'PRACTICAL_CONSIDERATIONS', header: 'Practical Considerations', guidance: 'Anything that genuinely bears on settlement (limitation or scheduling pressure, cost exposure, the client\'s circumstances and desire for closure).' },
];

/** The effective section set: the firm's own flow headings where the style
 *  profile supplies at least three, otherwise the eight standard sections. */
export function mediationSections(styleFlowHeadings?: string[] | null): MediationSection[] {
  const firm = (styleFlowHeadings ?? []).map(h => h.trim()).filter(Boolean);
  if (firm.length >= 3) {
    return firm.map((header, i) => ({
      id: `FIRM_${i + 1}`,
      header,
      guidance: `Cover the substance that belongs under "${header}" for a plaintiff's mediation brief, in the firm's structure. State facts and positions, not settled law.`,
    }));
  }
  return MEDIATION_SECTIONS;
}

export function buildMediationOutline(
  sections: MediationSection[],
  draft: MediationDraftState | undefined,
): MediationOutlineSection[] {
  return sections.map(s => {
    const d = draft?.sections?.[s.id];
    return {
      ...s,
      hasDraft: Boolean(d),
      approved: Boolean(d?.approved),
      generatedAt: d?.generatedAt,
      html: d?.html,
      reviewFlags: d?.reviewFlags,
      draftStatus: !d ? 'not_drafted' : d.approved ? 'approved' : 'drafted',
    };
  });
}

export function mediationDraftReadiness(sections: MediationOutlineSection[]): {
  total: number;
  drafted: number;
  approved: number;
  allApproved: boolean;
} {
  const total = sections.length;
  const drafted = sections.filter(s => s.hasDraft).length;
  const approved = sections.filter(s => s.approved).length;
  return { total, drafted, approved, allApproved: total > 0 && approved === total };
}

/** Assemble the approved sections into the narrative HTML the mediation
 *  furniture wraps: each section's heading then its paragraphs, in order. */
export function assembleMediationNarrative(sections: MediationOutlineSection[]): string {
  return sections
    .map(s => `<h2>${s.header}</h2>\n${s.html ?? ''}`)
    .join('\n\n');
}
