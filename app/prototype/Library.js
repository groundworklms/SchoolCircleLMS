'use client';

import { useState } from 'react';
import { downloadAuthenticated, useApiQuery, useApiMutation, useApiStream } from '../_learning/useLearning';
import CourseLesson from '../_course/CoursePresentation';
import { InstructorMasteryPlan, InstructorSyllabus } from './InstructorFeatures';
import { SourceViewer } from './SourceViewer';
import { CourseReadiness } from './CourseReadiness';
import { CourseItemReview } from './ItemReview';
import { GenerationProgress, ThinCoverageNotice } from './GenerationProgress';
import { RowActions } from './RowActions';

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
      <div className="p-panel-head">
        <h3>{source.title}</h3>
        <RowActions
          label="source"
          title={source.title}
          endpoint={`/api/learning/sources/${source.id}`}
          onChanged={onApproved}
          removeNote="A source that any course still cites cannot be removed."
        />
      </div>
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
      <div className="p-panel" role="dialog" aria-modal="true" aria-label="Add source" style={{ width: '440px', maxWidth: '90%', maxHeight: '85vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '1.1em', marginBottom: '1rem' }}>Add source</h3>
        <p className="p-src">Saved to your reusable source library. Review and explicitly approve it before generating a course.</p>
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
            disabled={pdfUpload.loading || ingest.loading || !file}
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
          <button className="p-btn ghost" onClick={() => setOpen(false)} disabled={ingest.loading || pdfUpload.loading}>Cancel</button>
          <button className="p-btn" onClick={handleSubmit} disabled={ingest.loading || pdfUpload.loading || !title.trim() || !text.trim()}>
            {ingest.loading ? 'Saving…' : 'Save text source'}
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
        </div>
        <DraftCourseModal
          sources={Array.isArray(sources) ? sources : []}
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
        <p>No approved sources yet. Choose Create course to add, review and approve your sources in one place.</p>
      )}
      {!loading && !error && courses.length === 0 && <p>No courses yet. Create a course from your sources, then review the generated draft.</p>}
      {courses.length > 0 && (
        <div className="s-courselist">
          {courses.map((c) => (
            /* A row-actions button cannot nest inside the row's own button, so
               the open affordance is its own element and the menu is a
               sibling. */
            <div className="s-courserow s-courserow-managed" key={c.id}>
              <button className="s-courserow-open" onClick={() => onOpen(c.id)}>
                <div className="s-courserow-main">
                  <div className="s-card-title">
                    {c.name || c.title}
                    {c.manual && <span className="s-legacy-tag">Legacy</span>}
                  </div>
                  <div className="s-card-school">
                    {c.manual
                      ? 'Published through the retired manual workflow · roster only'
                      : <>{c.sections} sections · <strong>{c.hasPendingRevision || c.record?.hasPendingRevision ? `${c.status === 'APPROVED' ? 'Published' : 'Draft'} · revision needs review` : c.status === 'APPROVED' ? 'Published' : 'Needs review'}</strong></>}
                  </div>
                </div>
                <span className="s-quick-arrow">→</span>
              </button>
              <RowActions
                label="course"
                title={c.name || c.title}
                /* Legacy courses live on the authoring API, where renaming is
                   retired (410), so only removal is offered for them. */
                endpoint={c.manual
                  ? `/api/authoring/courses/${c.id}`
                  : `/api/learning/courses/${c.id}`}
                canRename={!c.manual}
                onChanged={onDrafted}
                removeNote="A course learners have worked in is archived instead, and their work is kept."
              />
            </div>
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
  // Generation is a minute or more of model calls. Rather than a spinner over
  // it, the stream reports every objective and artifact as it lands and the
  // modal shows the course being written.
  const [events, setEvents] = useState(null);
  const draft = useApiStream('/courses/draft/stream');
  const approvedSources = sources.filter((source) => source.status === 'APPROVED');
  const selectedIds = sourceIds.filter((id) => approvedSources.some((source) => source.id === id));

  const handleSubmit = async () => {
    if (selectedIds.length === 0 || draft.loading) return;
    setErr(null);
    setEvents([]);
    try {
      // Title and objectives are overrides, not requirements. Left empty they
      // are written from the selected sources; an empty string would read as an
      // instructor asking for a blank title, so send neither unless typed.
      const last = await draft.start(
        {
          ...(title.trim() ? { title: title.trim() } : {}),
          objectives: objective.split('\n').map((line) => line.trim()).filter(Boolean),
          sourceIds: selectedIds,
          diagrams: false,
        },
        (event) => setEvents((current) => [...(current || []), event]),
      );
      // The stream carries its own failure so the partial progress stays on
      // screen next to the reason, rather than collapsing to one error line.
      if (last?.phase !== 'saved') return;
      setOpen(false);
      setTitle('');
      setObjective('');
      setSourceIds([]);
      setEvents(null);
      onDrafted(last.record);
    } catch (e) {
      setErr(errText(e, 'Failed to draft course'));
    }
  };

  const closeModal = () => {
    setOpen(false);
    setEvents(null);
  };

  const sourceUnavailable = sourcesLoading || Boolean(sourcesError);
  if (!open) {
    return (
      <button
        className="p-btn"
        onClick={() => setOpen(true)}
      >
        Create course
      </button>
    );
  }

  return (
    <div style={MODAL_BACKDROP}>
      <div className="p-panel" role="dialog" aria-modal="true" aria-label="Create course" style={{ width: '640px', maxWidth: '90%', maxHeight: '85vh', overflowY: 'auto' }}>
        <h3 style={{ fontSize: '1.1em', marginBottom: '1rem' }}>Create course</h3>
        <p className="p-src">1. Sources → 2. Generate → 3. Review → 4. Approve and publish</p>
        <p>Add a PDF or paste text, review and approve it below, then select it for this course. Existing approved sources can be reused.</p>
        <IngestSourceModal onIngested={onRetrySources} />
        {sources.filter((source) => source.status === 'PENDING').map((source) => (
          <details key={source.id} style={{ margin: '0.75rem 0' }}>
            <summary>{source.title} · Review and approve source</summary>
            <SourceCard source={source} onApproved={onRetrySources} />
          </details>
        ))}
        <h4>Generate from selected sources</h4>
        <p className="p-src">
          The title and objectives are written from the sources you select. Fill either in only to
          override what the model would choose.
        </p>
        <input
          className="scw-ti"
          placeholder="Course title (optional — written from the sources)"
          aria-label="Course title"
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
          {approvedSources.map((s) => (
            <label key={s.id} style={{ display: 'flex', gap: '0.5rem', alignItems: 'flex-start', padding: '0.25rem 0', cursor: 'pointer' }}>
              <input
                type="checkbox"
                value={s.id}
                checked={selectedIds.includes(s.id)}
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
          {approvedSources.length > 0 && (
            <small style={{ display: 'block', marginTop: '0.35rem', color: 'var(--p-faint)' }}>
              {selectedIds.length} source{selectedIds.length === 1 ? '' : 's'} selected
            </small>
          )}
        </fieldset>
        {sourcesError && (
          <div className="s-shell-error" role="alert">
            <p style={{ margin: '0 0 0.5rem' }}>{errText(sourcesError, 'Could not load approved sources.')}</p>
            <button type="button" className="p-btn ghost" onClick={onRetrySources}>Retry loading sources</button>
          </div>
        )}
        {sourcesLoading && <p role="status">Loading sources…</p>}
        {!sourcesLoading && !sourcesError && approvedSources.length === 0 && (
          <p className="p-src" style={{ marginBottom: '1rem' }}>No approved sources yet. Add a source above, then open its review and approve it.</p>
        )}
        {err && <p className="s-shell-error" role="alert">{err}</p>}
        {Array.isArray(events) && (
          <section
            aria-label="Course generation progress"
            aria-live="polite"
            style={{
              border: '1px solid var(--p-border)',
              borderRadius: '10px',
              padding: '0.75rem 0.9rem',
              margin: '1rem 0',
            }}
          >
            <GenerationProgress events={events} />
          </section>
        )}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="p-btn ghost" onClick={closeModal} disabled={draft.loading}>
            {Array.isArray(events) && !draft.loading ? 'Close' : 'Cancel'}
          </button>
          <button className="p-btn" onClick={handleSubmit} disabled={draft.loading || sourceUnavailable || selectedIds.length === 0}>
            {draft.loading ? 'Generating…' : Array.isArray(events) ? 'Try again' : 'Generate course'}
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

function GeneratedCoursePreview({ course, version, onSubmitRevision, pendingRevision, revisionsDisabled }) {
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
                busy={revisionsDisabled || pendingRevision === `lesson:${lesson.sectionId || lesson.id}`}
              />
            </div>
            {lesson.questionRefs?.map((question) => (
              <QuestionRevisionControl
                key={question.questionId}
                question={question}
                version={version}
                onSubmit={onSubmitRevision}
                busy={revisionsDisabled || pendingRevision === `question:${question.questionId}`}
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
      setNotice('Course approved and published. The reviewed version is now available to learners.');
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
  const notCovered = (Array.isArray(draft?.skippedObjectives) ? draft.skippedObjectives : [])
    .map((entry) => (typeof entry === 'string'
      ? { objective: entry, reason: '' }
      : { objective: String(entry?.objective || ''), reason: String(entry?.reason || '') }))
    .filter((entry) => entry.objective);
  const approvedSources = Array.isArray(sources) ? sources.filter((source) => source.status === 'APPROVED') : [];
  const showingLoading = loading || (!envelope && !draftError);
  // A pendingRevision key only ever matches the one form it names, so blocking
  // every revision form while an approve is in flight (or the draft failed to
  // load) needs its own flag. A sentinel key such as 'unavailable' matched no
  // form at all and left them all enabled -- the opposite of the intent.
  const revisionsDisabled = approve.loading || Boolean(draftError);

  return (
    <>
      <div className="course-review-heading">
        <div>
          <p className="p-src" style={{ margin: 0 }}>Version {version}</p>
          <h2 className="p-h">{draft?.title || course.name || 'Course draft'}</h2>
          <p className="p-sub">
            Grounded in {sourceCount || 'the selected'} approved source{sourceCount === 1 ? '' : 's'}.
            {' '}Review the generated content, then approve and publish this exact version.
          </p>
        </div>
        <span className={`p-live${status === 'APPROVED' && !hasPendingRevision ? ' on' : ''}`}>
          {hasPendingRevision ? 'NEEDS REVIEW' : status === 'APPROVED' ? 'PUBLISHED' : status || 'PENDING'}
        </span>
      </div>

      {/* What this draft does NOT teach, carried on the record itself. The
          generation modal said it once while the instructor watched; this is
          the same fact days later, when they are deciding whether to approve a
          course that covers three of the four objectives they asked for. Older
          drafts stored bare objective strings, so both shapes render.

          The heading names the course, not the sources: an entry here may be a
          topic the sources cover perfectly well and the outline scoped out, and
          its reason says so. */}
      {notCovered.length > 0 && (
        <div className="p-panel" style={{ marginBottom: '1rem' }}>
          <p className="p-src" style={{ margin: 0 }}>
            Not covered by this course:
          </p>
          <ul style={{ margin: '0.3rem 0 0', paddingLeft: '1.1rem' }}>
            {notCovered.map((entry) => (
              <li key={entry.objective} className="p-src">
                {entry.objective}
                {entry.reason ? <> &mdash; {entry.reason}</> : null}
              </li>
            ))}
          </ul>
          {draft?.thinCoverage === true && <ThinCoverageNotice />}
        </div>
      )}

      {err && <p className="s-shell-error" role="alert">{err}</p>}
      {draftError && <div className="s-shell-error" role="alert"><p>{errText(draftError, 'Could not load course draft.')}</p><button type="button" className="p-btn ghost" onClick={refetch}>Reload course</button></div>}
      {notice && <p className="p-check ok" role="status"><strong>{notice}</strong></p>}

      <div className="p-btnrow" style={{ marginBottom: '1.25rem' }}>
        {status === 'APPROVED' && !hasPendingRevision && (
          <>
            <button type="button" className="p-btn ghost" onClick={() => exportScorm('1.2')}>Export SCORM 1.2</button>
            <button type="button" className="p-btn ghost" onClick={() => exportScorm('2004')}>Export SCORM 2004</button>
          </>
        )}
      </div>

      <CourseReadiness
        courseId={course.id}
        version={version}
        candidate={draft}
        pending={hasPendingRevision}
        published={status === 'APPROVED'}
        busy={approve.loading || Boolean(pendingRevision)}
        unavailable={showingLoading || Boolean(draftError) || !envelope}
        onApprove={handleApprove}
      />

      {/* Approving the course released this snapshot; it did not release the
          items in it. Every materialised item starts PENDING and a learner only
          ever sees APPROVED, so the gate stays open until a human closes it. */}
      {status === 'APPROVED' && !showingLoading && (
        <CourseItemReview courseId={course.id} onChanged={onChanged} />
      )}

      {showingLoading && <p>Loading generated course…</p>}
      {!showingLoading && (
        <div className="p-panel">
          <GeneratedCoursePreview
            course={draft || {}}
            version={version}
            onSubmitRevision={submitRevision}
            pendingRevision={pendingRevision}
            revisionsDisabled={revisionsDisabled}
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
      <details className="p-panel">
        <summary>Optional learning tools · syllabus and mastery plan</summary>
        <p className="p-src">These tools do not block course publication. Rubrics and fidelity evaluation are available under Advanced tools.</p>
        {status === 'PENDING' && <InstructorSyllabus courseId={course.id} />}
        <InstructorMasteryPlan
          courseId={course.id}
          course={draft || course}
          approvedSources={approvedSources}
          onUpdated={refresh}
        />
      </details>
    </>
  );
}
