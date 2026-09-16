'use client';

import Link from 'next/link';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { useAuth } from '../../_auth/AuthProvider';
import { createLibraryTransport, messageForError } from './client';
import './library.css';

function LoadingState({ label = 'Loading course library…' }) {
  return <div className="manual-library-state" role="status">{label}</div>;
}

function SignInState() {
  return (
    <div className="manual-library-state manual-auth-notice">
      <h2>Sign-in required</h2>
      <p>Sign in with any SchoolCircle account to view published courses.</p>
      <Link className="manual-reader-back" href="/login?next=%2Flearn%2Flibrary">Sign in</Link>
    </div>
  );
}

export function LibraryList({ request, user: providedUser } = {}) {
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
        <h2>Unable to load courses</h2>
        <p>{messageForError(error, 'The course library is temporarily unavailable.')}</p>
        <button type="button" onClick={() => load()} disabled={loading}>Try again</button>
      </div>
    );
  }

  return (
    <div className="manual-library">
      <div className="manual-library-inner">
        <header className="manual-library-header">
          <h1>Course library</h1>
          <p>Published lessons from your SchoolCircle instructors.</p>
        </header>
        {error ? (
          <div className="manual-library-error" role="alert">
            {messageForError(error, 'We could not refresh the library.')}
            <button type="button" onClick={() => load()} disabled={loading}>Retry</button>
          </div>
        ) : null}
        {courses?.length ? (
          <div className="manual-library-grid">
            {courses.map((course) => (
              <Link className="manual-course-card" href={`/learn/library/${encodeURIComponent(course.id)}`} key={course.id}>
                <h2>{course.title || 'Untitled course'}</h2>
                <p>{course.summary || 'Open this published course to begin.'}</p>
                <div className="manual-course-card-footer">
                  <span>{course.publishedReleaseId ? 'Published' : 'Available'}</span>
                  <span>Open course&nbsp; →</span>
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <div className="manual-library-state">
            <h2>No published courses yet</h2>
            <p>Your instructors’ published courses will appear here.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export default function LibraryPage() {
  return <LibraryList />;
}