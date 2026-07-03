/**
 * MyPageView — Lawyer profile & practice defaults for DemandPay Starling.
 *
 * Sections:
 *   1. About You       — lawyer name, firm, LSO number, jurisdiction, court location
 *   2. Default Settings — analysis workflow, intensity, budget defaults
 *   3. Custom Instructions — free-text appended to every matter analysis
 *   4. Saved Teams     — reusable analysis team presets
 *
 * Lawyer name, firm name, LSO number, and court location flow into
 * generated documents (demand letters, Statements of Claim).
 * Auto-saves on every change (debounced 500ms via React state → localStorage).
 */

import { useCallback, useState, useEffect, useRef } from 'react';
import { colors, fonts, spacing, radii } from '../staffing/styles/tokens.js';
import { useUserProfile } from './hooks/useUserProfile.js';
import type { UserProfile } from './hooks/useUserProfile.js';

interface Props {
  onBack: () => void;
}

// ── Workflow options ────────────────────────────────────────────────────

const WORKFLOW_OPTIONS = [
  { value: 'counsel', label: 'Counsel — quick opinion' },
  { value: 'review', label: 'Review — document review' },
  { value: 'adversarial', label: 'Adversarial — draft + stress-test' },
  { value: 'roundtable', label: 'Roundtable — expert panel' },
];

const INTENSITY_OPTIONS = [
  { value: 'quick', label: 'Quick' },
  { value: 'standard', label: 'Standard' },
  { value: 'thorough', label: 'Thorough' },
  { value: 'maximal', label: 'Maximal' },
];

const MAX_INSTRUCTIONS = 2000;

// ── Component ──────────────────────────────────────────────────────────

