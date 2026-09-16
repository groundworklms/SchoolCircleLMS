'use client';

import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../_auth/AuthProvider';
import { publishedCourseHref } from '../nav';
import { createLibraryTransport, messageForError } from './client';
import './library.css';

function LoadingState({ label = 'Loading published course library…' }) {
  return <div className="manual-library-state" role="status">{label}</div>;
}

function SignInState() {
  return (
    <div className="manual-library-state manual-auth-notice">
      <h2>Sign-in required</h2>
      <p>Sign in with any SchoolCircle account to view published courses.</p>
      <a className="manual-reader-back" href="/login?next=%2Fprototype%2Fcourses">Sign in</a>
    </div>
  );
}

function CourseCard({ course, onOpen }) {
  const href = publishedCourseHref(course.id);
  const open = (event) => {
    if (!onOpen) return;
    event.preventDefault();
    onOpen(course.id);
  };

  return (
    <a className="manual-course-card" href={href} onClick={open}>
      <h2>{course.title || 'Untitled published course'}</h2>
      <p>{course.summary || 'Open this published course to begin.'}</p>
      <div className="manual-course-card-footer">
        <span>{course.publishedReleaseId ? 'Published manual course' : 'Published course'}</span>
        <span>Open course&nbsp; →</span>
      </div>
    </a>
  );
}

/**
 * The manual authoring library as a section inside the student shell.
 *
 * `onOpen` is optional so the component remains usable in a small harness, but
 * the shell supplies it to keep navigation URL-backed without mounting a
 * second page or shell.
 */
export function LibraryList({ request, user: providedUser, onOpen } = {}) {
  const auth = useAuth();
  const user = providedUser || auth.user;
  const authLoading = auth.loading;
  const [courses, setCourses] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);
  const transport = useMemo(() => createLibraryTransport({ user, request }), [user, request]);

  const load = useCallback(async (signal) => {
    if (!user) {
      setCourses(null);
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const response = await transport.library(signal);
      if (signal?.aborted) return;
      setCourses(Array.isArray(response?.courses) ? response.courses : []);
    } catch (nextError) {
      if (signal?.aborted || nextError?.name === 'AbortError') return;
      setError(nextError);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [transport, user]);

  useEffect(() => {
    const controller = new AbortController();
    // Clearing before a new account's result arrives prevents the previous
    // account's library from flashing during an auth transition.
    setCourses(null);
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  if (authLoading) return <LoadingState label="Checking your sign-in…" />;
  if (!user) return <SignInState />;
  if (loading && !courses) return <LoadingState />;
  if (error && !courses) {
    return (
      <div className="manual-library-state manual-library-error" role="alert">
        <h2>Unable to load published courses</h2>
        <p>{messageForError(error, 'The published course library is temporarily unavailable.')}</p>
        <button type="button" onClick={() => load()} disabled={loading}>Try again</button>
      </div>
    );
  }

  return (
    <section className="manual-library" aria-labelledby="published-course-library-title">
      <div className="manual-library-inner">
        <header className="manual-library-header">
          <h2 id="published-course-library-title">Published manual courses</h2>
          <p>Published lessons from your SchoolCircle instructors.</p>
        </header>
        {error ? (
          <div className="manual-library-error" role="alert">
            {messageForError(error, 'We could not refresh the published course library.')}
            <button type="button" onClick={() => load()} disabled={loading}>Retry</button>
          </div>
        ) : null}
        {courses?.length ? (
          <div className="manual-library-grid">
            {courses.map((course) => (
              <CourseCard course={course} key={course.id} onOpen={onOpen} />
            ))}
          </div>
        ) : (
          <div className="manual-library-state">
            <h3>No published manual courses yet</h3>
            <p>Your instructors’ published courses will appear here.</p>
          </div>
        )}
      </div>
    </section>
  );
}

export { CourseCard, LoadingState };
export default LibraryList;