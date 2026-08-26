// The one place the briefing flow inlines an SVG string into the page.
//
// Avatars, portraits, and trophy badges are SVG markup the app itself builds
// (interviewers.ts, the trophy definitions, DiceBear output), not content any
// user supplies. Inlining is what lets them inherit currentColor and the
// surrounding sizing, which an <img> would not.
//
// TRUST BOUNDARY: the strings passed here must stay app-generated. If an SVG
// ever comes from user-supplied or model-generated data, sanitise it before it
// reaches this component: SVG carries its own script vectors (<script>,
// onload=, xlink:href="javascript:").
//
// Do not write dangerouslySetInnerHTML anywhere else under viz/src/briefing.
// The verification loop's lens 8 asserts that this file is the only sink.

type InlineSvgProps = {
  /** App-generated SVG markup. Never user-supplied. */
  svg: string;
  style?: React.CSSProperties;
  className?: string;
};

export function InlineSvg({ svg, style, className }: InlineSvgProps) {
  return (
    <div
      className={className}
      style={style}
      // scan-ok: the single inline-SVG sink; see the trust boundary above.
      dangerouslySetInnerHTML={{ __html: svg }}
    />
  );
}
