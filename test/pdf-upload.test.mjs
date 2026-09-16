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
    /10 MiB/,
  );
});