'use client';

import { useState } from 'react';
import { downloadAuthenticated, useApiQuery, useApiMutation } from '../_learning/useLearning';
import CourseLesson from '../_course/CoursePresentation';
import { InstructorMasteryPlan, InstructorSyllabus } from './InstructorFeatures';
import { SourceViewer } from './SourceViewer';

/* The instructor library — the parts of the persisted learning loop that are
   not tied to one course on screen: source documents (Quarry) and the course
   drafts they feed (Coursewright). Every approval here is a human click; the
   server never self-approves, and a learner never sees anything PENDING. */

const MODAL_BACKDROP = {
  position: 'fixed', top: 0, left: 0, right: 0, bottom: 0,
  background: 'rgba(0,0,0,0.5)', zIndex: 100,
  display: 'flex', alignItems: 'center', justifyContent: 'center',
};

function StatusTag({ status }) {
  return (
    <strong style={{ color: status === 'APPROVED' ? 'var(--p-good)' : 'var(--p-warning)' }}>{status}</strong>
  );
}

function errText(e, fallback) {
  return e?.error || e?.message || fallback;
}

/* ---------- sources ---------- */

export function SourcesView() {
  const { data: sources, loading, error, refetch } = useApiQuery('/sources');

  return (
    <>
      <div className="s-pagehead s-pagehead-row">
        <div>
          <h1>Source documents</h1>
          <p>Approve sources before drafting courses.</p>
        </div>
        <IngestSourceModal onIngested={refetch} />
      </div>

      {loading && <p>Loading sources…</p>}
      {error && <p className="s-shell-error" role="alert">{errText(error, 'Could not load sources.')}</p>}
      {!loading && !error && (!sources || sources.length === 0) && <p>No sources yet. Add one to start a course.</p>}
      {sources?.length > 0 && (
        <div className="p-grid2">
          {sources.map((src) => (
            <SourceCard key={src.id} source={src} onApproved={refetch} />
          ))}
        </div>
      )}
    </>
  );
}

function SourceCard({ source, onApproved }) {
  const [err, setErr] = useState(null);
  const approve = useApiMutation(`/sources/${source.id}/approve`, 'POST');

  const handleApprove = async () => {
    setErr(null);
    try {
      await approve.mutate();
      onApproved();
    } catch (e) {
      setErr(errText(e, 'Failed to approve source'));
    }
  };

  return (
    <div className="p-panel">
      <h3>{source.title}</h3>
      <p className="p-src" style={{ marginBottom: '1rem' }}>
        <code>{source.id}</code> · <StatusTag status={source.status} />
      </p>

      <SourceViewer sourceId={source.id} compact />

      {err && <p className="s-shell-error" role="alert">{err}</p>}
      {source.status === 'PENDING' && (
        <button className="p-btn" onClick={handleApprove} disabled={approve.loading}>
          {approve.loading ? 'Approving…' : 'Approve source'}
        </button>
      )}
    </div>
  );
}

