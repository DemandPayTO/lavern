/**
 * Unit Tests — reading comments and tracked changes out of a .docx.
 *
 * Built by hand as OOXML rather than through a library, so the fixture is
 * exactly the shape Word produces: <w:ins>/<w:del> runs inline in the body,
 * <w:commentRangeStart/End> marking the commented span, and the comment text
 * in a separate part.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { extractDocxRevisions, revisionsAsFeedback } from '../../src/documents/docx-revisions.js';

const NS = 'xmlns:w="http://schemas.openxmlformats.org/wordprocessingml/2006/main"';

/** A .docx body with one tracked insertion, one deletion, and one comment. */
function buildDocx(): Promise<Buffer> {
  const documentXml = `<?xml version="1.0"?>
<w:document ${NS}><w:body>
  <w:p><w:r><w:t>1. The Plaintiff was hired on March 2, </w:t></w:r>
    <w:del w:id="1" w:author="Amara Okonkwo" w:date="2026-08-04T10:00:00Z">
      <w:r><w:delText>2012</w:delText></w:r>
    </w:del>
    <w:ins w:id="2" w:author="Amara Okonkwo" w:date="2026-08-04T10:00:00Z">
      <w:r><w:t>2011</w:t></w:r>
    </w:ins>
    <w:r><w:t>.</w:t></w:r>
  </w:p>
  <w:p>
    <w:commentRangeStart w:id="10"/>
    <w:r><w:t>2. The Plaintiff was terminated without cause.</w:t></w:r>
    <w:commentRangeEnd w:id="10"/>
    <w:r><w:commentReference w:id="10"/></w:r>
  </w:p>
  <w:p><w:r><w:t>3. The Plaintiff claims damages.</w:t></w:r></w:p>
</w:body></w:document>`;

  const commentsXml = `<?xml version="1.0"?>
<w:comments ${NS}>
  <w:comment w:id="10" w:author="Amara Okonkwo" w:date="2026-08-04T10:05:00Z">
    <w:p><w:r><w:t>They walked me out with security. This reads too softly.</w:t></w:r></w:p>
  </w:comment>
</w:comments>`;

  const zip = new JSZip();
  zip.file('word/document.xml', documentXml);
  zip.file('word/comments.xml', commentsXml);
  return zip.generateAsync({ type: 'nodebuffer' });
}

/** A .docx with no comments and no tracked changes. */
function buildCleanDocx(): Promise<Buffer> {
  const zip = new JSZip();
  zip.file('word/document.xml', `<?xml version="1.0"?>
<w:document ${NS}><w:body>
  <w:p><w:r><w:t>1. The Plaintiff was hired on March 2, 2012.</w:t></w:r></w:p>
</w:body></w:document>`);
  return zip.generateAsync({ type: 'nodebuffer' });
}

describe('extraction', () => {
  it('reads a comment with its author and the passage it marks', async () => {
    const revisions = await extractDocxRevisions(await buildDocx());

    expect(revisions.comments).toHaveLength(1);
    const [comment] = revisions.comments;
    expect(comment.author).toBe('Amara Okonkwo');
    expect(comment.text).toContain('walked me out with security');
    // The anchor is what makes a comment actionable: it says WHICH passage.
    expect(comment.anchoredTo).toContain('terminated without cause');
  });

  it('reads tracked insertions and deletions', async () => {
    const revisions = await extractDocxRevisions(await buildDocx());

    const insertion = revisions.trackedChanges.find(c => c.kind === 'insertion');
    const deletion = revisions.trackedChanges.find(c => c.kind === 'deletion');
    expect(insertion?.text).toBe('2011');
    expect(deletion?.text).toBe('2012');
    expect(insertion?.author).toBe('Amara Okonkwo');
  });

  it('produces the body with changes accepted', async () => {
    const revisions = await extractDocxRevisions(await buildDocx());
    // The deleted year is gone, the inserted one survives: what the client
    // meant the document to say.
    expect(revisions.acceptedText).toContain('2011');
    expect(revisions.acceptedText).not.toContain('2012');
    expect(revisions.acceptedText).toContain('claims damages');
  });

  it('reports a clean document rather than failing on one', async () => {
    const revisions = await extractDocxRevisions(await buildCleanDocx());
    expect(revisions.clean).toBe(true);
    expect(revisions.comments).toHaveLength(0);
    expect(revisions.trackedChanges).toHaveLength(0);
    expect(revisions.acceptedText).toContain('hired on March 2, 2012');
  });
});

describe('rendering as feedback for the planner', () => {
  it('describes each change the way an email would', async () => {
    const feedback = revisionsAsFeedback(await extractDocxRevisions(await buildDocx()));

    expect(feedback).toContain('Comment from Amara Okonkwo');
    expect(feedback).toContain('terminated without cause');
    expect(feedback).toContain('walked me out with security');
    expect(feedback).toContain('inserted: "2011"');
    expect(feedback).toContain('deleted: "2012"');
  });

  it('returns nothing for a clean document', async () => {
    const feedback = revisionsAsFeedback(await extractDocxRevisions(await buildCleanDocx()));
    expect(feedback).toBe('');
  });
});
