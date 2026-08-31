// The one section-by-section workspace, shared by every document that is
// drafted a section at a time: the claim, the factum, the mediation brief, and
// whatever comes next.
//
// It was three near-identical panels. They drifted apart in wording while
// staying identical in behaviour, and the duplication had a cost beyond the
// lines: "what this document reads before it drafts" was defined separately in
// every route, so the claim's section-by-section facts route was passing no
// source documents at all and nobody could see it. One surface makes that kind
// of omission visible.
//
// The differences between documents are presentational and live in the section
// model the caller builds, not in branches here. The claim's pleading nodes are
// readable but never drafted (draftable: false) and carry their own chip; the
// factum's parts carry a prefix; the brief's sections carry neither.
//
// State stays in the parent, as it did in all three (Option A).

import { useState } from 'react';
import { navy, orange, green, amber, red, muted, border, ink, sans } from '../tokens.js';
import { DocumentHtml } from '../../DocumentHtml.js';

export type OutlineSectionStatus =
  | 'not_drafted'
  | 'as_pleaded'
  | 'drafted'
  | 'edited'
  | 'approved';

export type OutlineSectionUI = {
  id: string;
  header: string;
  html?: string;
  /** The chip. The caller maps its own state onto one of these. */
  status: OutlineSectionStatus;
  approved: boolean;
  /** There is text to read, whether Starling drafted it or the firm wrote it. */
  readable: boolean;
  /** Starling drafts this section, so it gets a draft control. */
  draftable: boolean;
  /** A draft already exists, which is the difference between draft and redraft. */
  hasDraft: boolean;
  /** Small label above the header: the factum's Part number. */
  prefix?: string;
  /** Muted note after the header: "your section", "Starling drafts this". */
  suffix?: string;
  /** Muted line under the header: the factum's authorities. */
  detail?: string;
  /** Amber lines under the header: "3 blanks to fill". */
  notes?: string[];
  reviewFlags?: string[];
  generatedAt?: string;
  /** Label for the discard control. Omitted hides it, which is how a node
   *  the lawyer has not touched offers nothing to revert. */
  discardLabel?: string;
  /** Shown in place of the body when there is nothing to read yet. */
  emptyText?: string;
};

const CHIP: Record<OutlineSectionStatus, { label: string; bg: string; fg: string }> = {
  approved: { label: 'APPROVED', bg: '#e8f2e8', fg: green },
  edited: { label: 'EDITED', bg: '#fdf0dd', fg: amber },
  drafted: { label: 'DRAFTED', bg: '#fdf0dd', fg: amber },
  as_pleaded: { label: 'AS PLEADED', bg: '#eef1f6', fg: navy },
  not_drafted: { label: 'NOT DRAFTED', bg: '#f3f3f3', fg: muted },
};

