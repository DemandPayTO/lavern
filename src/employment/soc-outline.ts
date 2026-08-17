/**
 * SOC outline — the section-by-section skeleton of a Statement of Claim.
 *
 * The factum outline drafts every section with the model; the SOC is
 * different. Its pleading sections are the firm's nodes, which render
 * deterministically (renderNode), and only the Background Facts is written by
 * the model. So the SOC outline is: the active nodes, each rendered so the
 * lawyer can read the exact pleading, plus the Background Facts. Each section
 * can be read, edited by hand, and approved; the Background Facts can also be
 * drafted by the model. The section flow is ADDITIVE: assembly uses the
 * lawyer's approved or edited text where they set it, and the standard
 * rendered node (or a fresh Background Facts draft) everywhere else, so
 * generating never forces the lawyer to approve every deterministic node.
 *
 * Paragraph numbering is document-wide and mechanical (numberSocParagraphs
 * replaces {{para}} markers). A section's stored text therefore keeps its
 * {{para}} markers; the markers are stripped only for reading and editing, and
 * re-inserted when the lawyer's edit is saved, so the numbers stay correct.
 */

import { renderNode, AI_NARRATIVE_BLOCK } from './soc-nodes.js';
import type { SocNode } from './soc-nodes.js';
import { nodeStatuses } from './soc-nodes.js';

export type SocSectionKind = 'facts' | 'node';
export type SocSectionDraftStatus = 'not_drafted' | 'rendered' | 'drafted' | 'approved';

export interface SocOutlineSection {
  /** The node's blockId; the Background Facts uses the AI narrative block id. */
  id: string;
  kind: SocSectionKind;
  header: string;
  /** The reading text: the lawyer's edit/approval if set, else the rendered
   *  node (or the drafted facts). Paragraph markers stripped for display. */
  html: string;
  /** Blanks the render still needs, as [LAWYER: ...] (nodes only). */
  missing: string[];
  /** The lawyer has edited this section's text by hand. */
  edited: boolean;
  approved: boolean;
  draftStatus: SocSectionDraftStatus;
  generatedAt?: string;
  reviewFlags?: string[];
  lawyerReview: boolean;
}

export interface SocSectionDraft {
  /** Stored WITH {{para}} markers, so assembly numbers it document-wide. */
  html: string;
  approved: boolean;
  edited: boolean;
  generatedAt: string;
  reviewFlags?: string[];
}

export interface SocDraftState {
  sections: Record<string, SocSectionDraft>;
}

/** Strip the {{para}} numbering markers for reading and editing. */
export function stripParaMarkers(html: string): string {
  return html.replace(/\{\{para\}\}\.?(?:&nbsp;| |\s)*/g, '');
}

/** Re-insert a {{para}} marker at the start of each numbered paragraph, so a
 *  lawyer's hand edit keeps document-wide numbering. Sub-paragraphs
 *  (class="sub") and raw markup blocks (blockquote) are left unnumbered. */
export function ensureParaMarkers(html: string): string {
  return html.replace(
    /<p(?![^>]*class="sub")([^>]*)>\s*(?:\{\{para\}\}\.?(?:&nbsp;| |\s)*)?(?:\d+[.)]\s*)?/gi,
    '<p$1>{{para}}. ',
  );
}

/** The active pleading sections in order, each with its reading text and draft
 *  status. `active` is the nodes that fire or are forced on, in assembly order. */
export function buildSocOutline(input: {
  nodes: SocNode[];
  ctx: Record<string, unknown>;
  approvedIssues: string[];
  overrides: Record<string, 'on' | 'off'>;
  draft?: SocDraftState;
}): SocOutlineSection[] {
  const report = nodeStatuses(input.nodes, input.ctx, input.approvedIssues, input.overrides);
  const headerById = new Map(report.map(r => [r.blockId, r.sectionHeader]));
  const activeIds = new Set(report.filter(r => r.status === 'firing' || r.status === 'forced_on').map(r => r.blockId));
  const active = input.nodes.filter(n => activeIds.has(n.blockId));

  return active.map(node => {
    const isFacts = node.blockId === AI_NARRATIVE_BLOCK;
    const rendered = isFacts
      ? { html: '', header: node.sectionHeader || 'Background Facts', missing: [] as string[] }
      : renderNode(node, input.ctx);
    const d = input.draft?.sections?.[node.blockId];
    const sourceHtml = d?.html ?? rendered.html;
    return {
      id: node.blockId,
      kind: isFacts ? 'facts' : 'node',
      header: rendered.header || headerById.get(node.blockId) || node.blockId,
      html: stripParaMarkers(sourceHtml),
      missing: rendered.missing,
      edited: Boolean(d?.edited),
      approved: Boolean(d?.approved),
      generatedAt: d?.generatedAt,
      reviewFlags: d?.reviewFlags,
      lawyerReview: node.lawyerReview,
      draftStatus: !d
        ? (isFacts ? 'not_drafted' : 'rendered')
        : d.approved ? 'approved' : 'drafted',
    };
  });
}

export function isSocFactsSection(id: string): boolean {
  return id === AI_NARRATIVE_BLOCK;
}

export function socOutlineReadiness(sections: SocOutlineSection[]): {
  total: number;
  approved: number;
  edited: number;
} {
  return {
    total: sections.length,
    approved: sections.filter(s => s.approved).length,
    edited: sections.filter(s => s.edited).length,
  };
}
