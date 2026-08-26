/**
 * TasksView — the unified task inbox ("Tasks" tab).
 *
 * One list of everything the lawyer owes across every matter: docket
 * deadlines plus debrief action items, grouped by band (Overdue, Today,
 * This week, Later, No date) with done items collapsed into an archive.
 * Court deadlines are the only red, matching the dashboard triage rule.
 * Quick-add, check-off, and reschedule call the deterministic /api/tasks
 * routes; the calendar panel manages the revocable subscribe token.
 *
 * See docs/specs/task-inbox-2026-07.md.
 */

import { useState, useCallback, useEffect, useContext } from 'react';
import { useApprovalsEnabled } from './hooks/useStarlingApi.js';
import { UserContext } from '../auth/UserContext.js';

// ── Design tokens (Starling palette, matches StarlingDashboard) ─────────
const navy = '#0f1a2e';
const orange = '#ea580c';
const frame = '#e8e5e0';
const red = '#dc2626';
const amber = '#d97706';
const border = 'rgba(15,26,46,0.12)';
const ink = '#0f1a2e';
const muted = '#5a6472';
const serif = "Georgia, 'Palatino Linotype', serif";
const sans = "system-ui, -apple-system, sans-serif";

// ── API types (mirror src/api/routes/tasks.ts) ──────────────────────────

type TaskBand = 'overdue' | 'today' | 'week' | 'later' | 'none';

export interface TaskRow {
  id: string;
  matterId: string;
  matterLabel: string;
  fileNumber: string;
  title: string;
  source: 'action' | 'deadline';
  kind: string;
  dueDate: string | null;
  isCourt: boolean;
  band: TaskBand;
  status: 'open' | 'done';
  emailSubject?: string;
  emailBody?: string;
}

interface MatterOption { matterId: string; matterLabel: string; fileNumber: string }

interface InboxData {
  tasks: TaskRow[];
  matters: MatterOption[];
  counts: { overdue: number; today: number; week: number; later: number; none: number; done: number };
}

const KIND_LABELS: Record<string, string> = {
  task: 'Task', email: 'Email', call: 'Call', filing: 'Filing', document: 'Document',
  limitation: 'Limitation', demand_response: 'Demand response', severance_offer: 'Offer deadline',
  timeline: 'Deadline', client_email: 'Client email', grievance_filing: 'Grievance filing',
  grievance_referral: 'Referral', grievance_step: 'Grievance step',
};

const GROUPS: Array<{ band: TaskBand; title: string }> = [
  { band: 'overdue', title: 'Overdue' },
  { band: 'today', title: 'Today' },
  { band: 'week', title: 'This week' },
  { band: 'later', title: 'Later' },
  { band: 'none', title: 'No date' },
];

function fmtDate(iso: string | null): string {
  if (!iso) return '';
  const d = new Date(`${iso}T00:00:00`);
  if (isNaN(d.getTime())) return iso;
  return d.toLocaleDateString('en-CA', { month: 'short', day: 'numeric', year: 'numeric' });
}

// ── Component ───────────────────────────────────────────────────────────

