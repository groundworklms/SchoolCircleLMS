'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { moveArrayItem } from './editor-pure.mjs';
import {
  apiError,
  errorMessage,
  LoadingError,
  requestJson,
  StatusPill,
  useAuthoringRequest,
} from './editor-shared';
import { IconButton } from './editor-shared';

function isCourseList(body) {
  return body && Array.isArray(body.courses);
}

function courseTitle(course) {
  return course?.draft?.title || course?.title || 'Untitled course';
}

export function CoursesPage({ request: requestProp }) {
  const request = useAuthoringRequest(requestProp);
  const router = useRouter();
  const [courses, setCourses] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [title, setTitle] = useState('');
  const [creating, setCreating] = useState(false);
  const [createError, setCreateError] = useState(null);

  const loadCourses = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const body = await requestJson(request, '/api/authoring/courses');
      if (!isCourseList(body)) throw apiError(null, 502, 'The authoring service returned an invalid course list.');
      setCourses(body.courses);
    } catch (nextError) {
      setError(nextError);
    } finally {
      setLoading(false);
    }
  }, [request]);

  useEffect(() => { void loadCourses(); }, [loadCourses]);

  const createCourse = async (event) => {
    event.preventDefault();
    const cleanTitle = title.trim();
    if (!cleanTitle || creating) return;
    setCreating(true);
    setCreateError(null);
    try {
      const body = await requestJson(request, '/api/authoring/courses', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ title: cleanTitle }),
      });
      if (!body?.course?.id) throw apiError(null, 502, 'The authoring service did not return the new course.');
      setTitle('');
      router.push(`/teach/courses/${encodeURIComponent(body.course.id)}`);
    } catch (nextError) {
      setCreateError(nextError);
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="authoring-root">
      <header className="authoring-topbar">
        <div>
          <p className="authoring-eyebrow">Instructor authoring</p>
          <h1>Courses</h1>
          <p className="authoring-subtitle">Create and maintain manual-first lessons without AI services.</p>
        </div>
        <Link href="/teach" className="authoring-btn ghost">Teaching home</Link>
      </header>

      <main className="authoring-main">
        <section className="authoring-panel authoring-create-panel" aria-labelledby="create-course-heading">
          <div>
            <p className="authoring-section-kicker">Start from scratch</p>
            <h2 id="create-course-heading">Create a course</h2>
            <p className="authoring-muted">You can add the summary, objectives, lessons, and blocks after creating it.</p>
          </div>
          <form className="authoring-create-form" onSubmit={createCourse}>
            <label htmlFor="new-course-title">Course title</label>
            <div className="authoring-form-row">
              <input
                id="new-course-title"
                value={title}
                onChange={(event) => setTitle(event.target.value)}
                placeholder="e.g. Field safety fundamentals"
                maxLength={160}
                disabled={creating}
              />
              <button className="authoring-btn" type="submit" disabled={creating || !title.trim()}>
                {creating ? 'Creating…' : 'Create course'}
              </button>
            </div>
            {createError && <p className="authoring-inline-error" role="alert">{errorMessage(createError, 'Unable to create the course.')}</p>}
          </form>
        </section>

        <section aria-labelledby="courses-heading">
          <div className="authoring-section-head">
            <div>
              <p className="authoring-section-kicker">Your work</p>
              <h2 id="courses-heading">Course drafts</h2>
            </div>
            <button type="button" className="authoring-btn ghost small" onClick={() => void loadCourses()} disabled={loading}>
              Refresh
            </button>
          </div>
          <LoadingError loading={loading} error={error} onRetry={() => void loadCourses()}>
            {courses.length === 0 ? (
              <div className="authoring-empty">
                <h3>No manual courses yet</h3>
                <p>Create a course above to begin authoring.</p>
              </div>
            ) : (
              <div className="authoring-course-list">
                {courses.map((course) => (
                  <button
                    type="button"
                    className="authoring-course-card"
                    key={course.id}
                    onClick={() => router.push(`/teach/courses/${encodeURIComponent(course.id)}`)}
                  >
                    <span className="authoring-course-card-main">
                      <strong>{courseTitle(course)}</strong>
                      <span>{course.draft?.summary || 'No summary yet.'}</span>
                      <small>{course.draft?.lessons?.length || 0} lesson{course.draft?.lessons?.length === 1 ? '' : 's'}</small>
                    </span>
                    <span className="authoring-course-card-side">
                      <StatusPill status={course.status} />
                      <span aria-hidden="true">→</span>
                    </span>
                  </button>
                ))}
              </div>
            )}
          </LoadingError>
        </section>
      </main>
    </div>
  );
}

