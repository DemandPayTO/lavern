/**
 * Template Injector — Fill firm DOCX templates with generated content.
 *
 * Takes a firm's DOCX template (stored as base64 in the database) and
 * replaces {{PLACEHOLDER}} markers with the corresponding content.
 *
 * How it works:
 *   1. Decode the base64 template to a Buffer
 *   2. Open the DOCX as a zip archive (DOCX = zip of XML files)
 *   3. Read word/document.xml (the main content)
 *   4. Replace {{PLACEHOLDER}} strings in the XML
 *   5. Write the modified XML back to the zip
 *   6. Return the zip as a Buffer (the finished DOCX)
 *
 * This preserves all firm formatting: fonts, colours, logos, headers,
 * footers, page layout, styles — everything except the placeholder text.
 *
 * Uses JSZip (available as transitive dependency of the `docx` package).
 */

import JSZip from 'jszip';
import { injectPlaceholders, type TemplatePlaceholderValues } from './firm-templates.js';
import { getFirmTemplate } from '../db/database.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('TEMPLATE-INJECT');

/**
 * Inject content into a firm's DOCX template.
 *
 * @param firmId       The firm identifier.
 * @param documentType The document type (demand_letter, statement_of_claim, etc.).
 * @param values       Placeholder values to inject.
 * @returns            A Buffer containing the finished DOCX, or null if no template exists.
 */
export async function injectIntoFirmTemplate(
  firmId: string,
  documentType: string,
  values: TemplatePlaceholderValues,
  variantId?: string,
): Promise<Buffer | null> {
  // Load the firm's template. Without a variant this is the type's
  // default; an unknown variant also falls back to the default rather
  // than silently producing an untemplated document.
  const template = getFirmTemplate(firmId, documentType, variantId);
  if (!template) {
    logger.info('No firm template found, using default', { firmId, documentType });
    return null;
  }

  try {
    // Decode base64 → raw DOCX bytes
    const docxBytes = Buffer.from(template.template_b64, 'base64');

    // Open the DOCX as a zip
    const zip = await JSZip.loadAsync(docxBytes);

    // Read the main document XML
    const docXml = zip.file('word/document.xml');
    if (!docXml) {
      logger.warn('Template missing word/document.xml', { firmId, documentType });
      return null;
    }

    let xmlContent = await docXml.async('string');

    // Replace placeholders in the XML content.
    // DOCX XML may split placeholders across multiple XML runs
    // (e.g. <w:r><w:t>{{CLIENT</w:t></w:r><w:r><w:t>_NAME}}</w:t></w:r>).
    // First, try to clean up split placeholders by joining adjacent runs.
    xmlContent = cleanSplitPlaceholders(xmlContent);

    // Now inject the values
    xmlContent = injectPlaceholders(xmlContent, values);

    // Write the modified XML back to the zip
    zip.file('word/document.xml', xmlContent);

    // Also check headers and footers for placeholders
    const headerFooterFiles = Object.keys(zip.files).filter(
      f => f.startsWith('word/header') || f.startsWith('word/footer'),
    );
    for (const hfFile of headerFooterFiles) {
      const file = zip.file(hfFile);
      if (file) {
        let hfContent = await file.async('string');
        hfContent = cleanSplitPlaceholders(hfContent);
        hfContent = injectPlaceholders(hfContent, values);
        zip.file(hfFile, hfContent);
      }
    }

    // Pack the zip back to a Buffer
    const buffer = await zip.generateAsync({ type: 'nodebuffer' });

    logger.info('Template injected', {
      firmId,
      documentType,
      templateName: template.name,
      sizeBytes: buffer.length,
    });

    return buffer;
  } catch (err) {
    logger.error('Template injection failed', {
      firmId,
      documentType,
      error: err instanceof Error ? err.message : String(err),
    });
    return null;
  }
}

/**
 * Clean up DOCX XML where Word has split a placeholder across multiple runs.
 *
 * Word sometimes does this:
 *   <w:r><w:t>{{CLIENT</w:t></w:r><w:r><w:t>_NAME}}</w:t></w:r>
 *
 * This function merges adjacent <w:t> elements that together form a
 * placeholder pattern, so {{CLIENT_NAME}} becomes a single run.
 */
function cleanSplitPlaceholders(xml: string): string {
  // Strategy: find all instances of {{ that don't have a matching }} in the
  // same <w:t> element, then merge forward until we find the }}.
  // Simple approach: remove XML tags between {{ and }}.

  // Match a {{ that's followed by XML tags before the }}
  const splitPattern = /(\{\{[A-Z_]*)(<\/w:t><\/w:r><w:r[^>]*><w:rPr[^>]*\/?><w:t[^>]*>|<\/w:t><\/w:r><w:r[^>]*><w:t[^>]*>)([A-Z_]*\}\})/g;

  let result = xml;
  let prevResult = '';

  // Iterate until no more changes (handles deeply split placeholders)
  let iterations = 0;
  while (result !== prevResult && iterations < 10) {
    prevResult = result;
    result = result.replace(splitPattern, '$1$3');
    iterations++;
  }

  return result;
}
