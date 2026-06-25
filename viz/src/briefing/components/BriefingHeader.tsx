/**
 * BriefingHeader — Title, matter summary, back button, progress stepper.
 */

import { ProgressStepper, type BriefingPhase } from './ProgressStepper.js';
import { colors, fonts, radii } from '../../staffing/styles/tokens.js';

const WORKFLOW_LABELS: Record<string, string> = {
  'counsel': 'Counsel',
  'review': 'Review',
  'adversarial': 'Adversarial',
  'roundtable': 'Roundtable',
  'full-bench': 'Full Bench',
  'pre-engagement': 'Client Onboarding',
  // Backward-compatible alias for old workflow ID
  'legal-design': 'Roundtable',
};

interface Props {
  matterNumber?: string;
  matterTitle?: string;
  workflowId: string;
  jurisdiction?: string;
  phase: BriefingPhase;
  onBack: () => void;
  onSkip?: () => void;
}

export function BriefingHeader({ matterNumber, matterTitle, workflowId, jurisdiction, phase, onBack, onSkip }: Props) {
  const workflowLabel = WORKFLOW_LABELS[workflowId] ?? workflowId;

  // Build subtitle parts
  const parts: string[] = [];
  if (matterNumber) parts.push(matterNumber);
  parts.push(workflowLabel);
  if (jurisdiction) parts.push(jurisdiction);

  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <button
          onClick={onBack}
          style={styles.backButton}
          onMouseEnter={e => { const b = e.currentTarget; b.style.backgroundColor = colors.text; b.style.color = '#fff'; }}
          onMouseLeave={e => { const b = e.currentTarget; b.style.backgroundColor = 'transparent'; b.style.color = colors.text; }}
        >
          {'←'} Back
        </button>

        <h1 style={styles.title}>
          Starling <span style={{ fontWeight: 500 }}>Briefing</span>
        </h1>

        {onSkip ? (
          <button
            onClick={onSkip}
            style={styles.skipButton}
            onMouseEnter={e => { const b = e.currentTarget; b.style.backgroundColor = colors.text; b.style.color = '#fff'; b.style.borderColor = colors.text; }}
            onMouseLeave={e => { const b = e.currentTarget; b.style.backgroundColor = 'transparent'; b.style.color = colors.textMuted; b.style.borderColor = colors.border; }}
          >
            Skip {'→'}
          </button>
        ) : (
          <span style={styles.spacer} aria-hidden="true" />
        )}
      </div>

      <p style={styles.subtitle}>
        {parts.join(' · ')}
      </p>

      <ProgressStepper currentPhase={phase} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: {
    textAlign: 'center',
    marginBottom: 24,
  },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
  },
  backButton: {
    padding: '6px 14px',
    borderRadius: radii.sm,
    border: `1.5px solid ${colors.text}`,
    backgroundColor: 'transparent',
    color: colors.text,
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    transition: 'background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease',
    flexShrink: 0,
  },
  title: {
    fontSize: 'clamp(22px, 5.5vw, 32px)',
    fontFamily: fonts.sans,
    fontWeight: 400,
    color: colors.text,
    margin: 0,
    lineHeight: 1.2,
    flex: '1 1 auto',
    minWidth: 0,
    textAlign: 'center',
  },
  skipButton: {
    padding: '6px 14px',
    borderRadius: radii.sm,
    border: `1.5px solid ${colors.border}`,
    backgroundColor: 'transparent',
    color: colors.textMuted,
    fontFamily: fonts.sans,
    fontSize: 11,
    fontWeight: 600,
    letterSpacing: 1,
    textTransform: 'uppercase' as const,
    cursor: 'pointer',
    transition: 'background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease',
    flexShrink: 0,
  },
  spacer: {
    // Invisible placeholder to keep title centered when no Skip button.
    display: 'inline-block',
    minWidth: 78,
  },
  subtitle: {
    fontSize: 13,
    fontFamily: fonts.sans,
    color: colors.textMuted,
    marginTop: 8,
    textTransform: 'capitalize' as const,
  },
};
