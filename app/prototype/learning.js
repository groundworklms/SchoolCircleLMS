'use client';

import { useEffect, useState } from 'react';
import { useAuth } from '../_auth/AuthProvider';
import { useApiQuery } from '../_learning/useLearning';
import { authFetch } from '../../lib/firebase';
import { COURSES } from './data';
import { courseFromRecord } from './learning-course-utils';

export { courseFromRecord } from './learning-course-utils';

/* Bridge from the shells to the persisted learning loop (/api/learning/*).

   A course on screen is one of three things:
     - a mock course from data.js, keyed like 'M092721', with hand-written
       mastery / AAR / lesson content for the click-through demo; or
     - a real COURSE_DRAFT LearningRecord (Coursewright output an instructor
       drafted and approved), keyed by its record id; or
      - a legacy instructor-owned MANUAL_COURSE from the read-only authoring
        service list. Legacy records remain available to the roster, but are
        never sent to the AI course editor.
   `resolveCourse` returns a shell-shaped object for either. Real courses carry
   `record` so a screen can tell which it has and draw from the API instead of
   the mock. Mock screens never call the API with a mock id; real screens never
   fall back to mock numbers — they show what the evidence supports or say so. */

export function isMockCourseId(id) {
  return Boolean(id && COURSES[id]);
}

/* The learning API's course list for the signed-in account. Learners see
   APPROVED courses; instructors also see their own PENDING drafts. The
   legacy manual list is opt-in because StudentShell must never receive an
   instructor's unpublished manual courses. The merged `courses` array is
   convenient for instructor navigation; callers that render the AI draft
   library filter out `manual` records. */
function useManualCourses(enabled) {
  const [state, setState] = useState({ courses: [], loading: false, error: null });
  // This list is fetched by hand rather than through useApiQuery, so it needs
  // its own reload trigger. Without one it loads once and never updates --
  // removing a legacy course succeeded on the server while its row stayed on
  // screen, which is indistinguishable from the delete not working.
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!enabled) {
      setState({ courses: [], loading: false, error: null });
      return undefined;
    }
    const controller = new AbortController();
    setState({ courses: [], loading: true, error: null });
    authFetch('/api/authoring/courses', { signal: controller.signal })
      .then(async (response) => {
        let body = null;
        try {
          body = await response.json();
        } catch {
          // The explicit status below is more useful than a JSON parse error.
        }
        if (controller.signal.aborted) return;
        if (!response.ok) throw new Error(body?.error || body?.message || `Unable to load manual courses (${response.status})`);
        if (!Array.isArray(body?.courses)) throw new Error('Authoring service returned an invalid course list.');
        setState({
          courses: body.courses.map((entry) => courseFromRecord(entry, 'manual')),
          loading: false,
          error: null,
        });
      })
      .catch((error) => {
        if (error?.name === 'AbortError' || controller.signal.aborted) return;
        setState({ courses: [], loading: false, error });
      });
    return () => controller.abort();
  }, [enabled, reload]);

  return { ...state, refetch: () => setReload((n) => n + 1) };
}

export function useLearningCourses({ includeManual = false } = {}) {
  const { ready, user, profile } = useAuth();
  const enabled = Boolean(ready && user);
  const manualEnabled = Boolean(includeManual && enabled && ['INSTRUCTOR', 'BOTH'].includes(profile?.role));
  const { data, loading, error, refetch } = useApiQuery('/courses', { enabled });
  const manual = useManualCourses(manualEnabled);
  const list = enabled && Array.isArray(data) ? data : [];
  const learningCourses = list.map((entry) => courseFromRecord(entry));
  const manualCourses = manualEnabled ? manual.courses : [];
  const byId = new Map();
  [...learningCourses, ...manualCourses].forEach((course) => {
    if (!byId.has(course.id)) byId.set(course.id, course);
  });
  return {
    courses: [...byId.values()],
    learningCourses,
    manualCourses,
    loading: enabled && loading,
    error: enabled ? error : null,
    manualLoading: manualEnabled && manual.loading,
    manualError: manualEnabled ? manual.error : null,
    manualEnabled,
    enabled,
    // Refresh BOTH lists. Callers use this after a change that could touch
    // either -- a removal especially -- and refreshing only the generated
    // courses left legacy rows behind.
    refetch: async () => {
      const generated = refetch();
      manual.refetch?.();
      return generated;
    },
    refetchGenerated: refetch,
  };
}

/* A mock course or a real one, or null when the id matches neither. */
export function resolveCourse(id, learningCourses) {
  if (!id) return null;
  if (COURSES[id]) return COURSES[id];
  return learningCourses.find((c) => c.id === id) || null;
}
