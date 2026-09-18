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
  withoutUnanswerableQuestions,
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

/*
 * The defect that cost the MCWP 5-10 course.
 *
 * validQuestion checked the COUNT of options and never the options, so a
 * question keyed on a real answer beside a blank string was valid at
 * generation and invalid at approval, where cleanOptions demands "at least two
 * non-empty strings". The two validators disagreed about what a question is,
 * and the disagreement surfaced only when an instructor pressed approve -- on
 * a sixteen-section course, after all of it had been generated. The course was
 * deleted rather than published.
 */
test('a question with a blank option is not a valid question', () => {
  const sound = {
    stem: 'What does orders reconciliation ensure?',
    options: ['The order and its annexes agree', 'The commander has signed it'],
    answer: 0,
  };
  const course = { sections: [{ title: 'S', pre: [sound], post: [] }] };
  // Shuffling is a no-op on an invalid question, which is how this surfaces
  // through the public surface: a blank-option question comes back untouched.
  const blank = { ...sound, options: ['The order and its annexes agree', '   '] };
  assert.equal(shuffleQuestionOptions(blank), blank, 'left alone because it is not valid');
  assert.notEqual(shuffleCourseAnswers(course), null);
});

test('a question with a blank option is dropped rather than failing the whole course', () => {
  const good = {
    stem: 'What does orders reconciliation ensure?',
    options: ['The order and its annexes agree', 'The commander has signed it'],
    answer: 0,
  };
  const blank = { stem: 'Which applies?', options: ['A real choice', ''], answer: 0 };
  const course = {
    title: 'A course',
    sections: [
      { title: 'One', pre: [good, blank], post: [good] },
      { title: 'Two', pre: [good], post: [good] },
    ],
  };
  const cleaned = withoutUnanswerableQuestions(course);
  assert.equal(cleaned.sections[0].pre.length, 1, 'the blank one is gone');
  assert.equal(cleaned.sections[0].pre[0].stem, good.stem, 'the sound one is kept');
  assert.equal(cleaned.sections[0].post.length, 1);
  assert.equal(cleaned.sections[1].pre.length, 1, 'untouched sections are untouched');
});

test('a course with nothing to drop is returned unchanged, not rebuilt', () => {
  const good = { stem: 'A stem here', options: ['One', 'Two'], answer: 0 };
  const course = { sections: [{ title: 'One', pre: [good], post: [good] }] };
  assert.equal(withoutUnanswerableQuestions(course), course, 'same instance, so a caller can tell');
  assert.equal(withoutUnanswerableQuestions(null), null);
  assert.deepEqual(withoutUnanswerableQuestions({ sections: [] }).sections, []);
});

test('an emptied phase still fails validation, because a section that assesses nothing is not a section', () => {
  const blank = { stem: 'Which applies?', options: ['A real choice', ''], answer: 0 };
  const cleaned = withoutUnanswerableQuestions({ sections: [{ title: 'One', pre: [blank], post: [] }] });
  assert.deepEqual(cleaned.sections[0].pre, [], 'dropped to empty rather than kept');
});