export default function MyPageView({ onBack }: Props) {
  const { profile, updateProfile, deleteTeam, hasSavedTeams } = useUserProfile();

  // LOCAL MODE (the default in v0.15.0) has no auth surface, so the
  // referral and change-password endpoints 404 and their cards render
  // empty under "Share Starling" / "Security" headers. Read the runtime
  // `auth` flag from /api/capabilities and hide both sections when off.
  // Default `null` = "still loading" so we don't flash the sections
  // briefly before the fetch resolves.
  const [authEnabled, setAuthEnabled] = useState<boolean | null>(null);
  useEffect(() => {
    let cancelled = false;
    fetch('/api/capabilities', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d && typeof d.auth === 'boolean') setAuthEnabled(d.auth); })
      .catch(() => { if (!cancelled) setAuthEnabled(false); });
    return () => { cancelled = true; };
  }, []);

  // Simple field updater
  const field = useCallback(
    <K extends keyof UserProfile>(key: K) =>
      (value: UserProfile[K]) => updateProfile({ [key]: value }),
    [updateProfile],
  );

  return (
    <div style={styles.page}>
      {/* Back link \u2014 wrapped so it shares the content column's left edge */}
      <div style={styles.backLinkRow}>
        <button
          onClick={onBack}
          style={styles.backLink}
          onMouseEnter={e => { const b = e.currentTarget; b.style.backgroundColor = colors.text; b.style.color = '#fff'; }}
          onMouseLeave={e => { const b = e.currentTarget; b.style.backgroundColor = 'transparent'; b.style.color = colors.text; }}
        >
          {'\u2190'} Back to Home
        </button>
      </div>

      {/* Page title */}
      <h1 style={styles.pageTitle}>Starling <span style={{ fontWeight: 500 }}>Profile</span></h1>
      <p style={styles.pageSub}>
        Your details flow into every generated document. Everything saves automatically.
      </p>

      {/* ── Share Starling (Referral) ────────────────────────────── */}
      {authEnabled && (
        <>
          <SectionDivider label="Share Starling" />
          <ReferralCard />
        </>
      )}

      {/* ── Section 1: About You ───────────────────────────────────── */}
      <SectionDivider label="About You" />

      <div style={styles.fieldGroup}>
        <FieldRow label="Lawyer Name">
          <input
            type="text"
            value={profile.displayName}
            onChange={e => field('displayName')(e.target.value)}
            placeholder="As it should appear on demand letters and pleadings"
            style={styles.input}
          />
        </FieldRow>
        <FieldRow label="Firm Name">
          <input
            type="text"
            value={profile.firmName}
            onChange={e => field('firmName')(e.target.value)}
            placeholder="Appears on generated documents and letterhead"
            style={styles.input}
          />
        </FieldRow>
        <FieldRow label="LSO Number">
          <input
            type="text"
            value={profile.lsoNumber}
            onChange={e => field('lsoNumber')(e.target.value)}
            placeholder="Law Society of Ontario licence number"
            style={styles.input}
          />
        </FieldRow>
        <FieldRow label="Firm Address">
          <input
            type="text"
            value={profile.firmAddress}
            onChange={e => field('firmAddress')(e.target.value)}
            placeholder="Fills the signature block — e.g. 10 Dundas St W, Unit 1002, Toronto, ON M5B 2G9"
            style={styles.input}
          />
        </FieldRow>
        <FieldRow label="Firm Phone">
          <input
            type="text"
            value={profile.firmPhone}
            onChange={e => field('firmPhone')(e.target.value)}
            placeholder="e.g. 416-555-0100"
            style={styles.input}
          />
        </FieldRow>
        <FieldRow label="Firm Email">
          <input
            type="text"
            value={profile.firmEmail}
            onChange={e => field('firmEmail')(e.target.value)}
            placeholder="Correspondence email on demand letters and pleadings"
            style={styles.input}
          />
        </FieldRow>
        <FieldRow label="Default Court Location">
          <input
            type="text"
            value={profile.defaultCourtLocation}
            onChange={e => field('defaultCourtLocation')(e.target.value)}
            placeholder="e.g. Toronto — pre-fills Statements of Claim"
            style={styles.input}
          />
        </FieldRow>
        <FieldRow label="Jurisdiction">
          <input
            type="text"
            value={profile.defaultJurisdiction}
            onChange={e => field('defaultJurisdiction')(e.target.value)}
            placeholder="Ontario"
            style={styles.input}
          />
        </FieldRow>
      </div>

      {/* ── Security: Change Password ──────────────────────────────── */}
      {authEnabled && (
        <>
          <SectionDivider label="Security" />
          <ChangePasswordSection />
        </>
      )}

      {/* ── Section 2: Default Settings ────────────────────────────── */}
      <SectionDivider label="Default Settings" />

      <div style={styles.fieldGroup}>
        <FieldRow label="Workflow">
          <select
            value={profile.defaultWorkflowId}
            onChange={e => field('defaultWorkflowId')(e.target.value)}
            style={styles.select}
          >
            {WORKFLOW_OPTIONS.map(w => (
              <option key={w.value} value={w.value}>{w.label}</option>
            ))}
          </select>
        </FieldRow>

        <FieldRow label="Intensity">
          <div style={styles.radioRow}>
            {INTENSITY_OPTIONS.map(opt => (
              <button
                key={opt.value}
                onClick={() => field('defaultIntensity')(opt.value)}
                style={{
                  ...styles.radioBtn,
                  ...(profile.defaultIntensity === opt.value ? styles.radioBtnActive : {}),
                }}
              >
                {opt.label}
              </button>
            ))}
          </div>
        </FieldRow>

        <FieldRow label="Default Budget">
          <div style={styles.budgetRow}>
            <span style={styles.budgetPrefix}>$</span>
            <input
              type="number"
              min={1}
              max={200}
              value={profile.defaultBudgetUsd}
              onChange={e => field('defaultBudgetUsd')(Math.max(1, Math.min(200, Number(e.target.value) || 10)))}
              style={{ ...styles.input, ...styles.budgetInput }}
            />
          </div>
        </FieldRow>

        <FieldRow label="YOLO Mode">
          <div style={styles.toggleRow}>
            <button
              onClick={() => field('yoloModeDefault')(!profile.yoloModeDefault)}
              style={{
                ...styles.toggle,
                backgroundColor: profile.yoloModeDefault ? colors.accent : colors.bgInput,
              }}
              role="switch"
              aria-checked={profile.yoloModeDefault}
            >
              <div
                style={{
                  ...styles.toggleThumb,
                  transform: profile.yoloModeDefault ? 'translateX(18px)' : 'translateX(0)',
                }}
              />
            </button>
            <span style={styles.toggleLabel}>
              Auto-approve all gates by default
            </span>
          </div>
        </FieldRow>
      </div>

      {/* ── Section 3: Custom Instructions ─────────────────────────── */}
      <SectionDivider label="Custom Instructions" />

      <div style={styles.fieldGroup}>
        <p style={styles.fieldHint}>
          Appended to every matter analysis. Tell Starling what matters to your practice.
        </p>
        <textarea
          value={profile.customInstructions}
          onChange={e => {
            const val = e.target.value.slice(0, MAX_INSTRUCTIONS);
            field('customInstructions')(val);
          }}
          placeholder="Always check the termination clause against Waksdale. Flag human rights overlays early. Prefer firm but professional tone in demand letters."
          rows={6}
          style={styles.textarea}
        />
        <span style={styles.charCount}>
          {profile.customInstructions.length} / {MAX_INSTRUCTIONS}
        </span>
      </div>

      {/* ── Section 4: Saved Teams ─────────────────────────────────── */}
      <SectionDivider label="Saved Teams" />

      {hasSavedTeams ? (
        <div style={styles.teamList}>
          {profile.savedTeams.map(team => (
            <div key={team.id} style={styles.teamCard}>
              <div style={styles.teamInfo}>
                <span style={styles.teamName}>{team.name}</span>
                <span style={styles.teamDesc}>
                  {team.description || `${team.teamSize} agents`}
                </span>
                <span style={styles.teamMeta}>
                  {team.teamSize} agents {'\u00B7'} {team.roles.length} roles
                </span>
              </div>
              <div style={styles.teamActions}>
                <TeamActionButton
                  label="Use"
                  onClick={() => {
                    sessionStorage.setItem('shem-briefing-team', JSON.stringify(team.roles));
                    window.location.hash = '#/strategy';
                  }}
                />
                <TeamActionButton
                  label="Delete"
                  danger
                  onClick={() => deleteTeam(team.id)}
                />
              </div>
            </div>
          ))}
        </div>
      ) : (
        <p style={styles.emptyState}>
          No saved teams yet. Build a team during a matter analysis and save it from there.
        </p>
      )}

      {/* Bottom spacer */}
      <div style={{ height: 80 }} />
    </div>
  );
}

