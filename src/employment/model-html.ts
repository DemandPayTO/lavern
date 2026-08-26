/**
 * Model output is asked for as HTML. Sometimes it arrives as Markdown.
 *
 * Every document prompt ends with "Output as HTML", and the model complies
 * almost always. When it does not, nothing downstream works: the deterministic
 * paragraph numbering finds no <p> to number, the assembly wraps text that has
 * no structure, and what reaches the lawyer is a document with "## OVERVIEW"
 * printed in it. Observed in a verification run where the narrative came back
 * as Markdown while a single remedies list came back as HTML, so the failure
 * is not always total.
 *
 * The conversion is deliberately narrow. It fires only where the text carries
 * Markdown headings AND no HTML heading, which is the signature of a response
 * that ignored the format instruction. A proper HTML document is returned
 * untouched. Raw HTML inside a Markdown response passes through the converter
 * unchanged, so the mixed case resolves correctly rather than losing the part
 * that was already right.
 */

import { marked } from 'marked';

/** An ATX heading at the start of a line: "# Overview", "## THE FACTS". */
const MARKDOWN_HEADING = /^#{1,6}[ \t]\S/m;
const HTML_HEADING = /<h[1-6][\s>]/i;

export function htmlFromModelText(text: string): { html: string; convertedFromMarkdown: boolean } {
  if (!MARKDOWN_HEADING.test(text) || HTML_HEADING.test(text)) {
    return { html: text, convertedFromMarkdown: false };
  }
  const html = marked.parse(text, { async: false }) as string;
  return { html, convertedFromMarkdown: true };
}
