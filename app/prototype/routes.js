/*
 * Pure route contract for the prototype.
 *
 * Keeping this module free of React and Next imports lets auth, navigation,
 * and regression tests agree on the same URL grammar.  A location that does
 * not match the grammar is deliberately a `not-found` location; callers must
 * not silently turn a typo into the dashboard or the first course.
 */

export const BASE = '/prototype';
export const NOT_FOUND_HREF = `${BASE}/not-found`;

const STUDENT_AREAS = new Set(['courses', 'calendar', 'inbox', 'settings']);
const STUDENT_COURSE_VIEWS = new Set([
  'home',
  'lessons',
  'path',
  'materials',
  'assignments',
  'grades',
  'discussions',
  'progress',
  // Approved LearningRecords expose this in place of the mock course tools.
  'mastery',
]);
const INSTRUCTOR_LIBRARY_VIEWS = new Set(['courses', 'sources', 'rubrics', 'settings']);
const INSTRUCTOR_COURSE_VIEWS = new Set([
  'builder',
  'roster',
  'fidelity',
  // Rubrics exist at two addresses on purpose. The library one is the whole
  // owner's collection; this one is a single course's objectives and the
  // rubric each of them is judged by. `rubrics` is matched as a library view
  // first (see parseInstructor), so the two never collide.
  'rubrics',
  'mastery',
  'aar',
  'settings',
]);
/*
 * Settings is one destination with tabs rather than several scattered buttons,
 * so the tab is part of the URL: a deep link has to be able to name it, and
 * the shells must not hold the active tab in state the router cannot see.
 * `account` is the default, which is why /settings stays a valid location.
 */
const SETTINGS_TABS = new Set(['account', 'app', 'course']);
const DEFAULT_SETTINGS_TAB = 'account';

const INSTRUCTOR_ROLES = new Set(['INSTRUCTOR', 'BOTH']);
const LEARNER_ROLES = new Set(['LEARNER', 'BOTH']);

function notFound(role = 'student') {
  return { role, area: 'not-found', courseId: null, view: null };
}

function decodeSegment(raw) {
  if (typeof raw !== 'string' || !raw) return null;
  let value;
  try {
    value = decodeURIComponent(raw);
  } catch {
    return null;
  }
  // A decoded slash would change the route's segment structure.  Reject it
  // instead of allowing an encoded path traversal or an ambiguous course id.
  if (
    !value ||
    value === '.' ||
    value === '..' ||
    value.includes('/') ||
    value.includes('\\') ||
    /[\u0000-\u001f\u007f]/.test(value)
  ) {
    return null;
  }
  return value;
}

function encodeId(value) {
  if (value === null || value === undefined) return null;
  const string = String(value);
  if (!decodeSegment(string)) return null;
  return encodeURIComponent(string);
}

