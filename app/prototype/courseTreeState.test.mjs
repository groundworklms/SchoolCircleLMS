import assert from 'node:assert/strict';
import test from 'node:test';

import {
  COURSE_NAV,
  coursePanelId,
  courseNavDestination,
  expandCourse,
  expandOnCourseSelection,
  initialExpandedCourseIds,
  pruneExpandedCourseIds,
  toggleExpandedCourse,
} from './courseTreeState.mjs';

test('course disclosure expands a deep-linked course without closing siblings', () => {
  const initial = initialExpandedCourseIds('M092721');
  assert.deepEqual(initial, { M092721: true });
  assert.deepEqual(toggleExpandedCourse(initial, 'TC32209'), {
    M092721: true,
    TC32209: true,
  });
  assert.deepEqual(toggleExpandedCourse({ M092721: true }, 'M092721'), {
    M092721: false,
  });
});

test('expanding a course is idempotent for same-course navigation', () => {
  const collapsed = { M092721: false };
  assert.deepEqual(expandCourse(collapsed, 'M092721'), { M092721: true });
  assert.deepEqual(expandCourse({ M092721: true }, 'M092721'), { M092721: true });
  assert.deepEqual(expandOnCourseSelection(collapsed, 'M092721', 'M092721'), collapsed);
  assert.deepEqual(expandOnCourseSelection(collapsed, null, 'M092721'), { M092721: true });
});

test('refreshing the course projection removes stale disclosures without affecting siblings', () => {
  const expanded = { 'course/a': true, 'course-b': false, retired: true };
  assert.deepEqual(pruneExpandedCourseIds(expanded, ['course/a', 'course-b']), {
    'course/a': true,
    'course-b': false,
  });
  // No-op refreshes preserve identity, allowing React callers to avoid a
  // state update when the API returns the same IDs.
  const retained = { 'course/a': true };
  assert.equal(pruneExpandedCourseIds(retained, ['course/a']), retained);
});

test('course IDs remain distinct when encoded for disclosure panel targets', () => {
  assert.notEqual(coursePanelId('a/b'), coursePanelId('a-b'));
  assert.equal(coursePanelId('course 1'), 'course-nav-course%201');
});

test('course tree entries retain the existing destination contract', () => {
  assert.deepEqual(COURSE_NAV.map(({ id }) => id), [
    'home',
    'lessons',
    'path',
    'materials',
    'assignments',
    'grades',
    'discussions',
    'live',
    'progress',
  ]);
  assert.deepEqual(courseNavDestination('M092721', 'lessons'), {
    area: 'course',
    courseId: 'M092721',
    view: 'lessons',
    lessonId: null,
    page: null,
    threadId: null,
  });
});