// ── Sub-components ─────────────────────────────────────────────────────

// ── Referral Card ────────────────────────────────────────────────────

function ReferralCard() {
  const [data, setData] = useState<{ shareUrl: string; referralCount: number; hoursEarned: number; hoursPerReferral: number } | null>(null);
  const [copied, setCopied] = useState(false);
  const copyTimerRef = useRef<ReturnType<typeof setTimeout>>(undefined);

  useEffect(() => {
    let cancelled = false;
    fetch('/api/referral', { credentials: 'include' })
      .then(r => r.ok ? r.json() : null)
      .then(d => { if (!cancelled && d) setData(d); })
      .catch(() => {});
    return () => { cancelled = true; };
  }, []);

  // Cleanup copy timer on unmount
  useEffect(() => () => { clearTimeout(copyTimerRef.current); }, []);

  if (!data) return null;

  return (
    <div style={styles.billingCard}>
      <p style={{ margin: 0, fontSize: 14, color: colors.textMuted, lineHeight: 1.6 }}>
        Give <strong style={{ color: colors.text }}>{data.hoursPerReferral}h</strong>, get{' '}
        <strong style={{ color: colors.text }}>{data.hoursPerReferral}h</strong>.
        Share your link — both of you earn hours.
      </p>
      <div style={{
        display: 'flex', gap: spacing.sm, marginTop: spacing.lg, alignItems: 'center',
      }}>
        <input
          type="text"
          readOnly
          value={data.shareUrl}
          style={{ ...styles.input, flex: 1, fontSize: 12, fontFamily: 'monospace' }}
          onFocus={e => e.target.select()}
        />
        <button
          onClick={() => {
            navigator.clipboard.writeText(data.shareUrl).then(() => {
              setCopied(true);
              clearTimeout(copyTimerRef.current);
              copyTimerRef.current = setTimeout(() => setCopied(false), 2000);
            });
          }}
          style={{
            ...styles.buyHoursBtn,
            whiteSpace: 'nowrap' as const,
            minWidth: 80,
          }}
          onMouseEnter={e => { e.currentTarget.style.backgroundColor = colors.text; e.currentTarget.style.color = '#fff'; }}
          onMouseLeave={e => { e.currentTarget.style.backgroundColor = 'transparent'; e.currentTarget.style.color = colors.text; }}
        >
          {copied ? 'Copied!' : 'Copy'}
        </button>
      </div>
      {data.referralCount > 0 && (
        <p style={{ margin: `${spacing.md}px 0 0`, fontSize: 13, color: colors.textMuted }}>
          {data.referralCount} referral{data.referralCount !== 1 ? 's' : ''} · {data.hoursEarned.toFixed(0)}h earned
        </p>
      )}
    </div>
  );
}

