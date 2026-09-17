/* Disclosure state for the instructor's sample-course menu.
   This is kept separate from the learner course tree so the instructor rail
   can change without changing student destinations or their state. */

export function initialExpandedCourseIds(courseId) {
  return courseId ? { [courseId]: true } : {};
}

export function toggleExpandedCourse(expandedCourseIds, courseId) {
  return {
    ...expandedCourseIds,
    [courseId]: !expandedCourseIds[courseId],
  };
}

export function expandCourse(expandedCourseIds, courseId) {
  return {
    ...expandedCourseIds,
    [courseId]: true,
  };
}

export function expandOnCourseSelection(expandedCourseIds, previousCourseId, selectedCourseId) {
  if (selectedCourseId && selectedCourseId !== previousCourseId) {
    return expandCourse(expandedCourseIds, selectedCourseId);
  }
  return expandedCourseIds;
}
