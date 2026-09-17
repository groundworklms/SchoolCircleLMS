// A LearningRecord id is a cuid: cmu51u8t2001es6011f3flar9. It is a database
// key, it means nothing to an instructor or a learner, and it was being printed
// on the learner dashboard and under all 109 rows of the source picker. Nothing
// that renders to a user should interpolate a record id as its own label.
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';

const workspace = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const read = (file) => fs.readFileSync(path.join(workspace, file), 'utf8');

test('the learner dashboard names a course rather than keying it', () => {
  const source = read('app/prototype/FocusedDashboard.js');
  assert.doesNotMatch(source, /f-course-id/);
  // The name has to survive the chip's removal.
  assert.match(source, /className="f-course-name">\{row\.name\}/);
});

test('the source picker labels a document by its publication, not its record id', () => {
  const source = read('app/prototype/Library.js');
  // `s` is a source summary in the picker: pages and the publication label are
  // meaningful there, `s.id` is not.
  assert.doesNotMatch(source, /pages · \{s\.id\}/);
  assert.match(source, /s\.sourceId/);
});

test('no stylesheet still reserves space for the removed id chip', () => {
  assert.doesNotMatch(read('app/prototype/Focused.css'), /f-course-id/);
});
