/**
 * Unit Tests — putting generated content into a firm's Word template.
 *
 * The failure this replaces was verified on a real template: the letter's
 * HTML went into a single text run, so a firm that uploaded its letterhead
 * got "<p><strong>WITHOUT PREJUDICE</strong></p>" printed on the page.
 *
 * The splice has to replace the whole paragraph holding the marker. Word
 * paragraphs cannot nest, so putting several <w:p> elements inside one is
 * a file Word refuses to open.
 */

import { describe, it, expect } from 'vitest';
import {
  spliceIntoParagraph, looksLikeHtml, escapeXml, renderHtmlAsWordXml,
  hasBodyMarker, replaceBodyContent, detectForeignMarkerStyle,
  fillFirmMarkers, templateHasOwnOpening, stripLeadingFurniture,
} from '../../src/employment/docx-splice.js';
import { htmlToParagraphs } from '../../src/employment/docx-export.js';

const template = [
  '<w:body>',
  '<w:p><w:r><w:t>August 5, 2026</w:t></w:r></w:p>',
  '<w:p><w:r><w:t>{{LEGAL_ANALYSIS}}</w:t></w:r></w:p>',
  '<w:sectPr><w:pgSz w:w="12240" w:h="15840"/></w:sectPr>',
  '</w:body>',
].join('');

describe('spliceIntoParagraph', () => {
  const body = '<w:p><w:r><w:t>One.</w:t></w:r></w:p><w:p><w:r><w:t>Two.</w:t></w:r></w:p>';

  it('replaces the paragraph, never nests inside it', () => {
    const out = spliceIntoParagraph(template, 'LEGAL_ANALYSIS', body);
    expect(out).toContain('One.');
    expect(out).toContain('Two.');
    expect(out).not.toContain('{{LEGAL_ANALYSIS}}');
    // The marker's own paragraph is gone, not wrapped around the new ones.
    expect(out).not.toMatch(/<w:p><w:r><w:t><w:p>/);
  });

  it('leaves the rest of the template alone, page setup included', () => {
    const out = spliceIntoParagraph(template, 'LEGAL_ANALYSIS', body);
    expect(out).toContain('August 5, 2026');
    expect(out).toContain('<w:sectPr>');
    expect(out).toContain('w:pgSz');
  });

  it('handles a paragraph with properties on its opening tag', () => {
    const withProps = '<w:body><w:p w:rsidR="00A1"><w:r><w:t>{{X}}</w:t></w:r></w:p></w:body>';
    const out = spliceIntoParagraph(withProps, 'X', body);
    expect(out).toBe(`<w:body>${body}</w:body>`);
  });

  it('does nothing when the marker is not in the template', () => {
    expect(spliceIntoParagraph(template, 'NOT_PRESENT', body)).toBe(template);
  });

  it('leaves a marker with no enclosing paragraph visible rather than corrupting the file', () => {
    const loose = '<w:body>{{LEGAL_ANALYSIS}}</w:body>';
    expect(spliceIntoParagraph(loose, 'LEGAL_ANALYSIS', body)).toBe(loose);
  });
});

describe('looksLikeHtml', () => {
  it('recognises generated content', () => {
    expect(looksLikeHtml('<p>We act for the plaintiff.</p>')).toBe(true);
    expect(looksLikeHtml('<h2>Demand</h2>')).toBe(true);
    expect(looksLikeHtml('<table><tr><td>x</td></tr></table>')).toBe(true);
  });

  it('leaves plain values alone, so they stay text', () => {
    expect(looksLikeHtml('Evans Law Firm')).toBe(false);
    expect(looksLikeHtml('DP-2026-004')).toBe(false);
    // A firm name with an angle bracket is still not markup.
    expect(looksLikeHtml('Smith < Jones')).toBe(false);
  });
});

describe('escapeXml', () => {
  it('escapes what would otherwise break the document', () => {
    // "Smith & Jones Inc" produced XML Word could not open.
    expect(escapeXml('Smith & Jones Inc')).toBe('Smith &amp; Jones Inc');
    expect(escapeXml('a < b > c')).toBe('a &lt; b &gt; c');
    expect(escapeXml('say "yes"')).toBe('say &quot;yes&quot;');
  });
});

