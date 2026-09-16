import test from 'node:test';
import assert from 'node:assert/strict';

import {
  assertRosterEmailsUnique,
  createRosterMessageRequestId,
  normalizeRosterEmail,
  parseRosterCsv,
  rosterCsv,
  escapeSpreadsheetValue,
} from '../app/prototype/roster-utils.js';
import { courseFromRecord } from '../app/prototype/learning-course-utils.js';

test('roster CSV parser handles quoted commas, escaped quotes, and newlines', () => {
  const students = parseRosterCsv(
    'name,email,section\n"Doe, Jane","jane@example.mil",A\n"Line ""Break""\nName",b@example.mil,B',
  );
  assert.deepEqual(students, [
    { name: 'Doe, Jane', email: 'jane@example.mil', section: 'A' },
    { name: 'Line "Break"\nName', email: 'b@example.mil', section: 'B' },
  ]);
});

test('roster CSV parser validates required headers and row fields', () => {
  assert.throws(() => parseRosterCsv('name,email\nJane,jane@example.mil'), /header/i);
  assert.throws(() => parseRosterCsv('name,email,section\nJane,,A'), /row 2/i);
  assert.throws(() => parseRosterCsv('name,email,section\nJane,not-an-email,A'), /invalid email/i);
});

test('roster email dedupe normalizes whitespace and case across retained records', () => {
  assert.equal(normalizeRosterEmail('  Student@Example.MIL '), 'student@example.mil');
  assert.throws(
    () => assertRosterEmailsUnique(
      [{ email: '  Student@Example.MIL ', status: 'dropped' }],
      [{ email: 'student@example.mil' }],
    ),
    /duplicate roster email/i,
  );
});

test('roster email dedupe rejects duplicates within one import batch atomically', () => {
  assert.throws(
    () => assertRosterEmailsUnique([], [
      { email: 'new@example.mil' },
      { email: ' NEW@example.mil ' },
    ]),
    /duplicate roster email/i,
  );
});

test('roster CSV export protects formula-like spreadsheet cells', () => {
  assert.equal(escapeSpreadsheetValue('=HYPERLINK("x")'), '\'=HYPERLINK("x")');
  const csv = rosterCsv([{ name: '=Injected', email: '+mail@example.mil', section: '@A', status: 'active' }]);
  assert.match(csv, /"'=Injected"/);
  assert.match(csv, /"'\+mail@example\.mil"/);
  assert.match(csv, /"'@A"/);
});

test('manual course mapping keeps authoring records instructor-only and roster-addressable', () => {
  const course = courseFromRecord({
    id: 'manual-1',
    status: 'DRAFT',
    version: 3,
    draft: { title: 'Field safety', lessons: [{ id: 'lesson-1' }, { id: 'lesson-2' }] },
  }, 'manual');
  assert.equal(course.id, 'manual-1');
  assert.equal(course.name, 'Field safety');
  assert.equal(course.manual, true);
  assert.equal(course.courseType, 'MANUAL_COURSE');
  assert.equal(course.record.type, 'MANUAL_COURSE');
  assert.equal(course.sections, 2);
});

test('message request id is generated once and can be retained for retries', () => {
  const calls = [];
  const randomSource = { randomUUID: () => { calls.push(true); return 'request-1'; } };
  const requestId = createRosterMessageRequestId(randomSource);
  assert.equal(requestId, 'request-1');
  assert.equal(createRosterMessageRequestId({ randomUUID: () => requestId }), requestId);
  assert.equal(calls.length, 1);
});
