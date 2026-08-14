/**
 * Unit Tests — reading a precedent by its bytes, not its name.
 *
 * The pilot's "mediation brief templates" were .docx in name only, and
 * the Word reader's raw zip error reached his screen. The properties: a
 * PDF wearing a .docx name is read as a PDF; an old binary .doc is named
 * for what it is with the fix stated; junk gets the lawyer's-words error,
 * never a zip internals message.
 */

import { describe, it, expect } from 'vitest';
import { readPrecedentBuffer } from '../../src/employment/precedent-read.js';

const b64 = (buf: Buffer): string => buf.toString('base64');

describe('readPrecedentBuffer', () => {
  it('names an old Word .doc for what it is, with the fix stated', async () => {
    const oleHeader = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0, 0, 0]);
    const out = await readPrecedentBuffer('brief-template.docx', b64(oleHeader));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toContain('old Word .doc');
      expect(out.error).toContain('save it as .docx');
    }
  });

  it('junk bytes get the lawyer message, never the zip internals error', async () => {
    const junk = Buffer.from('this is not any kind of document container at all');
    const out = await readPrecedentBuffer('template.docx', b64(junk));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).not.toMatch(/central directory|zip file/i);
      expect(out.error).toContain('could not be read as a Word document');
    }
  });

  it('a broken PDF wearing a .docx name is described as a PDF', async () => {
    const fakePdf = Buffer.from('%PDF-1.7\nnot really a pdf body');
    const out = await readPrecedentBuffer('template.docx', b64(fakePdf));
    expect(out.ok).toBe(false);
    if (!out.ok) {
      expect(out.error).toMatch(/PDF/);
      expect(out.error).not.toMatch(/central directory/i);
    }
  });
});
