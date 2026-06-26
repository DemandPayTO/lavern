/**
 * StarlingWordmark — DemandPay Starling logo wordmark.
 *
 * Three graduating orange dots + stacked "DEMAND PAY" in Georgia serif.
 * Used on login, auth gate loading, and anywhere the brand mark is needed.
 */

interface Props {
  /** Text colour. Default navy for light backgrounds, pass '#fff' for dark. */
  color?: string;
  /** Size variant. */
  size?: 'sm' | 'md' | 'lg';
}

const SIZES = {
  sm: { dot: 6, font: 10, gap: 3 },
  md: { dot: 10, font: 15, gap: 4 },
  lg: { dot: 14, font: 20, gap: 5 },
};

export function StarlingWordmark({ color = '#0f1a2e', size = 'md' }: Props) {
  const s = SIZES[size];
  return (
    <div
      style={{ display: 'flex', alignItems: 'center', gap: s.dot + 2 }}
      aria-label="DemandPay Starling"
      role="img"
    >
      <span style={{ display: 'flex', gap: s.gap }} aria-hidden="true">
        <span style={{ width: s.dot, height: s.dot, borderRadius: '50%', background: '#ea580c', display: 'block' }} />
        <span style={{ width: s.dot, height: s.dot, borderRadius: '50%', background: '#f26a3d', display: 'block' }} />
        <span style={{ width: s.dot, height: s.dot, borderRadius: '50%', background: '#ff8a5c', display: 'block' }} />
      </span>
      <span style={{ fontFamily: "Georgia, 'Palatino Linotype', serif", lineHeight: 1, letterSpacing: 1 }}>
        <span style={{ fontSize: s.font, fontWeight: 700, color, display: 'block' }}>DEMAND</span>
        <span style={{ fontSize: s.font, fontWeight: 700, color, display: 'block' }}>PAY</span>
      </span>
    </div>
  );
}
