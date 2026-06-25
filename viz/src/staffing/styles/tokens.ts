/**
 * Design Tokens — DemandPay Starling palette.
 *
 * Navy + orange + cream. Headings in Georgia serif, body in system sans.
 * Principle: restraint signals quality. Color is punctuation, not decoration.
 */

export const colors = {
  // Backgrounds — DemandPay cream
  bg: '#faf8f5',
  bgCard: '#FFFFFF',
  bgCardHover: '#FFFFFF',
  bgPanel: '#f5f3ef',
  bgInput: '#f0ede8',
  bgAlt: '#f5f3ef',

  // Borders — navy-tinted
  border: 'rgba(15, 26, 46, 0.12)',
  borderHover: 'rgba(15, 26, 46, 0.28)',
  borderSelected: '#0f1a2e',

  // Accent — DemandPay orange
  accent: '#ea580c',
  accentLight: 'rgba(234, 88, 12, 0.08)',
  accentMid: 'rgba(234, 88, 12, 0.15)',
  accentMuted: 'rgba(234, 88, 12, 0.5)',

  // Cost tiers — muted, desaturated
  opus: '#8B6914',
  opusBg: 'rgba(139, 105, 20, 0.07)',
  sonnet: '#2E7D9C',
  sonnetBg: 'rgba(46, 125, 156, 0.07)',
  haiku: '#4A7C50',
  haikuBg: 'rgba(74, 124, 80, 0.07)',

  // Text — DemandPay navy
  text: '#0f1a2e',
  textSecondary: '#2E3D50',
  textMuted: '#556070',
  textDim: '#556070',

  // Semantic
  success: '#16a34a',
  successBg: 'rgba(22, 163, 74, 0.07)',
  warning: '#d97706',
  warningBg: 'rgba(217, 119, 6, 0.07)',
  danger: '#dc2626',

  // Category colors — muted editorial
  lawyer: '#2E7D9C',
  specialist: '#7B5EA7',
  infrastructure: '#9C7B3E',
  orchestrator: '#ea580c',
};

export const fonts = {
  sans: "system-ui, -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif",
  serif: "Georgia, 'Palatino Linotype', Palatino, serif",
  mono: "'Geist Mono', 'SF Mono', 'Fira Code', 'Fira Mono', Menlo, monospace",
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 24,
  xxl: 32,
  xxxl: 48,
  xxxxl: 64,
};

export const radii = {
  sm: 4,
  md: 8,
  lg: 12,
  xl: 16,
  pill: 999,
};

/**
 * Shadow scale — Apple-inspired multi-layer drop shadows.
 *
 * Recipe (the part most teams get wrong):
 *   - huge blur radius (40–120px)
 *   - very low opacity (0.02–0.08)
 *   - 3 stacked layers: contact + mid + ambient
 *   - warm-toned, not pure black (matches our cream palette)
 *
 * The shadow should never *look* like a shadow. It should feel like depth.
 */
export const shadows = {
  /** Barely-there elevation. Pills, badges. */
  xs: '0 1px 2px rgba(20, 18, 14, 0.05), 0 3px 6px rgba(20, 18, 14, 0.04)',
  /** Resting card. Default surface above background. */
  sm: '0 1px 2px rgba(20, 18, 14, 0.06), 0 6px 16px rgba(20, 18, 14, 0.07), 0 16px 40px rgba(20, 18, 14, 0.08)',
  /** Standard card. Most surfaces. */
  md: '0 2px 4px rgba(20, 18, 14, 0.06), 0 10px 28px rgba(20, 18, 14, 0.09), 0 28px 64px rgba(20, 18, 14, 0.11)',
  /** Elevated / hovered card. Lifted, attention-drawing. */
  lg: '0 3px 6px rgba(20, 18, 14, 0.08), 0 18px 44px rgba(20, 18, 14, 0.11), 0 44px 88px rgba(20, 18, 14, 0.14)',
  /** Modal / overlay. Floating well above the page. */
  xl: '0 6px 12px rgba(20, 18, 14, 0.10), 0 28px 72px rgba(20, 18, 14, 0.14), 0 68px 132px rgba(20, 18, 14, 0.18)',
  /** Primary button — sits on a surface, distinctive lift. */
  button: '0 1px 2px rgba(20, 18, 14, 0.10), 0 6px 14px rgba(20, 18, 14, 0.10), 0 16px 32px rgba(20, 18, 14, 0.08)',
  /** Primary button hover — pronounced lift. */
  buttonHover: '0 2px 4px rgba(20, 18, 14, 0.14), 0 10px 24px rgba(20, 18, 14, 0.12), 0 28px 60px rgba(20, 18, 14, 0.12)',
  /** Inset rim — top-edge highlight that gives a "specular" feel. */
  rimLight: 'inset 0 1px 0 rgba(255, 255, 255, 0.5)',
  /** Selected card focus ring + lift. */
  selected: '0 0 0 1.5px rgba(26, 26, 26, 0.92), 0 6px 16px rgba(20, 18, 14, 0.09), 0 28px 64px rgba(20, 18, 14, 0.13)',
};

/** Map cost tier to color */
export function tierColor(tier: string): string {
  if (tier === 'opus') return colors.opus;
  if (tier === 'sonnet') return colors.sonnet;
  if (tier === 'haiku') return colors.haiku;
  return colors.textMuted;
}

/** Map cost tier to background color */
export function tierBg(tier: string): string {
  if (tier === 'opus') return colors.opusBg;
  if (tier === 'sonnet') return colors.sonnetBg;
  if (tier === 'haiku') return colors.haikuBg;
  return 'rgba(122,122,118,0.07)';
}

/** Map category to color */
export function categoryColor(cat: string): string {
  if (cat === 'lawyer') return colors.lawyer;
  if (cat === 'specialist') return colors.specialist;
  if (cat === 'infrastructure') return colors.infrastructure;
  if (cat === 'orchestrator') return colors.orchestrator;
  return colors.textMuted;
}
