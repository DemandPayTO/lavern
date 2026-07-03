/**
 * Integration Test — firm DOCX template fidelity (upload → inject → download).
 *
 * Builds a synthetic firm letterhead DOCX in-memory (header branding +
 * {{PLACEHOLDER}} markers), stores it as the firm template, then runs the
 * same path the download endpoint uses (htmlToDocx with firmId +
 * documentType) and verifies:
 *   - placeholders are replaced with matter values
 *   - the firm's own letterhead text survives untouched
 *   - generated content lands inside the firm's document
 *   - unknown placeholders are left visible (lawyer sees what's unfilled)
 */

import { describe, it, expect, beforeAll } from 'vitest';
import { Document, Packer, Paragraph, TextRun, Header } from 'docx';
import JSZip from 'jszip';
import { initDatabase, saveFirmTemplate } from '../../src/db/database.js';
import { detectPlaceholders } from '../../src/employment/firm-templates.js';
import { htmlToDocx } from '../../src/employment/docx-export.js';

const FIRM_ID = 'test-firm-fidelity';

/** Build a letterhead-style DOCX with placeholder markers. */
async function buildTemplateDocx(): Promise<Buffer> {
  const doc = new Document({
    sections: [{
      headers: {
        default: new Header({
          children: [new Paragraph({
            children: [new TextRun({ text: 'WHITFIELD EMPLOYMENT LAW — EST. 2019', bold: true })],
          })],
        }),
      },
      children: [
        new Paragraph({ children: [new TextRun('{{DATE}}')] }),
        new Paragraph({ children: [new TextRun('RE: {{CLIENT_NAME}} — {{EMPLOYER_NAME}}')] }),
        new Paragraph({ children: [new TextRun('{{LEGAL_ANALYSIS}}')] }),
        new Paragraph({ children: [new TextRun('Custom marker: {{CUSTOM_UNKNOWN}}')] }),
        new Paragraph({ children: [new TextRun('Yours truly, {{LAWYER_NAME}}, {{FIRM_NAME}}')] }),
      ],
    }],
  });
  return Packer.toBuffer(doc);
}

async function docxText(buffer: Buffer): Promise<string> {
  const zip = await JSZip.loadAsync(buffer);
  const xml = await zip.file('word/document.xml')!.async('string');
  const headerFiles = Object.keys(zip.files).filter(f => f.startsWith('word/header'));
  let headerXml = '';
  for (const f of headerFiles) headerXml += await zip.file(f)!.async('string');
  return (xml + headerXml).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ');
}

beforeAll(async () => {
  initDatabase(':memory:');
  const templateBuffer = await buildTemplateDocx();
  const b64 = templateBuffer.toString('base64');
  // Placeholder detection runs against the raw bytes-as-string in the route;
  // here we detect against the XML directly for accuracy
  const zip = await JSZip.loadAsync(templateBuffer);
  const xml = await zip.file('word/document.xml')!.async('string');
  saveFirmTemplate('tpl-fidelity-1', FIRM_ID, 'demand_letter', 'Letterhead v1', b64, detectPlaceholders(xml));
});

describe('firm template injection fidelity', () => {
  it('injects matter values into the firm template and preserves letterhead', async () => {
    const generatedHtml = '<p>UNIQUE-ANALYSIS-MARKER: the termination clause is void under Waksdale.</p>';

    const buffer = await htmlToDocx(generatedHtml, {
      title: 'Demand Letter — Webb v Cadence',
      firmName: 'Whitfield Employment Law',
      lawyerName: 'Jordan Whitfield',
      firmId: FIRM_ID,
      documentType: 'demand_letter',
      intake: {
        client_first_name: 'Marcus',
        client_last_name: 'Webb',
        employer_legal_name: 'Cadence Manufacturing Ltd',
      },
    });

    const text = await docxText(buffer);

    // Placeholders replaced with matter values
    expect(text).toContain('Marcus Webb');
    expect(text).toContain('Cadence Manufacturing Ltd');
    expect(text).toContain('Jordan Whitfield');
    expect(text).toContain('Whitfield Employment Law');
    expect(text).not.toContain('{{CLIENT_NAME}}');
    expect(text).not.toContain('{{EMPLOYER_NAME}}');
    expect(text).not.toContain('{{LAWYER_NAME}}');
    expect(text).not.toContain('{{DATE}}');

    // Generated content injected
    expect(text).toContain('UNIQUE-ANALYSIS-MARKER');

    // Firm letterhead preserved untouched
    expect(text).toContain('WHITFIELD EMPLOYMENT LAW — EST. 2019');

    // Unknown placeholders stay visible so the lawyer notices them
    expect(text).toContain('{{CUSTOM_UNKNOWN}}');
  });

  it('falls back to the default template when the firm has none for the type', async () => {
    const buffer = await htmlToDocx('<p>Fallback body content.</p>', {
      title: 'SOC — no template',
      firmName: 'Whitfield Employment Law',
      firmId: FIRM_ID,
      documentType: 'statement_of_claim', // no template stored for this type
    });
    const text = await docxText(buffer);
    expect(text).toContain('Fallback body content');
    // Default template, not the letterhead
    expect(text).not.toContain('EST. 2019');
  });
});