function splitPath(pathname) {
  if (typeof pathname !== 'string') return null;
  const path = pathname.split(/[?#]/, 1)[0];
  if (!path.startsWith(`${BASE}/`) && path !== BASE && path !== `${BASE}/`) return null;
  if (path === BASE || path === `${BASE}/`) return [];

  const tail = path.slice(`${BASE}/`.length);
  const raw = tail.split('/');
  // One trailing slash is harmless, but empty interior segments are not.
  if (raw[raw.length - 1] === '') raw.pop();
  if (raw.length === 0 || raw.some((part) => !part)) return null;
  const segments = raw.map(decodeSegment);
  return segments.every(Boolean) ? segments : null;
}

function studentGlobal(area, extra = {}) {
  return {
    role: 'student',
    area,
    courseId: null,
    view: null,
    lessonId: null,
    page: null,
    ...extra,
  };
}

function studentCourse(courseId, view, extra = {}) {
  return {
    role: 'student',
    area: 'course',
    courseId,
    view,
    lessonId: null,
    page: null,
    threadId: null,
    ...extra,
  };
}

function parseStudentCourse(segments) {
  if (segments.length < 2 || segments.length > 5) return null;
  const courseId = segments[1];
  if (!courseId) return null;
  if (segments.length === 2) return studentCourse(courseId, 'home');

  const view = segments[2];
  if (!STUDENT_COURSE_VIEWS.has(view)) return null;

  if (view === 'lessons') {
    if (segments.length === 3) return studentCourse(courseId, view);
    if (segments.length === 4) {
      return segments[3] ? studentCourse(courseId, view, { lessonId: segments[3] }) : null;
    }
    if (segments.length !== 5) return null;
    const lessonId = segments[3];
    if (!lessonId || !/^[1-9]\d*$/.test(segments[4])) return null;
    const page = Number(segments[4]);
    if (!Number.isSafeInteger(page)) return null;
    return studentCourse(courseId, view, { lessonId, page });
  }

  if (view === 'discussions') {
    if (segments.length === 3) return studentCourse(courseId, view);
    if (segments.length === 4) {
      const threadId = segments[3];
      return threadId && threadId !== 'lesson' ? studentCourse(courseId, view, { threadId }) : null;
    }
    if (segments.length === 5 && segments[3] === 'lesson' && segments[4]) {
      return studentCourse(courseId, view, { lessonId: segments[4] });
    }
    return null;
  }

  return segments.length === 3 ? studentCourse(courseId, view) : null;
}

function parseInstructor(segments) {
  if (segments.length === 1) {
    return { role: 'instructor', area: 'library', courseId: null, view: 'courses' };
  }

  const first = segments[1];
  if (INSTRUCTOR_LIBRARY_VIEWS.has(first)) {
    if (segments.length === 2) {
      return first === 'settings'
        ? { role: 'instructor', area: 'library', courseId: null, view: first, tab: DEFAULT_SETTINGS_TAB }
        : { role: 'instructor', area: 'library', courseId: null, view: first };
    }
    if (first === 'settings' && segments.length === 3 && SETTINGS_TABS.has(segments[2])) {
      return { role: 'instructor', area: 'library', courseId: null, view: first, tab: segments[2] };
    }
    return null;
  }

  if (!first || segments.length > 3) return null;
  const view = segments[2] || 'builder';
  if (!INSTRUCTOR_COURSE_VIEWS.has(view)) return null;
  // A per-course settings link keeps working and resolves to the Course tab of
  // the consolidated page, so old deep links are not broken by the merge.
  return view === 'settings'
    ? { role: 'instructor', area: 'course', courseId: first, view, tab: 'course' }
    : { role: 'instructor', area: 'course', courseId: first, view };
}

/**
 * Parse a prototype pathname into a canonical location.
 *
 * Unknown roots, retired roots, malformed ids, unsupported views, and extra
 * segments are all explicit not-found locations.  In particular, they never
 * become the dashboard or the default demo course.
 */
export function parse(pathname) {
  const segments = splitPath(pathname);
  if (!segments) return notFound();
  if (segments.length === 0) return studentGlobal('dashboard');

  if (segments[0] === 'instructor') {
    return parseInstructor(segments) || notFound('instructor');
  }
  if (segments[0] === 'course') {
    return parseStudentCourse(segments) || notFound();
  }
  if (STUDENT_AREAS.has(segments[0])) {
    if (segments.length === 1) {
      return segments[0] === 'settings'
        ? studentGlobal('settings', { tab: DEFAULT_SETTINGS_TAB })
        : studentGlobal(segments[0]);
    }
    if (segments[0] === 'settings' && segments.length === 2 && SETTINGS_TABS.has(segments[1])) {
      return studentGlobal('settings', { tab: segments[1] });
    }
    return notFound();
  }
  // The retired instructor and learner roots are not aliases here. They are
  // retired entry points and must not be accepted as prototype deep links.
  return notFound();
}

function validCourseId(value) {
  return encodeId(value);
}

function studentHref(loc) {
  if (loc.area === 'dashboard') return BASE;
  if (loc.area === 'settings') {
    const suffix = settingsTabSuffix(loc);
    return suffix === null ? NOT_FOUND_HREF : `${BASE}/settings${suffix}`;
  }
  if (STUDENT_AREAS.has(loc.area)) return `${BASE}/${loc.area}`;
  if (loc.area !== 'course') return NOT_FOUND_HREF;

  const courseId = validCourseId(loc.courseId);
  if (!courseId) return NOT_FOUND_HREF;
  const view = loc.view || 'home';
  if (!STUDENT_COURSE_VIEWS.has(view)) return NOT_FOUND_HREF;
  if (view === 'home') return `${BASE}/course/${courseId}`;

  if (view === 'lessons') {
    if (loc.lessonId === null || loc.lessonId === undefined) {
      return `${BASE}/course/${courseId}/lessons`;
    }
    const lessonId = validCourseId(loc.lessonId);
    const page = loc.page === null || loc.page === undefined ? null : Number(loc.page);
    if (!lessonId || (page !== null && (!Number.isSafeInteger(page) || page < 1))) {
      return NOT_FOUND_HREF;
    }
    return `${BASE}/course/${courseId}/lessons/${lessonId}${page > 1 ? `/${page}` : ''}`;
  }

  if (view === 'discussions') {
    if (loc.threadId !== null && loc.threadId !== undefined) {
      const threadId = validCourseId(loc.threadId);
      return threadId ? `${BASE}/course/${courseId}/discussions/${threadId}` : NOT_FOUND_HREF;
    }
    if (loc.lessonId !== null && loc.lessonId !== undefined) {
      const lessonId = validCourseId(loc.lessonId);
      return lessonId ? `${BASE}/course/${courseId}/discussions/lesson/${lessonId}` : NOT_FOUND_HREF;
    }
    return `${BASE}/course/${courseId}/discussions`;
  }

  return `${BASE}/course/${courseId}/${view}`;
}

/** The tab suffix for a settings href. Absent for the default tab, so the
 * canonical form of the landing page stays /settings rather than
 * /settings/account -- two URLs for one screen invites drift. */
function settingsTabSuffix(loc) {
  const tab = loc.tab;
  if (tab === undefined || tab === null || tab === DEFAULT_SETTINGS_TAB) return '';
  return SETTINGS_TABS.has(tab) ? `/${tab}` : null;
}

function instructorHref(loc) {
  if (loc.area === 'library') {
    const view = loc.view || 'courses';
    if (!INSTRUCTOR_LIBRARY_VIEWS.has(view)) return NOT_FOUND_HREF;
    if (view !== 'settings') return `${BASE}/instructor/${view}`;
    const suffix = settingsTabSuffix(loc);
    return suffix === null ? NOT_FOUND_HREF : `${BASE}/instructor/settings${suffix}`;
  }
  if (loc.area !== 'course') return NOT_FOUND_HREF;
  const courseId = validCourseId(loc.courseId);
  const view = loc.view || 'builder';
  if (!courseId || !INSTRUCTOR_COURSE_VIEWS.has(view)) return NOT_FOUND_HREF;
  return `${BASE}/instructor/${courseId}/${view}`;
}

/**
 * Turn a location into a canonical href.  Invalid locations point at the
 * explicit not-found route rather than being silently repaired.
 */
export function href(loc) {
  if (!loc || (loc.role !== 'student' && loc.role !== 'instructor')) return NOT_FOUND_HREF;
  return loc.role === 'instructor' ? instructorHref(loc) : studentHref(loc);
}

/** Href for a settings tab, for either role. */
export function settingsHref(role, tab = DEFAULT_SETTINGS_TAB, courseId = null) {
  return role === 'instructor'
    ? href({ role: 'instructor', area: 'library', courseId, view: 'settings', tab })
    : href({ role: 'student', area: 'settings', tab });
}

export { SETTINGS_TABS, DEFAULT_SETTINGS_TAB };

export function canAccessRole(profile, role, ready = true) {
  if (!ready) return true;
  if (role === 'instructor') return INSTRUCTOR_ROLES.has(profile?.role);
  if (role === 'student') return LEARNER_ROLES.has(profile?.role);
  return false;
}

/**
 * Auth gate for a parsed location.  Instructors may read the student library
 * for preview only; every other student route still follows
 * the saved role.
 */
export function canAccessLocation(profile, location, ready = true) {
  if (!ready) return true;
  if (location?.role === 'instructor') return canAccessRole(profile, 'instructor', ready);
  if (location?.role === 'student') {
    return canAccessRole(profile, 'student', ready)
      || (profile?.role === 'INSTRUCTOR' && location.area === 'courses');
  }
  return false;
}