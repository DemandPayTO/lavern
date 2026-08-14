/**
 * Reading a precedent upload by what it actually is, not what it is named.
 *
 * Firms keep precedents as whatever their document system produced, and a
 * file named .docx is often something else underneath: a PDF a DMS
 * renamed, or an old binary .doc. The Word reader's failure for those is
 * a raw zip error ("Can't find end of central directory"), which reached
 * the pilot's screen verbatim. The first bytes say what a file really is:
 * PK means a real .docx, %PDF means a PDF, D0 CF means old Word. Read
 * accordingly, and where the format genuinely cannot be read, say what
 * the file is and what to do about it in the lawyer's words.
 */

import { parsePdf } from '../documents/pdf-parser.js';

export async function readPrecedentBuffer(name: string, docxBase64: string): Promise<{ ok: true; text: string } | { ok: false; error: string }> {
  const buffer = Buffer.from(docxBase64, 'base64');
  const magic = buffer.subarray(0, 4);

  // %PDF: a PDF wearing a .docx name. Read it as what it is.
  if (magic.length >= 4 && magic[0] === 0x25 && magic[1] === 0x50 && magic[2] === 0x44 && magic[3] === 0x46) {
    try {
      const doc = await parsePdf(buffer, name, buffer.length);
      const text = (doc.fullText ?? '').trim();
      if (text) return { ok: true, text };
      return { ok: false, error: `"${name}" is a PDF with no readable text layer. If it is a scan, upload it with a .pdf name so the transcription runs.` };
    } catch {
      return { ok: false, error: `"${name}" is a PDF underneath its name, and it could not be read. Rename it .pdf and try again.` };
    }
  }

  // D0 CF 11 E0: an old binary Word .doc, whatever it is named.
  if (magic.length >= 2 && magic[0] === 0xd0 && magic[1] === 0xcf) {
    return { ok: false, error: `"${name}" is an old Word .doc file underneath its name. Open it in Word and save it as .docx, or save it as a PDF, then upload that.` };
  }

  // PK: a real zip, so a real .docx (or at least Word's own container).
  try {
    const mammoth = (await import('mammoth')).default;
    const { value } = await mammoth.extractRawText({ buffer });
    const text = (value ?? '').trim();
    if (text) return { ok: true, text };
    return { ok: false, error: `"${name}" appears to contain no text.` };
  } catch {
    return { ok: false, error: `"${name}" could not be read as a Word document. If it came out of a document system, save a fresh copy from Word, or upload the PDF version.` };
  }
}
