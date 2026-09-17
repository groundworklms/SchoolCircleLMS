'use client';

import { useAuth } from '../_auth/AuthProvider';
import { useApiQuery } from '../_learning/useLearning';
import { courseFromRecord } from './learning-course-utils';

export { courseFromRecord } from './learning-course-utils';

/* Bridge from the shells to the persisted learning loop (/api/learning/*).
   Student course state is generated from the learning API. */
/* The learning API's generated course list for the signed-in account. Learners
   see APPROVED courses; instructors also see their own PENDING drafts. */
export function useLearningCourses() {
  const { ready, user } = useAuth();
  const enabled = Boolean(ready && user);
  const { data, loading, error, refetch } = useApiQuery('/courses', { enabled });
  const list = enabled && Array.isArray(data) ? data : [];
  const courses = list.map((entry) => courseFromRecord(entry));
  return {
    courses,
    learningCourses: courses,
    loading: enabled && loading,
    error: enabled ? error : null,
    enabled,
    refetch,
    refetchGenerated: refetch,
  };
}

/* A generated course, or null when the id matches neither. */
export function resolveCourse(id, learningCourses) {
  if (!id) return null;
  return (Array.isArray(learningCourses) ? learningCourses : []).find((course) => course.id === id) || null;
}
