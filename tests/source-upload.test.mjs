import assert from 'node:assert/strict';
import { test } from 'node:test';
import { zipSync } from 'fflate';
import {
  MAX_ZIP_ENTRIES,
  collectionFromFilename,
  isPdfFile,
  isZipFile,
  pdfEntriesFromZip,
  titleFromEntryPath,
  zipEntryForm,
} from '../app/prototype/source-upload.js';

const pdf = (label) => new Uint8Array(Buffer.from(`%PDF-1.4\n% ${label}\n%%EOF\n`));
const bytesOf = (text) => new Uint8Array(Buffer.from(text));

test('file type detection accepts what browsers actually report', () => {
  assert.equal(isZipFile({ name: 'Lesson Plans.zip', type: 'application/zip' }), true);
  // Windows reports zips as x-zip-compressed; some browsers report nothing.
  assert.equal(isZipFile({ name: 'x.zip', type: 'application/x-zip-compressed' }), true);
  assert.equal(isZipFile({ name: 'x.ZIP', type: '' }), true);
  assert.equal(isZipFile({ name: 'x.pdf', type: 'application/pdf' }), false);
  assert.equal(isPdfFile({ name: 'x.PDF', type: '' }), true);
  assert.equal(isPdfFile({ name: 'x.zip', type: 'application/zip' }), false);
  assert.equal(isZipFile(null), false);
});

test('the zip name is the default collection and the entry name the default title', () => {
  assert.equal(collectionFromFilename('Lesson Plans.zip'), 'Lesson Plans');
  assert.equal(collectionFromFilename('student.material.v2.zip'), 'student.material.v2');
  assert.equal(titleFromEntryPath('week-1/lesson-01.pdf'), 'lesson-01');
  assert.equal(titleFromEntryPath('Lesson 01.PDF'), 'Lesson 01');
});

test('only real PDFs come out of a zip, in archive order, with junk skipped', () => {
  const archive = zipSync({
    'week-1/lesson-01.pdf': pdf('one'),
    'week-1/notes.txt': bytesOf('not a document'),
    '__MACOSX/week-1/._lesson-01.pdf': bytesOf('resource fork'),
    'week-2/.hidden.pdf': pdf('hidden'),
    'week-2/lesson-02.pdf': pdf('two'),
    'week-2/renamed.pdf': bytesOf('PK not really a pdf'),
    'empty-folder/': new Uint8Array(0),
  });
  const entries = pdfEntriesFromZip(archive);
  assert.deepEqual(entries.map((entry) => entry.path), ['week-1/lesson-01.pdf', 'week-2/lesson-02.pdf']);
  assert.deepEqual([...entries[1].bytes], [...pdf('two')]);
});

test('a zip that is not a zip, or holds too many documents, is refused with a reason', () => {
  assert.throws(() => pdfEntriesFromZip(bytesOf('%PDF-1.4 this is a pdf, not a zip')), /could not be read as a zip/);
  const files = {};
  for (let index = 0; index <= MAX_ZIP_ENTRIES; index += 1) files[`doc-${index}.pdf`] = pdf(String(index));
  assert.throws(() => pdfEntriesFromZip(zipSync(files)), new RegExp(`at most ${MAX_ZIP_ENTRIES}`));
});

test('each entry posts as the same form a single PDF upload sends, plus its collection', () => {
  const form = zipEntryForm({ path: 'week-1/lesson-01.pdf', bytes: pdf('one') }, 'Lesson plans');
  const file = form.get('file');
  assert.equal(file.name, 'week-1/lesson-01.pdf');
  assert.equal(file.type, 'application/pdf');
  assert.equal(file.size, pdf('one').length);
  assert.equal(form.get('title'), 'lesson-01');
  assert.equal(form.get('collection'), 'Lesson plans');
  assert.equal(zipEntryForm({ path: 'a.pdf', bytes: pdf('a') }, '').has('collection'), false);
});
