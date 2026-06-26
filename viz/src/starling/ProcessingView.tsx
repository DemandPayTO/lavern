/**
 * ProcessingView -- Starling pipeline progress screen.
 *
 * Shows AI pipeline steps as a human-readable checklist with live
 * activity feed and cost tracker. Static demo data with simulated
 * step progression (will be wired to WebSocket events later).
 *
 * Ontario employment law vocabulary. Canadian spelling throughout.
 */

import { useEffect, useCallback } from 'react';
import { useProcessing } from './hooks/useStarlingApi.js';
import { SOURCE_TAGS } from './hooks/stepMapping.js';

// -- Design Tokens --------------------------------------------------------
const navy = '#0f1a2e';
const orange = '#ea580c';
const cream = '#faf8f5';
const frame = '#e8e5e0';
const green = '#16a34a';
const amber = '#d97706';
const border = 'rgba(15,26,46,0.12)';
const ink = '#0f1a2e';
const muted = '#5a6472';
const serif = "Georgia, 'Palatino Linotype', serif";
const sans = "system-ui, -apple-system, sans-serif";

// -- Types ----------------------------------------------------------------

type StepState = 'done' | 'run' | 'todo';

interface PipelineStep {
  label: string;
  subtitle?: string;
  state: StepState;
}

interface ActivityItem {
  who: string;
  finding: string;
  findingBold?: string;
  tag: 'verified' | 'web';
  tagLabel: string;
}

// -- Keyframes injection (once) -------------------------------------------

const PULSE_KEYFRAMES = `
@keyframes starling-pulse {
  0%, 100% { box-shadow: 0 0 0 0 rgba(234,88,12,0.4); }
  50% { box-shadow: 0 0 0 6px rgba(234,88,12,0); }
}
`;

let injected = false;
function injectKeyframes() {
  if (injected || typeof document === 'undefined') return;
  const style = document.createElement('style');
  style.textContent = PULSE_KEYFRAMES;
  document.head.appendChild(style);
  injected = true;
}

// -- Component ------------------------------------------------------------

