/**
 * DOCX Export — Converts generated employment law documents to Word format.
 *
 * Takes the HTML output from the demand letter, SOC, or application generators
 * and produces a downloadable DOCX file. Uses the `docx` npm package (v9.6).
 *
 * Two modes:
 *   1. Default template — clean professional formatting with firm name in header
 *   2. Firm template — inject content into the firm's uploaded DOCX template (future)
 *
 * The HTML is parsed into structured DOCX elements: headings, paragraphs,
 * numbered lists, bold text, horizontal rules.
 */

import {
  Document, Packer, Paragraph, TextRun,
  AlignmentType, Header, Footer, PageNumber, BorderStyle, PageOrientation, VerticalAlign,
  Table, TableRow, TableCell, WidthType,
} from 'docx';
import { createLogger } from '../utils/logger.js';
import { injectIntoFirmTemplate } from './template-injector.js';
import { buildPlaceholderValues } from './firm-templates.js';

const logger = createLogger('DOCX-EXPORT');

// ── Types ────────────────────────────────────────────────────────────────

export interface DocxExportOptions {
  /** Structured Form 4C backsheet: rendered as its own LANDSCAPE section. */
  socBacksheet?: {
    plaintiff: string; defendant: string; plaintiffRole: string; defendantRole: string;
    courtFileNo: string; city: string; docTitle: string; firmLines: string[][];
  };
  /** Small Claims filings keep the templated path; Superior Court does not. */
  smallClaims?: boolean;
  /** Who the letter is addressed to, for the firm's own [RECIPIENT] markers. */
  recipientName?: string;
  /** Document title (e.g. "Demand Letter — Smith v. Acme Corp"). */
  title: string;
  /** Firm name for the header. */
  firmName?: string;
  /** Lawyer name for the footer. */
  lawyerName?: string;
  /** Date string for the header (defaults to today). */
  date?: string;
  /** Firm ID for template lookup. If set, tries firm template first. */
  firmId?: string;
  /** Document type for template lookup (demand_letter, statement_of_claim, etc.). */
  documentType?: string;
  /** Which of the firm's templates for that type to use. Omitted means the
   *  type's default variant. */
  templateVariantId?: string;
  /** Firm address block for {{FIRM_ADDRESS}}. */
  firmAddress?: string;
  /** The firm's file number for {{FILE_NUMBER}}. */
  matterNumber?: string;
  /** Court general heading for {{COURT_NAME}}. */
  courtName?: string;
  /** Intake data for placeholder values (client name, employer name, etc.). */
  intake?: {
    client_first_name?: string;
    client_last_name?: string;
    client_address?: string;
    employer_legal_name?: string;
    employer_address?: string;
    job_title?: string;
    hire_date?: string;
    termination_date?: string;
    annual_salary?: number | null;
  };
  /** Demand or settlement figure set on the matter, for {{AMOUNT}}. */
  demandAmount?: number | null;
}

// ── HTML parsing helpers ─────────────────────────────────────────────────

/** Strip HTML tags, decode basic entities. */
function stripTags(html: string): string {
  return html
    .replace(/<br\s*\/?>/gi, '\n')
    .replace(/<\/p>/gi, '\n')
    .replace(/<\/li>/gi, '\n')
    .replace(/<\/h[1-6]>/gi, '\n')
    .replace(/<[^>]+>/g, '')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&nbsp;/g, ' ')
    .trim();
}

/** Extract text runs from an HTML fragment, preserving bold/italic. */
function parseInlineHtml(
  html: string,
  face?: string,
  body?: number,
): TextRun[] {
  const runs: TextRun[] = [];
  // Split on <strong>/<em>/<u> tags. Underline matters on court covers:
  // STATEMENT OF CLAIM is underlined on the form, and a title that loses
  // its underline reads as a draft, not a filing.
  const parts = html.split(/(<\/?(?:strong|b|em|i|u)>)/gi);
  let bold = false;
  let italic = false;
  let underline = false;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === '<strong>' || lower === '<b>') { bold = true; continue; }
    if (lower === '</strong>' || lower === '</b>') { bold = false; continue; }
    if (lower === '<em>' || lower === '<i>') { italic = true; continue; }
    if (lower === '</em>' || lower === '</i>') { italic = false; continue; }
    if (lower === '<u>') { underline = true; continue; }
    if (lower === '</u>') { underline = false; continue; }

    const text = stripTags(part);
    if (text) {
      // <br> arrives as newlines from stripTags; each becomes a real Word
      // line break (the cover's counsel block depends on this).
      const lines = text.split('\n');
      lines.forEach((line, i) => {
        if (!line && i === 0) return;
        runs.push(new TextRun({
          text: line, bold, italics: italic, font: face, size: body,
          ...(underline ? { underline: { type: 'single' as const } } : {}),
          ...(i > 0 ? { break: 1 } : {}),
        }));
      });
    }
  }

  return runs;
}

