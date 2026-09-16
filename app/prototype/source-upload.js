// Zip intake for the source library, done in the browser: a zip is unpacked
// here and each PDF inside is posted to the existing /sources/pdf route with
// the zip's name as its collection. The server never sees an archive, so
// every guard it already has (size, %PDF- signature, per-request time) still
// applies to each document, and one unreadable PDF fails alone.
import { unzipSync } from 'fflate';

export const MAX_ZIP_ENTRIES = 100;

const ZIP_TYPES = new Set(['application/zip', 'application/x-zip-compressed', 'multipart/x-zip']);
const PDF_SIGNATURE = [0x25, 0x50, 0x44, 0x46, 0x2d]; // %PDF-

export function isZipFile(file) {
  if (!file) return false;
  return ZIP_TYPES.has(String(file.type || '').toLowerCase()) || /\.zip$/i.test(file.name || '');
}

export function isPdfFile(file) {
  if (!file) return false;
  return String(file.type || '').toLowerCase() === 'application/pdf' || /\.pdf$/i.test(file.name || '');
}

/** "Lesson Plans.zip" -> "Lesson Plans": the collection a zip upload defaults to. */
export function collectionFromFilename(name) {
  return String(name || '').replace(/\.[^.]+$/, '').trim();
}

/** "week-1/lesson-01.pdf" -> "lesson-01": the title a zipped PDF defaults to. */
export function titleFromEntryPath(entryPath) {
  const base = String(entryPath || '').split('/').pop() || '';
  return base.replace(/\.pdf$/i, '').trim() || base;
}

function wantedEntry(name) {
  if (!name || name.endsWith('/')) return false;
  if (!/\.pdf$/i.test(name)) return false;
  const parts = name.split('/');
  // Finder's resource forks and dotfiles are never documents.
  if (parts[0] === '__MACOSX') return false;
  return !parts[parts.length - 1].startsWith('.');
}

function looksLikePdf(bytes) {
  return bytes.length >= PDF_SIGNATURE.length
    && PDF_SIGNATURE.every((value, index) => bytes[index] === value);
}

/**
 * The PDFs inside a zip, in archive order: `{ path, bytes }`. Non-PDF entries
 * are never inflated. Throws when the archive is not a zip or holds more
 * documents than one upload should carry.
 */
export function pdfEntriesFromZip(zipBytes) {
  let unpacked;
  try {
    unpacked = unzipSync(zipBytes, { filter: (entry) => wantedEntry(entry.name) });
  } catch (error) {
    throw new Error(`That file could not be read as a zip archive (${error?.message || error}).`);
  }
  const entries = Object.entries(unpacked)
    .filter(([, bytes]) => looksLikePdf(bytes))
    .map(([path, bytes]) => ({ path, bytes }));
  if (entries.length > MAX_ZIP_ENTRIES) {
    throw new Error(`That zip holds ${entries.length} PDFs; upload at most ${MAX_ZIP_ENTRIES} at a time.`);
  }
  return entries;
}

/** The FormData /sources/pdf expects, for one entry out of a zip. */
export function zipEntryForm(entry, collection) {
  const form = new FormData();
  form.append('file', new File([entry.bytes], entry.path, { type: 'application/pdf' }));
  form.append('title', titleFromEntryPath(entry.path));
  if (collection) form.append('collection', collection);
  return form;
}
