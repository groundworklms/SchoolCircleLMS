export const MAX_PDF_BYTES = 10 * 1024 * 1024;

const PDF_SIGNATURE = new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d]); // %PDF-

function badPdf(message) {
  const error = new TypeError(message);
  error.code = 'BAD_REQUEST';
  return error;
}

/**
 * Read an uploaded PDF only after checking its declared type, bounded size,
 * and file signature. The parser must never receive an unchecked upload.
 */
export async function readPdfUpload(file) {
  if (!file || typeof file.arrayBuffer !== 'function') {
    throw badPdf('PDF file is required');
  }
  const mime = String(file.type || '').split(';', 1)[0].trim().toLowerCase();
  if (mime !== 'application/pdf') {
    throw badPdf('PDF upload must use application/pdf MIME type');
  }
  if (Number.isFinite(file.size) && file.size > MAX_PDF_BYTES) {
    throw badPdf('PDF upload exceeds the 10 MiB limit');
  }
  const bytes = new Uint8Array(await file.arrayBuffer());
  if (bytes.byteLength > MAX_PDF_BYTES) {
    throw badPdf('PDF upload exceeds the 10 MiB limit');
  }
  if (
    bytes.length < PDF_SIGNATURE.length ||
    PDF_SIGNATURE.some((value, index) => bytes[index] !== value)
  ) {
    throw badPdf('PDF upload has an invalid %PDF- signature');
  }
  return bytes;
}