// The Timeline tab of the matter workspace: add a key date, then the docket
// list. Extracted from MatterDetailView.tsx; state stays in the parent and
// arrives as props.

import { navy, orange, border, ink, muted, sans } from '../tokens.js';

type KeyDate = { date: string; label: string; category: string; courtDeadline: boolean };
type TimelineItem = { id: string; date: string; title: string; subtitle: string; isCurrent?: boolean; courtDeadline?: boolean };

export function TimelineTab({
  timeline, keyDate, setKeyDate, keyDateSaving, setKeyDateSaving, sessionId, refreshMatter, refreshEmployment,
}: {
  timeline: TimelineItem[];
  keyDate: KeyDate;
  setKeyDate: React.Dispatch<React.SetStateAction<KeyDate>>;
  keyDateSaving: boolean;
  setKeyDateSaving: React.Dispatch<React.SetStateAction<boolean>>;
  sessionId: string | null;
  refreshMatter: () => Promise<void> | void;
  refreshEmployment: () => void;
}) {
  return (
    <div id="panel-timeline" role="tabpanel" style={{ paddingTop: 22 }}>
      {/* Add a key date. Court/statutory deadlines drive the red band. */}
      <div style={{ background: '#fff', border: `1px solid ${border}`, padding: 16, marginBottom: 20 }}>
        <div style={{ fontSize: 12, fontWeight: 700, color: navy, letterSpacing: 0.3, marginBottom: 10 }}>ADD A KEY DATE</div>
        <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input type="date" value={keyDate.date} onChange={e => setKeyDate(k => ({ ...k, date: e.target.value }))}
            style={{ fontSize: 13, padding: '7px 9px', border: `1px solid ${border}`, borderRadius: 2, fontFamily: sans }} />
          <input value={keyDate.label} onChange={e => setKeyDate(k => ({ ...k, label: e.target.value }))}
            placeholder="e.g. Settlement conference, trial date, motion return"
            style={{ flex: 1, minWidth: 220, fontSize: 13, padding: '7px 9px', border: `1px solid ${border}`, borderRadius: 2, fontFamily: sans }} />
          <label style={{ display: 'inline-flex', alignItems: 'center', gap: 6, fontSize: 12.5, color: ink, whiteSpace: 'nowrap' }}>
            <input type="checkbox" checked={keyDate.courtDeadline} onChange={e => setKeyDate(k => ({ ...k, courtDeadline: e.target.checked }))} />
            Court / statutory deadline
          </label>
          <button
            disabled={keyDateSaving || !keyDate.date || keyDate.label.trim().length === 0}
            onClick={async () => {
              setKeyDateSaving(true);
              try {
                await fetch(`/api/employment/${sessionId}/timeline`, {
                  method: 'POST', headers: { 'Content-Type': 'application/json' }, credentials: 'include',
                  body: JSON.stringify({ date: keyDate.date, label: keyDate.label.trim(), category: keyDate.category, courtDeadline: keyDate.courtDeadline }),
                });
                setKeyDate({ date: '', label: '', category: 'legal', courtDeadline: true });
                await refreshMatter();
                refreshEmployment();
              } catch { /* transient */ }
              setKeyDateSaving(false);
            }}
            style={{ fontSize: 12.5, fontWeight: 600, padding: '8px 14px', borderRadius: 2, border: 'none', background: navy, color: '#fff', cursor: 'pointer', opacity: (!keyDate.date || !keyDate.label.trim()) ? 0.5 : 1 }}
          >
            {keyDateSaving ? 'Adding...' : 'Add'}
          </button>
        </div>
        <div style={{ fontSize: 11.5, color: muted, marginTop: 8 }}>
          Court and statutory deadlines show in red on the docket when they are overdue or within a business week. Untick for a non-court date (a reminder, a call).
        </div>
      </div>
      {timeline.length === 0 && (
        <div style={{ padding: '24px 0', textAlign: 'center', color: muted, fontSize: 14 }}>No timeline events yet.</div>
      )}
      {timeline.length > 0 && (
      <div style={{ position: 'relative', paddingLeft: 24 }}>
        {/* Vertical line */}
        <div
          style={{
            position: 'absolute',
            left: 6,
            top: 4,
            bottom: 4,
            width: 2,
            background: border,
          }}
          aria-hidden="true"
        />
        {timeline.map(ev => (
          <div key={ev.id} style={{ position: 'relative', marginBottom: 18 }}>
            {/* Dot */}
            <div
              style={{
                position: 'absolute',
                left: -22,
                top: 4,
                width: 10,
                height: 10,
                borderRadius: '50%',
                background: ev.isCurrent ? orange : navy,
                border: '2px solid #fff',
                boxShadow: `0 0 0 1px ${border}`,
              }}
              aria-hidden="true"
            />
            <div style={{ fontSize: 12, color: muted, marginBottom: 2 }}>{ev.date}</div>
            <div style={{ fontSize: 14, color: ink, fontWeight: 600 }}>
              {ev.title}
              {ev.courtDeadline && (
                <span style={{ marginLeft: 8, fontSize: 10, fontWeight: 700, color: '#dc2626', background: '#fce8e6', padding: '2px 7px', borderRadius: 2, verticalAlign: 'middle' }}>COURT DEADLINE</span>
              )}
            </div>
            <div style={{ fontSize: 13, color: muted }}>{ev.subtitle}</div>
          </div>
        ))}
      </div>
      )}
    </div>
  );
}
