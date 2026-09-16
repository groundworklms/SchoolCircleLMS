'use client';

import { Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import CourseLesson from '../../_course/CoursePresentation';
import { useAuth } from '../../_auth/AuthProvider';
import { publishedCourseHref } from '../nav';
import {
  createLibraryTransport,
  createSessionEpochGuard,
  createStaleSessionError,
  createStableAttemptManager,
  messageForError,
} from './client';
import './library.css';

function LoadingState() {
  return <div className="manual-library-state" role="status">Loading published course…</div>;
}

function SignInState({ courseId }) {
  const query = typeof window === 'undefined' ? '' : window.location.search;
  const next = `${publishedCourseHref(courseId)}${query}`;
  return (
    <div className="manual-library-state manual-auth-notice">
      <h2>Sign-in required</h2>
      <p>Sign in with any SchoolCircle account to view this course.</p>
      <a className="manual-reader-back" href={`/login?next=${encodeURIComponent(next)}`}>Sign in</a>
    </div>
  );
}

function courseLessons(content) {
  if (Array.isArray(content?.lessons)) return content.lessons;
  if (Array.isArray(content?.blocks)) return [content];
  if (content?.lesson && typeof content.lesson === 'object') return [content.lesson];
  return [];
}

function lessonIndexFor(content, requestedLesson) {
  const lessons = courseLessons(content);
  if (!requestedLesson) return 0;
  const byId = lessons.findIndex((lesson) => String(lesson?.id || '') === String(requestedLesson));
  if (byId >= 0) return byId;
  const number = Number(requestedLesson);
  if (Number.isInteger(number) && number > 0 && number <= lessons.length) return number - 1;
  return 0;
}

function returnedProgress(response) {
  if (response?.progress) return response.progress;
  if (response && Array.isArray(response.completedBlockIds)) return response;
  return null;
}

function BackButton({ onBack }) {
  if (onBack) {
    return (
      <button type="button" className="manual-reader-back" onClick={onBack}>
        ← Courses
      </button>
    );
  }
  return <a className="manual-reader-back" href="/prototype/courses">← Courses</a>;
}

/**
 * The published manual reader as a screen inside StudentShell.
 *
 * The reader gets its Firebase user from useAuth but accepts request and user
 * injection points for a browser harness. Instructors and BOTH accounts are
 * valid library readers too; authorization remains in the API transport.
 */
export function CourseReader({ courseId, request, user: providedUser, onBack } = {}) {
  const auth = useAuth();
  const user = providedUser || auth.user;
  const authLoading = auth.loading;
  const router = useRouter();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const requestedReleaseId = searchParams.get('releaseId') || searchParams.get('release') || '';
  const requestedLesson = searchParams.get('lesson') || searchParams.get('lessonId') || '';
  const [envelope, setEnvelope] = useState(null);
  const [progress, setProgress] = useState(null);
  const [lessonIndex, setLessonIndex] = useState(0);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [saving, setSaving] = useState({});
  const transport = useMemo(() => createLibraryTransport({ user, request }), [user, request]);
  const releaseId = envelope?.release?.id || requestedReleaseId;
  const sessionGuardRef = useRef(null);
  if (!sessionGuardRef.current) sessionGuardRef.current = createSessionEpochGuard();
  // This runs during render so a route/account transition invalidates an old
  // mutation before a late promise continuation can publish state.
  const sessionKey = JSON.stringify({
    user: user?.uid || user?.email || null,
    courseId: courseId || null,
    requestedReleaseId,
    releaseId: releaseId || null,
  });
  sessionGuardRef.current.update(sessionKey);
  const renderedSessionToken = sessionGuardRef.current.capture();

  const load = useCallback(async (signal) => {
    if (!user || !courseId) {
      if (!user) {
        setLoading(false);
        return;
      }
      setError(new Error('A published course ID is required.'));
      setLoading(false);
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const nextEnvelope = await transport.course(courseId, requestedReleaseId, signal);
      if (signal?.aborted) return;
      if (!nextEnvelope?.release) throw new Error('The course response did not include a published release.');
      setEnvelope(nextEnvelope);
      setProgress(nextEnvelope.progress || null);
      setLessonIndex(0);
      // The first successful read chooses the exact immutable release. Keep
      // that id in the address bar so a refresh remains on the same snapshot
      // even if the instructor publishes a newer release in the meantime.
      if (!requestedReleaseId && nextEnvelope.release.id) {
        const query = new URLSearchParams(
          typeof window === 'undefined' ? '' : window.location.search,
        );
        query.set('releaseId', nextEnvelope.release.id);
        const queryText = query.toString();
        router.replace(`${pathname}${queryText ? `?${queryText}` : ''}`, { scroll: false });
      }
    } catch (nextError) {
      if (signal?.aborted || nextError?.name === 'AbortError') return;
      setError(nextError);
      setEnvelope(null);
      setProgress(null);
    } finally {
      if (!signal?.aborted) setLoading(false);
    }
  }, [courseId, pathname, requestedReleaseId, router, transport, user]);

  useEffect(() => {
    const controller = new AbortController();
    // A course/account transition must not let an earlier response overwrite
    // the new reader. Abort plus the dependency-bound transport handles both.
    setEnvelope(null);
    setProgress(null);
    setLessonIndex(0);
    setSaving({});
    load(controller.signal);
    return () => controller.abort();
  }, [load]);

  const lessons = useMemo(() => courseLessons(envelope?.release?.content), [envelope]);
  const lesson = lessons[lessonIndex] || null;

  useEffect(() => {
    if (envelope) setLessonIndex(lessonIndexFor(envelope.release?.content, requestedLesson));
  }, [envelope, requestedLesson]);

  const selectLesson = useCallback((index) => {
    setLessonIndex(index);
    const query = new URLSearchParams(
      typeof window === 'undefined' ? '' : window.location.search,
    );
    const selected = lessons[index];
    if (selected?.id) query.set('lesson', selected.id);
    else query.set('lesson', String(index + 1));
    const queryText = query.toString();
    router.replace(`${pathname}${queryText ? `?${queryText}` : ''}`, { scroll: false });
  }, [lessons, pathname, router]);

  const sendAttempt = useMemo(
    () => createStableAttemptManager(
      (blockId, optionId, attemptId) => transport.answer(courseId, {
        releaseId,
        blockId,
        optionId,
        attemptId,
      }),
    ),
    [courseId, releaseId, transport],
  );

  const onAnswer = useCallback(async (blockId, optionId, attemptId) => {
    // Capture the render's epoch, not the epoch at invocation time. An old
    // ManualLesson callback retained by a late event must not start a write
    // into the new account/course/release session.
    const sessionToken = renderedSessionToken;
    if (!sessionGuardRef.current.isCurrent(sessionToken)) throw createStaleSessionError();
    setSaving((current) => ({ ...current, [blockId]: true }));
    setError(null);
    try {
      if (!sessionGuardRef.current.isCurrent(sessionToken)) throw createStaleSessionError();
      const response = await sendAttempt(blockId, optionId, attemptId);
      if (!sessionGuardRef.current.isCurrent(sessionToken)) throw createStaleSessionError();
      const nextProgress = returnedProgress(response);
      if (nextProgress) setProgress(nextProgress);
      return response;
    } catch (nextError) {
      if (!sessionGuardRef.current.isCurrent(sessionToken)) throw createStaleSessionError();
      if (nextError?.name !== 'AbortError') setError(nextError);
      throw nextError;
    } finally {
      if (sessionGuardRef.current.isCurrent(sessionToken)) {
        setSaving((current) => ({ ...current, [blockId]: false }));
      }
    }
  }, [renderedSessionToken, sendAttempt]);

  const onComplete = useCallback(async (blockId) => {
    const sessionToken = renderedSessionToken;
    if (!sessionGuardRef.current.isCurrent(sessionToken)) throw createStaleSessionError();
    setSaving((current) => ({ ...current, [blockId]: true }));
    setError(null);
    try {
      if (!sessionGuardRef.current.isCurrent(sessionToken)) throw createStaleSessionError();
      const response = await transport.complete(courseId, { releaseId, blockId });
      if (!sessionGuardRef.current.isCurrent(sessionToken)) throw createStaleSessionError();
      const nextProgress = returnedProgress(response);
      if (nextProgress) setProgress(nextProgress);
      return response;
    } catch (nextError) {
      if (!sessionGuardRef.current.isCurrent(sessionToken)) throw createStaleSessionError();
      if (nextError?.name !== 'AbortError') setError(nextError);
      throw nextError;
    } finally {
      if (sessionGuardRef.current.isCurrent(sessionToken)) {
        setSaving((current) => ({ ...current, [blockId]: false }));
      }
    }
  }, [courseId, releaseId, renderedSessionToken, transport]);

  if (authLoading) return <div className="manual-reader"><div className="manual-reader-inner"><LoadingState /></div></div>;
  if (!user) return <div className="manual-reader"><div className="manual-reader-inner"><SignInState courseId={courseId} /></div></div>;
  if (loading && !envelope) return <div className="manual-reader"><div className="manual-reader-inner"><LoadingState /></div></div>;
  if (error && !envelope) {
    return (
      <div className="manual-reader">
        <div className="manual-reader-inner">
          <div className="manual-library-state manual-library-error" role="alert">
            <h2>Unable to load this course</h2>
            <p>{messageForError(error, 'The published course is temporarily unavailable.')}</p>
            <button type="button" onClick={() => load()} disabled={loading}>Try again</button>
          </div>
        </div>
      </div>
    );
  }

  const content = envelope?.release?.content || {};
  const title = content.title || envelope?.release?.title || 'Published course';
  const completedCount = progress?.completed ?? progress?.completedBlockIds?.length ?? 0;
  const total = progress?.total || 0;

  return (
    <div className="manual-reader">
      <div className="manual-reader-inner">
        <div className="manual-reader-top">
          <BackButton onBack={onBack} />
          <h1>{title}</h1>
        </div>
        {content.summary ? <p className="manual-reader-summary">{content.summary}</p> : null}
        {error ? (
          <div className="manual-reader-error" role="alert">
            {messageForError(error, 'The last save failed. Choose the answer or completion action again to retry.')}
          </div>
        ) : null}
        <div className="manual-reader-layout">
          <nav className="manual-reader-nav" aria-label="Course lessons">
            <h2>Lessons</h2>
            {lessons.map((item, index) => (
              <button
                type="button"
                className={index === lessonIndex ? 'is-active' : ''}
                key={item.id || item.lessonId || item.title || 'lesson'}
                onClick={() => selectLesson(index)}
                aria-current={index === lessonIndex ? 'page' : undefined}
              >
                {item.title || `Lesson ${index + 1}`}
              </button>
            ))}
            <p className="manual-reader-progress">
              {total ? `${completedCount} of ${total} blocks complete` : 'Progress saved as you learn'}
              {typeof progress?.percent === 'number' ? ` · ${progress.percent}%` : ''}
            </p>
          </nav>
          <main className="manual-reader-content">
            {Object.values(saving).some(Boolean) ? <p className="manual-reader-saving" role="status">Saving progress…</p> : null}
            {lesson ? (
              <CourseLesson
                content={lesson}
                progress={progress}
                onAnswer={onAnswer}
                onComplete={onComplete}
                busy={saving}
              />
            ) : (
              <div className="manual-library-state">
                <h2>This course has no lessons</h2>
                <p>The instructor has not added usable lesson content to this release.</p>
              </div>
            )}
          </main>
        </div>
      </div>
    </div>
  );
}

export function PublishedCourseReader(props) {
  return (
    <Suspense fallback={<div className="manual-reader"><div className="manual-reader-inner"><LoadingState /></div></div>}>
      <CourseReader {...props} />
    </Suspense>
  );
}

export default PublishedCourseReader;