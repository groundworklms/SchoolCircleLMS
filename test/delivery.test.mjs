import assert from 'node:assert/strict';
import test from 'node:test';

import {
  projectDeliveryCourse,
  projectLearnerLessons,
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
/* ---------------------------------------------------------------------------
 * Lesson prose and ratification.
 *
 * The defect these pin: the learner reader took its section text from the
 * authoring draft while taking its checks from the delivery rows, so the
 * LESSON row an instructor was asked to approve governed nothing a learner
 * saw. Prose now comes from the row, which means withheld prose has to be
 * absent from the projection rather than merely unrendered by one client.
 * ------------------------------------------------------------------------- */

function lessonRow(status, overrides = {}) {
  return {
    id: 'release:s1:lesson',
    kind: 'LESSON',
    stem: 'Sight alignment is the relationship between the post and the aperture.',
    options: null,
    answer: null,
    rationale: null,
    citation: { citation: 'src-1 p.208', pubId: 'TC 3-22.9', page: '208' },
    support: 0.94,
    status,
    ...overrides,
  };
}

function releaseSections(lesson) {
  return [{
    id: 'release:s1',
    title: 'Aiming',
    order: 0,
    items: [
      ...(lesson ? [lesson] : []),
      {
        id: 'release:s1:pre1',
        kind: 'QUESTION',
        stem: 'Which relationship is sight alignment?',
        options: ['Post to aperture', 'Post to target'],
        answer: 0,
        rationale: 'The source names the aperture.',
        citation: { citation: 'src-1 p.208', pubId: 'TC 3-22.9', page: '208' },
        status: 'APPROVED',
      },
    ],
  }];
}

test('an approved lesson delivers its own prose and its own citation', () => {
  const [lesson] = projectLearnerLessons(releaseSections(lessonRow('APPROVED')));
  assert.equal(lesson.sectionIndex, 0);
  assert.equal(lesson.sectionTitle, 'Aiming');
  assert.equal(lesson.id, 'release:s1:lesson');
  assert.equal(lesson.released, true);
  assert.equal(lesson.text, 'Sight alignment is the relationship between the post and the aperture.');
  // The citation of the SAME row as the text. Per-item resolution means this
  // may name a different passage than the section's primary label, and it is
  // the one the instructor ratified alongside these words.
  assert.deepEqual(lesson.citation, { citation: 'src-1 p.208', pubId: 'TC 3-22.9', page: '208' });
  // A copy, so a caller cannot write back into the row it was read from.
  assert.notEqual(lesson.citation, lessonRow('APPROVED').citation);
});

test('a lesson no human has ratified puts no prose and no citation on the wire', () => {
  for (const status of ['PENDING', 'REJECTED']) {
    const [lesson] = projectLearnerLessons(releaseSections(lessonRow(status)));
    assert.equal(lesson.released, false, status);
    assert.equal(lesson.text, '', status);
    assert.equal(lesson.citation, null, status);
    // Nothing of the withheld wording survives anywhere in the projection.
    assert.doesNotMatch(JSON.stringify(lesson), /Sight alignment/, status);
    // PENDING and REJECTED are indistinguishable to a learner: which way an
    // instructor is leaning on a passage is not theirs to read off a screen.
    assert.deepEqual(
      projectLearnerLessons(releaseSections(lessonRow('PENDING')))[0],
      projectLearnerLessons(releaseSections(lessonRow('REJECTED')))[0],
    );
  }
});

test('a section that never had a lesson is not reported as one being withheld', () => {
  // The reader says "your instructor has not approved the text" off this entry,
  // and there is no text. Saying it about a section the draft never wrote a
  // lesson for would be a false explanation of an honestly empty section.
  assert.deepEqual(projectLearnerLessons(releaseSections(null)), []);
  assert.deepEqual(projectLearnerLessons(undefined), []);
});

test('lesson prose is placed by Section.order, like the checks beside it', () => {
  const sections = [
    { id: 'release:s2', title: 'Second', order: 1, items: [lessonRow('APPROVED', { id: 'release:s2:lesson' })] },
    { id: 'release:s1', title: 'First', order: 0, items: [lessonRow('APPROVED', { id: 'release:s1:lesson' })] },
  ];
  assert.deepEqual(
    projectLearnerLessons(sections).map((entry) => [entry.id, entry.sectionIndex]),
    [['release:s2:lesson', 1], ['release:s1:lesson', 0]],
  );
});