/** Parse HTML into DOCX paragraphs. */
/**
 * Convert an HTML table to a PLAIN Word table: single black borders, no
 * shading, header cells bold. Court and mediation documents do not take
 * decorated tables, and highlighted cells read as emphasis a tribunal
 * did not ask for.
 */
function htmlTableToDocx(tableHtml: string, face?: string, cellSize?: number): Table | null {
  const rowMatches = [...tableHtml.matchAll(/<tr[^>]*>([\s\S]*?)<\/tr>/gi)];
  if (rowMatches.length === 0) return null;
  const border = { style: BorderStyle.SINGLE, size: 4, color: '000000' } as const;
  const rows: TableRow[] = [];
  for (const rm of rowMatches) {
    const cellMatches = [...rm[1].matchAll(/<(th|td)[^>]*>([\s\S]*?)<\/\1>/gi)];
    if (cellMatches.length === 0) continue;
    rows.push(new TableRow({
      children: cellMatches.map(cm => new TableCell({
        borders: { top: border, bottom: border, left: border, right: border },
        margins: { top: 60, bottom: 60, left: 100, right: 100 },
        children: [new Paragraph({
          children: [new TextRun({
            text: stripTags(cm[2]),
            bold: cm[1].toLowerCase() === 'th',
            font: face,
            size: cellSize,
          })],
        })],
      })),
    }));
  }
  if (rows.length === 0) return null;
  return new Table({ rows, width: { size: 100, type: WidthType.PERCENTAGE } });
}

export interface HtmlToParagraphsOptions {
  /**
   * Court filing format: the type is PRESCRIBED, not inherited. 12-point
   * Times New Roman, double-spaced, whatever any firm template says. Cuts
   * deliberately against inheritFont, which is for correspondence.
   */
  courtFormat?: boolean;
  /**
   * Omit the font and size on every run so the surrounding document's
   * defaults apply. Used when splicing into a firm's own template: a
   * letter on the firm's letterhead should be in the firm's typeface, not
   * in ours.
   */
  inheritFont?: boolean;
}

