import assert from 'node:assert/strict';
import test from 'node:test';

import { validateCourseDraft } from '../lib/arsenal-core.js';
import {
  groupBlockers,
  isStructuralFailure,
  revisionProgress,
  sectionIndexOf,
} from '../lib/learning/course-blockers.js';

const source = {
  id: 'source-record-1',
  status: 'APPROVED',
  payload: {
    title: 'Safety standard',
    sourceId: 'safety-standard',
    text: 'A safety check is required before operation. The operator confirms the check before starting.',
    pages: [
      {
        page: 1,
        text: 'A safety check is required before operation. The operator confirms the check before starting.',
      },
    ],
  },
};

const section = (lesson) => ({
  title: 'Safety check',
  cite: 'safety-standard',
  lesson,
  pre: [{ stem: 'When is a safety check required before operation?', options: ['Before operation', 'Never'], answer: 0 }],
  post: [{ stem: 'What must the operator confirm before starting?', options: ['The safety check', 'Nothing'], answer: 0 }],
});

const GROUNDED = 'A safety check is required before operation.';
// Prose a model actually writes: pedagogically sound, far under the token
// overlap the grounding check requires.
const UNGROUNDED =
  'In this lesson you will learn why pre-operation verification matters. Personnel must complete a documented inspection, a habit that protects everyone nearby.';

const validate = (sections) => validateCourseDraft({ title: 'Safety course', sections }, { sources: [source] });

test('blockers name the section an instructor has to revise', () => {
  const result = validate([section(GROUNDED), section(UNGROUNDED), section(GROUNDED)]);
  assert.equal(result.valid, false);

  const blockers = groupBlockers(result);
  assert.equal(blockers.valid, false);
  assert.deepEqual(blockers.general, []);
  assert.equal(blockers.sections.length, 1);
  assert.equal(blockers.sections[0].index, 1, 'the middle section is the one that is blocked');
  assert.match(blockers.sections[0].issues[0], /not grounded/);
  assert.doesNotMatch(blockers.sections[0].issues[0], /^section/, 'the section prefix is stripped for display');
});

test('a fully grounded course reports no blockers', () => {
  const blockers = groupBlockers(validate([section(GROUNDED), section(GROUNDED)]));
  assert.deepEqual(blockers, { valid: true, issues: [], general: [], sections: [] });
});

test('sectionIndexOf separates course-wide issues from section issues', () => {
  assert.equal(sectionIndexOf('section 4 requires a citation'), 4);
  assert.equal(sectionIndexOf('course title is required'), null);
});

test('only a draft with nothing to review is a structural failure', () => {
  for (const issues of [
    ['course must contain at least one section'],
    ['course must be an object'],
    ['approved source projections are required for grounding'],
  ]) {
    assert.equal(isStructuralFailure({ valid: false, issues }), true);
  }
  // A section an instructor can open, read and revise is reviewable content.
  assert.equal(isStructuralFailure(validate([section(UNGROUNDED)])), false);
  assert.equal(isStructuralFailure(validate([section(GROUNDED)])), false);
});

test('a revision that leaves the course publishable is always saved', () => {
  const before = validate([section(UNGROUNDED), section(UNGROUNDED)]);
  const after = validate([section(GROUNDED), section(GROUNDED)]);
  assert.deepEqual(revisionProgress(before, after), { accept: true });
});

test('a publishable course is never allowed to regress', () => {
  const before = validate([section(GROUNDED), section(GROUNDED)]);
  const after = validate([section(GROUNDED), section(UNGROUNDED)]);
  const progress = revisionProgress(before, after);
  assert.equal(progress.accept, false);
  assert.match(progress.reason, /ungrounded/);
});

test('repairing one section of a blocked draft is saved even while others stay blocked', () => {
  // The deadlock this replaces: fixing section 0 used to be rejected because
  // section 1 was still bad, so a blocked draft could never converge.
  const before = validate([section(UNGROUNDED), section(UNGROUNDED)]);
  const after = validate([section(GROUNDED), section(UNGROUNDED)]);
  assert.equal(before.valid, false);
  assert.equal(after.valid, false);
  assert.deepEqual(revisionProgress(before, after), { accept: true });
});

test('a revision that breaks a section which passed before is rejected', () => {
  const before = validate([section(GROUNDED), section(UNGROUNDED)]);
  const after = validate([section(UNGROUNDED), section(GROUNDED)]);
  const progress = revisionProgress(before, after);
  assert.equal(progress.accept, false);
  assert.match(progress.reason, /section 1/, 'names the section it would break, counting from one');
});

test('a revision that resolves nothing is rejected', () => {
  const before = validate([section(UNGROUNDED), section(GROUNDED)]);
  const after = validate([section(UNGROUNDED), section(GROUNDED)]);
  const progress = revisionProgress(before, after);
  assert.equal(progress.accept, false);
  assert.match(progress.reason, /did not resolve anything/);
});
