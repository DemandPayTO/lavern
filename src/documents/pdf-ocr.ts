/**
 * Reading scanned PDFs: when a PDF has no text layer (a photocopied
 * agreement, a fax, a signature-page scan), the text extractor returns
 * pages of nothing. Claude reads PDFs as images natively, so the
 * fallback sends the document itself for a verbatim transcription.
 *
 * Honesty notes, both surfaced to the lawyer as parse warnings:
 * - The transcript is a MODEL READING an image. Quoted passages should
 *   be verified against the original before they anchor anything.
 * - A scan goes to the model as an image, so the regex anonymisation
 *   that runs on text cannot run first. This matches the existing
 *   posture (document text already goes to the model for extraction),
 *   but it is stated, not silent.
 */

import Anthropic from '@anthropic-ai/sdk';
import { ensureApiKey } from '../utils/ensure-api-key.js';
import { createLogger } from '../utils/logger.js';

const logger = createLogger('pdf-ocr');

/** Pages beyond this are not attempted: cost and latency both scale. */
export const MAX_OCR_PAGES = 40;

const TRANSCRIBE_PROMPT = [
  'Transcribe this scanned document verbatim, in reading order, page by page.',
  'Output plain text only: no commentary, no summary, no markdown.',
  'Keep paragraph breaks. Mark anything you cannot read as [illegible].',
  'Do not correct, complete, or paraphrase anything: a transcription that',
  'improves on the page is worse than one that admits [illegible].',
].join(' ');

export interface OcrResult {
  text: string;
  truncated: boolean;
  costNote: string;
}

export async function ocrPdfWithClaude(buffer: Buffer, filename: string, pageCount: number): Promise<OcrResult> {
  const key = ensureApiKey();
  if (!key) throw new Error('AI transcription needs the API key configured.');
  if (pageCount > MAX_OCR_PAGES) {
    throw new Error(`"${filename}" is ${pageCount} pages of scan; AI transcription is capped at ${MAX_OCR_PAGES} pages. Split the file, or OCR it locally first.`);
  }

  const client = new Anthropic({ apiKey: key });
  const model = process.env.SHEM_MODEL ?? 'claude-sonnet-5';

  // Streaming lifts the non-streaming output ceiling; a dense scanned
  // agreement can outrun 8k tokens of transcript.
  const stream = client.messages.stream({
    model,
    max_tokens: 16384,
    messages: [{
      role: 'user',
      content: [
        { type: 'document', source: { type: 'base64', media_type: 'application/pdf', data: buffer.toString('base64') } },
        { type: 'text', text: TRANSCRIBE_PROMPT },
      ],
    }],
  });
  const msg = await stream.finalMessage();
  const text = msg.content.filter(b => b.type === 'text').map(b => (b as { text: string }).text).join('\n');
  const truncated = msg.stop_reason === 'max_tokens';

  logger.info('Scanned PDF transcribed', { filename, pageCount, chars: text.length, truncated });
  return {
    text,
    truncated,
    costNote: `AI transcription of a ${pageCount}-page scan.`,
  };
}
