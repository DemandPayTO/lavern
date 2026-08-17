/**
 * Factum outline — the section-by-section skeleton of a summary-judgment factum.
 *
 * A factum is drafted one section at a time: the lawyer drafts each section,
 * reads it, tweaks its guidance, regenerates it, and approves it. The approved
 * sections are then assembled into the numbered factum with its schedules. This
 * module is the pure model of that outline; drafting lives in
 * factum-section-generator.ts and assembly in factum-assemble.ts.
 *
 * The outline is uniform: every part is a section the lawyer drafts and
 * approves. The structural sections (Overview, Facts, Order) are always
 * present; the argument sections (Part III) come from the factum argument
 * library, selected by the matter's approved issues, in the picker's order.
 * Schedule A (authorities) and Schedule B (legislation) are not sections; they
 * are assembled deterministically from the sections' authorities.
 */

import type { FactumNodeReport } from './factum-nodes.js';

export type FactumSectionKind = 'overview' | 'facts' | 'argument' | 'order';
export type FactumSectionDraftStatus = 'not_drafted' | 'drafted' | 'approved';

/** One row of the factum outline, with its current draft status. */
export interface FactumOutlineSection {
  /** 'OVERVIEW' | 'FACTS' | 'ORDER' for the structural parts; the argument
   *  node's blockId for a Part III section. */
  id: string;
  kind: FactumSectionKind;
  /** 'Part I' … 'Part IV', for the workspace to group by. */
  partLabel: string;
  /** The section heading, as it appears in the factum. */
  header: string;
  /** Argument sections carry the firm's settled argument as guidance. */
  guidance?: string;
  /** Argument sections carry the authorities to cite. */
  authorities?: string;
  /** A custom section the firm added (Part III only). */
  custom: boolean;
  draftStatus: FactumSectionDraftStatus;
  hasDraft: boolean;
  approved: boolean;
  /** When the current draft of this section was generated. */
  generatedAt?: string;
  /** The current draft's HTML, so the workspace can preview it after reload. */
  html?: string;
  /** Review flags raised on the current draft. */
  reviewFlags?: string[];
}

/** The per-matter draft state, stored on the matter (matter.factumDraft). */
export interface FactumDraftState {
  sections: Record<string, FactumSectionDraft>;
}

export interface FactumSectionDraft {
  html: string;
  approved: boolean;
  generatedAt: string;
  reviewFlags?: string[];
}

/** The two structural sections that always lead a factum, in order. */
const LEADING_STRUCTURAL: Array<{ id: string; kind: FactumSectionKind; partLabel: string; header: string }> = [
  { id: 'OVERVIEW', kind: 'overview', partLabel: 'Part I', header: 'Overview' },
  { id: 'FACTS', kind: 'facts', partLabel: 'Part II', header: 'The Facts' },
];

/** The Order Requested always closes the factum (Part IV, after the arguments). */
const ORDER_SECTION: { id: string; kind: FactumSectionKind; partLabel: string; header: string } = {
  id: 'ORDER', kind: 'order', partLabel: 'Part IV', header: 'The Order Requested',
};

/**
 * Build the full outline: the leading structural sections, then the selected
 * Part III argument sections in the picker's order, then the Order. Each is
 * stamped with its draft status from the matter's saved draft.
 */
export function buildFactumOutline(
  selectedArguments: FactumNodeReport[],
  draft: FactumDraftState | undefined,
): FactumOutlineSection[] {
  const stamp = (
    base: Omit<FactumOutlineSection, 'draftStatus' | 'hasDraft' | 'approved' | 'generatedAt' | 'html' | 'reviewFlags'>,
  ): FactumOutlineSection => {
    const d = draft?.sections?.[base.id];
    return {
      ...base,
      hasDraft: Boolean(d),
      approved: Boolean(d?.approved),
      generatedAt: d?.generatedAt,
      html: d?.html,
      reviewFlags: d?.reviewFlags,
      draftStatus: !d ? 'not_drafted' : d.approved ? 'approved' : 'drafted',
    };
  };

  const out: FactumOutlineSection[] = [];
  for (const s of LEADING_STRUCTURAL) out.push(stamp({ ...s, custom: false }));
  for (const a of selectedArguments) {
    out.push(stamp({
      id: a.blockId,
      kind: 'argument',
      partLabel: 'Part III',
      header: a.sectionHeader,
      guidance: a.guidance,
      authorities: a.authorities,
      custom: a.custom,
    }));
  }
  out.push(stamp({ ...ORDER_SECTION, custom: false }));
  return out;
}

/** Whether an id names one of the always-present structural sections. */
export function isStructuralSectionId(id: string): boolean {
  return id === 'OVERVIEW' || id === 'FACTS' || id === 'ORDER';
}

export function structuralSectionKind(id: string): FactumSectionKind | null {
  if (id === 'OVERVIEW') return 'overview';
  if (id === 'FACTS') return 'facts';
  if (id === 'ORDER') return 'order';
  return null;
}

/** A glance at how far the factum has been drafted, for the workspace summary. */
export function factumDraftReadiness(sections: FactumOutlineSection[]): {
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
