/**
 * Unit Tests — the node spreadsheet importer.
 *
 * The strongest test is round-tripping: the ported nodes CAME from the
 * pilot's spreadsheet, so importing that same spreadsheet must propose
 * nothing. A changed cell must propose exactly that node, through the
 * gate; a trigger change must be reported and never applied; an unknown
 * block id must be named, not guessed at.
 */

import { describe, it, expect } from 'vitest';
import JSZip from 'jszip';
import { readFirstSheet, buildImportProposals, importNodeSpreadsheet } from '../../src/employment/soc-import.js';
import { loadSocNodes } from '../../src/employment/soc-nodes.js';
import fs from 'node:fs';
import path from 'node:path';

/** Build a minimal single-sheet xlsx with inline strings. */
async function makeXlsx(rows: Array<Record<string, string>>): Promise<Buffer> {
  const esc = (s: string) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  const rowXml = rows.map((row, i) =>
    `<row r="${i + 1}">` + Object.entries(row).map(([col, v]) =>
      `<c r="${col}${i + 1}" t="inlineStr"><is><t xml:space="preserve">${esc(v)}</t></is></c>`,
    ).join('') + '</row>',
  ).join('');

  const zip = new JSZip();
  zip.file('[Content_Types].xml', '<?xml version="1.0"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="xml" ContentType="application/xml"/><Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/></Types>');
  zip.file('xl/workbook.xml', '<?xml version="1.0"?><workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheets><sheet name="SOC Blocks" sheetId="1" r:id="rId1" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships"/></sheets></workbook>');
  zip.file('xl/worksheets/sheet1.xml', `<?xml version="1.0"?><worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main"><sheetData>${rowXml}</sheetData></worksheet>`);
  return zip.generateAsync({ type: 'nodebuffer' }) as Promise<Buffer>;
}

const header = { A: 'Block_ID', B: 'Tier', C: 'Section_Header', D: 'Trigger_Condition', E: 'Assembly_Order', F: 'Lawyer_Review', G: 'Content' };

describe('readFirstSheet', () => {
  it('reads inline-string cells by column', async () => {
    const buf = await makeXlsx([header, { A: 'SOC_HRC_01', G: '{{para}}. New words.' }]);
    const rows = await readFirstSheet(buf);
    expect(rows).toHaveLength(2);
    expect(rows[1].A).toBe('SOC_HRC_01');
    expect(rows[1].G).toContain('New words');
  });

  it('fails loudly on a file that is not a spreadsheet', async () => {
    await expect(readFirstSheet(Buffer.from('not a zip'))).rejects.toThrow();
  });
});

describe('buildImportProposals', () => {
  const nodes = loadSocNodes();

  it('proposes exactly the changed node, validated', async () => {
    const buf = await makeXlsx([header, { A: 'SOC_HRC_01', D: 'gate_G10_fired = YES', G: '{{para}}. The firm now pleads discrimination thus, against {{employer_name}}.' }]);
    const result = buildImportProposals(await readFirstSheet(buf), nodes);
    expect(result.proposals).toHaveLength(1);
    const p = result.proposals[0];
    expect(p.blockId).toBe('SOC_HRC_01');
    expect(p.proposed).toContain('pleads discrimination thus');
    expect(p.validation?.ok).toBe(true);
    expect(p.triggerDiffers).toBeUndefined();
  });

  it('reports a trigger change and never applies it', async () => {
    const buf = await makeXlsx([header, { A: 'SOC_HRC_01', D: 'some_new_condition = YES', G: '{{para}}. Changed words.' }]);
    const result = buildImportProposals(await readFirstSheet(buf), nodes);
    expect(result.proposals[0].triggerDiffers).toContain('Triggers live in code and did not change');
  });

  it('names an unknown block id instead of guessing', async () => {
    const buf = await makeXlsx([header, { A: 'SOC_BRAND_NEW_01', G: '{{para}}. A new cause.' }]);
    const result = buildImportProposals(await readFirstSheet(buf), nodes);
    expect(result.unknownBlocks).toEqual(['SOC_BRAND_NEW_01']);
    expect(result.proposals).toHaveLength(0);
  });

  it('a broken edit fails the gate, not the claim', async () => {
    const buf = await makeXlsx([header, { A: 'SOC_HRC_01', G: '{{para}}. {{#if not_a_real_field}}ground{{/if}}' }]);
    const result = buildImportProposals(await readFirstSheet(buf), nodes);
    expect(result.proposals[0].validation?.ok).toBe(false);
    expect(result.proposals[0].validation?.errors.some(e => e.includes('not_a_real_field'))).toBe(true);
  });

  it('an empty content cell cannot replace a node', async () => {
    const buf = await makeXlsx([header, { A: 'SOC_HRC_01', G: '   ' }]);
    const result = buildImportProposals(await readFirstSheet(buf), nodes);
    expect(result.proposals[0].proposed).toBeNull();
    expect(result.proposals[0].skipped).toContain('no content');
  });
});

describe('round-trip against the real spreadsheet', () => {
  const real = path.resolve(__dirname, '../../inbox/DemandPay_SOC_Content_Blocks.xlsx');
  const exists = fs.existsSync(real);

  it.skipIf(!exists)('importing the source spreadsheet proposes only the nodes the engine has deliberately grown past', async () => {
    const result = await importNodeSpreadsheet(fs.readFileSync(real));
    const changed = result.proposals.filter(p => p.proposed);
    // SOC_ESA_01 and SOC_CLAIM_01 gained the smaller ESA wage claims
    // (vacation underpayment theories, holiday pay, unpaid variable comp,
    // unreimbursed expenses) after the port, and SOC_NOTICE_01's Bardal
    // character line gained the job-level guard (2026-08-14), so the older
    // spreadsheet now proposes reverting exactly those three.
    expect(changed.map(p => p.blockId).sort()).toEqual(['SOC_CLAIM_01', 'SOC_ESA_01', 'SOC_NOTICE_01']);
    expect(result.unchanged).toBeGreaterThanOrEqual(18);
    expect(result.unknownBlocks).toEqual([]);
  });
});
