/**
 * Integration Tests — the document parse route's size handling.
 *
 * An oversized upload used to be buffered ENTIRELY before its length was
 * compared to the cap, so the process could be OOM-killed by the kernel
 * before it ever got to reject the file. That took the whole server down
 * mid-request and reached the user as a 502. The cap is now enforced while
 * the upload streams.
 */

import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import Fastify from 'fastify';
import fastifyMultipart from '@fastify/multipart';
import type { FastifyInstance } from 'fastify';
import { registerDocumentRoutes } from '../../src/api/routes/documents.js';
import { MAX_FILE_SIZE } from '../../src/documents/parser.js';

let app: FastifyInstance;

function multipartBody(filename: string, content: Buffer) {
  const boundary = '----starlingtest';
  const head = Buffer.from(
    `--${boundary}\r\nContent-Disposition: form-data; name="file"; filename="${filename}"\r\n`
    + 'Content-Type: application/pdf\r\n\r\n',
  );
  const tail = Buffer.from(`\r\n--${boundary}--\r\n`);
  return { boundary, payload: Buffer.concat([head, content, tail]) };
}

beforeAll(async () => {
  app = Fastify({ logger: false });
  await app.register(fastifyMultipart, { limits: { fileSize: 50 * 1024 * 1024 } });
  registerDocumentRoutes(app);
  await app.ready();
});

afterAll(async () => { await app.close(); });

describe('upload size enforcement', () => {
  it('rejects an oversized file without buffering all of it', async () => {
    // Comfortably over the cap. The route must abort mid-stream.
    const oversized = Buffer.alloc(MAX_FILE_SIZE + 2 * 1024 * 1024, 0x41);
    const { boundary, payload } = multipartBody('huge.pdf', oversized);

    const res = await app.inject({
      method: 'POST', url: '/api/documents/parse',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });

    expect(res.statusCode).toBe(413);
    expect(res.json().error).toMatch(/too large/i);
  });

  it('still rejects an unsupported type before reading anything', async () => {
    const { boundary, payload } = multipartBody('notes.exe', Buffer.from('x'));
    const res = await app.inject({
      method: 'POST', url: '/api/documents/parse',
      headers: { 'content-type': `multipart/form-data; boundary=${boundary}` },
      payload,
    });
    expect(res.statusCode).toBe(400);
    expect(res.json().error).toMatch(/unsupported/i);
  });
});