export default function ProcessingView() {
  // Extract sessionId from URL hash: #/processing/SESSION_ID
  const rawSid = window.location.hash.match(/#\/processing\/(.+)/)?.[1] ?? null;
  const sessionId = rawSid?.replace(/\s+/g, '') ?? null;

  const { steps: hookSteps, findings, cost, status, gateRequest, approveGate } = useProcessing(sessionId);

  // Inject CSS keyframes on mount
  useEffect(() => { injectKeyframes(); }, []);

  const handleNav = useCallback((hash: string) => {
    window.location.hash = hash;
  }, []);

  // Map hook steps to local PipelineStep shape
  const mappedSteps: PipelineStep[] = hookSteps.map(s => ({
    label: s.label,
    subtitle: s.detail,
    state: s.status === 'done' ? 'done' : s.status === 'active' ? 'run' : 'todo',
  }));

  // Map hook findings to local ActivityItem shape
  const activityItems: ActivityItem[] = findings.map(f => {
    const tag = SOURCE_TAGS[f.sourceType];
    const isVerified = tag?.trustLevel === 'high';
    return {
      who: 'Finding',
      finding: f.text,
      tag: isVerified ? 'verified' : 'web',
      tagLabel: tag?.label ?? f.sourceType,
    };
  });

  const costPct = cost.percentage;

  return (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' as const }}>
      {/* -- Top Bar ---------------------------------------------------- */}
      <TopBar />

      {/* -- Main Content ----------------------------------------------- */}
      <main id="main-content" style={{ maxWidth: 920, margin: '0 auto', padding: '24px 28px 60px' }}>
        {/* Breadcrumb */}
        <nav style={{ color: muted, fontSize: 13, marginBottom: 14 }} aria-label="Breadcrumb">
          <a href="#/" style={{ color: 'inherit', textDecoration: 'none' }} onClick={() => handleNav('#/')}>My Matters</a>
          {' > '}
          <span>{sessionId ? `Session ${sessionId.slice(0, 8)}` : 'Drafting'}</span>
        </nav>

        {/* Header */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 6 }}>
          <h1 style={{ fontFamily: serif, fontWeight: 600, fontSize: 23, color: navy, margin: 0 }}>Drafting Demand Letter</h1>
          {sessionId && <div style={{ fontSize: 13, color: muted }}>{sessionId.slice(0, 12)}</div>}
        </div>
        <p style={{ color: muted, fontSize: 14, marginBottom: 24 }}>
          Starling is working through the matter. You can leave this screen -- you will be notified when the draft is ready for your review.
        </p>

        {/* Gate approval dialog */}
        {gateRequest && (
          <div style={{
            background: '#fff',
            border: `2px solid ${orange}`,
            borderRadius: 2,
            padding: '18px 22px',
            marginBottom: 20,
          }}>
            <div style={{ fontWeight: 600, color: navy, fontSize: 14, marginBottom: 8 }}>
              Approval required
            </div>
            <div style={{ fontSize: 13.5, color: muted, marginBottom: 14 }}>
              {gateRequest.summary}
            </div>
            <div style={{ display: 'flex', gap: 10 }}>
              <button
                onClick={() => approveGate('approve')}
                style={{
                  background: green,
                  color: '#fff',
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '9px 18px',
                  borderRadius: 2,
                  border: 'none',
                  cursor: 'pointer',
                  fontFamily: sans,
                }}
              >
                Approve
              </button>
              <button
                onClick={() => approveGate('reject')}
                style={{
                  background: '#fff',
                  color: '#dc2626',
                  fontSize: 13,
                  fontWeight: 600,
                  padding: '9px 18px',
                  borderRadius: 2,
                  border: '1px solid #dc2626',
                  cursor: 'pointer',
                  fontFamily: sans,
                }}
              >
                Reject
              </button>
            </div>
          </div>
        )}

        {/* Grid: steps + sidebar */}
        <div style={{ display: 'grid', gridTemplateColumns: '1.15fr 1fr', gap: 20, alignItems: 'start' }}>
          {/* Steps checklist */}
          <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '8px 0' }}>
            {mappedSteps.map((step, i) => (
              <StepRow key={i} step={step} isLast={i === mappedSteps.length - 1} />
            ))}
          </div>

          {/* Sidebar: feed + cost */}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
            {/* Live Activity Feed */}
            <div style={{ background: navy, color: '#e8edf3', border: `1px solid ${navy}`, padding: '18px 20px' }}>
              <h3 style={{ fontFamily: serif, fontWeight: 600, color: '#fff', fontSize: 14, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8, margin: '0 0 14px 0' }}>
                Live Activity
                <span style={{
                  fontFamily: sans,
                  fontSize: 10,
                  fontWeight: 700,
                  letterSpacing: '0.08em',
                  color: '#fff',
                  background: status === 'complete' ? green : orange,
                  padding: '2px 7px',
                  borderRadius: 2,
                }}>{status === 'complete' ? 'DONE' : 'LIVE'}</span>
              </h3>
              {activityItems.length > 0 ? (
                activityItems.map((act, i) => (
                  <ActivityRow key={i} item={act} isLast={i === activityItems.length - 1} />
                ))
              ) : (
                <div style={{ fontSize: 13, color: '#9fb0c4', padding: '8px 0' }}>
                  Waiting for findings...
                </div>
              )}
            </div>

            {/* Cost Tracker */}
            <div style={{ background: '#fff', border: `1px solid ${border}`, padding: '18px 20px' }}>
              <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 10 }}>
                <span style={{ fontSize: 13, color: muted }}>Cost so far</span>
                <span style={{ fontFamily: serif, fontSize: 20, color: navy, fontWeight: 600 }}>
                  ${cost.spent.toFixed(2)} <small style={{ fontSize: 12, color: muted, fontWeight: 400 }}>/ ${cost.budget.toFixed(2)} budget</small>
                </span>
              </div>
              {/* Progress bar */}
              <div style={{ height: 9, background: cream, border: `1px solid ${border}`, borderRadius: 2, overflow: 'hidden' }}>
                <span style={{ display: 'block', height: '100%', width: `${costPct}%`, background: orange, transition: 'width 0.6s ease' }} />
              </div>
              <div style={{ fontSize: 11.5, color: muted, marginTop: 8 }}>
                {costPct}% of session budget &middot; within cap &middot; cost logged to audit bundle
              </div>
            </div>

            {/* View Results / Cancel button */}
            <div style={{ textAlign: 'center' }}>
              {status === 'complete' && sessionId ? (
                <button
                  onClick={() => handleNav(`#/results/${sessionId}`)}
                  style={{
                    background: orange,
                    color: '#fff',
                    fontSize: 14,
                    fontWeight: 600,
                    padding: '13px 24px',
                    borderRadius: 2,
                    border: 'none',
                    cursor: 'pointer',
                    fontFamily: sans,
                  }}
                >
                  View Results
                </button>
              ) : (
                <button
                  onClick={() => handleNav('#/')}
                  style={{
                    background: '#fff',
                    border: `1px solid ${border}`,
                    color: muted,
                    fontSize: 13,
                    padding: '9px 18px',
                    borderRadius: 2,
                    cursor: 'pointer',
                  }}
                >
                  Cancel and return to matter
                </button>
              )}
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

