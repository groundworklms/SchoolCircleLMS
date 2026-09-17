'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
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
function useManualCourses(enabled, { refreshOnFocus = false } = {}) {
  const [state, setState] = useState({ courses: [], loading: false, error: null });
  // This list is fetched by hand rather than through useApiQuery, so it needs
  // its own reload trigger. Without one it loads once and never updates --
  // removing a legacy course succeeded on the server while its row stayed on
  // screen, which is indistinguishable from the delete not working.
  const [reload, setReload] = useState(0);
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const reloadGenerationRef = useRef(0);
  const pendingRefetchesRef = useRef([]);
  const focusRequestRef = useRef(null);
  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      focusRequestRef.current = null;
      const pending = pendingRefetchesRef.current.splice(0);
      pending.forEach(({ resolve }) => resolve());
    };
  }, []);

  const fetchCourses = useCallback(async (signal, generation) => {
    if (!enabled || !enabledRef.current || !mountedRef.current) return undefined;
    const requestId = ++requestIdRef.current;
    const isCurrent = () => (
      mountedRef.current
      && enabledRef.current
      && reloadGenerationRef.current === generation
      && requestIdRef.current === requestId
      && !signal?.aborted
    );
    setState({ courses: [], loading: true, error: null });
    try {
      const response = await authFetch('/api/authoring/courses', { signal });
      let body = null;
      try {
        body = await response.json();
      } catch {
        // The explicit status below is more useful than a JSON parse error.
      }
      if (signal?.aborted || !isCurrent()) return { requestId, stale: true };
      if (!response.ok) throw new Error(body?.error || body?.message || `Unable to load manual courses (${response.status})`);
      if (!Array.isArray(body?.courses)) throw new Error('Authoring service returned an invalid course list.');
      const courses = body.courses.map((entry) => courseFromRecord(entry, 'manual'));
      if (!isCurrent()) return { requestId, stale: true };
      setState({ courses, loading: false, error: null });
      return { requestId, stale: false };
    } catch (error) {
      if (error?.name === 'AbortError' || !isCurrent()) return { requestId, stale: true };
      setState({ courses: [], loading: false, error });
      return { requestId, stale: false, failed: true };
    } finally {
      // A stale or aborted request must not clear a newer request's spinner.
      if (isCurrent()) {
        setState((current) => (
          requestIdRef.current === requestId && enabledRef.current && mountedRef.current
            ? { ...current, loading: false }
            : current
        ));
      }
    }
  }, [enabled]);

  useEffect(() => {
    if (!enabled) {
      setState({ courses: [], loading: false, error: null });
      requestIdRef.current += 1;
      const pending = pendingRefetchesRef.current.splice(0);
      pending.forEach(({ resolve }) => resolve());
      return undefined;
    }
    const controller = new AbortController();
    const requestGeneration = reload;
    const request = fetchCourses(controller.signal, requestGeneration);
    const requestId = requestIdRef.current;
    const isCurrentRequest = () => (
      !controller.signal.aborted
      && mountedRef.current
      && enabledRef.current
      && reloadGenerationRef.current === requestGeneration
      && requestIdRef.current === requestId
    );
    request.then((result) => {
      // Only the request that owns the current identity can settle waiters.
      if (!isCurrentRequest() || result?.requestId !== requestId) return;
      const pending = pendingRefetchesRef.current;
      pendingRefetchesRef.current = pending.filter(({ generation }) => generation > requestGeneration);
      pending
        .filter(({ generation }) => generation <= requestGeneration)
        .forEach(({ resolve }) => resolve());
    }).catch((error) => {
      // fetchCourses handles expected API failures, but preserve an explicit
      // error and settle the current waiter if an adapter throws unexpectedly.
      if (!isCurrentRequest()) return;
      setState({ courses: [], loading: false, error });
      const pending = pendingRefetchesRef.current;
      pendingRefetchesRef.current = pending.filter(({ generation }) => generation > requestGeneration);
      pending
        .filter(({ generation }) => generation <= requestGeneration)
        .forEach(({ resolve }) => resolve());
    });
    return () => {
      controller.abort();
      // Keep an adapter that ignores AbortSignal from publishing an old list.
      requestIdRef.current += 1;
    };
  }, [enabled, fetchCourses, reload]);

  const refetch = useCallback(() => {
    if (!enabled || !enabledRef.current || !mountedRef.current) return Promise.resolve(undefined);
    const generation = ++reloadGenerationRef.current;
    const promise = new Promise((resolve) => pendingRefetchesRef.current.push({ generation, resolve }));
    setReload((n) => n + 1);
    return promise;
  }, [enabled]);

  useEffect(() => {
    if (
      !refreshOnFocus
      || !enabled
      || typeof window === 'undefined'
      || typeof document === 'undefined'
    ) return undefined;
    const refresh = () => {
      if (document.visibilityState === 'hidden' || focusRequestRef.current) return;
      const request = Promise.resolve(refetch());
      focusRequestRef.current = request;
      request.finally(() => {
        if (focusRequestRef.current === request) focusRequestRef.current = null;
      });
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
      focusRequestRef.current = null;
    };
  }, [enabled, refreshOnFocus, refetch]);

  return { ...state, refetch };
}

export function useLearningCourses({ includeManual = false } = {}) {
  const { ready, user, profile } = useAuth();
  const enabled = Boolean(ready && user);
  const manualEnabled = Boolean(includeManual && enabled && ['INSTRUCTOR', 'BOTH'].includes(profile?.role));
  const { data, loading, error, refetch } = useApiQuery('/courses', {
    enabled,
    refreshOnFocus: true,
  });
  const manual = useManualCourses(manualEnabled, { refreshOnFocus: true });
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
    // useApiQuery starts with loading=false before its first effect runs.
    // Treat the absent response as loading, but let an actual error win so a
    // deleted/unavailable course reaches the shell's explicit error state.
    loading: enabled && !error && (loading || data === null),
    error: enabled ? error : null,
    manualLoading: manualEnabled && manual.loading,
    manualError: manualEnabled ? manual.error : null,
    manualEnabled,
    enabled,
    // Refresh BOTH lists. Callers use this after a change that could touch
    // either -- a removal especially -- and refreshing only the generated
    // courses left legacy rows behind.
    refetch: useCallback(async () => {
      const [generated] = await Promise.all([
        refetch(),
        manual.refetch?.(),
      ]);
      return generated;
    }, [manual.refetch, refetch]),
    refetchGenerated: refetch,
  };
}

/* A mock course or a real one, or null when the id matches neither. */
export function resolveCourse(id, learningCourses) {
  if (!id) return null;
  // Prefer the persisted projection when IDs overlap with a demo fixture.
  // Otherwise an AI course could render demo content after a refresh simply
  // because its ID happens to match one of the prototype samples.
  return learningCourses.find((c) => c.id === id) || COURSES[id] || null;
}