export default function TasksView() {
  const userCtx = useContext(UserContext);
  const approvalsEnabled = useApprovalsEnabled();
  const [data, setData] = useState<InboxData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  // Filters
  const [matterFilter, setMatterFilter] = useState('all');
  const [sourceFilter, setSourceFilter] = useState<'all' | 'action' | 'deadline'>('all');
  const [showDone, setShowDone] = useState(false);

  // Quick-add
  const [qaTitle, setQaTitle] = useState('');
  const [qaDate, setQaDate] = useState('');
  const [qaMatter, setQaMatter] = useState('');
  const [qaBusy, setQaBusy] = useState(false);

  // Reschedule: taskId currently showing a date input
  const [rescheduling, setRescheduling] = useState<string | null>(null);
  const [rescheduleDate, setRescheduleDate] = useState('');

  // Email draft expansion
  const [expandedEmail, setExpandedEmail] = useState<string | null>(null);

  // Calendar feed panel
  const [feedActive, setFeedActive] = useState(false);
  const [feedPath, setFeedPath] = useState<string | null>(null); // shown once after mint
  const [feedOpen, setFeedOpen] = useState(false);
  const [copied, setCopied] = useState<string | null>(null);

  // Weekly digest opt-in (real accounts only; hidden in LOCAL MODE)
  const [digestAvailable, setDigestAvailable] = useState(false);
  const [digestOptedIn, setDigestOptedIn] = useState(false);

  const fetchInbox = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks', { credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { ok: boolean } & InboxData;
      setData(body);
      setError(null);
    } catch {
      setError('Could not load your tasks. Check the connection and retry.');
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void fetchInbox();
    void fetch('/api/tasks/feed', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (d) setFeedActive(Boolean((d as { active?: boolean }).active)); })
      .catch(() => { /* panel simply shows generate */ });
    void fetch('/api/tasks/digest', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => {
        if (!d) return;
        const body = d as { available?: boolean; optedIn?: boolean };
        setDigestAvailable(Boolean(body.available));
        setDigestOptedIn(Boolean(body.optedIn));
      })
      .catch(() => { /* control stays hidden */ });
  }, [fetchInbox]);

  const toggleDigest = useCallback(async (optIn: boolean) => {
    setDigestOptedIn(optIn); // optimistic
    try {
      const res = await fetch('/api/tasks/digest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ optIn }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
    } catch {
      setDigestOptedIn(!optIn); // roll back
      setError('Could not update the weekly email setting.');
    }
  }, []);

  const patchTask = useCallback(async (t: TaskRow, body: { status?: 'open' | 'done'; dueDate?: string | null }) => {
    try {
      const res = await fetch(`/api/tasks/${encodeURIComponent(t.matterId)}/${encodeURIComponent(t.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify(body),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      await fetchInbox();
    } catch {
      setError('Update failed. The task is unchanged.');
    }
  }, [fetchInbox]);

  const quickAdd = useCallback(async () => {
    if (!qaTitle.trim() || !qaMatter) return;
    setQaBusy(true);
    try {
      const res = await fetch('/api/tasks', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ matterId: qaMatter, title: qaTitle.trim(), ...(qaDate ? { dueDate: qaDate } : {}) }),
      });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setQaTitle(''); setQaDate('');
      await fetchInbox();
    } catch {
      setError('Could not add the task.');
    } finally {
      setQaBusy(false);
    }
  }, [qaTitle, qaDate, qaMatter, fetchInbox]);

  const mintFeed = useCallback(async () => {
    try {
      const res = await fetch('/api/tasks/feed', { method: 'POST', credentials: 'include' });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const body = await res.json() as { path: string };
      setFeedPath(body.path);
      setFeedActive(true);
    } catch {
      setError('Could not generate the calendar link.');
    }
  }, []);

  const copy = useCallback((label: string, text: string) => {
    void navigator.clipboard?.writeText(text).then(() => {
      setCopied(label);
      setTimeout(() => setCopied(null), 2000);
    });
  }, []);

  const handleNav = useCallback((hash: string) => { window.location.hash = hash; }, []);

  const tasks = (data?.tasks ?? []).filter(t =>
    (matterFilter === 'all' || t.matterId === matterFilter)
    && (sourceFilter === 'all' || t.source === sourceFilter));
  const openTasks = tasks.filter(t => t.status === 'open');
  const doneTasks = tasks.filter(t => t.status === 'done');
  const overdueCount = data?.counts.overdue ?? 0;

  const feedHttpsUrl = feedPath ? `${window.location.origin}${feedPath}` : null;
  const feedWebcalUrl = feedPath ? `webcal://${window.location.host}${feedPath}` : null;

  // ── Row renderer ──────────────────────────────────────────────────────
  const renderRow = (t: TaskRow) => {
    const isDone = t.status === 'done';
    const dateColour = t.band === 'overdue' ? (t.isCourt ? red : amber) : muted;
    return (
      <div
        key={`${t.matterId}-${t.id}`}
        role="listitem"
        style={{
          display: 'flex', alignItems: 'flex-start', gap: 12, padding: '12px 16px',
          borderBottom: `1px solid ${border}`, background: '#fff',
          opacity: isDone ? 0.6 : 1,
        }}
      >
        {t.source === 'action' ? (
          <input
            type="checkbox"
            checked={isDone}
            onChange={() => { void patchTask(t, { status: isDone ? 'open' : 'done' }); }}
            aria-label={isDone ? `Reopen: ${t.title}` : `Mark done: ${t.title}`}
            style={{ marginTop: 3, width: 16, height: 16, accentColor: navy, cursor: 'pointer' }}
          />
        ) : (
          <span
            aria-hidden="true"
            title="Deadline. It derives from the matter; change the underlying date on the file"
            style={{
              marginTop: 5, width: 10, height: 10, borderRadius: '50%', flexShrink: 0,
              background: t.isCourt ? red : amber,
            }}
          />
        )}
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 14.5, fontWeight: 600, color: t.isCourt && !isDone ? red : ink, textDecoration: isDone ? 'line-through' : 'none' }}>
            {t.title}
          </div>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginTop: 3, fontSize: 12.5, color: muted, alignItems: 'center' }}>
            <button
              type="button"
              onClick={() => handleNav(`#/matter-detail/${t.matterId}`)}
              style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: navy, fontSize: 12.5, textDecoration: 'underline' }}
            >
              {t.fileNumber} · {t.matterLabel}
            </button>
            <span style={{ border: `1px solid ${border}`, borderRadius: 2, padding: '1px 6px' }}>
              {KIND_LABELS[t.kind] ?? t.kind}{t.isCourt ? ' · court' : ''}
            </span>
            {t.dueDate && <span style={{ color: dateColour, fontWeight: t.band === 'overdue' ? 700 : 400 }}>{fmtDate(t.dueDate)}</span>}
            {t.emailSubject !== undefined || t.emailBody !== undefined ? (
              <button
                type="button"
                onClick={() => setExpandedEmail(expandedEmail === t.id ? null : t.id)}
                style={{ background: 'none', border: 'none', padding: 0, cursor: 'pointer', color: orange, fontSize: 12.5 }}
              >
                {expandedEmail === t.id ? 'Hide draft' : 'View email draft'}
              </button>
            ) : null}
          </div>
          {expandedEmail === t.id && (
            <div style={{ marginTop: 8, padding: 10, background: '#faf8f5', border: `1px solid ${border}`, fontSize: 13 }}>
              {t.emailSubject && <div style={{ fontWeight: 700, marginBottom: 4 }}>{t.emailSubject}</div>}
              {t.emailBody && <div style={{ whiteSpace: 'pre-wrap' }}>{t.emailBody}</div>}
              <button
                type="button"
                onClick={() => copy(`email-${t.id}`, `${t.emailSubject ?? ''}\n\n${t.emailBody ?? ''}`.trim())}
                style={{ marginTop: 8, padding: '4px 10px', fontSize: 12, border: `1px solid ${navy}`, background: '#fff', color: navy, cursor: 'pointer', borderRadius: 2 }}
              >
                {copied === `email-${t.id}` ? 'Copied' : 'Copy draft'}
              </button>
              <span style={{ marginLeft: 8, fontSize: 11.5, color: muted }}>You review and send. Starling never sends.</span>
            </div>
          )}
        </div>
        {t.source === 'action' && !isDone && (
          rescheduling === t.id ? (
            <span style={{ display: 'flex', gap: 6, alignItems: 'center' }}>
              <input
                type="date"
                value={rescheduleDate}
                onChange={e => setRescheduleDate(e.target.value)}
                aria-label={`New date for ${t.title}`}
                style={{ fontSize: 12.5, padding: '3px 6px', border: `1px solid ${border}` }}
              />
              <button
                type="button"
                disabled={!rescheduleDate}
                onClick={() => { void patchTask(t, { dueDate: rescheduleDate }); setRescheduling(null); setRescheduleDate(''); }}
                style={{ fontSize: 12.5, padding: '3px 9px', background: navy, color: '#fff', border: 'none', cursor: 'pointer', borderRadius: 2 }}
              >
                Move
              </button>
              <button
                type="button"
                onClick={() => { setRescheduling(null); setRescheduleDate(''); }}
                style={{ fontSize: 12.5, padding: '3px 6px', background: 'none', border: 'none', color: muted, cursor: 'pointer' }}
              >
                Cancel
              </button>
            </span>
          ) : (
            <button
              type="button"
              onClick={() => { setRescheduling(t.id); setRescheduleDate(t.dueDate ?? ''); }}
              style={{ fontSize: 12.5, padding: '3px 9px', background: 'none', border: `1px solid ${border}`, color: muted, cursor: 'pointer', borderRadius: 2, flexShrink: 0 }}
            >
              {t.band === 'overdue' ? 'Move to…' : 'Reschedule'}
            </button>
          )
        )}
      </div>
    );
  };

  return (
    <div style={{ fontFamily: sans, background: frame, color: ink, lineHeight: 1.5, minHeight: '100vh', WebkitFontSmoothing: 'antialiased' }}>
      {/* ── Top bar (mirrors the dashboard header) ─────────────────── */}
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
            <b style={{ color: '#fff' }}>Starling</b> &middot; Tasks
          </span>
        </div>
        <nav style={{ display: 'flex', alignItems: 'center', gap: 8 }} aria-label="Main navigation">
          <a href="#/" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#cfd6e0', border: '1px solid transparent', textDecoration: 'none' }}>
            My Cases
          </a>
          <a href="#/tasks" aria-current="page" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#fff', border: '1px solid rgba(255,255,255,0.25)', textDecoration: 'none' }}>
            Tasks{overdueCount > 0 && (
              <span style={{ marginLeft: 6, background: red, color: '#fff', borderRadius: 8, padding: '0 6px', fontSize: 11.5, fontWeight: 700 }}>
                {overdueCount}
              </span>
            )}
          </a>
          {approvalsEnabled && (
            <a href="#/approvals" style={{ padding: '8px 14px', borderRadius: 2, fontSize: 14, color: '#cfd6e0', border: '1px solid transparent', textDecoration: 'none' }}>Approvals</a>
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

      <main id="main-content" style={{ maxWidth: 900, margin: '0 auto', padding: '32px 28px 64px' }}>
        {/* ── Page header ────────────────────────────────────────────── */}
        <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <h1 style={{ fontFamily: serif, fontSize: 26, fontWeight: 600, color: navy, margin: 0 }}>Tasks</h1>
            <p style={{ margin: '4px 0 0', fontSize: 13.5, color: muted }}>
              Everything you owe across every matter. Deadlines derive from the file; tasks come from debriefs and quick-adds.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setFeedOpen(!feedOpen)}
            style={{ padding: '8px 14px', fontSize: 13.5, background: feedOpen ? navy : '#fff', color: feedOpen ? '#fff' : navy, border: `1px solid ${navy}`, cursor: 'pointer', borderRadius: 2 }}
          >
            Calendar subscription
          </button>
        </div>

        {/* ── Calendar feed panel ────────────────────────────────────── */}
        {feedOpen && (
          <section aria-label="Calendar subscription" style={{ margin: '16px 0 0', padding: 16, background: '#fff', border: `1px solid ${border}` }}>
            {feedPath ? (
              <>
                <div style={{ fontSize: 13.5, fontWeight: 700, color: navy }}>Your subscribe link (shown once, copy it now)</div>
                <div style={{ marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                  <button type="button" onClick={() => copy('webcal', feedWebcalUrl!)} style={{ padding: '6px 12px', fontSize: 13, background: navy, color: '#fff', border: 'none', cursor: 'pointer', borderRadius: 2 }}>
                    {copied === 'webcal' ? 'Copied' : 'Copy webcal link (Outlook, Apple)'}
                  </button>
                  <button type="button" onClick={() => copy('https', feedHttpsUrl!)} style={{ padding: '6px 12px', fontSize: 13, background: '#fff', color: navy, border: `1px solid ${navy}`, cursor: 'pointer', borderRadius: 2 }}>
                    {copied === 'https' ? 'Copied' : 'Copy https link (Google Calendar)'}
                  </button>
                </div>
                <code style={{ display: 'block', marginTop: 8, fontSize: 12, color: muted, wordBreak: 'break-all' }}>{feedWebcalUrl}</code>
              </>
            ) : (
              <>
                <p style={{ margin: 0, fontSize: 13.5, color: ink }}>
                  {feedActive
                    ? 'A subscribe link is active. Generating a new one revokes the old link (existing calendar subscriptions will stop updating).'
                    : 'Generate a private link your calendar app re-fetches on its own, so every dated task and deadline stays current in Outlook, Google, or Apple Calendar.'}
                </p>
                <button type="button" onClick={() => { void mintFeed(); }} style={{ marginTop: 10, padding: '7px 14px', fontSize: 13.5, background: navy, color: '#fff', border: 'none', cursor: 'pointer', borderRadius: 2 }}>
                  {feedActive ? 'Regenerate link (revokes old)' : 'Generate subscribe link'}
                </button>
              </>
            )}
            {/* Subscribe instructions — always visible, not only right after minting */}
            <p style={{ margin: '12px 0 0', fontSize: 12.5, color: muted }}>
              <b>Outlook:</b> the desktop app cannot subscribe directly (Import ICS gives a frozen snapshot, so avoid it). Instead open{' '}
              <b>outlook.office.com</b> → Calendar → Add calendar → <b>Subscribe from web</b>, paste the <b>https</b> link, and it
              syncs into desktop Outlook automatically and stays current.
              {' '}<b>Google:</b> Other calendars → From URL (https link). <b>Apple Calendar:</b> File → New Calendar Subscription (webcal link).
            </p>
            <p style={{ margin: '6px 0 0', fontSize: 12.5, color: muted }}>
              Events show your file numbers, never client names. Subscribing from your firm account keeps the data in the firm's tenant.
              The link is shown once when generated; if you lost it, regenerate (old subscriptions stop updating).
            </p>
            {digestAvailable && (
              <label style={{ display: 'flex', alignItems: 'flex-start', gap: 8, marginTop: 14, paddingTop: 14, borderTop: `1px solid ${border}`, cursor: 'pointer', fontSize: 13 }}>
                <input
                  type="checkbox"
                  checked={digestOptedIn}
                  onChange={e => { void toggleDigest(e.target.checked); }}
                  aria-label="Weekly task email"
                  style={{ marginTop: 2, accentColor: navy }}
                />
                <span>
                  <b>Weekly task email.</b>{' '}
                  <span style={{ color: muted }}>
                    Every Monday morning, your own outstanding and upcoming items to your own inbox. File numbers only, never client names. Off by default.
                  </span>
                </span>
              </label>
            )}
          </section>
        )}

        {/* ── Quick-add ──────────────────────────────────────────────── */}
        <section aria-label="Add a task" style={{ margin: '20px 0 0', padding: 12, background: '#fff', border: `1px solid ${border}`, display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center' }}>
          <input
            type="text"
            placeholder="Add a task…"
            value={qaTitle}
            onChange={e => setQaTitle(e.target.value)}
            onKeyDown={e => { if (e.key === 'Enter') void quickAdd(); }}
            aria-label="Task title"
            style={{ flex: '1 1 220px', fontSize: 13.5, padding: '7px 10px', border: `1px solid ${border}` }}
          />
          <select
            value={qaMatter}
            onChange={e => setQaMatter(e.target.value)}
            aria-label="Matter"
            style={{ fontSize: 13, padding: '7px 8px', border: `1px solid ${border}`, background: '#fff', maxWidth: 240 }}
          >
            <option value="">Matter…</option>
            {(data?.matters ?? []).map(m => (
              <option key={m.matterId} value={m.matterId}>{m.fileNumber} · {m.matterLabel}</option>
            ))}
          </select>
          <input
            type="date"
            value={qaDate}
            onChange={e => setQaDate(e.target.value)}
            aria-label="Due date (optional)"
            style={{ fontSize: 13, padding: '6px 8px', border: `1px solid ${border}` }}
          />
          <button
            type="button"
            disabled={!qaTitle.trim() || !qaMatter || qaBusy}
            onClick={() => { void quickAdd(); }}
            style={{ padding: '7px 16px', fontSize: 13.5, background: qaTitle.trim() && qaMatter ? navy : '#9aa2ad', color: '#fff', border: 'none', cursor: qaTitle.trim() && qaMatter ? 'pointer' : 'default', borderRadius: 2 }}
          >
            {qaBusy ? 'Adding…' : 'Add'}
          </button>
        </section>

        {/* ── Filters ────────────────────────────────────────────────── */}
        <div style={{ margin: '14px 0 0', display: 'flex', gap: 8, flexWrap: 'wrap', alignItems: 'center', fontSize: 13 }}>
          <select value={matterFilter} onChange={e => setMatterFilter(e.target.value)} aria-label="Filter by matter" style={{ fontSize: 13, padding: '5px 8px', border: `1px solid ${border}`, background: '#fff', maxWidth: 240 }}>
            <option value="all">All matters</option>
            {(data?.matters ?? []).map(m => (
              <option key={m.matterId} value={m.matterId}>{m.fileNumber} · {m.matterLabel}</option>
            ))}
          </select>
          <select value={sourceFilter} onChange={e => setSourceFilter(e.target.value as typeof sourceFilter)} aria-label="Filter by type" style={{ fontSize: 13, padding: '5px 8px', border: `1px solid ${border}`, background: '#fff' }}>
            <option value="all">Tasks + deadlines</option>
            <option value="action">Tasks only</option>
            <option value="deadline">Deadlines only</option>
          </select>
          <label style={{ display: 'flex', alignItems: 'center', gap: 6, color: muted, cursor: 'pointer' }}>
            <input type="checkbox" checked={showDone} onChange={e => setShowDone(e.target.checked)} style={{ accentColor: navy }} />
            Show done ({doneTasks.length})
          </label>
        </div>

        {/* ── List ───────────────────────────────────────────────────── */}
        {loading ? (
          <p style={{ marginTop: 32, color: muted }}>Loading your tasks…</p>
        ) : error ? (
          <div style={{ marginTop: 32 }}>
            <p style={{ color: red, margin: 0 }}>{error}</p>
            <button type="button" onClick={() => { setLoading(true); void fetchInbox(); }} style={{ marginTop: 10, padding: '6px 14px', fontSize: 13.5, background: navy, color: '#fff', border: 'none', cursor: 'pointer', borderRadius: 2 }}>
              Retry
            </button>
          </div>
        ) : openTasks.length === 0 && (!showDone || doneTasks.length === 0) ? (
          <p style={{ marginTop: 32, color: muted }}>
            Nothing outstanding. Tasks arrive from matter debriefs, or add one above.
          </p>
        ) : (
          <>
            {GROUPS.map(g => {
              const rows = openTasks.filter(t => t.band === g.band);
              if (rows.length === 0) return null;
              return (
                <section key={g.band} aria-label={g.title} style={{ marginTop: 24 }}>
                  <h2 style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, margin: '0 0 8px', color: g.band === 'overdue' ? red : navy }}>
                    {g.title} <span style={{ fontWeight: 400, color: muted, fontSize: 13 }}>({rows.length})</span>
                  </h2>
                  <div role="list" style={{ border: `1px solid ${border}`, borderBottom: 'none' }}>
                    {rows.map(renderRow)}
                  </div>
                </section>
              );
            })}
            {showDone && doneTasks.length > 0 && (
              <section aria-label="Done" style={{ marginTop: 24 }}>
                <h2 style={{ fontFamily: serif, fontSize: 16, fontWeight: 600, margin: '0 0 8px', color: muted }}>
                  Done <span style={{ fontWeight: 400, fontSize: 13 }}>({doneTasks.length})</span>
                </h2>
                <div role="list" style={{ border: `1px solid ${border}`, borderBottom: 'none' }}>
                  {doneTasks.map(renderRow)}
                </div>
              </section>
            )}
          </>
        )}
      </main>
    </div>
  );
}
