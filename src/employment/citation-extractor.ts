/**
 * Citation Extractor — Cross-references generated documents with source documents
 * to identify which specific text the AI relied on for each section.
 *
 * Given a generated document (demand letter, SOC, etc.) and the uploaded source
 * documents (employment agreement, termination letter, etc.), this module asks
 * Claude to identify the exact text passages from the source documents that
 * support each section of the generated document.
 *
 * The output is an array of SourceCitation objects that the lawyer can use to:
 *   1. Verify that the AI is citing real document text (not hallucinating)
 *   2. Click through to the source document to read the full context
 *   3. Assess the strength of each claim in the generated document
 *
 * Uses crossProviderChat (inherits anonymisation + provider routing).
 */

import { z } from 'zod';
import { crossProviderChat } from '../providers/cross-provider-chat.js';
import { createLogger } from '../utils/logger.js';
import type { SourceCitation } from '../types/employment-intake.js';

const logger = createLogger('CITATIONS');

// ── Output schema (strict) ──────────────────────────────────────────────

const citationSchema = z.object({
  section: z.string().max(200),
  documentName: z.string().max(500),
  quotedText: z.string().max(2000),
  location: z.string().max(200).optional(),
  purpose: z.string().max(500),
  confidence: z.enum(['high', 'medium', 'low']),
});

const citationOutputSchema = z.object({
  citations: z.array(citationSchema).max(50),
}).strict();

// ── Main extraction function ─────────────────────────────────────────────

export interface CitationResult {
  citations: SourceCitation[];
  costUsd: number;
}

/**
 * Extract source citations by cross-referencing a generated document
 * with the uploaded source documents.
 *
 * @param generatedHtml   The generated document (demand letter, SOC, etc.)
 * @param sourceDocuments The uploaded documents with their content.
 * @param definedTerms    Optional party names for anonymisation.
 * @returns               Array of SourceCitation objects + cost.
 */
export async function extractCitations(
  generatedHtml: string,
  sourceDocuments: Array<{ name: string; content: string }>,
  definedTerms?: string[],
): Promise<CitationResult> {
  if (sourceDocuments.length === 0) {
    return { citations: [], costUsd: 0 };
  }

  // Truncate source documents to fit within context
  const maxPerDoc = 10_000;
  const docSummaries = sourceDocuments.map((doc, i) => {
    const content = doc.content.length > maxPerDoc
      ? doc.content.slice(0, maxPerDoc) + '\n[...truncated]'
      : doc.content;
    return `=== SOURCE DOCUMENT ${i + 1}: "${doc.name}" ===\n${content}\n=== END "${doc.name}" ===`;
  }).join('\n\n');

  // Truncate the generated document if very long
  const genDoc = generatedHtml.length > 15_000
    ? generatedHtml.slice(0, 15_000) + '\n[...truncated]'
    : generatedHtml;

  const systemPrompt = `You are a legal citation analyst. Given a GENERATED DOCUMENT (a demand letter or statement of claim) and one or more SOURCE DOCUMENTS (employment agreements, termination letters, etc.), identify every passage in the source documents that the generated document relies on or references.

For each citation, provide:
- section: which part of the generated document uses this source (e.g. "Employment Background", "Termination Clause Analysis", "Damages")
- documentName: the exact filename of the source document
- quotedText: the VERBATIM text from the source document (copy it exactly, do not paraphrase)
- location: where in the source document this text appears (e.g. "Section 12", "Page 2, Paragraph 3", "Under 'Termination'")
- purpose: how the generated document uses this text (e.g. "Establishes termination clause language for Waksdale analysis")
- confidence: how confident you are this is the correct source (high/medium/low)

RULES:
1. Only cite text that ACTUALLY APPEARS in the source documents; never fabricate quotes.
2. The quotedText must be VERBATIM from the source document. Copy it exactly.
3. If a section of the generated document does not rely on any source document (e.g. it cites case law or statutory provisions), skip it; cite only the uploaded documents.
4. Be thorough; find every relevant passage, not only the obvious ones.

Output ONLY a JSON object: { "citations": [ ... ] }
No commentary, no markdown fences. JSON only.`;

  const userMessage = `GENERATED DOCUMENT:
${genDoc}

SOURCE DOCUMENTS:
${docSummaries}

Identify all source document citations used in the generated document.`;

  try {
    const { text, cost } = await crossProviderChat({
      system: systemPrompt,
      user: userMessage,
      tier: 'sonnet',  // Sonnet is sufficient for citation extraction
      maxTokens: 4096,
      definedTerms: definedTerms ?? undefined,
    });

    // Parse response
    const parsed = parseJsonResponse(text);
    if (!parsed) {
      logger.warn('Citation extraction: failed to parse response');
      return { citations: [], costUsd: cost };
    }

    const validated = citationOutputSchema.safeParse(parsed);
    if (!validated.success) {
      logger.warn('Citation extraction: validation failed', {
        issues: validated.error.issues.map(i => i.path.join('.')),
      });
      return { citations: [], costUsd: cost };
    }

    // Verify citations against source documents — only keep citations where
    // the quoted text actually appears in the named document.
    const verifiedCitations: SourceCitation[] = [];
    for (const citation of validated.data.citations) {
      const sourceDoc = sourceDocuments.find(d => d.name === citation.documentName);
      if (sourceDoc) {
        // Check if the quoted text actually exists in the document
        // Use a fuzzy match — allow minor whitespace differences
        const normalisedQuote = citation.quotedText.replace(/\s+/g, ' ').trim().toLowerCase();
        const normalisedContent = sourceDoc.content.replace(/\s+/g, ' ').trim().toLowerCase();

        if (normalisedContent.includes(normalisedQuote.slice(0, 50))) {
          // At least the first 50 chars match — accept the citation
          verifiedCitations.push({
            section: citation.section,
            documentName: citation.documentName,
            quotedText: citation.quotedText,
            location: citation.location,
            purpose: citation.purpose,
            confidence: citation.confidence,
          });
        } else {
          // Quote not found in document — likely hallucinated, skip it
          logger.warn('Citation extraction: quote not found in source document', {
            documentName: citation.documentName,
            quoteStart: citation.quotedText.slice(0, 50),
          });
        }
      }
    }

    logger.info('Citations extracted', {
      total: validated.data.citations.length,
      verified: verifiedCitations.length,
      dropped: validated.data.citations.length - verifiedCitations.length,
    });

    return { citations: verifiedCitations, costUsd: cost };
  } catch (err) {
    logger.error('Citation extraction failed', {
      error: err instanceof Error ? err.message : String(err),
    });
    return { citations: [], costUsd: 0 };
  }
}

// ── Helpers ──────────────────────────────────────────────────────────────

function parseJsonResponse(text: string): unknown {
  try { return JSON.parse(text); } catch { /* continue */ }
  const fenced = text.match(/```(?:json)?\s*([\s\S]*?)```/);
  if (fenced) { try { return JSON.parse(fenced[1]); } catch { /* continue */ } }
  const obj = text.match(/\{[\s\S]*\}/);
  if (obj) { try { return JSON.parse(obj[0]); } catch { /* continue */ } }
  return null;
}
