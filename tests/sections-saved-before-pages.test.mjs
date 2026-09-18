import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

/*
 * On 2026-09-17 a generation completed all twelve sections AND all twelve page
 * expansions, and the instance was replaced before the record was written.
 * Twenty minutes of successful model calls, thrown away at the last step,
 * because nothing was persisted until everything had finished.
 *
 * The ordering is the fix, so the ordering is what is asserted. Driving a real
 * generation to prove it would need a model and a database; what makes the
 * difference is which side of `createRecordWithSourceGuards` the page pass
 * sits on, and that is visible here.
 */
const source = readFileSync(new URL('../lib/learning/core.js', import.meta.url), 'utf8');
const draft = source.slice(
  source.indexOf('export async function draftCourseRecord'),
  source.indexOf('export async function expandCoursePagesRecord'),
);

test('sections are drafted without pages, so the save comes first', () => {
  assert.match(draft, /pages: false/, 'draftCourse must not expand pages inline any more');
});

test('the record is created before the page pass runs', () => {
  // The CALL, not the name: a comment above the save explains why the page
  // pass follows it, and matching that instead would invert the answer.
  const save = draft.indexOf('await createRecordWithSourceGuards(');
  const pages = draft.indexOf('await expandCoursePagesRecord(');
  assert.ok(save > 0, 'the draft is saved');
  assert.ok(pages > 0, 'the pages are expanded');
  assert.ok(save < pages, 'the expensive, unrepeatable half must be on disk first');
});

test('a failed page pass does not undo the saved course', () => {
  const after = draft.slice(draft.indexOf('await expandCoursePagesRecord('));
  assert.match(after, /catch \(error\)/, 'the page pass is guarded');
  // Throwing here would discard a save that succeeded and hand the instructor
  // nothing, which is the behaviour this change exists to remove. Unwritten
  // pages are already reported on review and already block publication.
  const guard = after.slice(0, after.indexOf('return {'));
  assert.doesNotMatch(guard, /throw/, 'a page failure must not fail the draft');
});

test('page expansion has one implementation, not two', () => {
  // The review screen's "Rewrite lesson pages" calls the same function, so a
  // page pass that dies is a button rather than a lost course.
  assert.equal(
    (source.match(/export async function expandCoursePagesRecord/g) || []).length,
    1,
  );
});
