'use client';

import { useRouter } from 'next/navigation';
import { useCallback, useEffect, useRef, useState } from 'react';
import ManualLesson from './ManualLesson';
import { useAuth } from '../_auth/AuthProvider';
import {
  apiError,
  errorMessage,
  LoadingError,
  requestJson,
  TextField,
  StatusPill,
  useAuthoringRequest,
} from './editor-shared';
import {
  cloneValue,
  authoringAccountKey,
  clearRecoveryBuffer,
  createRecoveryBuffer,
  duplicateWithFreshIds,
  isDraftDirty,
  moveArrayItem,
  newBlock,
  newLesson,
  normalizeCourse,
  normalizeDraft,
  readRecoveryBuffer,
  recoveryRemoteStatus,
  recoveryStorageKey,
  writeRecoveryBuffer,
} from './editor-pure.mjs';
import { BLOCK_TYPES, BlockEditor, ObjectiveEditor } from './editor-blocks';
import { LessonList, ResultsPanel } from './editor-list';

export function CourseEditorPage({ courseId, request: requestProp }) {
  const request = useAuthoringRequest(requestProp);
  const router = useRouter();
  const { user, profile } = useAuth();
  const accountKey = authoringAccountKey(profile, user);
  const recoveryKey = recoveryStorageKey(accountKey, courseId);
  const [course, setCourse] = useState(null);
  const [draft, setDraft] = useState(null);
  const [savedDraft, setSavedDraft] = useState(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(null);
  const [saveError, setSaveError] = useState(null);
  const [actionError, setActionError] = useState(null);
  const [pending, setPending] = useState(null);
  const [savedNotice, setSavedNotice] = useState('');
  const [selectedLessonId, setSelectedLessonId] = useState(null);
  const [previewOpen, setPreviewOpen] = useState(false);
  const [results, setResults] = useState(null);
  const [resultsError, setResultsError] = useState(null);
  const [resultsLoading, setResultsLoading] = useState(false);
  const [recoveryPrompt, setRecoveryPrompt] = useState(null);
  const [recoveryReady, setRecoveryReady] = useState(false);
  const stableHistoryRef = useRef(null);
  if (stableHistoryRef.current === null && typeof window !== 'undefined') {
    stableHistoryRef.current = { url: window.location.href, state: window.history.state };
  }

  const dirty = isDraftDirty(draft, savedDraft);
  const selectedLesson = draft?.lessons?.find((lesson) => lesson.id === selectedLessonId) || draft?.lessons?.[0] || null;

  const sessionStorage = () => {
    if (typeof window === 'undefined') return null;
    try {
      return window.sessionStorage;
    } catch {
      return null;
    }
  };

  const persistRecovery = useCallback(() => {
    if (!recoveryReady || recoveryPrompt || loading || !course || !draft || !savedDraft || !dirty) return;
    writeRecoveryBuffer(
      sessionStorage(),
      recoveryKey,
      createRecoveryBuffer({
        accountKey,
        courseId,
        version: course.version,
        draft,
      }),
    );
  }, [accountKey, course, courseId, dirty, draft, loading, recoveryKey, recoveryPrompt, recoveryReady, savedDraft]);

  const loadCourse = useCallback(async () => {
    setLoading(true);
    setLoadError(null);
    setRecoveryReady(false);
    setRecoveryPrompt(null);
    try {
      const body = await requestJson(request, `/api/authoring/courses/${encodeURIComponent(courseId)}`);
      const nextCourse = normalizeCourse(body.course);
      const storedRecovery = readRecoveryBuffer(sessionStorage(), recoveryKey);
      setCourse(nextCourse);
      setDraft(nextCourse.draft);
      setSavedDraft(cloneValue(nextCourse.draft));
      setSelectedLessonId(nextCourse.draft.lessons[0]?.id || null);
      if (
        storedRecovery
        && storedRecovery.accountKey === accountKey
        && storedRecovery.courseId === String(courseId)
      ) {
        setRecoveryPrompt({
          buffer: storedRecovery,
          remoteVersion: nextCourse.version,
          status: recoveryRemoteStatus(storedRecovery, nextCourse.version),
        });
      }
      setRecoveryReady(true);
    } catch (nextError) {
      setLoadError(nextError);
    } finally {
      setLoading(false);
    }
  }, [accountKey, courseId, recoveryKey, request]);

  useEffect(() => { void loadCourse(); }, [loadCourse]);

  useEffect(() => {
    persistRecovery();
  }, [persistRecovery]);

  useEffect(() => {
    if (typeof window === 'undefined') return undefined;
    const beforeUnload = (event) => {
      if (!dirty) return;
      persistRecovery();
      event.preventDefault();
      event.returnValue = '';
    };
    const guardNavigation = (event) => {
      if (!dirty || event.defaultPrevented || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      persistRecovery();
      const anchor = event.target.closest?.('a[href]');
      if (!anchor || anchor.target === '_blank' || anchor.hasAttribute('download')) return;
      const destination = new URL(anchor.href, window.location.href);
      if (destination.origin !== window.location.origin || destination.href === window.location.href) return;
      if (!window.confirm('You have unsaved edits. Leave without saving?')) {
        event.preventDefault();
        event.stopPropagation();
        return;
      }
      // Next's delegated click handler may still navigate after this guard.
      // Do not replace the history entry or silently discard the edits here.
    };
    const guardHistoryNavigation = () => {
      if (!dirty) {
        stableHistoryRef.current = { url: window.location.href, state: window.history.state };
        return;
      }
      persistRecovery();
      const current = stableHistoryRef.current || { url: window.location.href, state: window.history.state };
      if (window.confirm('You have unsaved edits. Leave without saving?')) {
        stableHistoryRef.current = { url: window.location.href, state: window.history.state };
        return;
      }
      // popstate cannot be cancelled. Restore only this editor entry after
      // the user declines; the next back/forward can be confirmed again.
      window.history.pushState(current.state, '', current.url);
    };
    window.addEventListener('beforeunload', beforeUnload);
    document.addEventListener('click', guardNavigation, true);
    window.addEventListener('popstate', guardHistoryNavigation);
    return () => {
      window.removeEventListener('beforeunload', beforeUnload);
      document.removeEventListener('click', guardNavigation, true);
      window.removeEventListener('popstate', guardHistoryNavigation);
    };
  }, [dirty, persistRecovery]);

  const leaveEditor = () => {
    if (dirty && typeof window !== 'undefined' && !window.confirm('You have unsaved edits. Leave without saving?')) return;
    router.push('/teach/courses');
  };

  const updateDraft = (updater) => {
    setSavedNotice('');
    setSaveError(null);
    setActionError(null);
    setDraft((current) => (typeof updater === 'function' ? updater(current) : updater));
  };

  const saveDraft = async () => {
    if (!course || !draft || pending) return;
    setPending('save');
    setSaveError(null);
    setSavedNotice('');
    try {
      const body = await requestJson(request, `/api/authoring/courses/${encodeURIComponent(course.id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: course.version, draft }),
      });
      const nextCourse = normalizeCourse(body.course);
      setCourse(nextCourse);
      setDraft(nextCourse.draft);
      setSavedDraft(cloneValue(nextCourse.draft));
      setSelectedLessonId((current) => nextCourse.draft.lessons.some((lesson) => lesson.id === current) ? current : (nextCourse.draft.lessons[0]?.id || null));
      clearRecoveryBuffer(sessionStorage(), recoveryKey);
      setRecoveryPrompt(null);
      setSavedNotice('Draft saved.');
    } catch (nextError) {
      setSaveError(nextError);
    } finally {
      setPending(null);
    }
  };

  const publish = async () => {
    if (!course || dirty || pending) return;
    if (typeof window !== 'undefined' && !window.confirm('Publish this course? Publishing freezes an immutable student version.')) return;
    setPending('publish');
    setActionError(null);
    try {
      const body = await requestJson(request, `/api/authoring/courses/${encodeURIComponent(course.id)}/publish`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: course.version }),
      });
      const nextCourse = normalizeCourse(body.course);
      if (nextCourse.status !== 'PUBLISHED') throw apiError(null, 502, 'The service did not confirm that this course was published.');
      setCourse(nextCourse);
      setDraft(nextCourse.draft);
      setSavedDraft(cloneValue(nextCourse.draft));
      setSavedNotice('Published. The student version is immutable.');
    } catch (nextError) {
      setActionError(nextError);
    } finally {
      setPending(null);
    }
  };

  const archive = async (archived) => {
    if (!course || dirty || pending) return;
    const message = archived
      ? 'Archive this course? Learner access will be hidden, while its history is retained.'
      : 'Restore this course and make its prior availability active again?';
    if (typeof window !== 'undefined' && !window.confirm(message)) return;
    setPending(archived ? 'archive' : 'restore');
    setActionError(null);
    try {
      const body = await requestJson(request, `/api/authoring/courses/${encodeURIComponent(course.id)}/archive`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ version: course.version, archived }),
      });
      const nextCourse = normalizeCourse(body.course);
      if (archived && nextCourse.status !== 'ARCHIVED') throw apiError(null, 502, 'The service did not confirm that this course was archived.');
      if (!archived && nextCourse.status === 'ARCHIVED') throw apiError(null, 502, 'The service did not confirm that this course was restored.');
      setCourse(nextCourse);
      setSavedNotice(archived ? 'Course archived.' : 'Course restored.');
    } catch (nextError) {
      setActionError(nextError);
    } finally {
      setPending(null);
    }
  };

  const loadResults = useCallback(async () => {
    setResultsLoading(true);
    setResultsError(null);
    try {
      const body = await requestJson(request, `/api/authoring/courses/${encodeURIComponent(courseId)}/results`);
      if (!body?.results || typeof body.results !== 'object') throw apiError(null, 502, 'The authoring service returned invalid aggregate results.');
      setResults(body.results);
    } catch (nextError) {
      setResultsError(nextError);
    } finally {
      setResultsLoading(false);
    }
  }, [courseId, request]);

  useEffect(() => {
    if (course?.status === 'PUBLISHED' || course?.status === 'ARCHIVED') void loadResults();
  }, [course?.status, loadResults]);

  const setLessons = (lessons) => {
    updateDraft((current) => ({ ...current, lessons }));
  };

  const addLesson = () => {
    const lesson = newLesson();
    updateDraft((current) => ({ ...current, lessons: [...current.lessons, lesson] }));
    setSelectedLessonId(lesson.id);
  };

  const duplicateLesson = (lesson) => {
    const copied = duplicateWithFreshIds(lesson);
    const index = draft.lessons.findIndex((item) => item.id === lesson.id);
    setLessons([...draft.lessons.slice(0, index + 1), copied, ...draft.lessons.slice(index + 1)]);
    setSelectedLessonId(copied.id);
  };

  const deleteLesson = (lesson) => {
    if (typeof window !== 'undefined' && !window.confirm(`Delete “${lesson.title || 'Untitled lesson'}”?`)) return;
    const remaining = draft.lessons.filter((item) => item.id !== lesson.id);
    setLessons(remaining);
    if (selectedLessonId === lesson.id) setSelectedLessonId(remaining[0]?.id || null);
  };

  const patchLesson = (changes) => {
    if (!selectedLesson) return;
    updateDraft((current) => ({
      ...current,
      lessons: current.lessons.map((lesson) => lesson.id === selectedLesson.id ? { ...lesson, ...changes } : lesson),
    }));
  };

  const addBlock = (type) => {
    if (!selectedLesson) return;
    patchLesson({ blocks: [...selectedLesson.blocks, newBlock(type)] });
  };

  const patchBlock = (blockIndex, nextBlock) => {
    patchLesson({ blocks: selectedLesson.blocks.map((block, index) => index === blockIndex ? nextBlock : block) });
  };

  const restoreRecovery = () => {
    if (!recoveryPrompt || pending) return;
    setDraft(normalizeDraft(recoveryPrompt.buffer.draft));
    setSaveError(null);
    setActionError(null);
    setSavedNotice('');
    setRecoveryPrompt(null);
  };

  const discardRecovery = () => {
    clearRecoveryBuffer(sessionStorage(), recoveryKey);
    setRecoveryPrompt(null);
  };

  if (loading || loadError || !course || !draft) {
    return (
      <div className="authoring-root">
        <div className="authoring-main">
          <button type="button" className="authoring-text-btn" onClick={leaveEditor}>← Courses</button>
          <LoadingError loading={loading} error={loadError} onRetry={() => void loadCourse()}>
            <p>Course data is unavailable.</p>
          </LoadingError>
        </div>
      </div>
    );
  }

  const controlsDisabled = Boolean(pending || recoveryPrompt);
  const canPublish = !dirty && course.status !== 'ARCHIVED';
  const canArchive = !dirty && course.status !== 'ARCHIVED';

  return (
    <div className="authoring-root">
      <header className="authoring-editor-header">
        <div className="authoring-editor-heading">
          <button type="button" className="authoring-text-btn" onClick={leaveEditor}>← Courses</button>
          <div>
            <p className="authoring-eyebrow">Manual course editor</p>
            <div className="authoring-title-line">
              <h1>{draft.title || 'Untitled course'}</h1>
              <StatusPill status={course.status} />
            </div>
            <p className="authoring-muted">Version {course.version ?? '—'} · {dirty ? 'Unsaved changes' : 'All changes saved'}</p>
          </div>
        </div>
        <div className="authoring-header-actions">
          <button type="button" className="authoring-btn ghost" onClick={() => setPreviewOpen(true)} disabled={controlsDisabled || !selectedLesson}>Preview lesson</button>
          <button type="button" className="authoring-btn" onClick={() => void saveDraft()} disabled={controlsDisabled || !dirty}>{pending === 'save' ? 'Saving…' : 'Save draft'}</button>
          {course.status !== 'ARCHIVED' && (
            <button type="button" className="authoring-btn dark" onClick={() => void publish()} disabled={controlsDisabled || !canPublish}>
              {pending === 'publish' ? 'Publishing…' : 'Publish'}
            </button>
          )}
          {course.status !== 'ARCHIVED' ? (
            <button type="button" className="authoring-btn ghost" onClick={() => void archive(true)} disabled={controlsDisabled || !canArchive}>
              {pending === 'archive' ? 'Archiving…' : 'Archive'}
            </button>
          ) : (
            <button type="button" className="authoring-btn ghost" onClick={() => void archive(false)} disabled={controlsDisabled || dirty}>
              {pending === 'restore' ? 'Restoring…' : 'Restore'}
            </button>
          )}
        </div>
      </header>

      <main className="authoring-editor-main">
        {(saveError || actionError) && (
          <div className="authoring-banner error" role="alert">
            <strong>{saveError ? 'Draft was not saved.' : 'Action was not completed.'}</strong>
            <span>{errorMessage(saveError || actionError)}</span>
          </div>
        )}
        {savedNotice && <div className="authoring-banner success" role="status">{savedNotice}</div>}
        {recoveryPrompt && (
          <div className="authoring-banner recovery" role="alert">
            <strong>Unsaved browser edits found.</strong>
            <span>
              {recoveryPrompt.status === 'remote-changed'
                ? `The saved draft is now version ${recoveryPrompt.remoteVersion}; restoring this browser copy will not change it until you explicitly save.`
                : `This browser copy was made while the course was at version ${recoveryPrompt.remoteVersion}.`}
            </span>
            <div className="authoring-actions">
              <button type="button" className="authoring-btn small" onClick={restoreRecovery} disabled={Boolean(pending)}>Restore browser edits</button>
              <button type="button" className="authoring-btn ghost small" onClick={discardRecovery} disabled={Boolean(pending)}>Discard browser copy</button>
            </div>
          </div>
        )}
        {course.status === 'PUBLISHED' && (
          <div className="authoring-banner info" role="note">
            Publishing freezes an immutable student version. Editing this draft will never change an existing release; save and publish again for a new version.
          </div>
        )}

        <div className="authoring-editor-layout">
          <LessonList
            lessons={draft.lessons}
            selectedId={selectedLesson?.id}
            onSelect={setSelectedLessonId}
            onAdd={addLesson}
            onChange={setLessons}
            onDelete={deleteLesson}
            onDuplicate={duplicateLesson}
            disabled={controlsDisabled}
          />

          <section className="authoring-workspace" aria-label="Course content">
            <section className="authoring-panel authoring-course-details" aria-labelledby="course-details-heading">
              <div className="authoring-section-head">
                <div>
                  <p className="authoring-section-kicker">Course details</p>
                  <h2 id="course-details-heading">Title, summary, and objectives</h2>
                </div>
              </div>
              <div className="authoring-field-grid">
                <TextField label="Course title" value={draft.title} onChange={(title) => updateDraft((current) => ({ ...current, title }))} disabled={controlsDisabled} maxLength={160} />
                <TextField label="Summary" value={draft.summary} onChange={(summary) => updateDraft((current) => ({ ...current, summary }))} disabled={controlsDisabled} multiline rows={3} maxLength={4000} />
              </div>
              <ObjectiveEditor objectives={draft.objectives} onChange={(objectives) => updateDraft((current) => ({ ...current, objectives }))} disabled={controlsDisabled} />
            </section>

            {!selectedLesson ? (
              <div className="authoring-empty workspace-empty">
                <h2>No lesson selected</h2>
                <p>Add a lesson to begin building the course.</p>
                <button type="button" className="authoring-btn" onClick={addLesson} disabled={controlsDisabled}>Add lesson</button>
              </div>
            ) : (
              <section className="authoring-panel authoring-lesson-editor" aria-labelledby="lesson-heading">
                <div className="authoring-section-head">
                  <div>
                    <p className="authoring-section-kicker">Lesson {draft.lessons.findIndex((lesson) => lesson.id === selectedLesson.id) + 1}</p>
                    <h2 id="lesson-heading">Lesson content</h2>
                  </div>
                  <span className="authoring-muted">{selectedLesson.blocks.length} block{selectedLesson.blocks.length === 1 ? '' : 's'}</span>
                </div>
                <TextField label="Lesson title" value={selectedLesson.title} onChange={(title) => patchLesson({ title })} disabled={controlsDisabled} maxLength={160} />

                <div className="authoring-block-list">
                  {selectedLesson.blocks.length === 0 && (
                    <div className="authoring-empty-line">
                      <p>No blocks yet. Add text, media, checks, or nested interactive content below.</p>
                    </div>
                  )}
                  {selectedLesson.blocks.map((block, blockIndex) => (
                    <BlockEditor
                      key={block.id}
                      block={block}
                      index={blockIndex}
                      total={selectedLesson.blocks.length}
                      onChange={(nextBlock) => patchBlock(blockIndex, nextBlock)}
                      onDelete={() => patchLesson({ blocks: selectedLesson.blocks.filter((_, index) => index !== blockIndex) })}
                      onMove={(offset) => patchLesson({ blocks: moveArrayItem(selectedLesson.blocks, blockIndex, offset) })}
                      onDuplicate={() => {
                        const copied = duplicateWithFreshIds(block);
                        patchLesson({ blocks: [...selectedLesson.blocks.slice(0, blockIndex + 1), copied, ...selectedLesson.blocks.slice(blockIndex + 1)] });
                      }}
                      disabled={controlsDisabled}
                    />
                  ))}
                </div>
                <div className="authoring-add-block">
                  <label htmlFor="add-block-select">Add a block</label>
                  <div className="authoring-form-row">
                    <select id="add-block-select" defaultValue="" disabled={controlsDisabled} onChange={(event) => { if (event.target.value) { addBlock(event.target.value); event.target.value = ''; } }}>
                      <option value="" disabled>Select a block type…</option>
                      {BLOCK_TYPES.map(([value, label]) => <option value={value} key={value}>{label}</option>)}
                    </select>
                    <span className="authoring-muted">Blocks can be reordered, duplicated, and deleted.</span>
                  </div>
                </div>
              </section>
            )}
          </section>
        </div>

        {(course.status === 'PUBLISHED' || course.status === 'ARCHIVED') && (
          <ResultsPanel results={results} loading={resultsLoading} error={resultsError} onRetry={() => void loadResults()} />
        )}
      </main>

      {previewOpen && selectedLesson && (
        <div className="authoring-modal-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setPreviewOpen(false); }}>
          <section className="authoring-modal" role="dialog" aria-modal="true" aria-labelledby="preview-heading">
            <div className="authoring-modal-head">
              <div>
                <p className="authoring-section-kicker">Draft preview</p>
                <h2 id="preview-heading">{selectedLesson.title || 'Untitled lesson'}</h2>
              </div>
              <button type="button" className="authoring-icon-btn" aria-label="Close preview" onClick={() => setPreviewOpen(false)}>×</button>
            </div>
            <p className="authoring-preview-note">This preview uses the current unsaved draft. Learners only receive published releases.</p>
            <div className="authoring-preview-content">
              <ManualLesson content={selectedLesson} preview />
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