function IngestSourceModal({ onIngested }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const ingest = useApiMutation('/sources', 'POST');
  const pdfUpload = useApiMutation('/sources/pdf', 'POST');

  const handleSubmit = async () => {
    if (!title || !text) return;
    setErr(null);
    try {
      await ingest.mutate({ title, text });
      setOpen(false);
      setTitle('');
      setText('');
      setSourceId('');
      setFile(null);
      onIngested();
    } catch (e) {
      setErr(errText(e, 'Failed to ingest source'));
    }
  };

  const handlePdfUpload = async () => {
    if (!file) return;
    if (file.type !== 'application/pdf' && !file.name.toLowerCase().endsWith('.pdf')) {
      setErr('Select a PDF file.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    if (title.trim()) form.append('title', title.trim());
    if (sourceId.trim()) form.append('sourceId', sourceId.trim());
    setErr(null);
    try {
      await pdfUpload.mutate(form);
      setOpen(false);
      setTitle('');
      setText('');
      setSourceId('');
      setFile(null);
      onIngested();
    } catch (e) {
      setErr(errText(e, 'Failed to upload PDF'));
    }
  };

  if (!open) return <button className="p-btn" onClick={() => setOpen(true)}>Add source</button>;

  return (
    <div style={MODAL_BACKDROP}>
      <div className="p-panel" style={{ width: '440px', maxWidth: '90%' }}>
        <h3 style={{ fontSize: '1.1em', marginBottom: '1rem' }}>Ingest new source</h3>
        <input
          className="scw-ti"
          placeholder="Source title (optional for PDF)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        />
        <input
          className="scw-ti"
          aria-label="Source identifier"
          placeholder="Source identifier (optional)"
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.75rem' }}
        />
        <div style={{ padding: '0.75rem', background: 'var(--p-surface-2)', borderRadius: '8px', marginBottom: '0.75rem' }}>
          <strong style={{ display: 'block', marginBottom: '0.35rem' }}>Upload a PDF</strong>
          <p className="p-src" style={{ margin: '0 0 0.5rem' }}>
            Pages are preserved so instructors and learners can inspect a cited passage.
          </p>
          <input
            type="file"
            accept="application/pdf,.pdf"
            aria-label="PDF source file"
            onChange={(e) => setFile(e.target.files?.[0] || null)}
          />
          {file && <p className="p-src" style={{ margin: '0.5rem 0 0' }}>Selected: {file.name}</p>}
          <button
            type="button"
            className="p-btn"
            onClick={handlePdfUpload}
            disabled={pdfUpload.loading || !file}
            style={{ marginTop: '0.75rem' }}
          >
            {pdfUpload.loading ? 'Uploading…' : 'Upload PDF'}
          </button>
        </div>
        <div style={{ borderTop: '1px solid var(--p-border)', paddingTop: '0.75rem' }}>
          <p className="p-src" style={{ margin: '0 0 0.5rem' }}>Or add a text source</p>
        <textarea
          className="scw-ti"
          placeholder="Paste source text here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
        />
        </div>
        {err && <p className="s-shell-error" role="alert">{err}</p>}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="p-btn" onClick={handleSubmit} disabled={ingest.loading || !title || !text}>
            {ingest.loading ? 'Ingesting…' : 'Ingest'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- course drafts ---------- */

/* Every course the account can see: own drafts and approved courses. Opening
   one goes to its builder view in the shell (onOpen). */
export function CoursesLibrary({ courses, loading, error, onOpen, onDrafted }) {
  const {
    data: sources,
    loading: sourcesLoading,
    error: sourcesError,
    refetch: refetchSources,
  } = useApiQuery('/sources');
  // useApiQuery starts with no data before its first effect runs. Treat that
  // state as pending rather than presenting it as a successful empty library.
  const sourcesPending = sourcesLoading || (sources == null && !sourcesError);
  const approvedSources = Array.isArray(sources) ? sources.filter((s) => s.status === 'APPROVED') : [];

  return (
    <>
      <div className="s-pagehead s-pagehead-row">
        <div>
          <h1>Courses</h1>
          <p>Draft from approved sources; approve before learners see it.</p>
        </div>
        <DraftCourseModal
          sources={approvedSources}
          sourcesLoading={sourcesPending}
          sourcesError={sourcesError}
          onRetrySources={refetchSources}
          onDrafted={onDrafted}
        />
      </div>

      {loading && <p>Loading courses…</p>}
      {error && <p className="s-shell-error" role="alert">{errText(error, 'Could not load courses.')}</p>}
      {sourcesPending && <p>Loading approved sources…</p>}
      {sourcesError && (
        <div className="s-shell-error" role="alert">
          <p style={{ margin: '0 0 0.5rem' }}>
            {errText(sourcesError, 'Could not load approved sources.')}
          </p>
          <button type="button" className="p-btn ghost" onClick={refetchSources}>Retry loading sources</button>
        </div>
      )}
      {!sourcesPending && !sourcesError && Array.isArray(sources) && approvedSources.length === 0 && (
        <p>No approved sources. Add and approve one before drafting.</p>
      )}
      {!loading && !error && courses.length === 0 && <p>No course drafts yet. Approve a source, then draft from it.</p>}
      {courses.length > 0 && (
        <div className="s-courselist">
          {courses.map((c) => (
            <button className="s-courserow" key={c.id} onClick={() => onOpen(c.id)}>
              <div className="s-courserow-main">
                <div className="s-card-title">{c.name}</div>
                <div className="s-card-school">
                  {c.sections} sections · <StatusTag status={c.hasPendingRevision || c.record?.hasPendingRevision ? 'PENDING_REVIEW' : c.status} />
                </div>
              </div>
              <span className="s-quick-arrow">→</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function DraftCourseModal({ sources, sourcesLoading, sourcesError, onRetrySources, onDrafted }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [sourceIds, setSourceIds] = useState([]);
  const [err, setErr] = useState(null);
  const draft = useApiMutation('/courses/draft', 'POST');

  const handleSubmit = async () => {
    if (sourceIds.length === 0) return;
    setErr(null);
    try {
      // Both fields are overrides, not requirements. Left empty they are
      // written from the selected sources; an empty string would read as an
      // instructor asking for a blank title, so send neither unless typed.
      await draft.mutate({
        ...(title.trim() ? { title: title.trim() } : {}),
        objectives: objective.split('\n').map((line) => line.trim()).filter(Boolean),
        sourceIds,
        diagrams: false,
      });
      setOpen(false);
      setTitle('');
      setObjective('');
      setSourceIds([]);
      onDrafted();
    } catch (e) {
      setErr(errText(e, 'Failed to draft course'));
    }
  };

  const sourceUnavailable = sourcesLoading || Boolean(sourcesError);
  if (!open) {
    return (
      <button
        className="p-btn"
        onClick={() => setOpen(true)}
        disabled={sourceUnavailable}
        title={sourcesError ? 'Approved sources are unavailable.' : undefined}
      >
        {sourcesLoading ? 'Loading sources…' : 'Draft course'}
      </button>
    );
  }

  return (
    <div style={MODAL_BACKDROP}>
      <div className="p-panel" style={{ width: '440px', maxWidth: '90%' }}>
        <h3 style={{ fontSize: '1.1em', marginBottom: '0.35rem' }}>Draft new course</h3>
        <p className="p-src" style={{ marginBottom: '1rem' }}>
          Pick the sources. The title and objectives are written from them — fill either in only to
          override what the model would choose.
        </p>
        <input
          className="scw-ti"
          placeholder="Course title (optional — written from the sources)"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        />
        <textarea
          className="scw-ti"
          aria-label="Course objectives"
          placeholder="Objectives, one per line (optional — written from the sources)"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          rows={4}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        />
        <fieldset
          disabled={sourceUnavailable}
          style={{
            border: '1px solid var(--p-border)',
            borderRadius: '10px',
            padding: '0.65rem 0.8rem',
            margin: '0 0 1rem',
          }}
        >
          <legend style={{ padding: '0 0.3rem', fontSize: '0.84em', color: 'var(--p-dim)' }}>
            Approved sources
          </legend>
          {sources.map((s) => (
            <label key={s.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.25rem 0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                value={s.id}
                checked={sourceIds.includes(s.id)}
                onChange={(e) => setSourceIds((current) => e.target.checked
                  ? [...current, s.id]
                  : current.filter((id) => id !== s.id))}
              />
              <span>
                <strong>{s.title}</strong>
                <small style={{ display: 'block', color: 'var(--p-faint)' }}>{s.pages || 0} pages · {s.id}</small>
              </span>
            </label>
          ))}
          {sources.length > 0 && (
            <small style={{ display: 'block', marginTop: '0.35rem', color: 'var(--p-faint)' }}>
              {sourceIds.length} source{sourceIds.length === 1 ? '' : 's'} selected
            </small>
          )}
        </fieldset>
        {sourcesError && (
          <div className="s-shell-error" role="alert">
            <p style={{ margin: '0 0 0.5rem' }}>{errText(sourcesError, 'Could not load approved sources.')}</p>
            <button type="button" className="p-btn ghost" onClick={onRetrySources}>Retry loading sources</button>
          </div>
        )}
        {!sourcesLoading && !sourcesError && sources.length === 0 && (
          <p className="p-src" style={{ marginBottom: '1rem' }}>No approved sources — approve one under Sources first.</p>
        )}
        {err && <p className="s-shell-error" role="alert">{err}</p>}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="p-btn" onClick={handleSubmit} disabled={draft.loading || sourceUnavailable || sourceIds.length === 0}>
            {draft.loading ? 'Drafting…' : 'Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- AI course review ---------- */

function stableTextId(value, fallback) {
  const text = String(value || '').trim().toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
  return text ? text.slice(0, 48) : fallback;
}

function sectionStableId(section, sectionNumber) {
  // Matches the backend's one-time legacy normalisation. New payloads always
  // carry persisted ids; this fallback only keeps pre-id records addressable.
  return String(section?.id || section?.sectionId || `section-${sectionNumber + 1}`);
}

function questionStableId(question, sectionId, phase, questionNumber) {
  return String(
    question?.id
      || question?.questionId
      || `${sectionId}:${phase}${questionNumber + 1}`,
  );
}

function optionStableId(option, questionId, optionNumber) {
  return String(option?.id || `${questionId}-option-${stableTextId(option?.text, String(optionNumber + 1))}`);
}

function questionOptions(question, questionId) {
  const source = Array.isArray(question?.options)
    ? question.options
    : Array.isArray(question?.answers)
      ? question.answers
      : [];
  return source.map((option, index) => (
    typeof option === 'string'
      ? { id: optionStableId({ text: option }, questionId, index), text: option }
      : {
          ...option,
          id: optionStableId(option, questionId, index),
          text: option.text ?? option.label ?? '',
        }
  ));
}

function questionBlock(question, sectionId, phase, questionNumber) {
  const id = questionStableId(question, sectionId, phase, questionNumber);
  const options = questionOptions(question, id);
  const answerIndex = Number.isInteger(question?.answer) ? question.answer : null;
  const sourceCorrectId = question?.correctOptionId || question?.correctAnswerId;
  const correctOptionId = sourceCorrectId
    || (answerIndex !== null ? options[answerIndex]?.id : undefined)
    || options.find((option, index) => question?.answers?.[index]?.correct || option.correct)?.id;
  return {
    id,
    type: question?.type === 'scenario' ? 'scenario' : 'check',
    title: question?.title,
    prompt: question?.prompt || question?.stem || question?.q || '',
    body: question?.body || question?.scenario || '',
    options,
    correctOptionId,
    explanation: question?.explanation || question?.rationale || '',
  };
}

function lessonFromSection(section, sectionNumber) {
  const sectionId = sectionStableId(section, sectionNumber);
  const rawLesson = section?.lesson;
  const lessonObject = rawLesson && typeof rawLesson === 'object' ? rawLesson : null;
  const lessonId = String(lessonObject?.id || section?.lessonId || sectionId);
  const blocks = Array.isArray(lessonObject?.blocks)
    ? lessonObject.blocks.map((block, blockNumber) => ({
        ...block,
        id: String(block?.id || `${lessonId}-block-${stableTextId(block?.title || block?.type, String(blockNumber + 1))}`),
      }))
    : Array.isArray(section?.blocks)
      ? section.blocks.map((block, blockNumber) => ({
          ...block,
          id: String(block?.id || `${lessonId}-block-${stableTextId(block?.title || block?.type, String(blockNumber + 1))}`),
        }))
      : [];
  const questionRefs = [];
  if (typeof rawLesson === 'string' && rawLesson.trim()) {
    blocks.push({ id: `${lessonId}-lesson`, type: 'text', body: rawLesson });
  }
  for (const phase of ['pre', 'post']) {
    const questions = Array.isArray(section?.[phase]) ? section[phase] : [];
    questions.forEach((question, questionNumber) => {
      const block = questionBlock(question, sectionId, phase, questionNumber);
      blocks.push(block);
      questionRefs.push({ ...block, sectionId, phase, questionId: block.id });
    });
  }
  // New course payloads can put checks directly in lesson.blocks. Keep their
  // stable IDs and expose them to the same inline revision control.
  blocks.forEach((block) => {
    if ((block.type === 'check' || block.type === 'scenario') && !questionRefs.some((item) => item.questionId === block.id)) {
      questionRefs.push({
        ...block,
        sectionId,
        phase: block.phase === 'post' ? 'post' : 'pre',
        questionId: block.id,
      });
    }
  });
  return {
    ...lessonObject,
    id: lessonId,
    sectionId,
    title: lessonObject?.title || section?.title || `Lesson ${sectionNumber + 1}`,
    summary: lessonObject?.summary || section?.summary || '',
    objectives: lessonObject?.objectives || section?.objectives || [],
    citation: lessonObject?.citation || lessonObject?.cite || section?.citation || section?.cite || '',
    blocks,
    questionRefs,
  };
}

function courseLessons(course) {
  const explicitLessons = Array.isArray(course?.lessons) ? course.lessons : null;
  if (explicitLessons) {
    return explicitLessons.map((lesson, lessonNumber) => {
      const sectionId = String(lesson?.sectionId || lesson?.id || `section-${lessonNumber + 1}`);
      const lessonId = String(lesson?.id || sectionId);
      const blocks = Array.isArray(lesson?.blocks)
        ? lesson.blocks.map((block, blockNumber) => ({
            ...block,
            id: String(block?.id || `${lessonId}-block-${stableTextId(block?.title || block?.type, String(blockNumber + 1))}`),
          }))
        : [];
      const questionRefs = blocks
        .filter((block) => block.type === 'check' || block.type === 'scenario')
        .map((block) => ({
          ...block,
          sectionId,
          phase: block.phase === 'post' ? 'post' : 'pre',
          questionId: block.id,
        }));
      return { ...lesson, id: lessonId, sectionId, blocks, questionRefs };
    });
  }
  const sections = Array.isArray(course?.sections) ? course.sections : [];
  return sections.map(lessonFromSection);
}

function revisionHistoryKey(entry, version) {
  return String(entry?.id || entry?.revisionId || entry?.createdAt || `revision-${version || stableTextId(entry?.scope, 'entry')}`);
}

function RevisionForm({
  scope,
  version,
  sectionId,
  phase,
  questionId,
  onSubmit,
  busy,
}) {
  const [open, setOpen] = useState(false);
  const [instructions, setInstructions] = useState('');
  const label = scope === 'lesson' ? 'Revise whole lesson' : `Revise ${phase || 'pre'} question`;
  const submit = async (event) => {
    event.preventDefault();
    if (!instructions.trim() || busy) return;
    try {
      await onSubmit({
        version,
        scope,
        sectionId,
        ...(phase ? { phase } : {}),
        ...(questionId ? { questionId } : {}),
        instructions: instructions.trim(),
      });
      setInstructions('');
      setOpen(false);
    } catch {
      // The parent displays the explicit API error and keeps the form usable.
    }
  };

  if (!open) {
    return (
      <button type="button" className="p-btn ghost" onClick={() => setOpen(true)} disabled={busy}>
        {label}
      </button>
    );
  }
  return (
    <form className="course-revision-form" onSubmit={submit}>
      <label>
        <span>{label} instructions</span>
        <textarea
          value={instructions}
          onChange={(event) => setInstructions(event.target.value)}
          rows={3}
          maxLength={4000}
          placeholder="Describe the change; source evidence stays unchanged…"
          autoFocus
        />
      </label>
      <div className="p-btnrow">
        <button type="submit" className="p-btn" disabled={busy || !instructions.trim()}>
          {busy ? 'Saving…' : 'Save revision request'}
        </button>
        <button type="button" className="p-btn ghost" onClick={() => setOpen(false)} disabled={busy}>Cancel</button>
      </div>
    </form>
  );
}

function QuestionRevisionControl({ question, version, onSubmit, busy }) {
  return (
    <div className="course-question-review">
      <div className="course-question-review-head">
        <span>Question review · {question.phase}</span>
        <code>{question.questionId}</code>
      </div>
      <RevisionForm
        scope="question"
        version={version}
        sectionId={question.sectionId}
        phase={question.phase}
        questionId={question.questionId}
        onSubmit={onSubmit}
        busy={busy}
      />
    </div>
  );
}

function GeneratedCoursePreview({ course, version, onSubmitRevision, pendingRevision }) {
  const lessons = courseLessons(course);
  if (!lessons.length) {
    return <p className="p-src">No lessons to preview yet.</p>;
  }
  return (
    <div className="course-generated-preview">
      <div className="course-preview-banner">
        <strong>Generated course preview</strong>
        <span>Review each lesson and question before approval. Answer keys are instructor-only.</span>
      </div>
      {lessons.map((lesson, lessonNumber) => (
        <details key={lesson.id} open={lessonNumber === 0} className="course-preview-lesson">
          <summary>
            <span className="course-preview-number">{lessonNumber + 1}</span>
            <span>{lesson.title}</span>
            <small>{lesson.questionRefs?.length || 0} questions</small>
          </summary>
          <div className="course-preview-body">
            <CourseLesson content={lesson} preview />
            <div className="course-lesson-revision">
              <RevisionForm
                scope="lesson"
                version={version}
                sectionId={lesson.sectionId || lesson.id}
                onSubmit={onSubmitRevision}
                busy={pendingRevision === `lesson:${lesson.sectionId || lesson.id}`}
              />
            </div>
            {lesson.questionRefs?.map((question) => (
              <QuestionRevisionControl
                key={question.questionId}
                question={question}
                version={version}
                onSubmit={onSubmitRevision}
                busy={pendingRevision === `question:${question.questionId}`}
              />
            ))}
          </div>
        </details>
      ))}
    </div>
  );
}

export function CourseDraft({ course, onChanged }) {
  const [err, setErr] = useState(null);
  const [notice, setNotice] = useState('');
  const [pendingRevision, setPendingRevision] = useState(null);
  const { data: envelope, loading, error: draftError, refetch } = useApiQuery(`/courses/${course.id}`);
  const { data: sources } = useApiQuery('/sources');
  const revise = useApiMutation(`/courses/${course.id}/revise`, 'POST');
  const approve = useApiMutation(`/courses/${course.id}/approve`, 'POST');

  const draft = envelope?.course || course.record?.course || course.record || course;
  const status = envelope?.status || course.status;
  const version = envelope?.version ?? course.record?.version ?? course.version ?? 0;
  const hasPendingRevision = Boolean(
    envelope?.hasPendingRevision
      || status === 'PENDING_REVIEW'
      || status === 'PENDING',
  );
  const revisionHistory = Array.isArray(envelope?.revisionHistory) ? envelope.revisionHistory : [];

  const refresh = async () => {
    await refetch();
    await onChanged?.();
  };

  const submitRevision = async (payload) => {
    const key = payload.scope === 'lesson'
      ? `lesson:${payload.sectionId}`
      : `question:${payload.questionId}`;
    setPendingRevision(key);
    setErr(null);
    setNotice('');
    try {
      await revise.mutate(payload);
      setNotice('Revision saved. Review it before approval.');
      await refresh();
    } catch (error) {
      setErr(errText(error, 'The revision request could not be saved.'));
      throw error;
    } finally {
      setPendingRevision(null);
    }
  };

  const handleApprove = async () => {
    setErr(null);
    setNotice('');
    try {
      await approve.mutate({ version });
      setNotice('Approved and published. Learners can now access this version.');
      await refresh();
    } catch (error) {
      setErr(errText(error, 'The course could not be approved.'));
    }
  };

  const exportScorm = (release) =>
    downloadAuthenticated(
      `/api/learning/export?courseId=${course.id}&version=${release}`,
      `${course.id}-scorm-${release}.zip`,
    ).catch((error) => setErr(error.message));

  const sourceCount = draft?.sourceIds?.length || course.sourceIds?.length || 0;
  const sections = draft?.sections || [];
  const approvedSources = Array.isArray(sources) ? sources.filter((source) => source.status === 'APPROVED') : [];
  const showingLoading = loading || (!envelope && !draftError);

  return (
    <>
      <div className="course-review-heading">
        <div>
          <p className="p-src" style={{ margin: 0 }}>Version {version}</p>
          <h2 className="p-h">{draft?.title || course.name || 'Course draft'}</h2>
          <p className="p-sub">
            {sourceCount > 0
              ? `Uses ${sourceCount} approved source${sourceCount === 1 ? '' : 's'}.`
              : 'Uses approved sources.'}
          </p>
        </div>
        <span className={`p-live${status === 'APPROVED' && !hasPendingRevision ? ' on' : ''}`}>
          {hasPendingRevision ? 'PENDING REVIEW' : status || 'PENDING'}
        </span>
      </div>

      {err && <p className="s-shell-error" role="alert">{err}</p>}
      {draftError && <p className="s-shell-error" role="alert">{errText(draftError, 'Could not load course draft.')}</p>}
      {notice && <p className="p-check ok" role="status"><strong>{notice}</strong></p>}

      <div className="p-btnrow" style={{ marginBottom: '1.25rem' }}>
        {hasPendingRevision && (
          <button type="button" className="p-btn" onClick={handleApprove} disabled={approve.loading || loading || !envelope}>
            {approve.loading ? 'Publishing…' : 'Approve and publish'}
          </button>
        )}
        {status === 'APPROVED' && !hasPendingRevision && (
          <>
            <button type="button" className="p-btn ghost" onClick={() => exportScorm('1.2')}>Export SCORM 1.2</button>
            <button type="button" className="p-btn ghost" onClick={() => exportScorm('2004')}>Export SCORM 2004</button>
          </>
        )}
      </div>

      {showingLoading && <p>Loading generated course…</p>}
      {!showingLoading && (
        <div className="p-panel">
          <GeneratedCoursePreview
            course={draft || {}}
            version={version}
            onSubmitRevision={submitRevision}
            pendingRevision={pendingRevision}
          />
        </div>
      )}

      <div className="p-panel course-revision-history">
        <h3>Revision history</h3>
        {revisionHistory.length === 0 ? (
          <p className="p-src">No revision requests yet. Revise a lesson or question to start one.</p>
        ) : (
          <ol>
            {revisionHistory.map((entry) => (
              <li key={revisionHistoryKey(entry, entry.version)}>
                <strong>{entry.scope === 'lesson' ? 'Whole lesson' : 'Question'}</strong>
                {entry.phase ? ` · ${entry.phase}` : ''}
                {entry.version != null ? ` · v${entry.version}` : ''}
                <span>{entry.instructions || entry.instruction || 'Revision submitted'}</span>
                {entry.status && <small>{entry.status}</small>}
              </li>
            ))}
          </ol>
        )}
      </div>

      {status === 'PENDING' && sections.length === 0 && (
        <p className="p-src">Still generating. Refresh when the course is ready.</p>
      )}
      {status === 'PENDING' && <InstructorSyllabus courseId={course.id} />}
      <InstructorMasteryPlan
        courseId={course.id}
        course={draft || course}
        approvedSources={approvedSources}
        onUpdated={refresh}
      />
    </>
  );
}
