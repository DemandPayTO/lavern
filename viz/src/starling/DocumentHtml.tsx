// The one place Starling renders document HTML into the page.
//
// Every generated or lawyer-edited document, section, and memo reaches the
// screen through this component. It is the single trust boundary for document
// content: the HTML arrives already sanitised server-side, against the
// allowlist in employment/document-reviews.ts (sanitiseReviewHtml) or
// api/routes/employment/shared.ts (sanitiseHtml), and this component is where
// client-side defence in depth belongs if it is ever added.
//
// Do not write dangerouslySetInnerHTML anywhere else under viz/src/starling.
// The verification loop's lens 8 asserts that this file is the only sink, so a
// new workspace panel gets the safe path by default rather than by the author
// remembering. Panels vary only in their wrapper styling, which is why style
// and className are passed straight through.

type DocumentHtmlProps = {
  /** Server-sanitised document HTML. */
  html: string;
  style?: React.CSSProperties;
  className?: string;
};

export function DocumentHtml({ html, style, className }: DocumentHtmlProps) {
  return (
    <div
      className={className}
      style={style}
      // scan-ok: the single document-HTML sink; see the note above.
      dangerouslySetInnerHTML={{ __html: html }}
    />
  );
}
