'use client';

import { useState } from 'react';
import { downloadAuthenticated, useApiQuery, useApiMutation } from '../_learning/useLearning';
import { InstructorSyllabus } from './InstructorFeatures';

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
          <p>Doctrine and outlines the course drafts cite. Approve a source before drafting from it.</p>
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
  const [open, setOpen] = useState(false);
  const [err, setErr] = useState(null);
  const approve = useApiMutation(`/sources/${source.id}/approve`, 'POST');
  const { data: sourceDetail } = useApiQuery(`/sources/${source.id}`, { enabled: open });

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

      {!open ? (
        <button className="p-btn ghost" onClick={() => setOpen(true)} style={{ marginBottom: '1rem', marginRight: '0.5rem' }}>Inspect source</button>
      ) : (
        <div style={{ background: 'var(--p-surface-2)', padding: '1rem', borderRadius: '8px', marginBottom: '1rem', fontSize: '0.85em' }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)} style={{ marginBottom: '1rem' }}>Close source</button>
          {sourceDetail ? (
            <div style={{ maxHeight: '300px', overflowY: 'auto', whiteSpace: 'pre-wrap' }}>
              {sourceDetail.text || sourceDetail.pages?.map((p) => p.text).join('\n\n') || 'No content.'}
            </div>
          ) : (
            <p>Loading details…</p>
          )}
        </div>
      )}

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
  const [err, setErr] = useState(null);
  const ingest = useApiMutation('/sources', 'POST');

  const handleSubmit = async () => {
    if (!title || !text) return;
    setErr(null);
    try {
      await ingest.mutate({ title, text });
      setOpen(false);
      setTitle('');
      setText('');
      onIngested();
    } catch (e) {
      setErr(errText(e, 'Failed to ingest source'));
    }
  };

  if (!open) return <button className="p-btn" onClick={() => setOpen(true)}>Add source</button>;

  return (
    <div style={MODAL_BACKDROP}>
      <div className="p-panel" style={{ width: '440px', maxWidth: '90%' }}>
        <h3 style={{ fontSize: '1.1em', marginBottom: '1rem' }}>Ingest new source</h3>
        <input
          className="scw-ti"
          placeholder="Source title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        />
        <textarea
          className="scw-ti"
          placeholder="Paste source text here…"
          value={text}
          onChange={(e) => setText(e.target.value)}
          rows={6}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
        />
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
  const { data: sources } = useApiQuery('/sources');
  const approvedSources = sources?.filter((s) => s.status === 'APPROVED') || [];

  return (
    <>
      <div className="s-pagehead s-pagehead-row">
        <div>
          <h1>Courses</h1>
          <p>Cited drafts from approved sources. A draft reaches students only after you approve it.</p>
        </div>
        <DraftCourseModal sources={approvedSources} onDrafted={onDrafted} />
      </div>

      {loading && <p>Loading courses…</p>}
      {error && <p className="s-shell-error" role="alert">{errText(error, 'Could not load courses.')}</p>}
      {!loading && !error && courses.length === 0 && <p>No course drafts yet. Approve a source, then draft from it.</p>}
      {courses.length > 0 && (
        <div className="s-courselist">
          {courses.map((c) => (
            <button className="s-courserow" key={c.id} onClick={() => onOpen(c.id)}>
              <div className="s-courserow-main">
                <div className="s-card-title">{c.name}</div>
                <div className="s-card-school">{c.sections} sections · <StatusTag status={c.status} /></div>
              </div>
              <span className="s-quick-arrow">→</span>
            </button>
          ))}
        </div>
      )}
    </>
  );
}

function DraftCourseModal({ sources, onDrafted }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [objective, setObjective] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [err, setErr] = useState(null);
  const draft = useApiMutation('/courses/draft', 'POST');

  const handleSubmit = async () => {
    if (!title || !objective || !sourceId) return;
    setErr(null);
    try {
      await draft.mutate({ title, objectives: [objective], sourceIds: [sourceId], diagrams: false });
      setOpen(false);
      setTitle('');
      setObjective('');
      setSourceId('');
      onDrafted();
    } catch (e) {
      setErr(errText(e, 'Failed to draft course'));
    }
  };

  if (!open) return <button className="p-btn" onClick={() => setOpen(true)}>Draft course</button>;

  return (
    <div style={MODAL_BACKDROP}>
      <div className="p-panel" style={{ width: '440px', maxWidth: '90%' }}>
        <h3 style={{ fontSize: '1.1em', marginBottom: '1rem' }}>Draft new course</h3>
        <input
          className="scw-ti"
          placeholder="Course title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        />
        <input
          className="scw-ti"
          placeholder="Primary objective (e.g. Explain the standard)"
          value={objective}
          onChange={(e) => setObjective(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '0.5rem' }}
        />
        <select
          className="scw-ti"
          value={sourceId}
          onChange={(e) => setSourceId(e.target.value)}
          style={{ width: '100%', padding: '0.5rem', marginBottom: '1rem' }}
        >
          <option value="">Select an approved source…</option>
          {sources.map((s) => (
            <option key={s.id} value={s.id}>{s.title}</option>
          ))}
        </select>
        {sources.length === 0 && <p className="p-src" style={{ marginBottom: '1rem' }}>No approved sources yet — approve one under Sources first.</p>}
        {err && <p className="s-shell-error" role="alert">{err}</p>}
        <div style={{ display: 'flex', gap: '0.5rem', justifyContent: 'flex-end' }}>
          <button className="p-btn ghost" onClick={() => setOpen(false)}>Cancel</button>
          <button className="p-btn" onClick={handleSubmit} disabled={draft.loading || !title || !objective || !sourceId}>
            {draft.loading ? 'Drafting…' : 'Draft'}
          </button>
        </div>
      </div>
    </div>
  );
}

