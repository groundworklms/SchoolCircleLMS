import assert from 'node:assert/strict';
import test from 'node:test';

import {
  canAccessLocation,
  href,
  parse,
  publishedCourseHref,
  settingsHref,
} from '../app/prototype/routes.js';

test('canonical roots select the correct role and area', () => {
  assert.deepEqual(parse('/prototype'), {
    role: 'student',
    area: 'dashboard',
    courseId: null,
    view: null,
    lessonId: null,
    page: null,
  });
  assert.deepEqual(parse('/prototype/courses'), {
    role: 'student',
    area: 'courses',
    courseId: null,
    view: null,
    lessonId: null,
    page: null,
  });
  assert.deepEqual(parse('/prototype/instructor'), {
    role: 'instructor',
    area: 'library',
    courseId: null,
    view: 'courses',
  });
  // Settings is one destination with tabs, so its location names the tab and
  // the bare path means the default rather than "no tab".
  assert.deepEqual(parse('/prototype/instructor/settings'), {
    role: 'instructor',
    area: 'library',
    courseId: null,
    view: 'settings',
    tab: 'account',
  });
  assert.equal(href(parse('/prototype/instructor')), '/prototype/instructor/courses');
});

test('published reader paths are explicit and ids round-trip safely', () => {
  assert.deepEqual(parse('/prototype/published/course%201'), {
    role: 'student',
    area: 'published',
    courseId: 'course 1',
    view: null,
  });
  assert.equal(publishedCourseHref('course 1'), '/prototype/published/course%201');
  assert.equal(href(parse('/prototype/published/course%201')), '/prototype/published/course%201');
  assert.equal(href(parse('/prototype/course/course%201/lessons/lesson%201/2')), '/prototype/course/course%201/lessons/lesson%201/2');
});

test('existing learner and instructor course patterns remain canonical', () => {
  assert.equal(href(parse('/prototype/course/M092721')), '/prototype/course/M092721');
  assert.equal(href(parse('/prototype/course/M092721/lessons/L-1')), '/prototype/course/M092721/lessons/L-1');
  assert.equal(href(parse('/prototype/course/M092721/discussions/lesson/L-1')), '/prototype/course/M092721/discussions/lesson/L-1');
  assert.equal(href(parse('/prototype/instructor/M092721/settings')), '/prototype/instructor/M092721/settings');
  assert.equal(href(parse('/prototype/instructor/M092721')), '/prototype/instructor/M092721/builder');
});

test('instructor secondary and legacy course tools retain canonical deep links', () => {
  for (const view of ['sources', 'rubrics', 'settings']) {
    const path = `/prototype/instructor/${view}`;
    assert.equal(parse(path).area, 'library', path);
    assert.equal(href(parse(path)), path);
  }

  // The review/publish path stays the canonical builder URL, while existing
  // roster and live-learning links remain addressable for saved bookmarks.
  assert.equal(href(parse('/prototype/instructor/M092721')), '/prototype/instructor/M092721/builder');
  for (const view of ['roster', 'control', 'fidelity', 'mastery', 'aar', 'settings']) {
    const path = `/prototype/instructor/M092721/${view}`;
    assert.equal(parse(path).area, 'course', path);
    assert.equal(href(parse(path)), path);
  }
});

test('invalid, retired, malformed, and extra paths become not-found', () => {
  for (const path of [
    '/prototype/teach',
    '/prototype/learn/course/1',
    '/prototype/unknown',
    '/prototype/courses/extra',
    '/prototype/instructor/courses/extra',
    '/prototype/instructor/M092721/not-a-tool',
    '/prototype/course/M092721/lessons/L1/not-a-page',
    '/prototype/course/M092721/discussions/lesson',
    '/prototype/published/course-1/lessons',
    '/prototype/course/%E0%A4%A',
    '/prototype/course/course%2Fwith-slash',
  ]) {
    assert.equal(parse(path).area, 'not-found', path);
  }
});

test('saved-role access permits only the instructor preview locations', () => {
  const instructor = { role: 'INSTRUCTOR' };
  assert.equal(canAccessLocation(instructor, parse('/prototype/courses'), true), true);
  assert.equal(canAccessLocation(instructor, parse('/prototype/published/course-1'), true), true);
  assert.equal(canAccessLocation(instructor, parse('/prototype'), true), false);
  assert.equal(canAccessLocation(instructor, parse('/prototype/course/course-1'), true), false);
  assert.equal(canAccessLocation({ role: 'LEARNER' }, parse('/prototype/instructor'), true), false);
  assert.equal(canAccessLocation({ role: 'BOTH' }, parse('/prototype/instructor'), true), true);
});

test('settings tabs are addressable, canonical, and validated', () => {
  // Each tab is a real URL so it can be linked and the back button works.
  for (const tab of ['account', 'app', 'course']) {
    assert.equal(parse(`/prototype/settings/${tab}`).tab, tab, `student ${tab}`);
    assert.equal(parse(`/prototype/instructor/settings/${tab}`).tab, tab, `instructor ${tab}`);
  }

  // The default tab has ONE canonical URL: /settings, not /settings/account.
  assert.equal(href(parse('/prototype/settings')), '/prototype/settings');
  assert.equal(href(parse('/prototype/settings/account')), '/prototype/settings');
  assert.equal(href(parse('/prototype/instructor/settings/account')), '/prototype/instructor/settings');
  assert.equal(href(parse('/prototype/settings/app')), '/prototype/settings/app');
  assert.equal(href(parse('/prototype/instructor/settings/app')), '/prototype/instructor/settings/app');

  // An unknown or extra segment is not-found, not a silently repaired default.
  for (const bad of [
    '/prototype/settings/bogus',
    '/prototype/settings/app/extra',
    '/prototype/instructor/settings/bogus',
    '/prototype/instructor/settings/app/extra',
  ]) {
    assert.equal(parse(bad).area, 'not-found', bad);
  }

  // Other student areas gain no tab segment from this change.
  assert.equal(parse('/prototype/inbox/app').area, 'not-found');
  assert.equal(parse('/prototype/inbox').tab, undefined);

  // A per-course settings deep link still works and lands on the Course tab.
  const scoped = parse('/prototype/instructor/c1/settings');
  assert.equal(scoped.area, 'course');
  assert.equal(scoped.view, 'settings');
  assert.equal(scoped.tab, 'course');
  assert.equal(href(scoped), '/prototype/instructor/c1/settings');

  // settingsHref spares callers from knowing the grammar.
  assert.equal(settingsHref('instructor', 'app'), '/prototype/instructor/settings/app');
  assert.equal(settingsHref('instructor'), '/prototype/instructor/settings');
  assert.equal(settingsHref('student', 'app'), '/prototype/settings/app');
  assert.equal(settingsHref('student'), '/prototype/settings');
});
