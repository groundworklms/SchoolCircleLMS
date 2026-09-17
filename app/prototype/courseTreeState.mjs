/* Pure state helpers for the enrolled-course disclosure tree. Keeping these
   separate from React makes the navigation behavior easy to test and keeps
   route construction in StudentShell. */

export const COURSE_NAV = [
  { id: 'home', label: 'Home' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'path', label: 'Learning Path' },
  { id: 'materials', label: 'Study Materials' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'grades', label: 'Grades' },
  { id: 'discussions', label: 'Discussions' },
  { id: 'live', label: 'Live Session' },
  { id: 'progress', label: 'My Progress' },
];

export function coursePanelId(courseId) {
  // Encoding rather than replacing punctuation keeps IDs unique: `a/b` and
  // `a-b` must not share an aria-controls target when courses are generated.
  return `course-nav-${encodeURIComponent(String(courseId))}`;
}

export function initialExpandedCourseIds(courseId) {
  return courseId !== null && courseId !== undefined && String(courseId)
    ? { [courseId]: true }
    : {};
}

export function toggleExpandedCourse(expandedCourseIds, courseId) {
  if (courseId === null || courseId === undefined || !String(courseId)) return expandedCourseIds;
  return {
    ...expandedCourseIds,
    [courseId]: !expandedCourseIds[courseId],
  };
}

export function expandCourse(expandedCourseIds, courseId) {
  if (courseId === null || courseId === undefined || !String(courseId)) return expandedCourseIds;
  return {
    ...expandedCourseIds,
    [courseId]: true,
  };
}

export function expandOnCourseSelection(expandedCourseIds, previousCourseId, selectedCourseId) {
  if (
    selectedCourseId !== null
    && selectedCourseId !== undefined
    && String(selectedCourseId)
    && selectedCourseId !== previousCourseId
  ) {
    return expandCourse(expandedCourseIds, selectedCourseId);
  }
  return expandedCourseIds;
}

/* The API list is authoritative for which disclosure entries still exist.
   Returning the original object when nothing changed is important here: the
   caller can safely run this during list refreshes without causing a render
   loop.  Course IDs are normalized because URL params are strings while an
   API double may provide numeric IDs. */
export function pruneExpandedCourseIds(expandedCourseIds, courseIds) {
  const available = new Set(
    courseIds
      .filter((id) => id !== null && id !== undefined && String(id))
      .map((id) => String(id)),
  );
  const entries = Object.entries(expandedCourseIds);
  const retained = entries.filter(([id]) => available.has(String(id)));
  if (retained.length === entries.length) return expandedCourseIds;
  return Object.fromEntries(retained);
}

export function courseNavDestination(courseId, view) {
  return {
    area: 'course',
    courseId,
    view,
    lessonId: null,
    page: null,
    threadId: null,
  };
}