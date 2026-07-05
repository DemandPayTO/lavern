/**
 * XFA Datasets helpers — shared by every data-file populator (HRTO Form 1,
 * OLRB Forms A-30 and A-53). Government dynamic XFA forms cannot be filled
 * programmatically; the supported path is Acrobat's data import against a
 * pristine official form. These helpers set values inside a blank datasets
 * XML extracted from the official form.
 *
 * All replacement is anchor-sliced: the data models repeat node names
 * across sections, so every set is scoped to a named section (optionally
 * nested), and tags not present in the section are left untouched.
 */

export function escapeXml(v: string): string {
  return v.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&apos;');
}

/**
 * Section slice: from the first `<sectionName>` at or after `from` to its
 * closing tag. Name-boundary aware: `</form1` must not match `</form1x`.
 */
export function sectionBounds(xml: string, sectionName: string, from = 0): { start: number; end: number } | null {
  const openRe = new RegExp(`<${sectionName}(?=[\\s/>])`, 'g');
  openRe.lastIndex = from;
  const open = openRe.exec(xml);
  if (!open) return null;
  const closeRe = new RegExp(`</${sectionName}(?=[\\s>])`, 'g');
  closeRe.lastIndex = open.index;
  const close = closeRe.exec(xml);
  if (!close) return null;
  return { start: open.index, end: close.index };
}

/**
 * Set the FIRST occurrence of `<tag ... />` or `<tag>...</tag>` within
 * [start, end) to the given value. Returns updated xml (bounds shift).
 */
export function setFirstInRange(xml: string, start: number, end: number, tag: string, value: string): string {
  const slice = xml.slice(start, end);
  const escaped = escapeXml(value);

  const selfClose = new RegExp(`<${tag}(\\s*\\n?)/>`);
  if (selfClose.test(slice)) {
    return xml.slice(0, start) + slice.replace(selfClose, `<${tag}\n>${escaped}</${tag}\n>`) + xml.slice(end);
  }
  const valueForm = new RegExp(`(<${tag}\\s*\\n?>)[^<]*(</${tag})`);
  if (valueForm.test(slice)) {
    return xml.slice(0, start) + slice.replace(valueForm, `$1${escaped}$2`) + xml.slice(end);
  }
  return xml; // tag not present in this section — leave untouched
}

/** Set `tag` inside the first `sectionName` section. */
export function setInSection(xml: string, sectionName: string, tag: string, value: string | undefined | null): string {
  if (value == null || value === '') return xml;
  const bounds = sectionBounds(xml, sectionName);
  if (!bounds) return xml;
  return setFirstInRange(xml, bounds.start, bounds.end, tag, String(value));
}

/** Set `tag` inside `innerSection`, scoped within the first `outerSection`. */
export function setInNestedSection(
  xml: string, outerSection: string, innerSection: string, tag: string,
  value: string | undefined | null,
): string {
  if (value == null || value === '') return xml;
  const outer = sectionBounds(xml, outerSection);
  if (!outer) return xml;
  const inner = sectionBounds(xml, innerSection, outer.start);
  if (!inner || inner.start > outer.end) return xml;
  return setFirstInRange(xml, inner.start, Math.min(inner.end, outer.end), tag, String(value));
}
