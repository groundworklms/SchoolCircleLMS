/*
 * Pure dashboard data rules. Keeping these outside the React component makes
 * the URL destinations easy to regression-test without mounting the shell.
 */

const TASK_KINDS = new Set(['Practice', 'Reading', 'Task', 'Assignment']);

/**
 * Convert an agenda item into the destination used by the focused dashboard.
 *
 * Course work preserves its explicit destination, with study materials as a
 * fallback; exams retain their own tool. Requirements without a
 * course are calendar records, not course records, so they open Calendar.
 */
export function focusedItemDestination(item = {}) {
  if (!item.courseId) {
    return { type: 'calendar', title: item.title || 'Requirement' };
  }
  if (item.exam) {
    return { type: 'course', courseId: item.courseId, view: 'assignments' };
  }
  if (item.view === 'live' || item.kind === 'Live' || /live session/i.test(item.title || '')) {
    // The live-session screen simulated a class -- a hardcoded response
    // distribution, a counter ticking on a timer, and two sentences claiming
    // results had been written and a remediation lesson drafted, neither of
    // which happened. It was removed rather than left to be disproved, so a
    // row that named one opens the course itself.
    return { type: 'course', courseId: item.courseId, view: 'home' };
  }
  if (item.view) {
    return { type: 'course', courseId: item.courseId, view: item.view };
  }
  if (item.source === 'task' || TASK_KINDS.has(item.kind)) {
    return { type: 'course', courseId: item.courseId, view: 'materials' };
  }
  return { type: 'course', courseId: item.courseId, view: item.view || 'home' };
}

/**
 * Build the compact six-item agenda shown above the course list.
 *
 * The source agenda remains the source of truth. This only chooses which
 * existing items to surface and annotates their origin for routing.
 */
export function focusedAgendaItems(todo = [], upcoming = []) {
  const courseTodos = todo
    .filter((item) => item.kind !== 'Requirement' || item.late)
    .map((item) => ({ ...item, source: 'task', due: item.due }));
  const overdue = courseTodos.filter((item) => item.late);
  const upNext = courseTodos.filter((item) => !item.late).slice(0, 3);
  const soon = upcoming.slice(0, 2).map((item) => ({
    ...item,
    source: 'upcoming',
    due: item.when,
    kind: item.exam ? 'Exam' : 'Event',
  }));
  return [...overdue, ...soon, ...upNext].slice(0, 6);
}

/**
 * Keep the dashboard's enrolled-course list authoritative. API responses are
 * user-controlled data, so a malformed row must not create a button that
 * navigates to an empty course id, and a refetch must not duplicate a row.
 */
export function focusedLiveCourses(courses) {
  const seen = new Set();
  return (Array.isArray(courses) ? courses : []).filter((course) => {
    const id = typeof course?.id === 'string' ? course.id.trim() : '';
    if (!id || seen.has(id)) return false;
    seen.add(id);
    return true;
  });
}

/**
 * Loading and error states take precedence over cached rows. This prevents a
 * deleted/generated course from looking current while a refetch is in flight
 * or after the service has reported an error.
 */
export function focusedCourseListState(courses, { loading = false, error = null } = {}) {
  if (loading) return 'loading';
  if (error) return 'error';
  return focusedLiveCourses(courses).length > 0 ? 'ready' : 'empty';
}

export function focusedCourseById(courses, courseId) {
  if (typeof courseId !== 'string' || !courseId) return null;
  return focusedLiveCourses(courses).find((course) => course.id === courseId) || null;
}

export function focusedCourseRow(course) {
  const sections = Number.isInteger(course?.sections) ? course.sections : null;
  const hasProgress = Number.isFinite(course?.week)
    && Number.isFinite(course?.weeks)
    && course.weeks > 0;
  return {
    id: course?.id,
    name: course?.name || 'Untitled course',
    sections,
    status: course?.status,
    hasProgress,
    progress: hasProgress ? Math.max(0, Math.min(100, (course.week / course.weeks) * 100)) : null,
    week: hasProgress ? course.week : null,
    weeks: hasProgress ? course.weeks : null,
  };
}