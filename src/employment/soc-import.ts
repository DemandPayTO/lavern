/**
 * Importing the SOC content blocks spreadsheet.
 *
 * The firm maintains its node content in the DemandPay spreadsheet
 * (Block_ID, Tier, Section_Header, Trigger_Condition, Assembly_Order,
 * Lawyer_Review, Content, ...). This reads that file inside Starling and
 * turns it into per-node proposals through the SAME validation gate and
 * approval surface as teaching: nothing imports silently.
 *
 * Content only. Triggers, order and headers live in code, so a spreadsheet
 * whose trigger differs from the engine's is REPORTED, never applied: an
 * import that silently changed which claims plead what would be the exact
 * failure the gate exists to prevent.
 *
 * The XLSX parsing is deliberately dependency-free: an .xlsx is a zip of
 * XML, and JSZip is already here for the DOCX work. Only what this
 * spreadsheet needs is supported (inline and shared strings, single
 * sheet), and anything unreadable fails loudly.
 */

import JSZip from 'jszip';
import { loadSocNodes, type SocNode } from './soc-nodes.js';
import { validateNodeContent, type NodeValidation } from './soc-node-validator.js';

// ── Minimal XLSX reading ─────────────────────────────────────────────────

function textOf(xml: string): string {
  return [...xml.matchAll(/<t(?:\s[^>]*)?>([\s\S]*?)<\/t>/g)]
    .map(m => m[1])
    .join('')
    .replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_m, n) => String.fromCharCode(parseInt(n, 10)))
    .replace(/&amp;/g, '&');
}

export interface SheetRow { [column: string]: string }

/** Read the first worksheet as rows of column-letter → text. */
export async function readFirstSheet(xlsxBuffer: Buffer): Promise<SheetRow[]> {
  const zip = await JSZip.loadAsync(xlsxBuffer);

  const shared: string[] = [];
  const sharedFile = zip.file('xl/sharedStrings.xml');
  if (sharedFile) {
    const xml = await sharedFile.async('string');
    for (const si of xml.matchAll(/<si(?:\s[^>]*)?>([\s\S]*?)<\/si>/g)) {
      shared.push(textOf(si[1]));
    }
  }

  const sheetFile = zip.file('xl/worksheets/sheet1.xml');
  if (!sheetFile) throw new Error('The file has no first worksheet. Is it an .xlsx?');
  const sheetXml = await sheetFile.async('string');

  const rows: SheetRow[] = [];
  for (const rowMatch of sheetXml.matchAll(/<row(?:\s[^>]*)?>([\s\S]*?)<\/row>/g)) {
    const row: SheetRow = {};
    for (const cell of rowMatch[1].matchAll(/<c\s([^>]*)>([\s\S]*?)<\/c>/g)) {
      const attrs = cell[1];
      const inner = cell[2];
      const ref = /r="([A-Z]+)\d+"/.exec(attrs)?.[1];
      if (!ref) continue;
      const type = /t="([a-z]+)"/i.exec(attrs)?.[1];
      let value = '';
      if (type === 'inlineStr') {
        value = textOf(inner);
      } else {
        const v = /<v(?:\s[^>]*)?>([\s\S]*?)<\/v>/.exec(inner)?.[1] ?? '';
        value = type === 's' ? (shared[parseInt(v, 10)] ?? '') : textOf(`<t>${v}</t>`);
      }
      row[ref] = value;
    }
    if (Object.keys(row).length > 0) rows.push(row);
  }
  return rows;
}

// ── The import itself ────────────────────────────────────────────────────

export interface ImportProposal {
  blockId: string;
  sectionHeader: string;
  current: string;
  proposed: string | null;
  validation: NodeValidation | null;
  /** The spreadsheet's trigger differs from the engine's. Reported, never applied. */
  triggerDiffers?: string;
  /** Why there is no proposal, when there is none. */
  skipped?: string;
}

export interface ImportResult {
  proposals: ImportProposal[];
  /** Block ids in the sheet the engine does not know. */
  unknownBlocks: string[];
  unchanged: number;
}

const norm = (s: string) => s.replace(/\r\n/g, '\n').replace(/[ \t]+\n/g, '\n').trim();

/**
 * Diff the spreadsheet against the current effective nodes. Column layout
 * is the DemandPay export: A=Block_ID, C=Section_Header, D=Trigger,
 * G=Content. The header row is detected by its Block_ID cell.
 */
export function buildImportProposals(rows: SheetRow[], currentNodes: SocNode[]): ImportResult {
  const byId = new Map(currentNodes.map(n => [n.blockId, n]));
  const proposals: ImportProposal[] = [];
  const unknownBlocks: string[] = [];
  let unchanged = 0;

  for (const row of rows) {
    const blockId = (row.A ?? '').trim();
    if (!blockId || /^block[_ ]?id$/i.test(blockId)) continue;

    const node = byId.get(blockId);
    if (!node) {
      unknownBlocks.push(blockId);
      continue;
    }

    const content = row.G ?? '';
    // scan-ok: splits the em-dash out of an imported spreadsheet row; the
    // character comes from the sheet, it is not emitted by us.
    const sheetTrigger = (row.D ?? '').split('—')[0].trim(); // scan-ok: reads the sheet's character, emits none
    const triggerDiffers = sheetTrigger && sheetTrigger.toUpperCase() !== node.triggerCondition.toUpperCase()
      ? `The spreadsheet's trigger ("${sheetTrigger}") differs from the engine's ("${node.triggerCondition}"). Triggers live in code and did not change.`
      : undefined;

    if (norm(content) === norm(node.content)) {
      unchanged++;
      if (triggerDiffers) {
        proposals.push({
          blockId, sectionHeader: node.sectionHeader, current: node.content,
          proposed: null, validation: null, triggerDiffers,
          skipped: 'The language is unchanged.',
        });
      }
      continue;
    }

    if (!content.trim()) {
      proposals.push({
        blockId, sectionHeader: node.sectionHeader, current: node.content,
        proposed: null, validation: null, triggerDiffers,
        skipped: 'The spreadsheet row has no content. An empty import cannot replace a node.',
      });
      continue;
    }

    proposals.push({
      blockId,
      sectionHeader: node.sectionHeader,
      current: node.content,
      proposed: content,
      validation: validateNodeContent(blockId, content),
      triggerDiffers,
    });
  }

  return { proposals, unknownBlocks, unchanged };
}

export async function importNodeSpreadsheet(
  xlsxBuffer: Buffer,
  currentNodes?: SocNode[],
): Promise<ImportResult> {
  const rows = await readFirstSheet(xlsxBuffer);
  return buildImportProposals(rows, currentNodes ?? loadSocNodes());
}