/* ---------- one real course: the builder view ---------- */

/* The Coursewright draft as the instructor reviews it: sections with their
   lesson text and pre/post items, approve, syllabus (Cadence), SCORM export
   (Cartridge). Fidelity and the AAR are their own views in the shell. */
export function CourseDraft({ course, onChanged }) {
  const [err, setErr] = useState(null);
  const { data: envelope, loading, refetch } = useApiQuery(`/courses/${course.id}`);
  const approve = useApiMutation(`/courses/${course.id}/approve`, 'POST');

  const handleApprove = async () => {
    setErr(null);
    try {
      await approve.mutate();
      refetch();
      onChanged?.();
    } catch (e) {
      setErr(errText(e, 'Failed to approve course'));
    }
  };

  const exportScorm = (version) =>
    downloadAuthenticated(
      `/api/learning/export?courseId=${course.id}&version=${version}`,
      `${course.id}-scorm-${version}.zip`,
    ).catch((e) => setErr(e.message));

  const draft = envelope?.course;
  const status = envelope?.status || course.status;
  const sections = draft?.sections || [];
  const nSources = course.sourceIds?.length || 0;

  return (
    <>
      <h2 className="p-h">Course draft</h2>
      <p className="p-sub">
        Drafted by Coursewright from {nSources || 'approved'} source{nSources === 1 ? '' : 's'}.
        Status: <StatusTag status={status} />. Nothing here reaches a student until you approve it.
      </p>

      {err && <p className="s-shell-error" role="alert">{err}</p>}

      <div className="p-btnrow" style={{ marginBottom: '1.25rem' }}>
        {status === 'PENDING' && (
          <button className="p-btn" onClick={handleApprove} disabled={approve.loading}>
            {approve.loading ? 'Approving…' : 'Approve course'}
          </button>
        )}
        {status === 'APPROVED' && (
          <>
            <button type="button" className="p-btn ghost" onClick={() => exportScorm('1.2')}>Export SCORM 1.2</button>
            <button type="button" className="p-btn ghost" onClick={() => exportScorm('2004')}>Export SCORM 2004</button>
          </>
        )}
      </div>

      <div className="p-panel">
        <h3>Sections</h3>
        {loading && <p>Loading draft…</p>}
        {!loading && sections.length === 0 && <p className="p-src">This draft has no sections.</p>}
        {sections.map((s, i) => (
          <details key={s.title || i} className="s-draft-sec" open={i === 0}>
            <summary>
              <span className="s-draft-n">{i + 1}</span> {s.title || `Section ${i + 1}`}
              <span className="p-src" style={{ marginLeft: '0.6rem' }}>
                {(s.pre?.length || 0) + (s.post?.length || 0)} items
              </span>
            </summary>
            {s.lesson && <p style={{ whiteSpace: 'pre-wrap' }}>{s.lesson}</p>}
            {[['pre', 'Pre-check'], ['post', 'Post-check']].map(([k, label]) =>
              s[k]?.length ? (
                <div key={k} style={{ marginTop: '0.75rem' }}>
                  <h4 className="s-label">{label}</h4>
                  <ol className="s-obj">
                    {s[k].map((q, j) => (
                      <li key={j}>
                        {q.stem}
                        {Array.isArray(q.options) && (
                          <ul className="s-draft-opts">
                            {q.options.map((o, oi) => (
                              <li key={oi} className={oi === q.answer ? 'keyed' : ''}>{typeof o === 'string' ? o : o.text}</li>
                            ))}
                          </ul>
                        )}
                        {q.citation && (
                          <span className="p-src"> {typeof q.citation === 'string' ? q.citation : q.citation.citation}</span>
                        )}
                      </li>
                    ))}
                  </ol>
                </div>
              ) : null,
            )}
          </details>
        ))}
      </div>

      {status === 'PENDING' && <InstructorSyllabus courseId={course.id} />}
    </>
  );
}
