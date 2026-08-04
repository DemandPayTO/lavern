/**
 * Document Routes — File upload and parsing endpoint.
 *
 * POST /api/documents/parse — Accepts multipart file upload, returns ParsedDocument.
 * Supports PDF, DOCX, TXT, MD, RTF, HTML.
 */

import type { FastifyInstance } from 'fastify';
import { parseDocument, SUPPORTED_EXTENSIONS, MAX_FILE_SIZE } from '../../documents/parser.js';

/**
 * Register document parsing routes.
 */
export function registerDocumentRoutes(fastify: FastifyInstance): void {

  /**
   * POST /api/documents/parse
   *
   * Accepts a multipart file upload. Returns the parsed document
   * with structural information (sections, tables, defined terms).
   *
   * Request: multipart/form-data with a single file field named "file"
   * Response: ParsedDocument JSON
   */
  fastify.post('/api/documents/parse', async (request, reply) => {
    try {
      const data = await request.file();

      if (!data) {
        return reply.status(400).send({
          error: 'No file uploaded',
          hint: 'Send a multipart/form-data request with a file field named "file"',
        });
      }

      // Validate file extension
      const filename = data.filename;
      const ext = filename.toLowerCase().slice(filename.lastIndexOf('.'));
      if (!SUPPORTED_EXTENSIONS.has(ext)) {
        return reply.status(400).send({
          error: `Unsupported file type: ${ext}`,
          supported: Array.from(SUPPORTED_EXTENSIONS).join(', '),
        });
      }

      // Read the file, enforcing the size cap AS IT STREAMS.
      //
      // This previously buffered the whole upload and only then compared its
      // length to the cap, so an oversized file was fully resident before it
      // could be rejected, and Buffer.concat briefly held a second copy. On
      // a small container that is enough to get the process OOM-killed by
      // the kernel: the server dies mid-request and every other user's
      // session dies with it, surfacing as a 502 rather than a useful error.
      // Aborting mid-stream bounds the memory a caller can make us hold.
      const chunks: Buffer[] = [];
      let received = 0;
      for await (const chunk of data.file) {
        const buf = typeof chunk === 'string' ? Buffer.from(chunk) : chunk;
        received += buf.length;
        if (received > MAX_FILE_SIZE) {
          chunks.length = 0;              // release what we hold before replying
          data.file.destroy();
          return reply.status(413).send({
            error: `File too large. The limit is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
            maxSizeMb: MAX_FILE_SIZE / 1024 / 1024,
          });
        }
        chunks.push(buf);
      }
      const buffer = Buffer.concat(chunks);
      chunks.length = 0;                  // the concatenated copy is enough

      // @fastify/multipart truncates at the server-wide limit; a truncated
      // file would parse into a silently incomplete document.
      if ((data.file as { truncated?: boolean }).truncated) {
        return reply.status(413).send({
          error: `File too large. The limit is ${MAX_FILE_SIZE / 1024 / 1024} MB.`,
          maxSizeMb: MAX_FILE_SIZE / 1024 / 1024,
        });
      }

      // Parse the document (includes SMAC-L1 sanitization)
      const mimeType = data.mimetype || 'application/octet-stream';
      const parsed = await parseDocument(buffer, filename, mimeType);

      // Audit trail: log if invisible/hidden content was stripped
      if (parsed.sanitizationLog && parsed.sanitizationLog.length > 0) {
        fastify.log.warn({
          msg: 'document_sanitized',
          filename,
          removals: parsed.sanitizationLog,
        });
      }

      return reply.status(200).send(parsed);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'Document parsing failed';
      fastify.log.error(err, 'Document parse error');
      return reply.status(500).send({ error: message });
    }
  });
}
