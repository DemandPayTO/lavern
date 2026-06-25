/**
 * IntakeHeader — Title + progress stepper + skip/back buttons.
 */

import { IntakeProgress, type IntakePhase, type IntakeMode } from './IntakeProgress.js';
import { colors, fonts, radii } from '../../staffing/styles/tokens.js';
import { LavernIlluminated } from '../../components/LavernIlluminated.js';

interface Props {
  phase: IntakePhase;
  mode: IntakeMode;
  onBack: () => void;
  onSkip: () => void;
}

export function IntakeHeader({ phase, mode, onBack, onSkip }: Props) {
  return (
    <div style={styles.container}>
      <div style={styles.headerRow}>
        <button
          onClick={onBack}
          style={styles.backButton}
          onMouseEnter={e => { const b = e.currentTarget; b.style.backgroundColor = colors.text; b.style.color = '#fff'; }}
          onMouseLeave={e => { const b = e.currentTarget; b.style.backgroundColor = 'transparent'; b.style.color = colors.text; }}
        >{'←'} Back</button>

        <div style={styles.center}>
          <div style={styles.logoType}><LavernIlluminated color={colors.textMuted} /></div>
          <h1 style={styles.title}>
            Starling <span style={{ fontWeight: 500 }}>Intake</span>
          </h1>
        </div>

        <button
          onClick={onSkip}
          style={styles.skipButton}
          onMouseEnter={e => { const b = e.currentTarget; b.style.backgroundColor = colors.text; b.style.color = '#fff'; b.style.borderColor = colors.text; }}
          onMouseLeave={e => { const b = e.currentTarget; b.style.backgroundColor = 'transparent'; b.style.color = colors.textMuted; b.style.borderColor = colors.border; }}
        >Skip {'→'}</button>
      </div>

      {phase === 'mode-select' && (
        <p style={styles.subtitle}>How would you like to get started?</p>
      )}
      <IntakeProgress currentPhase={phase} mode={mode} />
    </div>
  );
}

const styles: Record<string, React.CSSProperties> = {
  container: { textAlign: 'center', marginBottom: 24 },
  headerRow: {
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'space-between',
    gap: 12,
    width: '100%',
  },
  center: {
    flex: '1 1 auto',
    minWidth: 0,
    textAlign: 'center',
  },
  backButton: {
    padding: '6px 14px', borderRadius: radii.sm,
    border: `1.5px solid ${colors.text}`, backgroundColor: 'transparent',
    color: colors.text, fontFamily: fonts.sans, fontSize: 11, fontWeight: 600,
    letterSpacing: 1, textTransform: 'uppercase' as const, cursor: 'pointer',
    transition: 'background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease',
    flexShrink: 0,
  },
  skipButton: {
    padding: '6px 14px', borderRadius: radii.sm,
    border: `1.5px solid ${colors.border}`, backgroundColor: 'transparent',
    color: colors.textMuted, fontFamily: fonts.sans, fontSize: 11, fontWeight: 600,
    letterSpacing: 1, textTransform: 'uppercase' as const, cursor: 'pointer',
    transition: 'background-color 0.25s ease, color 0.25s ease, border-color 0.25s ease',
    flexShrink: 0,
  },
  logoType: {
    fontSize: 10, fontWeight: 600, fontFamily: fonts.sans,
    color: colors.textMuted, letterSpacing: 4, textTransform: 'uppercase' as const,
    marginBottom: 4,
  },
  title: { fontSize: 'clamp(22px, 5.5vw, 32px)', fontFamily: fonts.sans, fontWeight: 400, color: colors.text, margin: 0, lineHeight: 1.2 },
  subtitle: { fontSize: 13, fontFamily: fonts.sans, color: colors.textMuted, marginTop: 8 },
};
