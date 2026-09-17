import assert from 'node:assert/strict';
import test from 'node:test';

import { MAX_PDF_BYTES, readPdfUpload } from '../lib/pdf-upload.js';

test('PDF upload guard requires MIME, bounded size, and %PDF- signature', async () => {
  const bytes = new TextEncoder().encode('%PDF-1.7\nfixture');
  assert.deepEqual(
    [...await readPdfUpload({
      type: 'application/pdf',
      size: bytes.byteLength,
      arrayBuffer: async () => bytes,
    })],
    [...bytes],
  );

  await assert.rejects(
    () => readPdfUpload({
      type: 'text/plain',
      size: bytes.byteLength,
      arrayBuffer: async () => bytes,
    }),
    /application\/pdf/,
  );
  await assert.rejects(
    () => readPdfUpload({
      type: 'application/pdf',
      size: bytes.byteLength,
      arrayBuffer: async () => new TextEncoder().encode('not a PDF'),
    }),
    /%PDF- signature/,
  );
  await assert.rejects(
    () => readPdfUpload({
      type: 'application/pdf',
      size: MAX_PDF_BYTES + 1,
      arrayBuffer: async () => {
        throw new Error('must reject before reading an oversized upload');
      },
    }),
    /50 MiB/,
  );
});
test('the size guard sits at 50 MiB and rejects just past it', async () => {
  // Corpus ingestion deals in whole publications; the previous 10 MiB cap
  // rejected exactly the T&R manuals and MCRPs a schoolhouse needs indexed.
  assert.equal(MAX_PDF_BYTES, 50 * 1024 * 1024);

  const header = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

  // Declared size is checked before the body is read, so an oversized upload
  // is refused without allocating it. Assert that without allocating it here
  // either.
  await assert.rejects(
    () => readPdfUpload({
      type: 'application/pdf',
      size: MAX_PDF_BYTES + 1,
      arrayBuffer: async () => { throw new Error('body must not be read past the limit'); },
    }),
    (error) => error.code === 'BAD_REQUEST' && /50 MiB/.test(error.message),
  );

  // A file at exactly the limit is accepted.
  const atLimit = new Uint8Array(1024);
  atLimit.set(header);
  const accepted = await readPdfUpload({
    type: 'application/pdf',
    size: MAX_PDF_BYTES,
    arrayBuffer: async () => atLimit.buffer,
  });
  assert.equal(accepted.byteLength, 1024);

  // A lying Content-Length does not get past the second check: the real bytes
  // are measured after the read.
  await assert.rejects(
    () => readPdfUpload({
      type: 'application/pdf',
      size: 1024,
      arrayBuffer: async () => new Uint8Array(MAX_PDF_BYTES + 1).buffer,
    }),
    (error) => error.code === 'BAD_REQUEST' && /50 MiB/.test(error.message),
  );
});