describe('renderHtmlAsWordXml', () => {
  it('turns the letter into Word paragraphs and a Word table', async () => {
    const html = [
      '<p><strong>WITHOUT PREJUDICE</strong></p>',
      '<h2>Damages Quantification</h2>',
      '<table><tr><th>Head</th><th>Amount</th></tr><tr><td>Notice</td><td>$8,462</td></tr></table>',
    ].join('');
    const xml = await renderHtmlAsWordXml(html, htmlToParagraphs as never);

    expect(xml).toContain('<w:p');
    expect(xml).toContain('<w:tbl>');
    expect(xml).toContain('WITHOUT PREJUDICE');
    expect(xml).toContain('$8,462');
    // No HTML survives into the Word file.
    expect(xml).not.toContain('<p>');
    expect(xml).not.toContain('<strong>');
  });

  it('leaves out the section properties, which belong to the template', async () => {
    // The template's sectPr carries the page size, margins, and the header
    // and footer references. Ours must not replace it.
    const xml = await renderHtmlAsWordXml('<p>Body.</p>', htmlToParagraphs as never);
    expect(xml).not.toContain('<w:sectPr');
  });

  it('names no font, so the firm’s own typeface applies', async () => {
    const xml = await renderHtmlAsWordXml('<p>Body.</p><table><tr><td>cell</td></tr></table>', htmlToParagraphs as never);
    expect(xml).not.toContain('Times New Roman');
  });

  it('is empty for empty content, so the caller can fall back', async () => {
    expect(await renderHtmlAsWordXml('', htmlToParagraphs as never)).toBe('');
  });
});


describe('a firm precedent with no markers in it', () => {
  // What the pilot uploaded: a letterhead and a skeleton, marked up in the
  // firm's own notation. Starling filled nothing and handed the precedent
  // back, which looked like a finished document and was an empty letter.
  const precedent = [
    '<w:body>',
    '<w:p><w:r><w:t>[DATE]</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>Dear [SALUTATION]:</w:t></w:r></w:p>',
    '<w:p><w:r><w:t>We are the solicitors for [CLIENT NAME].</w:t></w:r></w:p>',
    '<w:sectPr><w:headerReference r:id="rId6"/><w:footerReference r:id="rId7"/><w:pgSz w:w="12240"/></w:sectPr>',
    '</w:body>',
  ].join('');
  const letter = '<w:p><w:r><w:t>WITHOUT PREJUDICE</w:t></w:r></w:p>';

  it('is recognised as having nowhere to put the document', () => {
    expect(hasBodyMarker(precedent)).toBe(false);
    expect(hasBodyMarker('<w:body><w:p><w:t>{{LEGAL_ANALYSIS}}</w:t></w:p></w:body>')).toBe(true);
    expect(hasBodyMarker('<w:body><w:p><w:t>{{FACTS_SECTION}}</w:t></w:p></w:body>')).toBe(true);
  });

  it('takes the letter and keeps everything that makes it the firm’s', () => {
    const out = replaceBodyContent(precedent, letter);
    expect(out).toContain('WITHOUT PREJUDICE');
    expect(out).not.toContain('[CLIENT NAME]');
    // The section properties carry the page size and the header and footer
    // links; losing them loses the letterhead.
    expect(out).toContain('headerReference');
    expect(out).toContain('footerReference');
    expect(out).toContain('w:pgSz');
  });

  it('leaves the template alone when there is nothing to put in it', () => {
    expect(replaceBodyContent(precedent, '')).toBe(precedent);
  });
});

describe('detectForeignMarkerStyle', () => {
  it('names the notation the firm actually used', () => {
    expect(detectForeignMarkerStyle('Dear [SALUTATION]:')).toContain('square brackets');
    expect(detectForeignMarkerStyle('Dear \u00abSalutation\u00bb:')).toContain('guillemets');
    expect(detectForeignMarkerStyle('Dear <<Salutation>>:')).toContain('angle brackets');
    expect(detectForeignMarkerStyle('Dear ______________:')).toContain('underscores');
  });

  it('says nothing about ordinary prose', () => {
    expect(detectForeignMarkerStyle('We are the solicitors for Ms. Osei.')).toBeNull();
    // A citation is not a placeholder.
    expect(detectForeignMarkerStyle('Waksdale v Swegon, 2020 ONCA 391')).toBeNull();
  });
});


