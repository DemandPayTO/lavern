/**
 * MattersFilesView — the file room ("#/matters").
 *
 * Every matter as a plain folder-style card, deliberately unfancy: label,
 * file number, status, and an overdue flag. Sortable by most recent, name,
 * priority (overdue court work first), or status; searchable; closed files
 * hidden by default. One /api/tasks fetch supplies the directory and the
 * per-matter priority signals.
 */

import { useState, useCallback, useEffect, useContext } from 'react';
import { useApprovalsEnabled } from './hooks/useStarlingApi.js';
import { UserContext } from '../auth/UserContext.js';

const navy = '#0f1a2e';
const orange = '#ea580c';
const frame = '#e8e5e0';
const red = '#dc2626';
const amber = '#d97706';
const green = '#16a34a';
const border = 'rgba(15,26,46,0.12)';
const ink = '#0f1a2e';
const muted = '#5a6472';
const serif = "Georgia, 'Palatino Linotype', serif";
const sans = "system-ui, -apple-system, sans-serif";

interface DirMatter { matterId: string; matterLabel: string; fileNumber: string; status: string; updatedAt: string; openedBy?: string }
interface DirTask {
  matterId: string; dueDate: string | null; isCourt: boolean;
  band: 'overdue' | 'today' | 'week' | 'later' | 'none';
  status: 'open' | 'done';
}

interface FileCard extends DirMatter {
  overdueCourt: number;
  overdue: number;
  nextDue: string | null;
}

type SortKey = 'recent' | 'name' | 'priority' | 'status';

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'recent', label: 'Most recent' },
  { key: 'name', label: 'Name (A to Z)' },
  { key: 'priority', label: 'Priority tasks' },
  { key: 'status', label: 'Status' },
];

const CLOSED = new Set(['complete', 'closed', 'resolved']);

function statusChip(status: string): { label: string; colour: string } {
  if (CLOSED.has(status)) return { label: 'closed', colour: muted };
  if (status === 'urgent') return { label: 'urgent', colour: red };
  if (status === 'stale') return { label: 'needs attention', colour: amber };
  if (status === 'pre-engagement') return { label: 'new', colour: green };
  if (status === 'active' || status === '') return { label: 'active', colour: green };
  return { label: 'active', colour: green };
}

