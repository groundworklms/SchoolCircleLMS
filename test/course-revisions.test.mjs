import assert from 'node:assert/strict';
import test from 'node:test';

import { draftCourse, reviseCourseContent } from '../lib/arsenal-core.js';
import {
  applyCourseRevision,
  normaliseCourseIds,
  parseRevisionRequest,
} from '../lib/learning/course-revisions.js';

const SOURCE = 'A safety check is required before operation. The operator confirms the check before starting.';

test('unsupported explicit objectives fail before model or Coursewright generation', async () => {
  let called = false;
  await assert.rejects(draftCourse({
    title: 'Safety course',
    objectives: ['Calculate orbital mechanics'],
    documents: [{ text: SOURCE, source: 'source-record p.1' }],
  }, {
    ask: async () => { called = true; throw new Error('must not generate'); },
    load: async () => { called = true; throw new Error('must not load generator'); },
  }), (error) => error.code === 'COURSE_OBJECTIVE_INVALID' && error.status === 422);
  assert.equal(called, false);
});

function course() {
  return normaliseCourseIds({
    title: 'Safety course',
    sourceIds: ['source-record'],
    sections: [{
      title: 'Safety check',
      cite: 'source-record p.1',
      lesson: 'A safety check is required before operation.',
      pre: [{
        stem: 'When is a safety check required?',
        options: ['Before operation', 'Never'],
        answer: 0,
        rationale: 'The check happens before operation.',
        citation: { citation: 'source-record p.1', pubId: 'source-record', page: '1' },
      }],
      post: [{
        stem: 'What does the operator confirm?',
        options: ['The check', 'Nothing'],
        answer: 0,
        rationale: 'The operator confirms the check.',
      }],
    }],
  });
}

test('fresh generated sections and questions get stable ids, while supplied ids survive', () => {
  const generated = normaliseCourseIds({
    title: 'A',
    sections: [{
      id: 'saved-section',
      title: 'S',
      pre: [{ id: 'saved-question', stem: 'Q', options: ['a', 'b'], answer: 0 }],
    }, {
      title: 'T',
      pre: [{ stem: 'Q2', options: ['a', 'b'], answer: 0 }],
    }],
  });
  assert.equal(generated.sections[0].id, 'saved-section');
  assert.equal(generated.sections[0].pre[0].id, 'saved-question');
  assert.equal(generated.sections[1].id, 'section-2');
  assert.equal(generated.sections[1].pre[0].id, 'section-2:pre1');
});

test('question revision changes only the selected question and preserves its Anchor citation', () => {
  const original = course();
  const request = parseRevisionRequest({
    version: 4,
    scope: 'question',
    sectionId: original.sections[0].id,
    phase: 'pre',
    questionId: original.sections[0].pre[0].id,
    instructions: 'Make the stem more direct.',
  });
  const revised = applyCourseRevision(original, request, {
    question: {
      stem: 'When must the safety check happen?',
      options: ['Before operation', 'After operation'],
      answerIndex: 0,
      rationale: 'The source requires it before operation.',
      citation: 'invented-anchor',
    },
  });
  assert.equal(revised.sections[0].pre[0].id, original.sections[0].pre[0].id);
  assert.equal(revised.sections[0].pre[0].stem, 'When must the safety check happen?');
  assert.deepEqual(revised.sections[0].pre[0].citation, original.sections[0].pre[0].citation);
  assert.deepEqual(revised.sections[0].post, original.sections[0].post);
  assert.equal(revised.sections[0].lesson, original.sections[0].lesson);
});

test('lesson revision adapter uses the server model seam and refuses unsupported output', async () => {
  const saved = course();
  let prompt = '';
  const output = await reviseCourseContent({
    course: saved,
    scope: 'lesson',
    sectionId: saved.sections[0].id,
    instructions: 'Clarify the timing.',
    sourceDocuments: [{ text: SOURCE, source: 'source-record p.1' }],
  }, {
    ask: async (_system, value) => {
      prompt = value;
      return { lesson: 'A safety check is required before operation.' };
    },
  });
  assert.equal(output.lesson, 'A safety check is required before operation.');
  assert.match(prompt, /Approved source passages/);

  await assert.rejects(
    reviseCourseContent({
      course: saved,
      scope: 'lesson',
      sectionId: saved.sections[0].id,
      instructions: 'Add unsupported detail.',
      sourceDocuments: [{ text: SOURCE, source: 'source-record p.1' }],
    }, {
      ask: async () => ({ refused: true, reason: 'not grounded' }),
    }),
    (error) => error.code === 'COURSE_REVISION_REFUSED' && error.status === 422,
  );
});
