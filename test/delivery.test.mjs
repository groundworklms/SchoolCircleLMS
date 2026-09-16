import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectDeliveryCourse,
  selectedDeliveryId,
  selectCurrentDeliveryCourses,
} from '../lib/learning/delivery.js';

test('multiple replacements list only the current release while historical pins remain valid', () => {
  const root = {
    id: 'root',
    type: 'COURSE_DRAFT',
    status: 'APPROVED',
    payload: {
      deliveryCourseId: 'root:release:second',
      revisionHistory: [
        { status: 'APPROVED', deliveryCourseId: 'root' },
        { status: 'APPROVED', deliveryCourseId: 'root:release:first' },
        { status: 'APPROVED', deliveryCourseId: 'root:release:second' },
      ],
    },
  };
  const rows = ['root', 'root:release:first', 'root:release:second', 'legacy'].map((id) => course(id));
  assert.deepEqual(selectCurrentDeliveryCourses(rows, [root]).map((row) => row.id),
    ['root:release:second', 'legacy']);
  assert.equal(selectedDeliveryId(root), 'root:release:second');
  assert.equal(selectedDeliveryId(root, 'root'), 'root');
  assert.equal(selectedDeliveryId(root, 'root:release:first'), 'root:release:first');
  assert.equal(selectedDeliveryId(root, 'unrelated'), null);
});

function course(id, title = id) {
  return {
    id,
    title,
    sourceId: 'source-1',
    sections: [{
      id: `${id}:s1`,
      title: 'Lesson',
      order: 0,
      items: [{
        id: `${id}:q1`,
        kind: 'QUESTION',
        stem: 'Which release is selected?',
        options: ['Old', 'Current'],
        answer: 1,
        rationale: 'The current immutable release is selected.',
        support: 0.98,
        citation: { citation: 'source-1 p.1' },
        status: 'APPROVED',
      }],
    }],
  };
}

test('generated delivery selects latest immutable release and pins historical release', () => {
  const root = {
    id: 'course-root',
    type: 'COURSE_DRAFT',
    status: 'APPROVED',
    payload: {
      deliveryCourseId: 'course-root:release:revision-2',
      revisionHistory: [
        { id: 'revision-1', status: 'APPROVED', deliveryCourseId: 'course-root' },
        { id: 'revision-2', status: 'APPROVED', deliveryCourseId: 'course-root:release:revision-2' },
      ],
    },
  };
  const rows = selectCurrentDeliveryCourses(
    [
      course('course-root', 'Old release'),
      course('course-root:release:revision-2', 'Latest release'),
      course('unlinked-course', 'Legacy seeded course'),
    ],
    [root],
  );
  assert.deepEqual(rows.map((row) => row.id), [
    'course-root:release:revision-2',
    'unlinked-course',
  ]);
  assert.equal(selectedDeliveryId(root), 'course-root:release:revision-2');
  assert.equal(selectedDeliveryId(root, 'course-root'), 'course-root');
  assert.equal(selectedDeliveryId(root, 'course-root:release:revision-2'), 'course-root:release:revision-2');
  assert.equal(selectedDeliveryId(root, 'not-a-release'), null);
});

test('student delivery redacts answer keys while instructor export keeps release evidence', () => {
  const release = course('course-root:release:revision-2', 'Latest release');
  const learner = projectDeliveryCourse(release, { learner: true });
  assert.equal(learner.sections[0].items[0].answer, undefined);
  assert.equal(learner.sections[0].items[0].rationale, undefined);
  assert.equal(learner.sections[0].items[0].support, undefined);
  assert.equal(learner.sections[0].items[0].citation.citation, 'source-1 p.1');

  const instructor = projectDeliveryCourse(release);
  assert.equal(instructor.sections[0].items[0].answer, 1);
  assert.equal(instructor.sections[0].items[0].rationale, 'The current immutable release is selected.');
});