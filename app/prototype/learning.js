'use client';

import { useAuth } from '../_auth/AuthProvider';
import { useApiQuery } from '../_learning/useLearning';
import { COURSES } from './data';
import { courseFromRecord } from './learning-course-utils';

export { courseFromRecord } from './learning-course-utils';

/* Bridge from the shells to the persisted learning loop (/api/learning/*).

   A course on screen is one of two things:
     - a mock course from data.js, keyed like 'M092721', with hand-written
       mastery / AAR / lesson content for the click-through demo; or
      - a real COURSE_DRAFT LearningRecord (Coursewright output an instructor
        drafted and approved), keyed by its record id.
   `resolveCourse` returns a shell-shaped object for either. Real courses carry
   `record` so a screen can tell which it has and draw from the API instead of
   the mock. Mock screens never call the API with a mock id; real screens never
   fall back to mock numbers — they show what the evidence supports or say so. */

export function isMockCourseId(id) {
  return Boolean(id && COURSES[id]);
}

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

/* A mock course or a real one, or null when the id matches neither. */
export function resolveCourse(id, learningCourses) {
  if (!id) return null;
  if (COURSES[id]) return COURSES[id];
  return learningCourses.find((c) => c.id === id) || null;
}