export function htmlToParagraphs(
  html: string,
  options: HtmlToParagraphsOptions = {},
): Array<Paragraph | Table> {
  // When inheriting, font and size are left undefined rather than set,
  // which is how the docx library says "use the document default".
  const face = options.courtFormat ? 'Times New Roman' : options.inheritFont ? undefined : 'Times New Roman';
  const body = options.courtFormat ? 24 : options.inheritFont ? undefined : 24;
  // Double spacing for court documents: 480 twentieths of a point.
  const lineSpacing = options.courtFormat ? { line: 480 } : {};
  const paragraphs: Array<Paragraph | Table> = [];

  // Split into blocks by major HTML elements
  const blocks = html.split(/(?=<h[1-6]|<p|<ol|<ul|<hr|<li|<table)/gi);

  // Ordered-list state — court documents (SOC facts, grounds) require
  // continuous numbered paragraphs, so <ol><li> items get "N." prefixes
  // with a hanging indent. <ul> items stay as plain indented paragraphs.
  let inOrderedList = false;
  let listCounter = 0;

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // List container open/close markers
    if (/^<ol/i.test(trimmed)) {
      inOrderedList = true;
      listCounter = 0;
      continue;
    }
    if (/^<ul/i.test(trimmed)) {
      inOrderedList = false;
      continue;
    }

    // Table — a real Word table, plain
    if (/^<table/i.test(trimmed)) {
      const tableEnd = trimmed.search(/<\/table>/i);
      const tableHtml = tableEnd >= 0 ? trimmed.slice(0, tableEnd + 8) : trimmed;
      const table = htmlTableToDocx(tableHtml, face, options.inheritFont ? undefined : 22);
      if (table) {
        paragraphs.push(table);
        // Breathing room after the table.
        paragraphs.push(new Paragraph({ spacing: { before: 0, after: 120, ...lineSpacing }, children: [] }));
      }
      // Content after </table> in the same block (rare) falls through as text.
      const rest = tableEnd >= 0 ? trimmed.slice(tableEnd + 8).trim() : '';
      if (rest) {
        const restText = stripTags(rest);
        if (restText) {
          paragraphs.push(new Paragraph({
            spacing: { before: 120, after: 120, ...lineSpacing },
            children: [new TextRun({ text: restText, font: face, size: body })],
          }));
        }
      }
      continue;
    }

    // Heading — plain bold text, no Word heading styles (avoids blue colours)
    const headingMatch = trimmed.match(/^<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (headingMatch) {
      const level = parseInt(headingMatch[1]);
      const text = stripTags(headingMatch[2]);
      if (text) {
        paragraphs.push(new Paragraph({
          spacing: { before: level === 1 ? 360 : 240, after: 120 },
          children: [new TextRun({
            text: level <= 2 ? text.toUpperCase() : text,
            bold: true,
            font: face,
            size: options.inheritFont ? undefined : (level === 1 ? 28 : 24),
            color: '000000',
            underline: level <= 2 ? { type: 'single', color: '000000' } : undefined,
          })],
        }));
      }
      continue;
    }

    // Horizontal rule. In court format it is a PAGE BREAK: the claim's
    // shell uses <hr> to separate the backsheet, which must be its own
    // last page, not a line mid-page. Elsewhere it stays a subtle rule.
    if (/^<hr/i.test(trimmed)) {
      if (options.courtFormat) {
        paragraphs.push(new Paragraph({ pageBreakBefore: true, children: [] }));
      } else {
        paragraphs.push(new Paragraph({
          spacing: { before: 120, after: 120, ...lineSpacing },
          border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '000000' } },
          children: [],
        }));
      }
      continue;
    }

    // List item
    const liMatch = trimmed.match(/^<li[^>]*>([\s\S]*?)(?:<\/li>|$)/i);
    if (liMatch) {
      const runs = parseInlineHtml(liMatch[1], face, body);
      if (runs.length > 0) {
        if (inOrderedList) {
          listCounter++;
          // Avoid double numbering when the model already wrote "12. ..."
          const firstText = stripTags(liMatch[1]);
          const alreadyNumbered = /^\d+[.)]\s/.test(firstText);
          paragraphs.push(new Paragraph({
            spacing: { before: 60, after: 120, ...lineSpacing },
            // Hanging indent: number sits at 0.25", text wraps at 0.75"
            indent: { left: 1080, hanging: 720 },
            children: alreadyNumbered ? runs : [
              new TextRun({ text: `${listCounter}.\t`, font: face, size: body }),
              ...runs,
            ],
          }));
        } else {
          paragraphs.push(new Paragraph({
            spacing: { before: 60, after: 60, ...lineSpacing },
            indent: { left: 720 }, // 0.5 inch indent
            children: runs,
          }));
        }
      }
      // A closing </ol> rides along with the last <li> block
      if (/<\/ol>/i.test(trimmed)) {
        inOrderedList = false;
        listCounter = 0;
      }
      continue;
    }

    // Paragraph alignment from the class: the claim's shell writes
    // centre/right (Court File No. right, style of cause centred) and the
    // brief's cover writes centered. All three spellings count, because a
    // cover that silently renders flush left is not a court document.
    const pMatch = trimmed.match(/^<p([^>]*)>([\s\S]*?)(?:<\/p>|$)/i);
    if (pMatch) {
      const runs = parseInlineHtml(pMatch[2], face, body);
      const centered = /class="[^"]*\b(?:centered|centre|center)\b[^"]*"/i.test(pMatch[1]);
      const rightAligned = !centered && /class="[^"]*\bright\b[^"]*"/i.test(pMatch[1]);
      if (runs.length > 0) {
        paragraphs.push(new Paragraph({
          spacing: { before: 120, after: 120, ...lineSpacing },
          ...(centered ? { alignment: AlignmentType.CENTER } : {}),
          ...(rightAligned ? { alignment: AlignmentType.RIGHT } : {}),
          children: runs,
        }));
      }
      continue;
    }

    // Fallback — treat as plain text paragraph
    const plainText = stripTags(trimmed);
    if (plainText) {
      paragraphs.push(new Paragraph({
        spacing: { before: 120, after: 120, ...lineSpacing },
        children: [new TextRun({ text: plainText, font: face, size: body })],
      }));
    }
  }

  return paragraphs;
}

// ── Main export function ─────────────────────────────────────────────────

/**
 * Convert generated HTML to a DOCX Buffer.
 *
 * If firmId and documentType are provided, tries the firm's uploaded DOCX
 * template first (injecting content into their formatting). Falls back to
 * the default professional template if no firm template exists.
 *
 * @param html    The generated document HTML (from demand letter, SOC, or application generator).
 * @param options Export options (title, firm name, lawyer name, date, firmId, documentType).
 * @returns       A Buffer containing the DOCX file.
 */
