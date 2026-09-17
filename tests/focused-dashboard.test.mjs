import assert from 'node:assert/strict';
import test from 'node:test';

import {
  focusedAgendaItems,
  focusedCourseById,
  focusedCourseListState,
  focusedCourseRow,
  focusedLiveCourses,
  focusedItemDestination,
} from '../app/prototype/focused-dashboard-data.js';
import { href } from '../app/prototype/routes.js';

test('focused agenda destinations preserve task, live, exam, and calendar semantics', () => {
  assert.deepEqual(
    focusedItemDestination({
      title: 'Practice set',
      kind: 'Practice',
      source: 'task',
      courseId: 'new-course',
      view: 'lessons',
    }),
    { type: 'course', courseId: 'new-course', view: 'lessons' },
  );
  assert.deepEqual(
    focusedItemDestination({
      title: 'Live session',
      kind: 'Event',
      courseId: 'new-course',
      view: 'live',
    }),
    { type: 'course', courseId: 'new-course', view: 'live' },
  );
  assert.deepEqual(
    focusedItemDestination({
      title: 'Block exam',
      courseId: 'new-course',
      exam: true,
    }),
    { type: 'course', courseId: 'new-course', view: 'assignments' },
  );
  assert.deepEqual(
    focusedItemDestination({ title: 'Annual training', kind: 'Requirement' }),
    { type: 'calendar', title: 'Annual training' },
  );
});

test('focused course destinations remain URL-backed for newly loaded course ids', () => {
  const destination = focusedItemDestination({
    courseId: 'learning-record-42',
    kind: 'Practice',
    source: 'task',
  });
  assert.equal(
    href({
      role: 'student',
      area: 'course',
      courseId: destination.courseId,
      view: destination.view,
    }),
    '/prototype/course/learning-record-42/materials',
  );
});

test('focused agenda keeps overdue requirements and caps the existing agenda', () => {
  const items = focusedAgendaItems(
    [
      { title: 'Overdue requirement', kind: 'Requirement', late: true },
      { title: 'Hidden future requirement', kind: 'Requirement' },
      { title: 'Practice', kind: 'Practice', courseId: 'c1' },
      { title: 'Reading', kind: 'Reading', courseId: 'c1' },
      { title: 'Extra', kind: 'Practice', courseId: 'c1' },
      { title: 'Not shown', kind: 'Practice', courseId: 'c1' },
    ],
    [
      { title: 'Live', when: 'Mon', courseId: 'c1', view: 'live' },
      { title: 'Exam', when: 'Fri', courseId: 'c1', exam: true },
      { title: 'Later', when: 'Tue', courseId: 'c1' },
    ],
  );
  assert.equal(items.length, 6);
  assert.equal(items[0].title, 'Overdue requirement');
  assert.equal(items[1].title, 'Live');
  assert.equal(items[2].title, 'Exam');
  assert.equal(items[5].title, 'Extra');
});

test('focused course rows preserve real course status and section data without fake progress', () => {
  assert.deepEqual(
    focusedCourseRow({
      id: 'delivery-42',
      name: 'Published course',
      sections: 7,
      status: 'APPROVED',
    }),
    {
      id: 'delivery-42',
      name: 'Published course',
      sections: 7,
      status: 'APPROVED',
      hasProgress: false,
      progress: null,
      week: null,
      weeks: null,
    },
  );
});

test('focused live course rows are deduplicated and reject unusable ids', () => {
  const courses = focusedLiveCourses([
    { id: 'generated-1', name: 'Generated course' },
    { id: 'generated-1', name: 'Stale duplicate' },
    { id: '  ', name: 'Missing id' },
    { name: 'No id' },
    null,
    { id: 'generated-2', name: 'Second generated course' },
  ]);

  assert.deepEqual(courses.map((course) => course.id), ['generated-1', 'generated-2']);
  assert.equal(focusedCourseById(courses, 'generated-2')?.name, 'Second generated course');
  assert.equal(focusedCourseById(courses, 'deleted-course'), null);
});

test('focused course list state hides cached rows during loading and errors', () => {
  const cached = [{ id: 'generated-1', name: 'Generated course' }];
  assert.equal(focusedCourseListState(cached, { loading: true }), 'loading');
  assert.equal(focusedCourseListState(cached, { error: { message: 'timeout' } }), 'error');
  assert.equal(focusedCourseListState([], {}), 'empty');
  assert.equal(focusedCourseListState(cached, {}), 'ready');
});