function SectionDivider({ label }: { label: string }) {
  return (
    <div style={styles.sectionHeader}>
      <div style={styles.sectionLine} />
      <span style={styles.sectionTitle}>{label}</span>
      <div style={styles.sectionLine} />
    </div>
  );
}

function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div style={styles.fieldRow}>
      <label style={styles.fieldLabel}>{label}</label>
      {children}
    </div>
  );
}

function TeamActionButton({ label, onClick, danger }: { label: string; onClick: () => void; danger?: boolean }) {
  const [hovered, setHovered] = useState(false);
  return (
    <button
      onClick={onClick}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        ...styles.teamBtn,
        color: danger ? colors.danger : colors.text,
        backgroundColor: hovered
          ? (danger ? 'rgba(196,93,62,0.08)' : colors.bgInput)
          : 'transparent',
      }}
    >
      {label}
    </button>
  );
}

function ChangePasswordSection() {
  const [expanded, setExpanded] = useState(false);
  const [current, setCurrent] = useState('');
  const [newPwd, setNewPwd] = useState('');
  const [confirm, setConfirm] = useState('');
  const [status, setStatus] = useState<'idle' | 'saving' | 'success' | 'error'>('idle');
  const [errorMsg, setErrorMsg] = useState('');

  const canSubmit = current.length > 0 && newPwd.length >= 8 && newPwd === confirm && status !== 'saving';
  const mismatch = confirm.length > 0 && newPwd !== confirm;
  const tooShort = newPwd.length > 0 && newPwd.length < 8;

  const handleSubmit = useCallback(async () => {
    if (!canSubmit) return;
    setStatus('saving');
    setErrorMsg('');

    try {
      const res = await fetch('/api/auth/change-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ currentPassword: current, newPassword: newPwd }),
      });

      if (res.ok) {
        setStatus('success');
        setCurrent('');
        setNewPwd('');
        setConfirm('');
        // Collapse after brief success feedback
        setTimeout(() => { setExpanded(false); setStatus('idle'); }, 2000);
      } else {
        const data = await res.json().catch(() => ({ error: 'Something went wrong.' }));
        setErrorMsg((data as { error?: string }).error || 'Failed to change password.');
        setStatus('error');
      }
    } catch {
      setErrorMsg('Unable to reach the server.');
      setStatus('error');
    }
  }, [canSubmit, current, newPwd]);

  if (!expanded) {
    return (
      <div style={styles.fieldGroup}>
        <button
          onClick={() => setExpanded(true)}
          style={{
            ...styles.input,
            cursor: 'pointer',
            color: colors.textSecondary,
            textAlign: 'left',
            border: `1px solid ${colors.border}`,
          }}
        >
          Change password...
        </button>
      </div>
    );
  }

  return (
    <div style={styles.fieldGroup}>
      <FieldRow label="Current Password">
        <input
          type="password"
          value={current}
          onChange={e => setCurrent(e.target.value)}
          autoComplete="current-password"
          style={styles.input}
          placeholder="Enter current password"
        />
      </FieldRow>
      <FieldRow label="New Password">
        <input
          type="password"
          value={newPwd}
          onChange={e => setNewPwd(e.target.value)}
          autoComplete="new-password"
          style={styles.input}
          placeholder="Min 8 characters"
        />
      </FieldRow>
      {tooShort && (
        <div style={{ fontSize: 11, color: colors.danger, paddingLeft: spacing.lg, marginTop: -4 }}>
          Password must be at least 8 characters.
        </div>
      )}
      <FieldRow label="Confirm Password">
        <input
          type="password"
          value={confirm}
          onChange={e => setConfirm(e.target.value)}
          autoComplete="new-password"
          style={styles.input}
          placeholder="Repeat new password"
        />
      </FieldRow>
      {mismatch && (
        <div style={{ fontSize: 11, color: colors.danger, paddingLeft: spacing.lg, marginTop: -4 }}>
          Passwords do not match.
        </div>
      )}
      {errorMsg && (
        <div style={{ fontSize: 11, color: colors.danger, paddingLeft: spacing.lg }} role="alert">
          {errorMsg}
        </div>
      )}
      {status === 'success' && (
        <div style={{ fontSize: 11, color: colors.success, paddingLeft: spacing.lg }} role="status">
          Password changed. Other sessions have been logged out.
        </div>
      )}
      <div style={{ display: 'flex', gap: 8, paddingLeft: spacing.lg, marginTop: 4 }}>
        <button
          onClick={handleSubmit}
          disabled={!canSubmit}
          style={{
            padding: '6px 16px',
            fontSize: 11,
            fontWeight: 600,
            fontFamily: fonts.sans,
            letterSpacing: 0.5,
            textTransform: 'uppercase' as const,
            color: canSubmit ? '#fff' : colors.textDim,
            backgroundColor: canSubmit ? colors.text : colors.bgInput,
            border: 'none',
            borderRadius: radii.sm,
            cursor: canSubmit ? 'pointer' : 'default',
            opacity: status === 'saving' ? 0.6 : 1,
          }}
        >
          {status === 'saving' ? 'Saving...' : 'Change Password'}
        </button>
        <button
          onClick={() => { setExpanded(false); setCurrent(''); setNewPwd(''); setConfirm(''); setStatus('idle'); setErrorMsg(''); }}
          style={{
            padding: '6px 16px',
            fontSize: 11,
            fontFamily: fonts.sans,
            color: colors.textMuted,
            backgroundColor: 'transparent',
            border: `1px solid ${colors.border}`,
            borderRadius: radii.sm,
            cursor: 'pointer',
          }}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// ── Styles ─────────────────────────────────────────────────────────────

const styles: Record<string, React.CSSProperties> = {
  page: {
    width: '100%',
    minHeight: '100vh',
    backgroundColor: colors.bg,
    fontFamily: fonts.sans,
    color: colors.text,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    padding: `${spacing.xxxl}px ${spacing.xl}px`,
    boxSizing: 'border-box',
  },

  backLinkRow: {
    width: '100%',
    maxWidth: 640,
    marginBottom: spacing.xl,
  },
  backLink: {
    background: 'none',
    border: `1.5px solid ${colors.text}`,
    borderRadius: radii.sm,
    color: colors.text,
    fontSize: 11,
    fontFamily: fonts.sans,
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    padding: '6px 14px',
    transition: 'background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease',
  },

  pageTitle: {
    fontFamily: fonts.sans,
    fontSize: 'clamp(24px, 6vw, 36px)',
    fontWeight: 400,
    color: colors.text,
    margin: 0,
    letterSpacing: -0.5,
    width: '100%',
    maxWidth: 640,
  },
  pageSub: {
    fontSize: 14,
    color: colors.textMuted,
    margin: `${spacing.sm}px 0 ${spacing.xxl}px`,
    width: '100%',
    maxWidth: 640,
    lineHeight: 1.6,
  },

  // Section divider — same pattern as SessionList / YoloLauncher
  sectionHeader: {
    display: 'flex',
    alignItems: 'center',
    gap: 12,
    width: '100%',
    maxWidth: 640,
    marginTop: spacing.xxl,
    marginBottom: spacing.lg,
  },
  sectionLine: {
    flex: 1,
    height: 1,
    backgroundColor: colors.border,
  },
  sectionTitle: {
    fontSize: 11,
    fontWeight: 600,
    color: colors.textMuted,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    whiteSpace: 'nowrap' as const,
  },

  // Field group
  fieldGroup: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.md,
  },

  fieldRow: {
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.xs,
  },

  fieldLabel: {
    fontSize: 12,
    fontWeight: 600,
    color: colors.textSecondary,
    letterSpacing: 0.3,
  },

  fieldHint: {
    fontSize: 13,
    color: colors.textMuted,
    lineHeight: 1.5,
    margin: 0,
  },
  // ── Soul — dark inverted container ──────────────────────────────
  soulContainer: {
    width: '100%',
    maxWidth: 740,
    marginTop: spacing.xxl + 8,
    marginBottom: spacing.md,
    borderRadius: radii.lg,
    background: 'linear-gradient(145deg, #1A1A1A 0%, #2A2826 50%, #1A1A1A 100%)',
    position: 'relative' as const,
    overflow: 'hidden' as const,
    boxShadow: '0 8px 40px rgba(0, 0, 0, 0.15), inset 0 1px 0 rgba(255,255,255,0.03)',
  },
  soulInner: {
    position: 'relative' as const,
    zIndex: 1,
    padding: '48px 48px 36px',
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    textAlign: 'center' as const,
  },
  soulWatermark: {
    position: 'absolute' as const,
    top: -20,
    right: 30,
    fontFamily: fonts.serif,
    fontSize: 200,
    fontWeight: 300,
    color: 'rgba(250, 249, 246, 0.03)',
    lineHeight: 1,
    pointerEvents: 'none' as const,
    userSelect: 'none' as const,
  },
  soulLabel: {
    fontSize: 10,
    fontWeight: 600,
    letterSpacing: 3,
    textTransform: 'uppercase' as const,
    color: 'rgba(196, 93, 62, 0.7)',
    marginBottom: 16,
  },
  soulHeading: {
    fontSize: 26,
    fontFamily: fonts.serif,
    fontWeight: 300,
    color: 'rgba(250, 249, 246, 0.9)',
    margin: 0,
    letterSpacing: -0.3,
    lineHeight: 1.3,
  },
  soulSub: {
    fontSize: 13,
    fontFamily: fonts.sans,
    color: 'rgba(250, 249, 246, 0.4)',
    margin: '12px 0 28px',
    lineHeight: 1.5,
    maxWidth: 400,
  },
  soulTextarea: {
    width: '100%',
    padding: '16px 20px',
    fontSize: 15,
    fontFamily: fonts.serif,
    color: 'rgba(250, 249, 246, 0.85)',
    backgroundColor: 'rgba(250, 249, 246, 0.05)',
    border: '1px solid rgba(250, 249, 246, 0.1)',
    borderRadius: radii.sm,
    resize: 'vertical' as const,
    lineHeight: 1.7,
    boxSizing: 'border-box' as const,
    transition: 'border-color 0.3s ease, background-color 0.3s ease',
    textAlign: 'left' as const,
  },
  soulCharCount: {
    fontSize: 10,
    color: 'rgba(250, 249, 246, 0.2)',
    textAlign: 'right' as const,
    width: '100%',
    marginTop: 8,
  },

  // Input
  input: {
    width: '100%',
    padding: '10px 14px',
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.text,
    backgroundColor: colors.bgInput,
    border: `1.5px solid ${colors.border}`,
    borderRadius: radii.sm,
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease',
  },

  // Select
  select: {
    width: '100%',
    padding: '10px 14px',
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.text,
    backgroundColor: colors.bgInput,
    border: `1.5px solid ${colors.border}`,
    borderRadius: radii.sm,
    boxSizing: 'border-box',
    appearance: 'auto' as const,
    transition: 'border-color 0.2s ease',
  },

  // Radio row
  radioRow: {
    display: 'flex',
    gap: spacing.sm,
  },
  radioBtn: {
    flex: 1,
    padding: '8px 0',
    fontSize: 12,
    fontFamily: fonts.sans,
    fontWeight: 600,
    color: colors.textMuted,
    backgroundColor: colors.bgInput,
    border: `1.5px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: 'pointer',
    transition: 'background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease',
    letterSpacing: 0.5,
  },
  radioBtnActive: {
    color: '#fff',
    backgroundColor: colors.text,
    borderColor: colors.text,
  },

  // Budget
  budgetRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  },
  budgetPrefix: {
    fontSize: 14,
    fontWeight: 600,
    color: colors.textSecondary,
  },
  budgetInput: {
    width: 120,
  },

  // Toggle
  toggleRow: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
  },
  toggle: {
    width: 42,
    height: 24,
    borderRadius: 12,
    border: `1px solid ${colors.border}`,
    padding: 2,
    cursor: 'pointer',
    transition: 'background-color 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    flexShrink: 0,
  },
  toggleThumb: {
    width: 18,
    height: 18,
    borderRadius: 9,
    backgroundColor: '#fff',
    transition: 'transform 0.2s ease',
    boxShadow: '0 1px 3px rgba(0,0,0,0.15)',
  },
  toggleLabel: {
    fontSize: 13,
    color: colors.textMuted,
  },

  // Textarea
  textarea: {
    width: '100%',
    padding: '12px 14px',
    fontSize: 14,
    fontFamily: fonts.sans,
    color: colors.text,
    backgroundColor: colors.bgInput,
    border: `1.5px solid ${colors.border}`,
    borderRadius: radii.sm,
    resize: 'vertical' as const,
    lineHeight: 1.6,
    boxSizing: 'border-box',
    transition: 'border-color 0.2s ease',
  },
  charCount: {
    fontSize: 11,
    color: colors.textDim,
    textAlign: 'right' as const,
  },

  // Saved teams
  teamList: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  teamCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${spacing.lg}px ${spacing.xl}px`,
    backgroundColor: colors.bgCard,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
  },
  teamInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 2,
  },
  teamName: {
    fontSize: 14,
    fontWeight: 600,
    color: colors.text,
  },
  teamDesc: {
    fontSize: 12,
    color: colors.textSecondary,
  },
  teamMeta: {
    fontSize: 11,
    color: colors.textDim,
  },
  teamActions: {
    display: 'flex',
    gap: spacing.sm,
  },
  teamBtn: {
    padding: '6px 14px',
    fontSize: 12,
    fontWeight: 500,
    fontFamily: fonts.sans,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.sm,
    cursor: 'pointer',
    transition: 'background-color 0.15s ease, color 0.15s ease, border-color 0.15s ease',
  },

  emptyState: {
    width: '100%',
    maxWidth: 640,
    fontSize: 13,
    color: colors.textDim,
    textAlign: 'center',
    padding: `${spacing.xxl}px 0`,
  },

  // Custom agents
  agentList: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column',
    gap: spacing.sm,
  },
  agentCard: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: `${spacing.md}px ${spacing.lg}px`,
    backgroundColor: colors.bgCard,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.md,
    transition: 'border-color 0.15s ease',
  },
  agentLeft: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.md,
  },
  agentAvatar: {
    width: 44,
    height: 44,
    borderRadius: '50%',
    overflow: 'hidden',
    border: `2px solid ${colors.border}`,
    backgroundColor: colors.bgPanel,
    flexShrink: 0,
  },
  agentInfo: {
    display: 'flex',
    flexDirection: 'column',
    gap: 1,
  },
  agentName: {
    fontSize: 14,
    fontWeight: 600,
    fontFamily: fonts.sans,
    color: colors.text,
  },
  agentTagline: {
    fontSize: 12,
    fontFamily: fonts.sans,
    color: colors.textSecondary,
  },
  agentMeta: {
    fontSize: 10,
    fontFamily: fonts.sans,
    color: colors.textDim,
  },
  agentActions: {
    display: 'flex',
    alignItems: 'center',
    gap: spacing.sm,
  },
  deleteConfirm: {
    display: 'flex',
    alignItems: 'center',
    gap: 6,
  },
  buildAgentLink: {
    width: '100%',
    padding: `${spacing.md}px`,
    fontSize: 13,
    fontFamily: fonts.sans,
    fontWeight: 600,
    color: colors.textMuted,
    backgroundColor: 'transparent',
    border: `1.5px dashed ${colors.border}`,
    borderRadius: radii.md,
    cursor: 'pointer',
    textAlign: 'center',
    transition: 'border-color 0.2s ease, color 0.2s ease',
  },
  agentEmptyState: {
    width: '100%',
    maxWidth: 640,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    gap: spacing.md,
  },
  buildAgentBtn: {
    padding: '10px 24px',
    fontSize: 13,
    fontFamily: fonts.sans,
    fontWeight: 600,
    color: colors.text,
    backgroundColor: 'transparent',
    border: `1.5px solid ${colors.text}`,
    borderRadius: radii.sm,
    cursor: 'pointer',
    letterSpacing: 0.5,
    transition: 'background-color 0.2s ease, color 0.2s ease',
  },

  // ── Referral card ────────────────────────────────────────────────
  billingCard: {
    width: '100%',
    maxWidth: 580,
    backgroundColor: colors.bgCard,
    border: `1px solid ${colors.border}`,
    borderRadius: radii.lg,
    padding: `${spacing.xl}px ${spacing.xxl}px`,
    marginBottom: spacing.xl,
  },
  buyHoursBtn: {
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    color: colors.text,
    backgroundColor: 'transparent',
    border: `1px solid ${colors.text}`,
    borderRadius: radii.sm,
    padding: '8px 20px',
    cursor: 'pointer',
    transition: 'all 0.2s',
  },
};