/**
 * Form 4C, as filed: a LANDSCAPE page whose top band carries the style
 * of cause, with the court, place of commencement, boxed document title,
 * and counsel block confined to the right half above a vertical rule.
 * 12-point Times New Roman throughout; the left half stays empty.
 */
function buildBacksheetSection(b: NonNullable<DocxExportOptions['socBacksheet']>, footer: Footer) {
  const tnr = (text: string, opts: { bold?: boolean; italics?: boolean; size?: number } = {}) =>
    new TextRun({ text, font: 'Times New Roman', size: opts.size ?? 24, bold: opts.bold, italics: opts.italics });
  const para = (children: TextRun[], opts: { align?: (typeof AlignmentType)[keyof typeof AlignmentType]; before?: number; after?: number } = {}) =>
    new Paragraph({ alignment: opts.align, spacing: { before: opts.before ?? 0, after: opts.after ?? 120 }, children });
  const noBorder = { style: BorderStyle.NONE, size: 0, color: 'FFFFFF' } as const;
  const rule = { style: BorderStyle.SINGLE, size: 8, color: '000000' } as const;

  // Top band: party — and — party, roles beneath, court file no. right.
  const band = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: 42, type: WidthType.PERCENTAGE },
          borders: { top: noBorder, left: noBorder, right: noBorder, bottom: rule },
          children: [para([tnr(b.plaintiff, { bold: true })], { after: 0 }), para([tnr(b.plaintiffRole)], { after: 60 })],
        }),
        new TableCell({
          width: { size: 16, type: WidthType.PERCENTAGE },
          borders: { top: noBorder, left: noBorder, right: noBorder, bottom: rule },
          verticalAlign: VerticalAlign.TOP,
          children: [para([tnr('-and-')], { align: AlignmentType.CENTER, after: 60 })],
        }),
        new TableCell({
          width: { size: 42, type: WidthType.PERCENTAGE },
          borders: { top: noBorder, left: noBorder, right: noBorder, bottom: rule },
          children: [
            para([tnr(b.defendant, { bold: true })], { after: 0 }),
            para([tnr(b.defendantRole)], { after: 0 }),
            para([tnr(`Court File No. ${b.courtFileNo || ''}`)], { align: AlignmentType.RIGHT, after: 60 }),
          ],
        }),
      ],
    })],
  });

  // Right-half column: court, city, boxed title, counsel block.
  const titleBox = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [new TableCell({
        borders: { top: { ...rule, style: BorderStyle.DOUBLE }, bottom: { ...rule, style: BorderStyle.DOUBLE }, left: noBorder, right: noBorder },
        children: [para([tnr(b.docTitle, { bold: true })], { align: AlignmentType.CENTER, before: 120, after: 120 })],
      })],
    })],
  });
  const rightChildren: (Paragraph | Table)[] = [
    para([tnr('ONTARIO', { bold: true, italics: true })], { align: AlignmentType.CENTER, before: 120, after: 0 }),
    para([tnr('SUPERIOR COURT OF JUSTICE', { bold: true })], { align: AlignmentType.CENTER, after: 200 }),
    para([tnr('PROCEEDING COMMENCED AT')], { align: AlignmentType.CENTER, after: 0 }),
    para([tnr(b.city)], { align: AlignmentType.CENTER, after: 200 }),
    titleBox,
    para([], { after: 120 }),
  ];
  for (const group of b.firmLines) {
    group.forEach((line: string, i: number) => {
      rightChildren.push(para([tnr(line, { bold: i === 0 })], { after: 0 }));
    });
    rightChildren.push(para([], { after: 60 }));
  }
  const bodyTable = new Table({
    width: { size: 100, type: WidthType.PERCENTAGE },
    rows: [new TableRow({
      children: [
        new TableCell({
          width: { size: 55, type: WidthType.PERCENTAGE },
          borders: { top: noBorder, left: noBorder, bottom: noBorder, right: rule },
          children: [new Paragraph({ children: [] })],
        }),
        new TableCell({
          width: { size: 45, type: WidthType.PERCENTAGE },
          borders: { top: noBorder, left: noBorder, bottom: noBorder, right: noBorder },
          children: rightChildren,
        }),
      ],
    })],
  });

  return {
    properties: { page: { size: { orientation: PageOrientation.LANDSCAPE } } },
    headers: { default: new Header({ children: [] }) },
    footers: { default: footer },
    children: [band, bodyTable],
  };
}

