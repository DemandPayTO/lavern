// The Notes tab: the matter direction editor plus the lawyer's private notes.
// Extracted from MatterDetailView.tsx. The direction editor is rendered by the
// parent (it is shared with the draft workspaces) and passed in.

import { orange, green, red, border, ink, muted, sans } from '../tokens.js';

export function NotesTab({
  directionEditor, notes, setNotes, notesStatus, setNotesStatus, saveNotes,
}: {
  directionEditor: React.ReactNode;
  notes: string;
  setNotes: React.Dispatch<React.SetStateAction<string>>;
  notesStatus: 'idle' | 'saving' | 'saved' | 'error';
  setNotesStatus: React.Dispatch<React.SetStateAction<'idle' | 'saving' | 'saved' | 'error'>>;
  saveNotes: (notes: string) => Promise<{ ok: boolean; error?: string }>;
}) {
  return (
    <div id="panel-notes" role="tabpanel" style={{ paddingTop: 22 }}>
      {directionEditor}
      <div
        style={{
          fontSize: 12.5,
          color: muted,
          marginBottom: 10,
          display: 'flex',
          alignItems: 'center',
          gap: 7,
        }}
      >
        {/* Lock icon */}
        <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke={muted} strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <rect x="3" y="11" width="18" height="11" rx="2" ry="2" />
          <path d="M7 11V7a5 5 0 0110 0v4" />
        </svg>
        Private to you. Not processed by AI and not included in any deliverable.
      </div>
      <textarea
        value={notes}
        onChange={(e) => setNotes(e.target.value)}
        style={{
          width: '100%',
          minHeight: 220,
          fontFamily: sans,
          fontSize: 14,
          border: `1px solid ${border}`,
          borderRadius: 2,
          padding: 16,
          lineHeight: 1.6,
          resize: 'vertical',
          color: ink,
          boxSizing: 'border-box',
        }}
      />
      <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginTop: 12 }}>
        <button
          onClick={async () => {
            setNotesStatus('saving');
            const result = await saveNotes(notes);
            setNotesStatus(result.ok ? 'saved' : 'error');
            if (result.ok) setTimeout(() => setNotesStatus('idle'), 2500);
          }}
          disabled={notesStatus === 'saving'}
          style={{
            background: notesStatus === 'saving' ? '#b0b0b0' : orange,
            color: '#fff',
            fontSize: 13.5,
            fontWeight: 600,
            padding: '11px 18px',
            borderRadius: 2,
            border: 'none',
            cursor: notesStatus === 'saving' ? 'not-allowed' : 'pointer',
            fontFamily: sans,
          }}
        >
          {notesStatus === 'saving' ? 'Saving...' : 'Save Notes'}
        </button>
        {notesStatus === 'saved' && (
          <span style={{ fontSize: 13, color: green, fontWeight: 600 }} role="status">Saved</span>
        )}
        {notesStatus === 'error' && (
          <span style={{ fontSize: 13, color: red }} role="alert">The notes could not be saved. Please try again.</span>
        )}
      </div>
    </div>
  );
}