export default function MattersFilesView() {
  const userCtx = useContext(UserContext);
  const approvalsEnabled = useApprovalsEnabled();
  const [cards, setCards] = useState<FileCard[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [sort, setSort] = useState<SortKey>('recent');
  const [search, setSearch] = useState('');
  const [showClosed, setShowClosed] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setLoading(true);
    fetch('/api/tasks', { credentials: 'include' })
      .then(r => { if (!r.ok) throw new Error(`HTTP ${r.status}`); return r.json(); })
      .then(d => {
        if (cancelled) return;
        const body = d as { matters?: DirMatter[]; tasks?: DirTask[] };
        const byMatter = new Map<string, { overdueCourt: number; overdue: number; nextDue: string | null }>();
        for (const t of body.tasks ?? []) {
          if (t.status !== 'open') continue;
          const agg = byMatter.get(t.matterId) ?? { overdueCourt: 0, overdue: 0, nextDue: null };
          if (t.band === 'overdue') { agg.overdue += 1; if (t.isCourt) agg.overdueCourt += 1; }
          if (t.dueDate && (agg.nextDue === null || t.dueDate < agg.nextDue)) agg.nextDue = t.dueDate;
          byMatter.set(t.matterId, agg);
        }
        setCards((body.matters ?? []).map(m => ({
          ...m,
          ...(byMatter.get(m.matterId) ?? { overdueCourt: 0, overdue: 0, nextDue: null }),
        })));
        setError(null);
      })
      .catch(() => { if (!cancelled) setError('Could not load your files. Check the connection and retry.'); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [reloadKey]);

  const handleNav = useCallback((hash: string) => { window.location.hash = hash; }, []);

  const q = search.trim().toLowerCase();
  const visible = cards
    .filter(c => showClosed || !CLOSED.has(c.status))
    .filter(c => !q || `${c.matterLabel} ${c.fileNumber}`.toLowerCase().includes(q));

  const STATUS_ORDER: Record<string, number> = { urgent: 0, stale: 1, active: 2, 'pre-engagement': 3, complete: 4, closed: 4, resolved: 4 };
  const sorted = [...visible].sort((a, b) => {
    if (sort === 'name') return a.matterLabel.localeCompare(b.matterLabel);
    if (sort === 'priority') {
      return b.overdueCourt - a.overdueCourt
        || b.overdue - a.overdue
        || (a.nextDue ?? '9999').localeCompare(b.nextDue ?? '9999')
        || b.updatedAt.localeCompare(a.updatedAt);
    }
    if (sort === 'status') {
      return (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3)
        || b.updatedAt.localeCompare(a.updatedAt);
    }
    return b.updatedAt.localeCompare(a.updatedAt); // recent
  });

  return (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
      <header
        style={{ background: navy, color: '#fff', display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '0 28px', height: 64 }}
        role="banner"
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <a href="#/" style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }} aria-label="DemandPay Starling home">
            <span style={{ display: 'flex', gap: 4 }} aria-hidden="true">
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: orange, display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f26a3d', display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff8a5c', display: 'block' }} />
            </span>
            <span style={{ fontFamily: serif, lineHeight: 1, letterSpacing: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>DEMAND</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>PAY</span>
            </span>
          </a>
          <span style={{ marginLeft: 14, paddingLeft: 16, borderLeft: '1px solid rgba(255,255,255,0.18)', fontFamily: serif, fontSize: 15, color: '#cfd6e0' }}>
            <b style={{ color: '#fff' }}>Starling</b> &middot; Files
          </span>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label="Main navigation">
          <a href="#/" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#cfd6e0', border: '1px solid transparent', textDecoration: 'none' }}>
            My Cases
          </a>
          <a href="#/tasks" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#cfd6e0', border: '1px solid transparent', textDecoration: 'none' }}>
            Tasks
          </a>
          <a href="#/matters" aria-current="page" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#fff', border: '1px solid rgba(255,255,255,0.25)', textDecoration: 'none' }}>
            Files
          </a>
          {approvalsEnabled && (
            <a href="#/approvals" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#cfd6e0', border: '1px solid transparent', textDecoration: 'none' }}>
              Approvals
            </a>
          )}
          <a href="#/new-matter" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#cfd6e0', border: '1px solid transparent', textDecoration: 'none' }}>
            New Matter
          </a>
          {userCtx?.user && (
            <button
              type="button"
              onClick={() => { void userCtx.logout(); }}
              style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#fff', background: 'transparent', border: '1px solid rgba(255,255,255,0.25)', cursor: 'pointer' }}
              aria-label="Log out"
            >
              Log out
            </button>
          )}
        </nav>
      </header>

      <main id="main-content" style={{ maxWidth: 1120, margin: '0 auto', padding: '32px 28px 64px' }}>
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 600, color: navy, margin: 0 }}>Files</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, color: muted }}>
              Every matter in the file room. Open a folder to work the file.
            </p>
          </div>
        </div>

        {/* Controls */}
        <div style={{ margin: '18px 0 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
          <input
            type="text"
            placeholder="Search client, employer, file number…"
            value={search}
            onChange={e => setSearch(e.target.value)}
            aria-label="Search files"
            style={{ flex: '1 1 240px', maxWidth: 320, fontSize: 13.5, padding: '7px 10px', border: `1px solid ${border}` }}
          />
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: muted }}>
            Sort by
            <select value={sort} onChange={e => setSort(e.target.value as SortKey)} aria-label="Sort files" style={{ fontSize: 13, padding: '6px 8px', border: `1px solid ${border}`, background: '#fff' }}>
              {SORTS.map(s => <option key={s.key} value={s.key}>{s.label}</option>)}
            </select>
          </label>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: muted, cursor: 'pointer' }}>
            <input type="checkbox" checked={showClosed} onChange={e => setShowClosed(e.target.checked)} style={{ accentColor: navy }} />
            Show closed files
          </label>
        </div>

        {/* Folder grid */}
        {loading ? (
          <p style={{ marginTop: 32, color: muted }}>Loading your files…</p>
        ) : error ? (
          <div style={{ marginTop: 32 }}>
            <p role="alert" style={{ color: red, fontSize: 13.5 }}>{error}</p>
            <button onClick={() => setReloadKey(k => k + 1)} style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 14px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: navy, cursor: 'pointer', fontFamily: sans }}>Retry</button>
          </div>
        ) : sorted.length === 0 ? (
          <p style={{ marginTop: 32, color: muted }}>
            {q ? 'No files match the search.' : 'No files yet. Start one from New Matter.'}
          </p>
        ) : (
          <div
            role="list"
            aria-label="All files"
            style={{ marginTop: 22, display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(240px, 1fr))', gap: 16 }}
          >
            {sorted.map(c => {
              const chip = statusChip(c.status);
              const closed = CLOSED.has(c.status);
              return (
                <div
                  key={c.matterId}
                  role="listitem"
                  tabIndex={0}
                  onClick={() => handleNav(`#/matter-detail/${c.matterId}`)}
                  onKeyDown={(e) => { if (e.key === 'Enter') handleNav(`#/matter-detail/${c.matterId}`); }}
                  aria-label={`Open file ${c.fileNumber}: ${c.matterLabel}`}
                  style={{ cursor: 'pointer', opacity: closed ? 0.6 : 1 }}
                >
                  {/* Folder tab */}
                  <div style={{ width: 84, height: 10, background: '#d9d2c7', border: `1px solid ${border}`, borderBottom: 'none', borderRadius: '3px 3px 0 0' }} aria-hidden="true" />
                  {/* Folder body */}
                  <div style={{ background: '#fff', border: `1px solid ${c.overdueCourt > 0 ? red : border}`, borderRadius: '0 3px 3px 3px', padding: '14px 16px', minHeight: 92 }}>
                    <div style={{ fontSize: 14, fontWeight: 700, color: ink, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                      {c.matterLabel}
                    </div>
                    <div style={{ fontSize: 12, color: muted, marginTop: 2, fontFamily: 'ui-monospace, monospace' }}>{c.fileNumber}</div>
                    {c.openedBy && (
                      <div style={{ fontSize: 11, color: muted, marginTop: 2 }}>Opened by {c.openedBy}</div>
                    )}
                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 10, flexWrap: 'wrap' }}>
                      <span style={{ fontSize: 11, fontWeight: 700, color: chip.colour, border: `1px solid ${chip.colour}`, borderRadius: 2, padding: '1px 7px' }}>
                        {chip.label}
                      </span>
                      {c.overdue > 0 && (
                        <span style={{ fontSize: 11, fontWeight: 700, color: c.overdueCourt > 0 ? red : amber }}>
                          {c.overdue} overdue{c.overdueCourt > 0 ? ' · court' : ''}
                        </span>
                      )}
                      {c.overdue === 0 && c.nextDue && (
                        <span style={{ fontSize: 11, color: muted }}>next: {c.nextDue}</span>
                      )}
                    </div>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </main>
    </div>
  );
}
