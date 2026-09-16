'use client';

import { useAuth } from '../_auth/AuthProvider';
import { useApiQuery } from '../_learning/useLearning';
import { COURSES } from './data';

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

/* The learning API's course list for the signed-in account. Learners see
   APPROVED courses; instructors also see their own PENDING drafts. Off (empty)
   when Firebase is not configured or nobody is signed in — the learning routes
   answer 401 without a verified identity, so there is nothing to ask for. */
export function useLearningCourses() {
  const { ready, user } = useAuth();
  const enabled = Boolean(ready && user);
  const { data, loading, error, refetch } = useApiQuery('/courses', { enabled });
  const list = enabled && Array.isArray(data) ? data : [];
  return {
    courses: list.map(courseFromRecord),
    loading: enabled && loading,
    error: enabled ? error : null,
    enabled,
    refetch,
  };
}

/* Shell-shaped view of a course list entry from GET /api/learning/courses. The
   fields the rail and crumbs read (id, name, school) are always present; the
   demo-only numbers (week, students, topics…) are deliberately absent so a
   screen that needs them can tell it has a real course. */
export function courseFromRecord(entry) {
  return {
    id: entry.id,
    name: entry.title || 'Untitled course',
    school: entry.status === 'APPROVED' ? 'Approved · cited course' : 'Draft · awaiting approval',
    status: entry.status,
    sections: entry.sections || 0,
    sourceIds: entry.sourceIds || [],
    record: entry,
  };
}

/* A mock course or a real one, or null when the id matches neither. */
export function resolveCourse(id, learningCourses) {
  if (!id) return null;
  if (COURSES[id]) return COURSES[id];
  return learningCourses.find((c) => c.id === id) || null;
}