// -- Sub-components -------------------------------------------------------

/** Top navigation bar -- shared Starling pattern. */
function TopBar() {
  return (
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
    </header>
  );
}

/** Single pipeline step row. */
function StepRow({ step, isLast }: { step: PipelineStep; isLast: boolean }) {
  const isDone = step.state === 'done';
  const isRun = step.state === 'run';
  const isTodo = step.state === 'todo';

  // Icon styles per state
  const iconBase: React.CSSProperties = {
    width: 24,
    height: 24,
    borderRadius: '50%',
    display: 'grid',
    placeItems: 'center',
    fontSize: 13,
    flexShrink: 0,
    marginTop: 1,
  };

  let iconStyle: React.CSSProperties;
  let iconContent: React.ReactNode;

  if (isDone) {
    iconStyle = { ...iconBase, background: green, color: '#fff' };
    // SVG checkmark instead of emoji
    iconContent = (
      <svg width="12" height="12" viewBox="0 0 12 12" fill="none" aria-hidden="true">
        <path d="M2 6l3 3 5-5" stroke="#fff" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" />
      </svg>
    );
  } else if (isRun) {
    iconStyle = { ...iconBase, background: orange, color: '#fff', animation: 'starling-pulse 1.2s infinite' };
    // Filled dot
    iconContent = <span style={{ width: 6, height: 6, borderRadius: '50%', background: '#fff', display: 'block' }} />;
  } else {
    iconStyle = { ...iconBase, background: '#fff', border: `1.5px solid ${border}` };
    iconContent = null;
  }

  return (
    <div
      style={{
        display: 'flex',
        gap: 14,
        padding: '13px 22px',
        alignItems: 'flex-start',
        borderBottom: isLast ? 'none' : `1px solid ${border}`,
      }}
    >
      <div style={iconStyle}>{iconContent}</div>
      <div>
        <div style={{
          fontSize: 14,
          fontWeight: isTodo ? 500 : 600,
          color: isRun ? orange : isTodo ? muted : ink,
        }}>
          {step.label}{isRun ? '...' : ''}
        </div>
        {step.subtitle && (
          <div style={{ fontSize: 12.5, color: muted, marginTop: 4, lineHeight: 1.5 }}>
            {step.subtitle}
          </div>
        )}
      </div>
    </div>
  );
}

/** Single activity feed row. */
function ActivityRow({ item, isLast }: { item: ActivityItem; isLast: boolean }) {
  const isVerified = item.tag === 'verified';
  const dotColour = isVerified ? green : amber;
  const tagBg = isVerified ? 'rgba(22,163,74,0.22)' : 'rgba(217,119,6,0.22)';
  const tagColour = isVerified ? '#7ee2a0' : '#f4c77a';

  return (
    <div style={{ fontSize: 13, lineHeight: 1.55, padding: '10px 0', borderBottom: isLast ? 'none' : '1px solid rgba(255,255,255,0.1)' }}>
      <div style={{ color: '#9fb0c4', fontSize: 11.5, marginBottom: 3 }}>{item.who}</div>
      <div style={{ color: '#fff' }}>
        {item.findingBold
          ? renderBoldFinding(item.finding, item.findingBold)
          : item.finding
        }
      </div>
      <span style={{
        display: 'inline-flex',
        alignItems: 'center',
        gap: 4,
        fontSize: 10.5,
        fontWeight: 600,
        padding: '1px 7px',
        borderRadius: 2,
        marginTop: 5,
        background: tagBg,
        color: tagColour,
      }}>
        {/* Colour-coded dot */}
        <span style={{ width: 6, height: 6, borderRadius: '50%', background: dotColour, display: 'inline-block' }} />
        {item.tagLabel}
      </span>
    </div>
  );
}

/** Render finding text with one bold segment. */
function renderBoldFinding(text: string, bold: string): React.ReactNode {
  const idx = text.indexOf(bold);
  if (idx === -1) return text;
  return (
    <>
      {text.slice(0, idx)}
      <b style={{ color: '#ffd9c4' }}>{bold}</b>
      {text.slice(idx + bold.length)}
    </>
  );
}
