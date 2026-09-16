'use client';

import { usePathname, useRouter } from 'next/navigation';

/* URL-backed navigation for the prototype.

   Every screen has a real address, so refresh keeps your place, back/forward
   work, and a screen can be linked to directly:

     /prototype                                   student dashboard
     /prototype/courses | calendar | inbox | settings
     /prototype/course/:courseId                  course home
     /prototype/course/:courseId/:view            lessons | path | materials | assignments | live | progress
     /prototype/course/:courseId/lessons/:lessonId/:page   page number inside the lesson (1-based)
     /prototype/course/:courseId/discussions/:threadId
     /prototype/instructor/:courseId/:view        builder | control | fidelity | mastery | aar | settings
     /prototype/instructor/courses | sources | rubrics    the instructor library (not tied to a course)

   A courseId is either a mock course key (data.js) or a LearningRecord id
   from /api/learning/courses; the shells resolve which (see learning.js).

   `parse` turns a pathname into a location object; `href` turns one back into
   a pathname. Screens never touch the router directly — they call `go`. */

const BASE = '/prototype';
const STUDENT_AREAS = new Set(['courses', 'calendar', 'inbox', 'settings']);
const INSTRUCTOR_LIBRARY = new Set(['courses', 'sources', 'rubrics']);
const DEFAULT_COURSE = 'M092721';

export function canAccessRole(profile, role, ready = true) {
  // The prototype intentionally keeps its existing demo behavior when Firebase
  // is not configured. Once auth is configured, the persisted role controls
  // both direct URLs and the role switcher.
  if (!ready) return true;
  if (role === 'instructor') return ['INSTRUCTOR', 'BOTH'].includes(profile?.role);
  if (role === 'student') return ['LEARNER', 'BOTH'].includes(profile?.role);
  return false;
}

export function parse(pathname) {
  const seg = (pathname || '').replace(/^\/prototype\/?/, '').split('/').filter(Boolean);

  if (seg[0] === 'instructor') {
    if (INSTRUCTOR_LIBRARY.has(seg[1])) {
      return { role: 'instructor', area: 'library', courseId: null, view: seg[1] };
    }
    return { role: 'instructor', area: 'course', courseId: seg[1] || DEFAULT_COURSE, view: seg[2] || 'builder' };
  }
  if (seg[0] === 'course' && seg[1]) {
    const view = seg[2] || 'home';
    return {
      role: 'student',
      area: 'course',
      courseId: seg[1],
      view,
      lessonId: view === 'lessons' ? seg[3] || null : view === 'discussions' && seg[3] === 'lesson' ? seg[4] || null : null,
      page: view === 'lessons' && seg[4] ? parseInt(seg[4], 10) || 1 : null,
      threadId: view === 'discussions' && seg[3] !== 'lesson' ? seg[3] || null : null,
    };
  }
  if (STUDENT_AREAS.has(seg[0])) {
    return { role: 'student', area: seg[0], courseId: null, view: null, lessonId: null, page: null };
  }
  return { role: 'student', area: 'dashboard', courseId: null, view: null, lessonId: null, page: null };
}

export function href(loc) {
  if (loc.role === 'instructor') {
    if (loc.area === 'library') return `${BASE}/instructor/${loc.view || 'courses'}`;
    return `${BASE}/instructor/${loc.courseId || DEFAULT_COURSE}/${loc.view || 'builder'}`;
  }
  if (loc.area === 'course' && loc.courseId) {
    const view = loc.view || 'home';
    if (view === 'home') return `${BASE}/course/${loc.courseId}`;
    if (view === 'lessons' && loc.lessonId) {
      return `${BASE}/course/${loc.courseId}/lessons/${loc.lessonId}${loc.page && loc.page > 1 ? `/${loc.page}` : ''}`;
    }
    if (view === 'discussions' && loc.threadId) return `${BASE}/course/${loc.courseId}/discussions/${loc.threadId}`;
    if (view === 'discussions' && loc.lessonId) return `${BASE}/course/${loc.courseId}/discussions/lesson/${loc.lessonId}`;
    return `${BASE}/course/${loc.courseId}/${view}`;
  }
  if (loc.area && loc.area !== 'dashboard') return `${BASE}/${loc.area}`;
  return BASE;
}

export function useNav() {
  const pathname = usePathname();
  const router = useRouter();
  const loc = parse(pathname);
  // Partial updates: go({ view: 'lessons' }) keeps the current course.
  const go = (patch) => router.push(href({ ...loc, ...patch }));
  return { ...loc, go };
}
