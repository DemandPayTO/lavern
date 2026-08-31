// Each document's own section shape, mapped into the one the shared outline
// panel renders.
//
// This is where the documents are allowed to differ, and the differences are
// small: the claim's pleading nodes are readable but never drafted and revert
// rather than discard; the factum's sections carry a Part label and their
// authorities; the brief's carry neither. Everything else about reading,
// editing and approving a section is identical, which is why the panel is one
// component rather than three.
//
// Keeping the mapping here rather than in MatterDetailView keeps that file from
// growing another hundred lines of presentational branching.

import type { OutlineSectionUI } from './DocumentOutlinePanel.js';

// ── The claim ────────────────────────────────────────────────────────────

export type SocOutlineSectionUI = {
  id: string;
  kind: 'facts' | 'node';
  header: string;
  html: string;
  missing: string[];
  edited: boolean;
  approved: boolean;
  draftStatus: 'not_drafted' | 'rendered' | 'drafted' | 'approved';
  generatedAt?: string;
  reviewFlags?: string[];
  lawyerReview: boolean;
};

export function socOutlineSections(sections: SocOutlineSectionUI[]): OutlineSectionUI[] {
  return sections.map(s => {
    const hasText = Boolean(s.html && s.html.trim());
    return {
      id: s.id,
      header: s.header,
      html: s.html,
      status: s.approved ? 'approved'
        : s.edited ? 'edited'
          : s.draftStatus === 'drafted' ? 'drafted'
            : s.draftStatus === 'not_drafted' ? 'not_drafted'
              : 'as_pleaded',
      approved: s.approved,
      // A pleading node reads even before anything is drafted: its text is the
      // firm's own language, rendered.
      readable: hasText || s.kind === 'node',
      draftable: s.kind === 'facts',
      hasDraft: hasText,
      suffix: s.kind === 'facts' ? 'Starling drafts this' : undefined,
      notes: s.missing.length > 0
        ? [`${s.missing.length} blank${s.missing.length === 1 ? '' : 's'} to fill`]
        : undefined,
      reviewFlags: s.reviewFlags,
      // A node the lawyer has not touched has nothing to revert to.
      discardLabel: s.kind === 'facts'
        ? (hasText ? 'Discard' : undefined)
        : (s.edited || s.approved ? 'Revert to standard' : undefined),
      emptyText: 'Not drafted yet. Use draft to write the Background Facts.',
    };
  });
}

// ── The factum ───────────────────────────────────────────────────────────

export type FactumOutlineSectionUI = {
  id: string;
  kind: 'overview' | 'facts' | 'argument' | 'order';
  partLabel: string;
  header: string;
  guidance?: string;
  authorities?: string;
  custom: boolean;
  draftStatus: 'not_drafted' | 'drafted' | 'approved';
  hasDraft: boolean;
  approved: boolean;
  generatedAt?: string;
  html?: string;
  reviewFlags?: string[];
};

export function factumOutlineSections(sections: FactumOutlineSectionUI[]): OutlineSectionUI[] {
  return sections.map(s => ({
    id: s.id,
    header: s.header,
    html: s.html,
    status: s.draftStatus,
    approved: s.approved,
    readable: s.hasDraft,
    draftable: true,
    hasDraft: s.hasDraft,
    prefix: s.partLabel,
    suffix: s.custom ? 'your section' : undefined,
    detail: s.kind === 'argument' ? s.authorities : undefined,
    reviewFlags: s.reviewFlags,
    generatedAt: s.generatedAt,
    discardLabel: 'Discard',
  }));
}

// ── The mediation brief ──────────────────────────────────────────────────

export type MediationOutlineSectionUI = {
  id: string;
  header: string;
  guidance: string;
  draftStatus: 'not_drafted' | 'drafted' | 'approved';
  hasDraft: boolean;
  approved: boolean;
  generatedAt?: string;
  html?: string;
  reviewFlags?: string[];
};

export function mediationOutlineSections(sections: MediationOutlineSectionUI[]): OutlineSectionUI[] {
  return sections.map(s => ({
    id: s.id,
    header: s.header,
    html: s.html,
    status: s.draftStatus,
    approved: s.approved,
    readable: s.hasDraft,
    draftable: true,
    hasDraft: s.hasDraft,
    reviewFlags: s.reviewFlags,
    generatedAt: s.generatedAt,
    discardLabel: 'Discard',
  }));
}

// ── The copy each document carries ───────────────────────────────────────

export const OUTLINE_COPY = {
  soc: {
    title: 'Read the claim section by section',
    description: "Every pleading section, in order. The firm's sections plead in their settled language; read each, edit it by hand where you want to, and approve it. The Background Facts is the one section Starling drafts. Generate uses your approved or edited text where you set it, and the standard version elsewhere, so you never have to approve every section to file.",
    editHint: 'Paragraphs are <p>…</p>. Paragraph numbers are added when the claim assembles; do not number them here.',
  },
  factum: {
    title: 'Draft the factum section by section',
    description: 'Each part of the factum is a section you draft, read, and approve: the Overview, the Facts, each argument, and the Order. Draft one to read it on its own, or draft them all, then read each below and edit it by hand where you want to. Approve locks the section into the factum; Discard removes the draft. The Schedule of Authorities is built from the arguments you keep.',
    editHint: 'Paragraphs are <p>…</p>. Paragraph numbers are added when the factum assembles.',
  },
  mediation: {
    title: 'Draft the brief section by section',
    description: 'Each section of the narrative, in order. Draft one to read it on its own, or draft them all, then read each below and edit it by hand where you want to. Approve locks the section in; Discard removes the draft. The profile, damages, comparable-case and negotiation tables, the cover, and the sign-off are added when the brief assembles.',
    editHint: 'Paragraphs are <p>…</p>. Paragraph numbers are added when the brief assembles.',
  },
} as const;