describe('a template that IS marked up for Starling', () => {
  it('keeps its paragraphs so its placeholders can be filled', () => {
    // The regression this pins: treating "no BODY marker" as "bare
    // precedent" replaced the whole body and wiped the paragraphs holding
    // {{CLIENT_NAME}} and {{LAWYER_NAME}}, so a marked-up template lost
    // every value it existed to carry.
    const marked = [
      '<w:body>',
      '<w:p><w:r><w:t>{{CLIENT_NAME}}</w:t></w:r></w:p>',
      '<w:p><w:r><w:t>{{LAWYER_NAME}}</w:t></w:r></w:p>',
      '</w:body>',
    ].join('');
    expect(hasBodyMarker(marked)).toBe(false);
    // Which is why the caller must ALSO require that no markers exist at
    // all before treating a template as bare letterhead.
    const markers = [...marked.matchAll(/\{\{([A-Z_]+)\}\}/g)].map(m => m[1]);
    expect(markers).toEqual(['CLIENT_NAME', 'LAWYER_NAME']);
    expect(markers.length === 0 && !hasBodyMarker(marked)).toBe(false);
  });
});


describe('the firm’s own notation in its own template', () => {
  const slots = {
    'CLIENT NAME': 'Aisha Osei', CLIENT: 'Aisha Osei',
    'EMPLOYER NAME': 'Brightpath Financial Group Inc', EMPLOYER: 'Brightpath Financial Group Inc',
    DATE: 'August 6, 2026',
  };

  it('fills the markers the firm already wrote, so its opening is not rebuilt', () => {
    const xml = '<w:t>RE: [CLIENT NAME] v. [EMPLOYER NAME]</w:t><w:t>[DATE]</w:t>';
    const out = fillFirmMarkers(xml, slots);
    expect(out.xml).toContain('RE: Aisha Osei v. Brightpath Financial Group Inc');
    expect(out.xml).toContain('August 6, 2026');
    expect(out.filled).toContain('CLIENT NAME');
  });

  it('leaves a marker it cannot resolve exactly as the firm wrote it', () => {
    // Better a visible marker than a wrong value or a blank.
    const out = fillFirmMarkers('<w:t>[MANAGING PARTNER]</w:t>', slots);
    expect(out.xml).toContain('[MANAGING PARTNER]');
    expect(out.unresolved).toContain('MANAGING PARTNER');
  });

  it('escapes what it fills, since a firm name can carry an ampersand', () => {
    const out = fillFirmMarkers('<w:t>[EMPLOYER]</w:t>', { EMPLOYER: 'Smith & Jones Inc' });
    expect(out.xml).toContain('Smith &amp; Jones Inc');
  });

  it('leaves prose that merely uses brackets alone', () => {
    const out = fillFirmMarkers('<w:t>Waksdale [2020] ONCA 391</w:t>', slots);
    expect(out.xml).toContain('[2020]');
  });
});

describe('templateHasOwnOpening', () => {
  it('recognises a template that carries the letter’s opening', () => {
    expect(templateHasOwnOpening('[DATE] [EMPLOYER] Dear Sirs/Mesdames: RE: [CLIENT] v. [EMPLOYER]')).toBe(true);
  });

  it('does not mistake bare letterhead for an opening', () => {
    expect(templateHasOwnOpening('EVANS LAW FIRM 1 King Street West Toronto')).toBe(false);
  });
});

describe('stripLeadingFurniture', () => {
  it('removes the generated opening when the template supplies its own', () => {
    const letter = [
      '<p>WITHOUT PREJUDICE</p>',
      '<p>Brightpath Financial Group Inc</p>',
      '<p>Dear Sirs/Mesdames:</p>',
      '<p>RE: Aisha Osei v. Brightpath</p>',
      '<p>We are the solicitors for Aisha Osei in respect of the termination of her employment.</p>',
      '<h2>BACKGROUND</h2>',
    ].join('');
    const out = stripLeadingFurniture(letter);
    expect(out).not.toContain('WITHOUT PREJUDICE');
    expect(out).not.toContain('Dear Sirs/Mesdames');
    expect(out).toContain('We are the solicitors');
    expect(out).toContain('BACKGROUND');
  });

  it('keeps a without-prejudice reservation in the closing, which is substantive', () => {
    const letter = '<h2>CLOSING</h2><p>This letter is written without prejudice to our client\'s rights.</p>';
    expect(stripLeadingFurniture(letter)).toContain('without prejudice to our client');
  });
});
