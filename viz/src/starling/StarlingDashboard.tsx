/**
 * StarlingDashboard — Phase 2 Dashboard for DemandPay Starling.
 *
 * Full matter management dashboard with top bar, quick actions,
 * matter list with urgency sorting, and collapsed completed section.
 *
 * Ontario employment law vocabulary (ESA, Bardal, HRTO, Statement of Claim).
 * Canadian spelling throughout (analyse, licenced).
 */

import { useState, useCallback, useEffect, useContext } from 'react';
import { useMatterList, usePracticeMode } from './hooks/useStarlingApi.js';
import { UserContext } from '../auth/UserContext.js';

// ── Design Tokens (CSS variable references) ─────────────────────────────
const navy = '#0f1a2e';
const orange = '#ea580c';
const cream = '#faf8f5';
const frame = '#e8e5e0';
const green = '#16a34a';
const amber = '#d97706';
const red = '#dc2626';
const border = 'rgba(15,26,46,0.12)';
const ink = '#0f1a2e';
const muted = '#5a6472';
const serif = "Georgia, 'Palatino Linotype', serif";
const sans = "system-ui, -apple-system, sans-serif";

// ── Types ────────────────────────────────────────────────────────────────

type MatterStatus = 'urgent' | 'stale' | 'active' | 'complete';
type FilterKey = 'all' | 'urgent' | 'stale' | 'active';

interface MatterItem {
  id: string;
  status: MatterStatus;
  statusColour: string;
  name: string;
  number: string;
  flagText: string;
  flagColour: 'red' | 'amber' | 'navy' | 'green';
  description: string;
  metaLabel: string;
  metaValue: string;
  metaColour?: string;
}

// ── Demo Data ────────────────────────────────────────────────────────────

const DEMO_MATTERS: MatterItem[] = [
  {
    id: 'patel',
    status: 'urgent',
    statusColour: '#dc2626',
    name: 'Patel v MegaCorp',
    number: '#STR-2026-007',
    flagText: 'Limitation in 14 days',
    flagColour: 'red',
    description: 'Action: File Statement of Claim before July 9, 2026 \u00B7 SOC not yet filed',
    metaLabel: 'Limitation',
    metaValue: 'Jul 9, 2026',
    metaColour: red,
  },
  {
    id: 'jones',
    status: 'stale',
    statusColour: '#d97706',
    name: 'Jones v BigCo',
    number: '#STR-2026-005',
    flagText: 'No activity \u00B7 12 days',
    flagColour: 'amber',
    description: 'Missing: employment agreement, termination letter \u00B7 Last step: intake analysis',
    metaLabel: 'Last activity',
    metaValue: 'Jun 13, 2026',
  },
  {
    id: 'williams',
    status: 'stale',
    statusColour: '#d97706',
    name: 'Williams v StartupCo',
    number: '#STR-2026-004',
    flagText: 'No activity \u00B7 8 days',
    flagColour: 'amber',
    description: 'Next: Send demand letter to employer or request lawyer review',
    metaLabel: 'Last activity',
    metaValue: 'Jun 17, 2026',
  },
  {
    id: 'smith',
    status: 'active',
    statusColour: '#0f1a2e',
    name: 'Smith v Acme Corp',
    number: '#STR-2026-003',
    flagText: 'Demand letter drafted',
    flagColour: 'navy',
    description: 'Next: Send to employer or request review \u00B7 Limitation June 1, 2028',
    metaLabel: 'Last activity',
    metaValue: '3 days ago',
  },
  {
    id: 'lee',
    status: 'active',
    statusColour: '#0f1a2e',
    name: 'Lee v TechFirm',
    number: '#STR-2026-006',
    flagText: 'SOC in progress',
    flagColour: 'navy',
    description: 'Next: Review draft \u00B7 check limitation Feb 2027',
    metaLabel: 'Last activity',
    metaValue: 'Today',
  },
  {
    id: 'chen',
    status: 'active',
    statusColour: '#0f1a2e',
    name: 'Chen v RetailCo',
    number: '#STR-2026-008',
    flagText: 'Intake received',
    flagColour: 'navy',
    description: 'Next: Run issue analysis on uploaded ROE and termination letter',
    metaLabel: 'Last activity',
    metaValue: '2 days ago',
  },
];

const COMPLETED_MATTERS = ['Nguyen v LogiCo', 'Okafor v FinServ'];

// ── Flag colour map ──────────────────────────────────────────────────────

const FLAG_STYLES: Record<string, React.CSSProperties> = {
  red: { background: '#fce8e6', color: red },
  amber: { background: '#fdf0dd', color: amber },
  navy: { background: '#eef1f6', color: navy },
  green: { background: '#e7f6ec', color: green },
};

