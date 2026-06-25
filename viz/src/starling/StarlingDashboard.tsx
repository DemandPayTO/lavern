/**
 * StarlingDashboard — Phase 2 Dashboard for DemandPay Starling.
 *
 * Full matter management dashboard with top bar, quick actions,
 * matter list with urgency sorting, and collapsed completed section.
 *
 * Ontario employment law vocabulary (ESA, Bardal, HRTO, Statement of Claim).
 * Canadian spelling throughout (analyse, licenced).
 */

import { useState, useCallback } from 'react';

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
  const [activeFilter, setActiveFilter] = useState<FilterKey>('all');
  const [showCompleted, setShowCompleted] = useState(false);
  const [hoveredAction, setHoveredAction] = useState<string | null>(null);
  const [hoveredMatter, setHoveredMatter] = useState<string | null>(null);

  // Filter matters
  const filteredMatters = activeFilter === 'all'
    ? DEMO_MATTERS
    : DEMO_MATTERS.filter(m => m.status === activeFilter);

  // Stats
  const urgentCount = DEMO_MATTERS.filter(m => m.status === 'urgent').length;
  const staleCount = DEMO_MATTERS.filter(m => m.status === 'stale').length;
  const activeCount = DEMO_MATTERS.length;

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
            href="#/archive"
            style={{
              padding: '8px 14px',
              borderRadius: 2,
              fontSize: 14,
              color: '#cfd6e0',
              border: '1px solid transparent',
              textDecoration: 'none',
            }}
          >
            Library
          </a>
          <a
            href="#/my-page"
            style={{
              width: 34,
              height: 34,
              display: 'grid',
              placeItems: 'center',
              border: '1px solid rgba(255,255,255,0.22)',
              borderRadius: 2,
              color: '#cfd6e0',
              textDecoration: 'none',
            }}
            title="Settings"
            aria-label="Settings"
          >
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
              <circle cx="12" cy="12" r="3" />
              <path d="M12 1v2M12 21v2M4.22 4.22l1.42 1.42M18.36 18.36l1.42 1.42M1 12h2M21 12h2M4.22 19.78l1.42-1.42M18.36 5.64l1.42-1.42" />
            </svg>
          </a>
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
          <h2 style={{ fontFamily: serif, fontSize: 19, fontWeight: 600, color: navy, margin: 0 }}>My Matters</h2>
          <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
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
        <div
          style={{ background: '#fff', border: `1px solid ${border}` }}
          role="list"
          aria-label="Matters list"
        >
          {filteredMatters.map((matter, idx) => (
            <div
              key={matter.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '6px 1fr auto',
                gap: 0,
                borderBottom: idx < filteredMatters.length - 1 ? `1px solid ${border}` : 'none',
                alignItems: 'stretch',
              }}
              role="listitem"
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
                onClick={() => handleNav('#/matter-detail')}
                onMouseEnter={() => setHoveredMatter(matter.id)}
                onMouseLeave={() => setHoveredMatter(null)}
                onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); handleNav('#/matter-detail'); } }}
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
              </div>
            </div>
          ))}

          {filteredMatters.length === 0 && (
            <div style={{ padding: '24px 20px', textAlign: 'center', color: muted, fontSize: 14 }}>
              No matters match this filter.
            </div>
          )}
        </div>

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

        {!showCompleted ? (
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
              {'\u2705'} {COMPLETED_MATTERS.length} completed matters &mdash;{' '}
              {COMPLETED_MATTERS.map((name, i) => (
                <span key={name}>
                  <b style={{ color: ink }}>{name}</b>
                  {i < COMPLETED_MATTERS.length - 1 ? ', ' : ''}
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
        ) : (
          <div style={{ background: '#fff', border: `1px solid ${border}` }}>
            {COMPLETED_MATTERS.map((name, idx) => (
              <div
                key={name}
                style={{
                  display: 'grid',
                  gridTemplateColumns: '6px 1fr',
                  gap: 0,
                  borderBottom: idx < COMPLETED_MATTERS.length - 1 ? `1px solid ${border}` : 'none',
                  alignItems: 'stretch',
                }}
              >
                <div style={{ width: 6, background: green }} aria-hidden="true" />
                <div style={{ padding: '16px 20px' }}>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <span style={{ fontSize: 14 }} aria-hidden="true">{'\u2705'}</span>
                    <span style={{ fontFamily: serif, fontSize: 16.5, color: navy, fontWeight: 600 }}>{name}</span>
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
        )}

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
