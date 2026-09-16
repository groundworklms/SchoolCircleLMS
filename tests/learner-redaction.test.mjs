import assert from 'node:assert/strict';
import test from 'node:test';

import { redactCourse } from '../lib/arsenal-core.js';

test('redactCourse removes nested answer aliases while preserving learner content', () => {
  const course = {
    title: 'Navigation',
    citation: 'FM 3-21.8 p. 12',
    sections: [{
      title: 'Orientation',
      lessons: [{
        stem: 'Which direction is north?',
        options: [
          { id: 'north', text: 'North', nested: { correctOptionId: 'north' } },
          { id: 'south', text: 'South' },
        ],
        cites: [{ source: 'FM 3-21.8', page: 12 }],
        metadata: {
          answerKey: 'north',
          nested: {
            correctAnswer: 'north',
            correct_answer_id: 'north',
            answerIndex: 0,
            solution: 'Use the compass.',
            explanation: 'North is the reference direction.',
          },
        },
      }],
    }],
    nested: {
      rationale: 'The hidden rationale must not cross the learner boundary.',
      correctOptionId: 'north',
      is_correct: true,
    },
  };

  const redacted = redactCourse(course);
  assert.equal(redacted.title, course.title);
  assert.equal(redacted.citation, course.citation);
  assert.equal(redacted.sections[0].lessons[0].stem, course.sections[0].lessons[0].stem);
  assert.deepEqual(redacted.sections[0].lessons[0].options, [
    { id: 'north', text: 'North', nested: {} },
    { id: 'south', text: 'South' },
  ]);
  assert.deepEqual(redacted.sections[0].lessons[0].cites, course.sections[0].lessons[0].cites);
  assert.deepEqual(redacted.sections[0].lessons[0].metadata, { nested: {} });
  assert.deepEqual(redacted.nested, {});
  assert.doesNotMatch(
    JSON.stringify(redacted),
    /answerKey|correctOptionId|correct_answer_id|answerIndex|solution|explanation|rationale|is_correct/,
  );
});