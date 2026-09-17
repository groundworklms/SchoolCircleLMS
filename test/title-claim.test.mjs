import test from 'node:test';
import assert from 'node:assert/strict';
import { courseTitleWordsNotTaught, sectionBody, titleWordsNotTaught } from '../lib/learning/title-claim.js';
import { learnerCourseProjection } from '../lib/learning/core.js';

// ASTRA P0-5. "bias" appears exactly once in the whole course: in this title.
const SECTION = {
  title: 'Human performance and bias',
  objective: 'Describe the components of human performance',
  lesson:
    'Physical training includes compliance with body composition standards, managing fatigue and ' +
    'maintaining good health. Mental fitness supports performance under load.',
  pages: [
    {
      title: 'Human performance',
      blocks: [
        {
          type: 'p',
          text:
            'Physical fitness and physical training are not the same thing. Human performance ' +
            'depends on sleep, nutrition and load management.',
        },
      ],
    },
  ],
  pre: [
    {
      stem: 'Which component includes compliance with body composition standards?',
      options: ['Physical training', 'Mental fitness'],
      answer: 0,
      rationale: 'Physical training includes compliance with body composition standards.',
    },
  ],
  post: [],
};

test('a title word the section never teaches is reported', () => {
  assert.deepEqual(titleWordsNotTaught(SECTION), ['bias']);
});

test('a title the section does deliver is left alone', () => {
  assert.deepEqual(titleWordsNotTaught({ ...SECTION, title: 'Human performance and physical training' }), []);
  assert.deepEqual(titleWordsNotTaught({ ...SECTION, title: 'Performance and fatigue' }), []);
});

test('structural and generic title words are not claims', () => {
  assert.deepEqual(
    titleWordsNotTaught({ ...SECTION, title: 'An Introduction to the Fundamentals of Human Performance' }),
    [],
    '"introduction" and "fundamentals" promise nothing specific',
  );
});

test('a plural or inflected form in the body satisfies the title', () => {
  const section = {
    title: 'Bias in planning',
    lesson: 'Planners carry biases into estimates, and a structured technique surfaces them.',
    pre: [],
    post: [],
  };
  assert.deepEqual(titleWordsNotTaught(section), []);
});

test('a prefix that is a different word does not satisfy the title', () => {
  const section = {
    title: 'Levels of war',
    lesson: 'A warrant officer signs the document and the warranty applies for a year.',
    pre: [],
    post: [],
  };
  assert.deepEqual(titleWordsNotTaught(section), ['levels', 'war'], '"warrant" is not "war"');
});

test('a section with no content yet is not judged', () => {
  assert.deepEqual(titleWordsNotTaught({ title: 'Anything at all' }), []);
  assert.deepEqual(titleWordsNotTaught({}), []);
  assert.deepEqual(titleWordsNotTaught(null), []);
});

test('sectionBody reads the lesson, pages, items and cards, and not the title', () => {
  const body = sectionBody({
    title: 'A distinctive title word: zzyzx',
    lesson: 'The lesson.',
    pages: [{ title: 'Page', blocks: [{ type: 'p', text: 'A paragraph.' }] }],
    pre: [{ stem: 'A stem?', options: ['An option'], answer: 0, rationale: 'A rationale.' }],
    post: [],
    flashcards: [{ front: 'A front', back: 'A back' }],
  });
  for (const part of ['The lesson.', 'A paragraph.', 'A stem?', 'An option', 'A rationale.', 'A front', 'A back']) {
    assert.ok(body.includes(part), part);
  }
  assert.ok(!body.includes('zzyzx'), 'the title cannot vouch for itself');
});

// ASTRA P5.1: "Learning, National Defense, Joint Operations, and Readiness" is
// four courses, generated from a cluster of section topics.
test('a course title is judged against every section, not any one of them', () => {
  const covered = {
    title: 'Joint operations',
    lesson: 'Joint operations require readiness across the national defense enterprise and continuous learning.',
    pre: [],
    post: [],
  };
  assert.deepEqual(
    courseTitleWordsNotTaught({
      title: 'Learning, National Defense, Joint Operations, and Readiness',
      sections: [covered],
    }),
    [],
    'one section carrying all of it is enough for a scope',
  );
  assert.deepEqual(
    courseTitleWordsNotTaught({
      title: 'Learning, National Defense, Joint Operations, and Readiness',
      sections: [SECTION],
    }),
    ['learning', 'national', 'defense', 'joint', 'operations', 'readiness'],
  );
});

test('a course with no sections is not judged', () => {
  assert.deepEqual(courseTitleWordsNotTaught({ title: 'A course', sections: [] }), []);
  assert.deepEqual(courseTitleWordsNotTaught({}), []);
});

test('neither finding reaches a learner', () => {
  const wire = JSON.stringify(
    learnerCourseProjection({
      title: 'A course',
      titleNotTaught: ['bias'],
      sections: [{ title: 'A section', cite: 'pub p.1', titleNotTaught: ['bias'] }],
    }),
  );
  assert.doesNotMatch(wire, /titleNotTaught/);
});
