/*
 * Answer-position bias.
 *
 * Measured over one generated course: 39 of 44 keys were option 1 and option 4
 * was never correct. A learner who reads nothing and always picks the first
 * option scores 89%, which makes every pre-test, post-test, gain score and
 * class-mastery number the platform reports meaningless. These pin the fix.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  keyDistribution,
  shuffleCourseAnswers,
  shuffleQuestionOptions,
  validateKeyDistribution,
} from '../lib/arsenal-core.js';

/** A course shaped the way the generator emits one today: every key at index 0. */
function biasedCourse(sectionCount = 11) {
  return {
    sections: Array.from({ length: sectionCount }, (_, s) => ({
      title: `Section ${s}`,
      pre: [0, 1].map((i) => ({
        stem: `pre ${s} ${i}`,
        options: [`correct ${s}${i}`, 'b', 'c', 'd'],
        answer: 0,
        rationale: 'r',
      })),
      post: [0, 1].map((i) => ({
        stem: `post ${s} ${i}`,
        options: [`correct ${s}${i}`, 'b', 'c', 'd'],
        answer: 0,
        rationale: 'r',
      })),
    })),
  };
}

const keyedText = (question) => question.options[question.answer ?? question.answerIndex];

test('the key follows its own text rather than staying on an index', () => {
  const question = { stem: 'q', options: ['right', 'w1', 'w2', 'w3'], answer: 0, rationale: 'r' };
  const shuffled = shuffleQuestionOptions(question);
  assert.equal(keyedText(shuffled), 'right');
  assert.deepEqual([...shuffled.options].sort(), [...question.options].sort());
});

test('a generated course stops being answerable by always picking the first option', () => {
  const before = keyDistribution(biasedCourse());
  assert.equal(before.shares[0], 1, 'fixture must reproduce the measured bias');

  const after = keyDistribution(shuffleCourseAnswers(biasedCourse()));
  assert.equal(after.total, 44);
  for (const [index, share] of after.shares.entries()) {
    assert.ok(share > 0, `option ${index + 1} is never the answer`);
    assert.ok(share <= 0.35, `option ${index + 1} holds ${Math.round(share * 100)}% of keys`);
  }
});

test('every key still points at the text it pointed at before', () => {
  const original = biasedCourse();
  const shuffled = shuffleCourseAnswers(original);
  for (const [s, section] of shuffled.sections.entries()) {
    for (const phase of ['pre', 'post']) {
      for (const [i, question] of section[phase].entries()) {
        assert.equal(keyedText(question), keyedText(original.sections[s][phase][i]));
      }
    }
  }
});

test('the same item always shuffles the same way', () => {
  // Seeded on the item's own text: a re-render, a re-read, an export and a
  // re-import have to agree, or a recorded attempt stops meaning anything.
  assert.deepEqual(shuffleCourseAnswers(biasedCourse()), shuffleCourseAnswers(biasedCourse()));
});

test('duplicate options are left alone rather than keyed at the wrong one', () => {
  // indexOf would silently pick the first match and could key the wrong copy.
  const question = { stem: 'q', options: ['same', 'same', 'other', 'x'], answer: 1, rationale: 'r' };
  assert.deepEqual(shuffleQuestionOptions(question), question);
});

test('a malformed question is passed through untouched', () => {
  for (const bad of [null, {}, { stem: 'q', options: ['a'], answer: 0 }, { stem: 'q', options: ['a', 'b'], answer: 5 }]) {
    assert.deepEqual(shuffleQuestionOptions(bad), bad);
  }
});

test('the distribution gate fails a biased course and passes a spread one', () => {
  const biased = validateKeyDistribution(biasedCourse());
  assert.equal(biased.valid, false);
  assert.ok(biased.issues.some((issue) => /option 1 is the answer to \d+%/.test(issue)));
  assert.ok(biased.issues.some((issue) => /option 4 is never the answer/.test(issue)));

  assert.equal(validateKeyDistribution(shuffleCourseAnswers(biasedCourse())).valid, true);
});

test('a course too small to have a distribution is not judged on one', () => {
  // Two items cannot be spread across four positions; failing that would block
  // a short course for a property it cannot have.
  const tiny = { sections: [{ title: 's', pre: [{ stem: 'q', options: ['a', 'b', 'c', 'd'], answer: 0, rationale: 'r' }], post: [] }] };
  assert.equal(validateKeyDistribution(tiny).valid, true);
});