const BAR_COLOURS: Record<MatterStatus, string> = {
  urgent: red,
  stale: amber,
  active: navy,
  complete: green,
};

// ── Filter labels ────────────────────────────────────────────────────────

const FILTERS: { key: FilterKey; label: string }[] = [
  { key: 'all', label: 'All' },
  { key: 'urgent', label: 'Urgent' },
  { key: 'stale', label: 'Needs attention' },
  { key: 'active', label: 'Active' },
];

// ── Greeting helper ──────────────────────────────────────────────────────

function getGreeting(): string {
  const hour = new Date().getHours();
  if (hour < 12) return 'Good morning';
  if (hour < 17) return 'Good afternoon';
  return 'Good evening';
}

function getFormattedDate(): string {
  return new Date().toLocaleDateString('en-CA', {
    weekday: 'long',
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

// ── Component ────────────────────────────────────────────────────────────

export default function StarlingDashboard() {
  // Nullable on purpose: no provider in LOCAL MODE, where there is no auth
  // session to end, so the logout control simply does not render.
  const userCtx = useContext(UserContext);
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [search, setSearch] = useState('');
  const [visibleCount, setVisibleCount] = useState(25);
  const [showCompleted, setShowCompleted] = useState(false);
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const [hoveredMatter, setHoveredMatter] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState<string | null>(null);
  const [deleting, setDeleting] = useState(false);

  // Wire hook data
  const { matters, loading, refresh } = useMatterList();

  // Task inbox glance — one fetch powers the Tasks nav badge, the Today
  // widget, and Recent matters. Best-effort: demo mode and fetch failures
  // leave the widgets empty and the badge hidden.
  interface GlanceTask {
    id: string; matterId: string; matterLabel: string; fileNumber: string;
    title: string; source: 'action' | 'deadline'; kind: string;
    dueDate: string | null; isCourt: boolean;
    band: 'overdue' | 'today' | 'week' | 'later' | 'none';
    status: 'open' | 'done';
  }
  interface GlanceMatter { matterId: string; matterLabel: string; fileNumber: string; status: string; updatedAt: string }
  const [inboxTasks, setInboxTasks] = useState<GlanceTask[]>([]);
  const [inboxMatters, setInboxMatters] = useState<GlanceMatter[]>([]);
  const [overdueCount, setOverdueCount] = useState(0);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/tasks', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (cancelled || !d) return;
        const body = d as { tasks?: GlanceTask[]; matters?: GlanceMatter[]; counts?: { overdue?: number } };
        setInboxTasks(body.tasks ?? []);
        setInboxMatters(body.matters ?? []);
        if (typeof body.counts?.overdue === 'number') setOverdueCount(body.counts.overdue);
      })
      .catch(() => { /* glance stays empty */ });
    return () => { cancelled = true; };
  }, [matters.length]);

  const handleDeleteMatter = async (matterId: string) => {
    setDeleting(true);
    try {
      // Rows come from three sources — try each: employment matter,
      // live session, then archived session.
      const id = encodeURIComponent(matterId);
      let res = await fetch(`/api/matters/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) res = await fetch(`/api/sessions/${id}`, { method: 'DELETE', credentials: 'include' });
      if (!res.ok) res = await fetch(`/api/sessions/archive/${id}`, { method: 'DELETE', credentials: 'include' });
      if (res.ok) refresh();
    } finally {
      setDeleting(false);
      setConfirmingDelete(null);
    }
  };

  // Practice mode: hide the vertical the firm does not use. 'both' shows all.
  const practiceMode = usePracticeMode();
  const inPractice = (m: { isLabour?: boolean }) =>
    practiceMode === 'both' ? true : practiceMode === 'labour' ? Boolean(m.isLabour) : !m.isLabour;

  // Separate active and completed matters (within the active practice mode)
  const scopedMatters = matters.filter(inPractice);
  const activeMatters = scopedMatters.filter(m => m.status !== 'complete');
  const completedMatters = scopedMatters.filter(m => m.status === 'complete');

  // Filter active matters by status chip
  const filteredMatters = activeFilter === 'all'
    ? activeMatters
    : activeMatters.filter(m => m.status === activeFilter);

  // Free-text search over client name, matter/file number, and the summary
  // (which carries the employer). Then page the list so 200 matters stay
  // usable — render up to visibleCount with a "show more" control.
  const q = search.trim().toLowerCase();
  const searchedMatters = q
    ? filteredMatters.filter(m => `${m.name} ${m.number} ${m.description}`.toLowerCase().includes(q))
    : filteredMatters;
  const visibleMatters = searchedMatters.slice(0, visibleCount);
  // Reset paging whenever the filter or search narrows the set.
  useEffect(() => { setVisibleCount(25); }, [activeFilter, search]);

  // "Today": the daily glance. Up to 5 items due today or overdue (court
  // first), and any court/statutory deadline within 5 days ALWAYS surfaces —
  // the can't-miss safety net is never crowded out. Full management lives on
  // the Tasks tab.
  const inPracticeIds = new Set(scopedMatters.map(m => m.id));
  const daysTo = (iso: string): number => {
    const t = new Date(`${iso}T00:00:00`);
    const today = new Date();
    today.setHours(0, 0, 0, 0);
    return Math.round((t.getTime() - today.getTime()) / 86400000);
  };
  const todayCandidates = inboxTasks
    .filter(t => t.status === 'open' && inPracticeIds.has(t.matterId))
    .filter(t => t.band === 'overdue' || t.band === 'today'
      || (t.isCourt && t.dueDate !== null && daysTo(t.dueDate) <= 5))
    .sort((a, b) => Number(b.isCourt) - Number(a.isCourt)
      || (a.dueDate ?? '9999').localeCompare(b.dueDate ?? '9999'));
  const todayCourt = todayCandidates.filter(t => t.isCourt);
  // Cap at 5, but never cut a court deadline to make room.
  const todayItems = todayCourt.length >= 5 ? todayCourt : todayCandidates.slice(0, 5);
  const todayOverflow = todayCandidates.length - todayItems.length;

  // "Recent matters": the 5 most recently saved in-practice files, for fast
  // re-entry. updatedAt is the DB write stamp — any save touches it.
  const recentMatters = inboxMatters
    .filter(m => inPracticeIds.has(m.matterId) && m.status !== 'complete')
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))
    .slice(0, 5);

  // Stats
  const urgentCount = activeMatters.filter(m => m.status === 'urgent').length;
  const staleCount = activeMatters.filter(m => m.status === 'stale').length;
  const activeCount = activeMatters.length;

  const handleNav = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  return (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
      {/* ── Top Bar ─────────────────────────────────────────────── */}
      <header
        style={{
          background: navy,
          color: '#fff',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'space-between',
          padding: '0 28px',
          height: 64,
        }}
        role="banner"
      >
        <div style={{ display: 'flex', alignItems: 'center' }}>
          <a
            href="#/"
            style={{ display: 'flex', alignItems: 'center', gap: 12, textDecoration: 'none', color: 'inherit' }}
            aria-label="DemandPay Starling home"
          >
            {/* Three dots */}
            <span style={{ display: 'flex', gap: 4 }} aria-hidden="true">
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: orange, display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#f26a3d', display: 'block' }} />
              <span style={{ width: 10, height: 10, borderRadius: '50%', background: '#ff8a5c', display: 'block' }} />
            </span>
            {/* Stacked wordmark */}
            <span style={{ fontFamily: serif, lineHeight: 1, letterSpacing: 1 }}>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>DEMAND</span>
              <span style={{ fontSize: 15, fontWeight: 700, color: '#fff', display: 'block' }}>PAY</span>
            </span>
          </a>
          <span
            style={{
              marginLeft: 14,
              paddingLeft: 16,
              borderLeft: '1px solid rgba(255,255,255,0.18)',
              fontFamily: serif,
              fontSize: 15,
              color: '#cfd6e0',
            }}
          >
            <b style={{ color: '#fff' }}>Starling</b> &middot; Employment Law
          </span>
        </div>

        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label="Main navigation">
          <a
            href="#/"
            style={{
              padding: '8px 14px',
              borderRadius: 2,
              fontSize: 14,
              color: '#fff',
              border: '1px solid rgba(255,255,255,0.25)',
              textDecoration: 'none',
            }}
            aria-current="page"
          >
            My Cases
          </a>
          <a
            href="#/tasks"
            style={{
              padding: '8px 14px',
              borderRadius: 2,
              fontSize: 14,
              color: '#cfd6e0',
              border: '1px solid transparent',
              textDecoration: 'none',
            }}
          >
            Tasks{overdueCount > 0 && (
              <span style={{ marginLeft: 6, background: red, color: '#fff', borderRadius: 8, padding: '0 6px', fontSize: 11.5, fontWeight: 700 }}>
                {overdueCount}
              </span>
            )}
          </a>
          <a
            href="#/approvals"
            style={{
              padding: '8px 14px',
              borderRadius: 2,
              fontSize: 14,
              color: '#cfd6e0',
              border: '1px solid transparent',
              textDecoration: 'none',
            }}
          >
            Approvals
          </a>
          <a
            href="#/new-matter"
            style={{
              padding: '8px 14px',
              borderRadius: 2,
              fontSize: 14,
              color: '#cfd6e0',
              border: '1px solid transparent',
              textDecoration: 'none',
            }}
          >
            New Matter
          </a>
          {userCtx?.user && (
            <>
              <span
                style={{
                  marginLeft: 6,
                  paddingLeft: 14,
                  borderLeft: '1px solid rgba(255,255,255,0.18)',
                  fontSize: 13,
                  color: '#cfd6e0',
                  maxWidth: 220,
                  overflow: 'hidden',
                  textOverflow: 'ellipsis',
                  whiteSpace: 'nowrap',
                }}
                title={`${userCtx.user.displayName} · ${userCtx.user.firmName}`}
              >
                {userCtx.user.displayName}
              </span>
              <button
                type="button"
                onClick={() => { void userCtx.logout(); }}
                style={{
                  padding: '8px 14px',
                  borderRadius: 2,
                  fontSize: 14,
                  color: '#fff',
                  background: 'transparent',
                  border: '1px solid rgba(255,255,255,0.25)',
                  cursor: 'pointer',
                }}
                aria-label="Log out"
              >
                Log out
              </button>
            </>
          )}
        </nav>
      </header>

      {/* ── Main Content ────────────────────────────────────────── */}
      <main
        id="main-content"
        style={{
          maxWidth: 1120,
          margin: '0 auto',
          padding: '32px 28px 64px',
        }}
      >
        {/* Page header */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 600, color: navy, margin: 0 }}>
            {getGreeting()}, Jordan
          </h1>
          <div style={{ color: muted, fontSize: 13 }}>{getFormattedDate()}</div>
        </div>
        <p style={{ color: muted, fontSize: 14, marginBottom: 26, marginTop: 0 }}>
          {activeCount} active matters &middot;{' '}
          <span style={{ color: red, fontWeight: 600 }}>{urgentCount} urgent</span> &middot;{' '}
          <span style={{ color: amber, fontWeight: 600 }}>{staleCount} need attention</span>
        </p>

        {/* ── Today (daily glance) + Recent matters ─────────────── */}
        {!loading && (
          <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 2fr) minmax(0, 1fr)', gap: 18, marginBottom: 26 }}>
            <div>
              <div style={{ display: 'flex', alignItems: 'baseline', fontFamily: serif, fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: todayCourt.length > 0 ? red : muted, margin: '0 0 10px' }}>
                Today
                <a
                  href="#/tasks"
                  style={{ marginLeft: 'auto', color: orange, textDecoration: 'none', fontWeight: 600, textTransform: 'none' as const, letterSpacing: 0, fontFamily: sans, fontSize: 13 }}
                >
                  View all tasks →
                </a>
              </div>
              {todayItems.length === 0 ? (
                <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 18px', fontSize: 13.5, color: muted }}>
                  Nothing due today and nothing overdue. The Tasks tab has the full list.
                </div>
              ) : (
                <div style={{ background: '#fff', border: `1px solid ${todayCourt.length > 0 ? red : border}` }} role="list" aria-label="Due today or overdue">
                  {todayItems.map((t, i) => {
                    const days = t.dueDate === null ? 0 : daysTo(t.dueDate);
                    const chipColour = t.isCourt ? red : days <= 0 ? amber : muted;
                    return (
                      <div
                        key={`${t.matterId}-${t.id}`}
                        role="listitem"
                        onClick={() => handleNav(`#/matter-detail/${t.matterId}`)}
                        onKeyDown={(e) => { if (e.key === 'Enter') handleNav(`#/matter-detail/${t.matterId}`); }}
                        tabIndex={0}
                        style={{ display: 'flex', alignItems: 'center', gap: 12, padding: '11px 16px', cursor: 'pointer', borderBottom: i < todayItems.length - 1 ? `1px solid ${border}` : 'none' }}
                      >
                        <span style={{ fontSize: 13, fontWeight: 700, color: chipColour, minWidth: 96 }}>
                          {days < 0 ? `${-days}d overdue` : days === 0 ? 'TODAY' : `in ${days}d`}
                        </span>
                        <span style={{ fontSize: 13.5, color: ink, fontWeight: 600 }}>{t.title}</span>
                        {t.isCourt && (
                          <span style={{ fontSize: 10, fontWeight: 700, color: red, background: '#fce8e6', padding: '2px 7px', borderRadius: 2 }}>COURT</span>
                        )}
                        <span style={{ fontSize: 13, color: muted, marginLeft: 'auto', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 220 }}>{t.matterLabel}</span>
                      </div>
                    );
                  })}
                  {todayOverflow > 0 && (
                    <a href="#/tasks" style={{ display: 'block', padding: '8px 16px', fontSize: 12, color: muted, borderTop: `1px solid ${border}`, textDecoration: 'none' }}>
                      and {todayOverflow} more on the Tasks tab
                    </a>
                  )}
                </div>
              )}
            </div>
            <div>
              <div style={{ fontFamily: serif, fontSize: 13, letterSpacing: '0.08em', textTransform: 'uppercase' as const, color: muted, margin: '0 0 10px' }}>
                Recent matters
              </div>
              {recentMatters.length === 0 ? (
                <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '16px 18px', fontSize: 13.5, color: muted }}>
                  No files yet.
                </div>
              ) : (
                <div style={{ background: '#fff', border: `1px solid ${border}` }} role="list" aria-label="Recently updated matters">
                  {recentMatters.map((m, i) => (
                    <div
                      key={m.matterId}
                      role="listitem"
                      onClick={() => handleNav(`#/matter-detail/${m.matterId}`)}
                      onKeyDown={(e) => { if (e.key === 'Enter') handleNav(`#/matter-detail/${m.matterId}`); }}
                      tabIndex={0}
                      style={{ padding: '10px 14px', cursor: 'pointer', borderBottom: i < recentMatters.length - 1 ? `1px solid ${border}` : 'none' }}
                    >
                      <div style={{ fontSize: 13, fontWeight: 600, color: ink, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{m.matterLabel}</div>
                      <div style={{ fontSize: 11.5, color: muted, marginTop: 1 }}>{m.fileNumber}</div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        )}

        {/* ── Quick Actions ───────────────────────────────────── */}
        <div
          style={{
            fontFamily: serif,
            fontSize: 13,
            letterSpacing: '0.08em',
            textTransform: 'uppercase' as const,
            color: muted,
            margin: '0 0 12px',
          }}
        >
          Quick Actions
        </div>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(3, 1fr)',
            gap: 18,
            marginBottom: 38,
          }}
          role="list"
          aria-label="Quick actions"
        >
          {/* New Matter */}
          <ActionCard
            icon="+"
            title="New Matter"
            description="Start a new client file. Upload an intake transcript or employment documents, or just describe the situation."
            cta="Start a matter"
            primary
            hovered={hoveredAction === 'new-matter'}
            onHover={(h) => setHoveredAction(h ? 'new-matter' : null)}
            onClick={() => handleNav('#/new-matter')}
          />
          {/* Draft Document */}
          <ActionCard
            icon="D"
            title="Draft Document"
            description="Generate a demand letter, Statement of Claim, mediation brief, or motion materials for an existing matter."
            cta="Draft a document"
            hovered={hoveredAction === 'draft'}
            onHover={(h) => setHoveredAction(h ? 'draft' : null)}
            onClick={() => handleNav('#/matter-detail')}
          />
          {/* Review Document */}
          <ActionCard
            icon="R"
            title="Review Document"
            description="Analyse an employment agreement, termination letter, or severance package for risks and enforceability."
            cta="Review a document"
            hovered={hoveredAction === 'review'}
            onHover={(h) => setHoveredAction(h ? 'review' : null)}
            onClick={() => handleNav('#/matter-detail')}
          />
        </div>

        {/* ── My Matters ──────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', margin: '0 0 14px' }}>
          <h2 style={{ fontFamily: serif, fontSize: 19, fontWeight: 600, color: navy, margin: 0 }}>
            My Matters
            <a
              href="#/matters"
              style={{ marginLeft: 12, fontFamily: sans, fontSize: 13, fontWeight: 600, color: orange, textDecoration: 'none' }}
              aria-label="View all matters as files"
            >
              View as files →
            </a>
          </h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
            <input
              type="search"
              value={search}
              onChange={e => setSearch(e.target.value)}
              placeholder="Search client, employer, file number"
              aria-label="Search matters"
              style={{ fontSize: 12.5, padding: '6px 10px', border: `1px solid ${border}`, borderRadius: 2, fontFamily: sans, width: 240 }}
            />
            <div style={{ display: 'flex', gap: 6 }} role="group" aria-label="Filter matters">
              {FILTERS.map(f => (
                <button
                  key={f.key}
                  onClick={() => setActiveFilter(f.key)}
                  style={{
                    fontSize: 12,
                    padding: '5px 11px',
                    border: `1px solid ${activeFilter === f.key ? navy : border}`,
                    borderRadius: 2,
                    background: activeFilter === f.key ? navy : '#fff',
                    color: activeFilter === f.key ? '#fff' : muted,
                    cursor: 'pointer',
                    fontFamily: sans,
                  }}
                  aria-pressed={activeFilter === f.key}
                >
                  {f.label}
                </button>
              ))}
            </div>
            <button
              onClick={() => handleNav('#/new-matter')}
              style={{
                background: orange,
                color: '#fff',
                fontSize: 13,
                fontWeight: 600,
                padding: '9px 16px',
                borderRadius: 2,
                border: 'none',
                cursor: 'pointer',
                fontFamily: sans,
              }}
              aria-label="Create new matter"
            >
              {'\uFF0B'} New Matter
            </button>
          </div>
        </div>

        {/* Matter list */}
        {loading && (
          <div style={{ padding: '40px 20px', textAlign: 'center', color: muted, fontSize: 14, background: '#fff', border: `1px solid ${border}` }}>
            Loading matters...
          </div>
        )}
        {!loading && matters.length === 0 && (
          <div style={{ padding: '48px 32px', background: '#fff', border: `1px solid ${border}` }}>
            <div style={{ maxWidth: 560, margin: '0 auto', textAlign: 'center' }}>
              <div style={{ display: 'flex', gap: 4, justifyContent: 'center', marginBottom: 18 }} aria-hidden="true">
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ea580c' }} />
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#f26a3d' }} />
                <span style={{ width: 8, height: 8, borderRadius: '50%', background: '#ff8a5c' }} />
              </div>
              <div style={{ fontFamily: serif, fontSize: 22, color: navy, fontWeight: 600, marginBottom: 8 }}>
                Welcome to Starling
              </div>
              <div style={{ fontSize: 14, color: muted, marginBottom: 28, lineHeight: 1.6 }}>
                Your Ontario employment and labour law engine. From intake to demand letter in minutes;
                every draft reviewed and approved by you.
              </div>

              <div style={{ textAlign: 'left', margin: '0 auto 28px', display: 'inline-block' }}>
                {[
                  ['1', 'Add your details in the Starling Profile', 'Your name, firm, and LSO number flow onto every generated document.'],
                  ['2', 'Create your first matter', 'Structured intake, or upload the termination letter and let Starling extract the facts.'],
                  ['3', 'Review issues, then generate', 'Approve the legal issues you want to advance; Starling drafts the demand letter or pleading for your review.'],
                ].map(([num, title, sub]) => (
                  <div key={num} style={{ display: 'flex', gap: 14, alignItems: 'flex-start', marginBottom: 16 }}>
                    <span style={{
                      width: 24, height: 24, borderRadius: '50%', background: cream, border: `1px solid ${border}`,
                      color: navy, fontSize: 12, fontWeight: 700, display: 'flex', alignItems: 'center',
                      justifyContent: 'center', flexShrink: 0, fontFamily: sans,
                    }}>{num}</span>
                    <div>
                      <div style={{ fontSize: 14, color: ink, fontWeight: 600 }}>{title}</div>
                      <div style={{ fontSize: 12.5, color: muted, lineHeight: 1.5 }}>{sub}</div>
                    </div>
                  </div>
                ))}
              </div>

              <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
                <a
                  href="#/new-matter"
                  style={{
                    background: orange, color: '#fff', fontSize: 13.5, fontWeight: 600,
                    padding: '11px 22px', borderRadius: 2, textDecoration: 'none', fontFamily: sans,
                  }}
                >
                  Create your first matter
                </a>
                <a
                  href="#/my-page"
                  style={{
                    background: '#fff', color: navy, fontSize: 13.5, fontWeight: 600,
                    padding: '11px 22px', borderRadius: 2, border: `1px solid ${border}`,
                    textDecoration: 'none', fontFamily: sans,
                  }}
                >
                  Set up your profile
                </a>
              </div>
            </div>
          </div>
        )}
        {!loading && searchedMatters.length === 0 && (matters.length > 0) && (
          <div style={{ padding: '32px', textAlign: 'center', color: muted, fontSize: 13.5, background: '#fff', border: `1px solid ${border}` }}>
            No matters match {q ? `"${search.trim()}"` : 'this filter'}.
          </div>
        )}
        {!loading && visibleMatters.length > 0 && (
        <div
          style={{ background: '#fff', border: `1px solid ${border}` }}
          role="list"
          aria-label="Matters list"
        >
          {visibleMatters.map((matter, idx) => (
            <div
              key={matter.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '6px 1fr auto',
                gap: 0,
                borderBottom: idx < visibleMatters.length - 1 ? `1px solid ${border}` : 'none',
                alignItems: 'stretch',
              }}
              role="listitem"
              onMouseEnter={() => setHoveredMatter(matter.id)}
              onMouseLeave={() => setHoveredMatter(null)}
            >
              {/* Colour bar */}
              <div style={{ width: 6, background: BAR_COLOURS[matter.status] }} aria-hidden="true" />

              {/* Body */}
              <div
                style={{
                  padding: '16px 20px',
                  cursor: 'pointer',
                  background: hoveredMatter === matter.id ? '#fcfbf9' : 'transparent',
                  transition: 'background 0.15s',
                }}
                onClick={() => handleNav(`#/matter-detail/${matter.id}`)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNav(`#/matter-detail/${matter.id}`); } }}
                tabIndex={0}
                role="button"
                aria-label={`Open matter: ${matter.name}`}
              >
                {/* Line 1 */}
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
                  <span style={{ width: 8, height: 8, borderRadius: '50%', background: matter.statusColour, display: 'inline-block', flexShrink: 0 }} aria-hidden="true" />
                  <span style={{ fontFamily: serif, fontSize: 16.5, color: navy, fontWeight: 600 }}>{matter.name}</span>
                  <span style={{ fontSize: 11.5, color: muted, marginLeft: 2 }}>{matter.number}</span>
                  <span
                    style={{
                      marginLeft: 'auto',
                      fontSize: 12,
                      fontWeight: 600,
                      padding: '3px 9px',
                      borderRadius: 2,
                      ...FLAG_STYLES[matter.flagColour],
                    }}
                  >
                    {matter.flagText}
                  </span>
                </div>
                {/* Line 2 */}
                <div style={{ fontSize: 13.5, color: muted }}>
                  <b style={{ color: ink, fontWeight: 600 }}>{matter.description.split(':')[0]}:</b>
                  {matter.description.split(':').slice(1).join(':')}
                </div>
              </div>

              {/* Meta */}
              <div
                style={{
                  padding: '16px 20px',
                  textAlign: 'right' as const,
                  borderLeft: `1px solid ${border}`,
                  minWidth: 150,
                  display: 'flex',
                  flexDirection: 'column' as const,
                  justifyContent: 'center',
                  gap: 3,
                }}
              >
                <div style={{ fontSize: 11, color: muted, textTransform: 'uppercase' as const, letterSpacing: '0.05em' }}>
                  {matter.metaLabel}
                </div>
                <div style={{ fontSize: 13.5, color: matter.metaColour ?? ink, fontWeight: 600 }}>
                  {matter.metaValue}
                </div>
                {confirmingDelete === matter.id ? (
                  <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', marginTop: 4 }}>
                    <button
                      onClick={(e) => { e.stopPropagation(); handleDeleteMatter(matter.id); }}
                      disabled={deleting}
                      style={{ fontSize: 11, fontWeight: 600, color: '#fff', background: '#dc2626', border: 'none', borderRadius: 2, padding: '4px 10px', cursor: deleting ? 'not-allowed' : 'pointer', fontFamily: sans }}
                    >
                      {deleting ? 'Deleting...' : 'Confirm delete'}
                    </button>
                    <button
                      onClick={(e) => { e.stopPropagation(); setConfirmingDelete(null); }}
                      style={{ fontSize: 11, color: muted, background: 'transparent', border: `1px solid ${border}`, borderRadius: 2, padding: '4px 10px', cursor: 'pointer', fontFamily: sans }}
                    >
                      Cancel
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={(e) => { e.stopPropagation(); setConfirmingDelete(matter.id); }}
                    aria-label={`Delete matter ${matter.name}`}
                    style={{
                      fontSize: 11, color: muted, background: 'transparent', border: 'none',
                      cursor: 'pointer', fontFamily: sans, padding: 0, marginTop: 4,
                      textAlign: 'right' as const, textDecoration: 'underline',
                      opacity: hoveredMatter === matter.id ? 1 : 0,
                      transition: 'opacity 0.15s',
                    }}
                  >
                    Delete
                  </button>
                )}
              </div>
            </div>
          ))}

        </div>
        )}
        {!loading && searchedMatters.length > visibleMatters.length && (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 12, padding: '12px 0' }}>
            <span style={{ fontSize: 12.5, color: muted }}>
              Showing {visibleMatters.length} of {searchedMatters.length}
            </span>
            <button
              onClick={() => setVisibleCount(c => c + 25)}
              style={{ fontSize: 12.5, fontWeight: 600, padding: '6px 14px', border: `1px solid ${border}`, borderRadius: 2, background: '#fff', color: navy, cursor: 'pointer', fontFamily: sans }}
            >
              Show 25 more
            </button>
          </div>
        )}

        {/* ── Completed (collapsed) ──────────────────────────── */}
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 10,
            margin: '26px 0 12px',
            color: muted,
            fontSize: 12,
            letterSpacing: '0.06em',
            textTransform: 'uppercase' as const,
          }}
        >
          Completed
          <span style={{ flex: 1, height: 1, background: border }} aria-hidden="true" />
        </div>

        {completedMatters.length > 0 && !showCompleted ? (
          <div
            style={{
              fontSize: 13,
              color: muted,
              padding: '14px 20px',
              background: '#fff',
              border: `1px solid ${border}`,
              display: 'flex',
              alignItems: 'center',
              justifyContent: 'space-between',
            }}
          >
            <span>
              {completedMatters.length} completed matter{completedMatters.length !== 1 ? 's' : ''} &mdash;{' '}
              {completedMatters.map((m, i) => (
                <span key={m.id}>
                  <b style={{ color: ink }}>{m.name}</b>
                  {i < completedMatters.length - 1 ? ', ' : ''}
                </span>
              ))}
            </span>
            <button
              onClick={() => setShowCompleted(true)}
              style={{
                color: orange,
                fontWeight: 600,
                fontSize: 13,
                background: 'none',
                border: 'none',
                cursor: 'pointer',
                fontFamily: sans,
              }}
              aria-label="Show completed matters"
            >
              Show completed &rarr;
            </button>
          </div>
        ) : completedMatters.length > 0 ? (
          <div style={{ background: '#fff', border: `1px solid ${border}` }}>
            {completedMatters.map((m, idx) => (
              <div
                key={m.id}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '6px 1fr',
                  gap: 0,
                  borderBottom: idx < completedMatters.length - 1 ? `1px solid ${border}` : 'none',
                  alignItems: 'stretch',
                  cursor: 'pointer',
                }}
                onClick={() => handleNav(`#/matter-detail/${m.id}`)}
              >
                <div style={{ width: 6, background: green }} aria-hidden="true" />
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ width: 8, height: 8, borderRadius: '50%', background: green, display: 'inline-block' }} aria-hidden="true" />
                    <span style={{ fontFamily: serif, fontSize: 16.5, color: navy, fontWeight: 600 }}>{m.name}</span>
                    <span
                      style={{
                        marginLeft: 'auto',
                        fontSize: 12,
                        fontWeight: 600,
                        padding: '3px 9px',
                        borderRadius: 2,
                        ...FLAG_STYLES.green,
                      }}
                    >
                      Completed
                    </span>
                  </div>
                </div>
              </div>
            ))}
            <div style={{ padding: '10px 20px', textAlign: 'right' }}>
              <button
                onClick={() => setShowCompleted(false)}
                style={{
                  color: orange,
                  fontWeight: 600,
                  fontSize: 13,
                  background: 'none',
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: sans,
                }}
                aria-label="Hide completed matters"
              >
                Hide completed &larr;
              </button>
            </div>
          </div>
        ) : null}

        {/* ── Footer ──────────────────────────────────────────── */}
        <footer style={{ marginTop: 40, color: muted, fontSize: 12, textAlign: 'center' }} role="contentinfo">
          DemandPay <b style={{ color: ink }}>Starling</b> &middot; Ontario Employment Law Workbench &middot; Matters auto-sorted by urgency &middot; Status inferred from activity
        </footer>
      </main>
    </div>
  );
}