export function LessonList({ lessons, selectedId, onSelect, onAdd, onChange, onDelete, onDuplicate, disabled }) {
  return (
    <aside className="authoring-lesson-sidebar" aria-label="Lessons">
      <div className="authoring-sidebar-heading">
        <div>
          <p className="authoring-section-kicker">Course structure</p>
          <h2>Lessons</h2>
        </div>
        <button type="button" className="authoring-btn small" onClick={onAdd} disabled={disabled}>Add lesson</button>
      </div>
      {lessons.length === 0 && (
        <div className="authoring-sidebar-empty">
          <p>Add a lesson to start arranging content.</p>
        </div>
      )}
      <ol className="authoring-lesson-list">
        {lessons.map((lesson, index) => (
          <li key={lesson.id}>
            <button
              type="button"
              className={`authoring-lesson-item${lesson.id === selectedId ? ' selected' : ''}`}
              onClick={() => onSelect(lesson.id)}
              disabled={disabled}
              aria-current={lesson.id === selectedId ? 'step' : undefined}
            >
              <span className="authoring-lesson-index">{index + 1}</span>
              <span className="authoring-lesson-name">{lesson.title || 'Untitled lesson'}</span>
            </button>
            <div className="authoring-lesson-actions">
              <IconButton label={`Move lesson ${index + 1} up`} onClick={() => onChange(moveArrayItem(lessons, index, -1))} disabled={disabled || index === 0}>↑</IconButton>
              <IconButton label={`Move lesson ${index + 1} down`} onClick={() => onChange(moveArrayItem(lessons, index, 1))} disabled={disabled || index === lessons.length - 1}>↓</IconButton>
              <IconButton label={`Duplicate lesson ${index + 1}`} onClick={() => onDuplicate(lesson)} disabled={disabled}>＋</IconButton>
              <IconButton label={`Delete lesson ${index + 1}`} onClick={() => onDelete(lesson)} disabled={disabled} danger>×</IconButton>
            </div>
          </li>
        ))}
      </ol>
    </aside>
  );
}

export function ResultsPanel({ results, loading, error, onRetry }) {
  return (
    <section className="authoring-panel authoring-results" aria-labelledby="results-heading">
      <div className="authoring-section-head">
        <div>
          <p className="authoring-section-kicker">Aggregate only</p>
          <h2 id="results-heading">Learner results</h2>
        </div>
        <button type="button" className="authoring-btn ghost small" onClick={onRetry} disabled={loading}>{loading ? 'Loading…' : 'Refresh results'}</button>
      </div>
      {error && <p className="authoring-inline-error" role="alert">{errorMessage(error, 'Unable to load aggregate results.')}</p>}
      {loading && !results && <p className="authoring-muted">Loading aggregate results…</p>}
      {results && (
        <>
          <div className="authoring-result-tiles">
            <div><strong>{results.learners ?? 0}</strong><span>Learners</span></div>
            <div><strong>{results.completed ?? 0}</strong><span>Completed</span></div>
          </div>
          <div className="authoring-table-wrap">
            <table className="authoring-table">
              <caption className="sr-only">Aggregate block results</caption>
              <thead><tr><th scope="col">Block</th><th scope="col">Responses</th><th scope="col">Accuracy</th></tr></thead>
              <tbody>
                {(results.blocks || []).map((block) => (
                  <tr key={block.blockId}>
                    <th scope="row"><code>{block.blockId}</code></th>
                    <td>{block.responses ?? 0}</td>
                    <td>{block.accuracy == null ? 'Suppressed' : `${block.accuracy}%`}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="authoring-muted authoring-privacy-note">Accuracy is suppressed when fewer than five distinct learners are represented.</p>
        </>
      )}
    </section>
  );
}