export function DocumentOutlinePanel({
  title, description, editHint,
  sections, approveSection, saveSection, clearSection,
  draftSection, draftAll, busyId, draftingAll = false,
}: {
  title: string;
  description: string;
  /** The note under the edit box, which says where the numbering comes from. */
  editHint: string;
  sections: OutlineSectionUI[];
  approveSection: (sectionId: string, approved: boolean) => Promise<void>;
  saveSection: (sectionId: string, html: string) => Promise<void>;
  clearSection: (sectionId: string) => Promise<void>;
  /** Omitted where no section is drafted. */
  draftSection?: (sectionId: string) => Promise<void>;
  /** Omitted where the document has no draft-everything control. */
  draftAll?: () => Promise<void>;
  busyId: string | null;
  draftingAll?: boolean;
}) {
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [editText, setEditText] = useState('');
  const [saving, setSaving] = useState(false);

  const drafted = sections.filter(s => s.hasDraft).length;
  const approved = sections.filter(s => s.approved).length;
  const anyBusy = busyId !== null || draftingAll;

  const startEdit = (s: OutlineSectionUI) => { setEditId(s.id); setEditText(s.html ?? ''); setOpenId(s.id); };
  const saveEdit = async (id: string) => {
    if (!editText.trim() || saving) return;
    setSaving(true);
    try { await saveSection(id, editText.trim()); setEditId(null); }
    finally { setSaving(false); }
  };

  // A drafted count only means something where every section is drafted. The
  // claim's pleading nodes are rendered rather than drafted, so counting them
  // as undrafted would read as work outstanding that does not exist.
  const summary = draftAll
    ? `${drafted} of ${sections.length} drafted · ${approved} approved`
    : `${approved} of ${sections.length} approved`;

  return (
    <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '14px 18px', marginBottom: 16 }}>
      <div style={{ fontSize: 13.5, fontWeight: 600, color: ink, marginBottom: 4 }}>{title}</div>
      <div style={{ fontSize: 12.5, color: muted, marginBottom: 10, lineHeight: 1.5 }}>{description}</div>

      {draftAll ? (
        <div style={{ display: 'flex', gap: 10, alignItems: 'center', marginBottom: 12 }}>
          <button
            onClick={() => void draftAll()}
            disabled={anyBusy}
            style={{ fontSize: 12.5, fontWeight: 600, padding: '7px 14px', borderRadius: 2, fontFamily: sans, background: anyBusy ? '#b0b0b0' : orange, color: '#fff', border: 'none', cursor: anyBusy ? 'not-allowed' : 'pointer' }}
          >
            {draftingAll ? 'Drafting every section…' : drafted === 0 ? 'Draft all sections' : 'Draft any not yet drafted'}
          </button>
          <span style={{ fontSize: 11.5, color: muted }}>{summary}</span>
        </div>
      ) : (
        <div style={{ fontSize: 11.5, color: muted, marginBottom: 10 }}>{summary}</div>
      )}

      {sections.map(s => {
        const chip = CHIP[s.status];
        const isBusy = busyId === s.id || draftingAll;
        const isOpen = openId === s.id;
        const isEditing = editId === s.id;
        const flags = s.reviewFlags ?? [];
        return (
          <div key={s.id} style={{ padding: '7px 0', borderTop: '1px solid #f0ede8' }}>
            <div style={{ display: 'flex', gap: 10, alignItems: 'flex-start' }}>
              <span style={{ fontSize: 10, fontWeight: 700, color: chip.fg, background: chip.bg, padding: '2px 7px', borderRadius: 2, minWidth: 92, textAlign: 'center', marginTop: 2 }}>{chip.label}</span>
              <span style={{ flex: 1, fontSize: 12.5, color: ink }}>
                {s.prefix && <span style={{ fontSize: 10.5, fontWeight: 700, color: muted, letterSpacing: 0.4, display: 'block' }}>{s.prefix.toUpperCase()}</span>}
                <span style={{ fontWeight: 600 }}>{s.header || 'Section'}</span>
                {s.suffix && <span style={{ color: muted, fontWeight: 400 }}> · {s.suffix}</span>}
                {s.detail && <span style={{ display: 'block', fontSize: 11.5, color: muted, lineHeight: 1.45 }}>{s.detail}</span>}
                {(s.notes ?? []).map((n, i) => (
                  <span key={i} style={{ display: 'block', fontSize: 11.5, color: amber }}>{n}</span>
                ))}
                {flags.length > 0 && (
                  <span style={{ display: 'block', fontSize: 11.5, color: amber }}>
                    {flags.length} thing{flags.length === 1 ? '' : 's'} to check
                  </span>
                )}
              </span>

              {s.readable && (
                <button onClick={() => setOpenId(isOpen ? null : s.id)} style={btn(navy)}>{isOpen ? 'hide' : 'read'}</button>
              )}
              {s.draftable && draftSection && (
                <button
                  onClick={() => void draftSection(s.id)}
                  disabled={anyBusy}
                  style={{ ...btn(anyBusy ? muted : navy, anyBusy), minWidth: 66 }}
                >
                  {isBusy ? 'drafting…' : s.hasDraft ? 'redraft' : 'draft'}
                </button>
              )}
              {s.readable && !s.approved && (
                <button
                  onClick={() => void approveSection(s.id, true)}
                  disabled={anyBusy}
                  style={{ ...btn('#fff', anyBusy), fontWeight: 600, background: green, border: 'none' }}
                >
                  Approve
                </button>
              )}
              {s.approved && (
                <button onClick={() => void approveSection(s.id, false)} style={btnGhost} aria-label={`Reopen ${s.header}`}>reopen</button>
              )}
            </div>

            {isOpen && (
              <div style={{ marginTop: 8, marginLeft: 102 }}>
                {flags.length > 0 && (
                  <ul style={{ margin: '0 0 8px', paddingLeft: 16, fontSize: 11.5, color: amber, lineHeight: 1.5 }}>
                    {flags.map((f, i) => <li key={i}>{f}</li>)}
                  </ul>
                )}
                {isEditing ? (
                  <div>
                    <textarea
                      value={editText}
                      onChange={e => setEditText(e.target.value)}
                      rows={10}
                      aria-label={`Edit ${s.header}`}
                      style={{ width: '100%', boxSizing: 'border-box', fontFamily: 'ui-monospace, Menlo, monospace', fontSize: 12, lineHeight: 1.5, padding: '10px 12px', border: `1px solid ${border}`, borderRadius: 2, color: ink, resize: 'vertical' }}
                    />
                    <div style={{ fontSize: 11, color: muted, margin: '4px 0 8px' }}>{editHint}</div>
                    <div style={{ display: 'flex', gap: 8 }}>
                      <button
                        onClick={() => void saveEdit(s.id)}
                        disabled={!editText.trim() || saving}
                        style={{ ...btn('#fff', !editText.trim() || saving), fontWeight: 600, background: editText.trim() && !saving ? orange : '#b0b0b0', border: 'none', padding: '6px 14px' }}
                      >
                        {saving ? 'Saving…' : 'Save changes'}
                      </button>
                      <button onClick={() => setEditId(null)} style={{ ...btn(navy), padding: '6px 12px' }}>Cancel</button>
                    </div>
                  </div>
                ) : (s.html ?? '').trim() ? (
                  <>
                    <DocumentHtml
                      style={{ fontSize: 12.5, color: ink, lineHeight: 1.55, background: '#fbfaf7', border: `1px solid ${border}`, borderRadius: 2, padding: '10px 12px', maxHeight: 320, overflowY: 'auto' }}
                      html={s.html ?? ''}
                    />
                    <div style={{ display: 'flex', gap: 12, alignItems: 'center', marginTop: 6 }}>
                      <button onClick={() => startEdit(s)} style={btnText(navy)}>edit by hand</button>
                      {s.discardLabel && (
                        <button onClick={() => void clearSection(s.id)} style={btnText(red)}>{s.discardLabel}</button>
                      )}
                      {s.generatedAt && <span style={{ fontSize: 10.5, color: muted }}>Drafted {new Date(s.generatedAt).toLocaleString('en-CA')}</span>}
                    </div>
                  </>
                ) : (
                  <div style={{ fontSize: 12.5, color: muted }}>{s.emptyText ?? 'Not drafted yet.'}</div>
                )}
              </div>
            )}
          </div>
        );
      })}
    </div>
  );
}

const btn = (color: string, disabled = false): React.CSSProperties => ({ fontSize: 11.5, fontFamily: sans, background: 'none', border: `1px solid ${border}`, color, cursor: disabled ? 'not-allowed' : 'pointer', padding: '3px 9px', borderRadius: 2 });
const btnGhost: React.CSSProperties = { fontSize: 11.5, fontFamily: sans, background: 'none', border: 'none', color: muted, cursor: 'pointer', padding: '3px 4px' };
const btnText = (color: string): React.CSSProperties => ({ fontSize: 11.5, fontFamily: sans, background: 'none', border: 'none', color, cursor: 'pointer', padding: '2px 0' });