// ── ActionCard sub-component ─────────────────────────────────────────────

interface ActionCardProps {
  icon: string;
  title: string;
  description: string;
  cta: string;
  primary?: boolean;
  hovered: boolean;
  onHover: (h: boolean) => void;
  onClick: () => void;
}

function ActionCard({ icon, title, description, cta, primary, hovered, onHover, onClick }: ActionCardProps) {
  return (
    <a
      href="#"
      onClick={(e) => { e.preventDefault(); onClick(); }}
      onMouseEnter={() => onHover(true)}
      onMouseLeave={() => onHover(false)}
      style={{
        background: '#fff',
        border: `1px solid ${hovered ? orange : border}`,
        borderRadius: 0,
        padding: '22px 22px 24px',
        display: 'flex',
        flexDirection: 'column',
        minHeight: 182,
        transition: 'border-color 0.15s, box-shadow 0.15s',
        boxShadow: hovered ? `0 2px 0 ${orange}` : 'none',
        textDecoration: 'none',
        color: 'inherit',
      }}
      role="listitem"
      aria-label={title}
    >
      {/* Icon */}
      <div
        style={{
          width: 38,
          height: 38,
          borderRadius: 2,
          display: 'grid',
          placeItems: 'center',
          fontSize: 20,
          marginBottom: 14,
          background: primary ? orange : cream,
          color: primary ? '#fff' : ink,
          border: `1px solid ${primary ? orange : border}`,
        }}
        aria-hidden="true"
      >
        {icon}
      </div>
      <h3 style={{ fontFamily: serif, fontSize: 18, fontWeight: 600, color: navy, marginBottom: 8, marginTop: 0 }}>{title}</h3>
      <p style={{ color: muted, fontSize: 13.5, flex: 1, margin: 0, lineHeight: 1.5 }}>{description}</p>
      <div style={{ marginTop: 16, fontSize: 13, fontWeight: 600, color: orange, display: 'flex', alignItems: 'center', gap: 6 }}>
        {cta} &rarr;
      </div>
    </a>
  );
}