export async function htmlToDocx(html: string, options: DocxExportOptions): Promise<Buffer> {
  // A court filing bypasses the firm template entirely. Its format is
  // prescribed, not the firm's to choose: 12-point Times New Roman,
  // double-spaced, and no letterhead in front of a general heading.
  const courtFormat = options.documentType === 'statement_of_claim' && !options.smallClaims;
  // Try firm template first if firmId and documentType are provided
  if (!courtFormat && options.firmId && options.documentType) {
    const placeholderValues = buildPlaceholderValues({
      intake: options.intake ?? {},
      firmName: options.firmName,
      lawyerName: options.lawyerName,
      firmAddress: options.firmAddress,
      demandAmount: options.demandAmount,
      matterNumber: options.matterNumber,
      courtName: options.courtName,
      date: options.date,
      generatedHtml: html,
      // The firm's own notation in its template resolves from the same
      // values the house form uses, so [CLIENT NAME] in a precedent means
      // what [CLIENT] means in a taught letter style.
      firmSlots: options.intake
        ? (await import('./house-form.js')).resolveSlots({
            intake: options.intake as never,
            recipientName: options.recipientName,
            lawyerName: options.lawyerName,
            firmName: options.firmName,
            fileNumber: options.matterNumber,
            demandAmount: options.demandAmount ?? undefined,
          })
        : undefined,
    });

    const firmBuffer = await injectIntoFirmTemplate(
      options.firmId,
      options.documentType,
      placeholderValues,
      options.templateVariantId,
    );

    if (firmBuffer) {
      logger.info('Using firm template for DOCX export', {
        firmId: options.firmId,
        documentType: options.documentType,
      });
      return firmBuffer;
    }
    // No firm template found — fall through to default
  }

  // Default template: build from scratch
  const date = options.date ?? new Date().toLocaleDateString('en-CA', {
    year: 'numeric', month: 'long', day: 'numeric',
  });

  // The structured backsheet replaces the HTML tail the shell writes for
  // the preview; without the cut the claim would carry two backsheets.
  const mainHtml = courtFormat && options.socBacksheet && html.includes('<hr')
    ? html.slice(0, html.indexOf('<hr'))
    : html;
  const paragraphs = htmlToParagraphs(mainHtml, courtFormat ? { courtFormat: true } : {});

  // A court document carries no firm chrome: no letterhead-style header,
  // no name in the footer. Page numbers only, centred, as filed claims are.
  const courtHeader = new Header({ children: [] });
  const courtFooter = new Footer({
    children: [new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [new TextRun({ children: [PageNumber.CURRENT], font: 'Times New Roman', size: 24 })],
    })],
  });

  const doc = new Document({
    title: options.title,
    creator: options.lawyerName ?? options.firmName ?? 'Starling',
    description: `Generated by Starling: ${options.title}`,
    sections: [{
      headers: {
        default: courtFormat ? courtHeader : new Header({
          children: [
            new Paragraph({
              alignment: AlignmentType.RIGHT,
              children: [
                ...(options.firmName ? [
                  new TextRun({
                    text: options.firmName,
                    bold: true,
                    font: 'Times New Roman',
                    size: 20,
                  }),
                  new TextRun({
                    text: '    ',
                    font: 'Times New Roman',
                    size: 20,
                  }),
                ] : []),
                new TextRun({
                  text: date,
                  font: 'Times New Roman',
                  size: 20,
                  color: '666666',
                }),
              ],
            }),
          ],
        }),
      },
      footers: {
        default: courtFormat ? courtFooter : new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                ...(options.lawyerName ? [
                  new TextRun({
                    text: `${options.lawyerName}${options.firmName ? `, ${options.firmName}` : ''}`,
                    font: 'Times New Roman',
                    size: 16,
                    color: '999999',
                  }),
                  new TextRun({ text: '    |    ', font: 'Times New Roman', size: 16, color: '999999' }),
                ] : []),
                new TextRun({
                  text: 'Page ',
                  font: 'Times New Roman',
                  size: 16,
                  color: '999999',
                }),
                new TextRun({
                  children: [PageNumber.CURRENT],
                  font: 'Times New Roman',
                  size: 16,
                  color: '999999',
                }),
              ],
            }),
          ],
        }),
      },
      children: paragraphs,
    },
    ...(courtFormat && options.socBacksheet ? [buildBacksheetSection(options.socBacksheet, courtFooter)] : []),
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  logger.info('DOCX exported', {
    title: options.title,
    paragraphs: paragraphs.length,
    sizeBytes: buffer.length,
  });

  return buffer;
}
