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
  Document, Packer, Paragraph, TextRun, HeadingLevel,
  AlignmentType, Header, Footer, PageNumber, BorderStyle,
} from 'docx';
import { createLogger } from '../utils/logger.js';
import { injectIntoFirmTemplate } from './template-injector.js';
import { buildPlaceholderValues } from './firm-templates.js';

const logger = createLogger('DOCX-EXPORT');

// ── Types ────────────────────────────────────────────────────────────────

export interface DocxExportOptions {
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
  /** Intake data for placeholder values (client name, employer name, etc.). */
  intake?: {
    client_first_name?: string;
    client_last_name?: string;
    client_address?: string;
    employer_legal_name?: string;
    employer_address?: string;
  };
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
function parseInlineHtml(html: string): TextRun[] {
  const runs: TextRun[] = [];
  // Split on <strong>...</strong> and <em>...</em> tags
  const parts = html.split(/(<\/?(?:strong|b|em|i)>)/gi);
  let bold = false;
  let italic = false;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === '<strong>' || lower === '<b>') { bold = true; continue; }
    if (lower === '</strong>' || lower === '</b>') { bold = false; continue; }
    if (lower === '<em>' || lower === '<i>') { italic = true; continue; }
    if (lower === '</em>' || lower === '</i>') { italic = false; continue; }

    const text = stripTags(part);
    if (text) {
      runs.push(new TextRun({ text, bold, italics: italic, font: 'Times New Roman', size: 24 }));
    }
  }

  return runs;
}

/** Parse HTML into DOCX paragraphs. */
function htmlToParagraphs(html: string): Paragraph[] {
  const paragraphs: Paragraph[] = [];

  // Split into blocks by major HTML elements
  const blocks = html.split(/(?=<h[1-6]|<p|<ol|<ul|<hr|<li)/gi);

  for (const block of blocks) {
    const trimmed = block.trim();
    if (!trimmed) continue;

    // Heading
    const headingMatch = trimmed.match(/^<h([1-6])[^>]*>([\s\S]*?)<\/h[1-6]>/i);
    if (headingMatch) {
      const level = parseInt(headingMatch[1]);
      const text = stripTags(headingMatch[2]);
      if (text) {
        const headingLevel = level === 1 ? HeadingLevel.HEADING_1
          : level === 2 ? HeadingLevel.HEADING_2
          : HeadingLevel.HEADING_3;
        paragraphs.push(new Paragraph({
          heading: headingLevel,
          spacing: { before: 240, after: 120 },
          children: [new TextRun({
            text,
            bold: true,
            font: 'Times New Roman',
            size: level === 1 ? 32 : level === 2 ? 28 : 24,
          })],
        }));
      }
      continue;
    }

    // Horizontal rule
    if (/^<hr/i.test(trimmed)) {
      paragraphs.push(new Paragraph({
        spacing: { before: 120, after: 120 },
        border: { bottom: { style: BorderStyle.SINGLE, size: 1, color: '999999' } },
        children: [],
      }));
      continue;
    }

    // List item
    const liMatch = trimmed.match(/^<li[^>]*>([\s\S]*?)(?:<\/li>|$)/i);
    if (liMatch) {
      const runs = parseInlineHtml(liMatch[1]);
      if (runs.length > 0) {
        paragraphs.push(new Paragraph({
          spacing: { before: 60, after: 60 },
          indent: { left: 720 }, // 0.5 inch indent
          children: runs,
        }));
      }
      continue;
    }

    // Paragraph
    const pMatch = trimmed.match(/^<p[^>]*>([\s\S]*?)(?:<\/p>|$)/i);
    if (pMatch) {
      const runs = parseInlineHtml(pMatch[1]);
      if (runs.length > 0) {
        paragraphs.push(new Paragraph({
          spacing: { before: 120, after: 120 },
          children: runs,
        }));
      }
      continue;
    }

    // Fallback — treat as plain text paragraph
    const plainText = stripTags(trimmed);
    if (plainText) {
      paragraphs.push(new Paragraph({
        spacing: { before: 120, after: 120 },
        children: [new TextRun({ text: plainText, font: 'Times New Roman', size: 24 })],
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
export async function htmlToDocx(html: string, options: DocxExportOptions): Promise<Buffer> {
  // Try firm template first if firmId and documentType are provided
  if (options.firmId && options.documentType) {
    const placeholderValues = buildPlaceholderValues({
      intake: options.intake ?? {},
      firmName: options.firmName,
      lawyerName: options.lawyerName,
      date: options.date,
      generatedHtml: html,
    });

    const firmBuffer = await injectIntoFirmTemplate(
      options.firmId,
      options.documentType,
      placeholderValues,
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

  const paragraphs = htmlToParagraphs(html);

  const doc = new Document({
    title: options.title,
    creator: options.lawyerName ?? options.firmName ?? 'Starling',
    description: `Generated by Starling — ${options.title}`,
    sections: [{
      headers: {
        default: new Header({
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
        default: new Footer({
          children: [
            new Paragraph({
              alignment: AlignmentType.CENTER,
              children: [
                ...(options.lawyerName ? [
                  new TextRun({
                    text: `${options.lawyerName}${options.firmName ? ` — ${options.firmName}` : ''}`,
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
    }],
  });

  const buffer = await Packer.toBuffer(doc);

  logger.info('DOCX exported', {
    title: options.title,
    paragraphs: paragraphs.length,
    sizeBytes: buffer.length,
  });

  return buffer;
}
