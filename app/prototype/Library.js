'use client';

import { useState } from 'react';
import { downloadAuthenticated, useApiQuery, useApiMutation, useApiStream } from '../_learning/useLearning';
import CourseLesson from '../_course/CoursePresentation';
import { InstructorMasteryPlan, InstructorSyllabus } from './InstructorFeatures';
import { CourseReadiness } from './CourseReadiness';
import { CourseItemReview } from './ItemReview';
import { GenerationProgress, ThinCoverageNotice } from './GenerationProgress';
import { CoursePreview } from './LearnerFeatures';
import { RowActions } from './RowActions';
import { SourceLibraryCard, SourcePreviewDialog } from './SourceLibraryPreview';
import { collectionFromFilename, isPdfFile, isZipFile, pdfEntriesFromZip, zipEntryForm } from './source-upload';
import './source-library.css';

/* The instructor library — the parts of the persisted learning loop that are
   not tied to one course on screen: source documents (Quarry) and the course
   drafts they feed (Coursewright). Every approval here is a human click; the
   server never self-approves, and a learner never sees anything PENDING. */

function errText(e, fallback) {
  return e?.error || e?.message || fallback;
}

/* ---------- sources ---------- */

const NO_COLLECTION = 'Other documents';

/* Sources grouped by the collection they were uploaded under -- "Lesson plans",
   "Student material" -- with the ungrouped ones last. Order inside a group puts
   what still needs a decision first. */
export function groupSourcesByCollection(sources) {
  const groups = new Map();
  for (const source of Array.isArray(sources) ? sources : []) {
    const key = source.collection || NO_COLLECTION;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(source);
  }
  const named = [...groups.keys()].filter((key) => key !== NO_COLLECTION).sort((a, b) => a.localeCompare(b));
  const keys = groups.has(NO_COLLECTION) ? [...named, NO_COLLECTION] : named;
  return keys.map((name) => {
    const items = groups.get(name);
    const pending = items.filter((source) => source.status !== 'APPROVED');
    const approved = items.filter((source) => source.status === 'APPROVED');
    return { name, sources: [...pending, ...approved], pending, approved };
  });
}

export function SourcesView() {
  const { data: sources, loading, error, refetch } = useApiQuery('/sources');
  const [previewSource, setPreviewSource] = useState(null);
  const groups = groupSourcesByCollection(sources);
  const pendingState = loading || (sources == null && !error);

  return (
    <>
      <div className="s-pagehead s-pagehead-row source-library-head">
        <div>
          <h1>Source documents</h1>
        </div>
        <IngestSourceModal onIngested={refetch} />
      </div>

      {pendingState && <SourceShelfSkeleton />}
      {error && <div className="s-shell-error source-library-error" role="alert"><p>{errText(error, 'Could not load sources.')}</p><button className="p-btn ghost" onClick={refetch}>Try again</button></div>}
      {!pendingState && !error && (
        <div className="source-library">
          {groups.length === 0 && <SourceShelf title="Source documents" count={0} empty="No documents yet. Add a PDF, a zip of PDFs, or pasted text." />}
          {groups.map((group) => (
            <SourceShelf
              key={group.name}
              title={group.name}
              count={group.sources.length}
              pendingCount={group.pending.length}
              actions={group.pending.length > 0 && (
                <ApproveAllButton collection={group.name} pending={group.pending} onApproved={refetch} />
              )}
            >
              {group.sources.map((src) => <SourceLibraryCard key={src.id} source={src} onPreview={setPreviewSource} onRefresh={refetch} />)}
            </SourceShelf>
          ))}
        </div>
      )}
      <SourcePreviewDialog source={previewSource} onClose={() => setPreviewSource(null)} onRefresh={refetch} />
    </>
  );
}

function SourceShelf({ title, count, pendingCount = 0, empty, actions, children }) {
  const caption = pendingCount > 0
    ? `${count} ${count === 1 ? 'document' : 'documents'} · ${pendingCount} ${pendingCount === 1 ? 'needs' : 'need'} approval`
    : `${count} ${count === 1 ? 'document' : 'documents'}`;
  return (
    <section className="source-shelf" aria-label={title}>
      <div className="source-shelf-heading">
        <div className="source-shelf-title"><h2>{title}</h2><span>{caption}</span></div>
        {actions}
      </div>
      {count === 0 ? <div className="source-shelf-empty">{empty}</div> : <div className="source-card-list">{children}</div>}
    </section>
  );
}

/* Approve every pending document in a collection. It is a second, explicit
   click: the first shows how many documents it covers, and anything the server
   refuses (a scanned PDF with no text) is listed by name afterwards. */
function ApproveAllButton({ collection, pending, onApproved }) {
  const [confirming, setConfirming] = useState(false);
  const [failed, setFailed] = useState([]);
  const [err, setErr] = useState(null);
  const approveAll = useApiMutation('/sources/approve', 'POST');
  const count = pending.length;

  const run = async () => {
    setErr(null);
    setFailed([]);
    try {
      const result = await approveAll.mutate({ ids: pending.map((source) => source.id) });
      const titleOf = (id) => pending.find((source) => source.id === id)?.title || id;
      setFailed((result?.failed || []).map((item) => ({ ...item, title: titleOf(item.id) })));
      setConfirming(false);
      await onApproved();
    } catch (e) {
      setErr(errText(e, 'The documents could not be approved.'));
    }
  };

  return (
    <div className="source-approve-all">
      {!confirming && (
        <button type="button" className="p-btn" onClick={() => setConfirming(true)} disabled={approveAll.loading}>
          Approve all pending ({count})
        </button>
      )}
      {confirming && (
        <div className="source-approve-confirm" role="group" aria-label={`Approve all pending in ${collection}`}>
          <span>Approve {count} {count === 1 ? 'document' : 'documents'} in {collection}?</span>
          <button type="button" className="p-btn" onClick={run} disabled={approveAll.loading}>
            {approveAll.loading ? 'Approving…' : `Approve ${count}`}
          </button>
          <button type="button" className="p-btn ghost" onClick={() => setConfirming(false)} disabled={approveAll.loading}>Cancel</button>
        </div>
      )}
      {err && <p className="s-shell-error source-action-error" role="alert">{err}</p>}
      {failed.length > 0 && (
        <div className="s-shell-error source-action-error" role="alert">
          <p>{failed.length} {failed.length === 1 ? 'document was' : 'documents were'} not approved:</p>
          <ul>{failed.map((item) => <li key={item.id}><strong>{item.title}</strong> — {item.error}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

function SourceShelfSkeleton() {
  return <div className="source-library" aria-label="Loading source library"><section className="source-shelf"><div className="source-skeleton title" /><div className="source-skeleton card" /><div className="source-skeleton card" /></section><section className="source-shelf"><div className="source-skeleton title" /><div className="source-skeleton card" /></section></div>;
}

function SourceCard({ source, onApproved }) {
  const [previewSource, setPreviewSource] = useState(null);
  return (
    <>
      <SourceLibraryCard
        source={source}
        onPreview={setPreviewSource}
        onRefresh={onApproved}
        approveLabel="Approve source"
      />
      <SourcePreviewDialog source={previewSource} onClose={() => setPreviewSource(null)} onRefresh={onApproved} />
    </>
  );
}

/* `variant` is the weight of the trigger, not of the dialog. On the Sources
   screen adding a source IS the page's action and the trigger is the primary;
   inside Create course it sits next to Generate course, and two accent buttons
   in one dialog is the same defect this pass removed from inside it. */
function IngestSourceModal({ onIngested, variant = 'primary' }) {
  const [open, setOpen] = useState(false);
  const [title, setTitle] = useState('');
  const [text, setText] = useState('');
  const [sourceId, setSourceId] = useState('');
  const [file, setFile] = useState(null);
  const [err, setErr] = useState(null);
  const [collection, setCollection] = useState('');
  // A zip is many uploads. `batch` is the running tally shown while they post
  // one by one, and what is left on screen if some of them were refused.
  const [batch, setBatch] = useState(null);
  const ingest = useApiMutation('/sources', 'POST');
  const pdfUpload = useApiMutation('/sources/pdf', 'POST');
  const busy = ingest.loading || pdfUpload.loading || Boolean(batch?.running);
  const zipSelected = isZipFile(file);
  const effectiveCollection = collection.trim() || (zipSelected ? collectionFromFilename(file.name) : '');

  const reset = () => {
    setOpen(false);
    setTitle('');
    setText('');
    setSourceId('');
    setFile(null);
    setCollection('');
    setBatch(null);
  };

  const handleSubmit = async () => {
    if (!title || !text) return;
    setErr(null);
    try {
      await ingest.mutate({ title, text, ...(collection.trim() ? { collection: collection.trim() } : {}) });
      reset();
      onIngested();
    } catch (e) {
      setErr(errText(e, 'Failed to ingest source'));
    }
  };

  const handlePdfUpload = async () => {
    if (!file) return;
    if (!isPdfFile(file)) {
      setErr('Select a PDF file.');
      return;
    }
    const form = new FormData();
    form.append('file', file);
    if (title.trim()) form.append('title', title.trim());
    if (sourceId.trim()) form.append('sourceId', sourceId.trim());
    if (collection.trim()) form.append('collection', collection.trim());
    setErr(null);
    try {
      await pdfUpload.mutate(form);
      reset();
      onIngested();
    } catch (e) {
      setErr(errText(e, 'Failed to upload PDF'));
    }
  };

  const handleZipUpload = async () => {
    if (!file || !zipSelected) return;
    setErr(null);
    let entries;
    try {
      entries = pdfEntriesFromZip(new Uint8Array(await file.arrayBuffer()));
    } catch (e) {
      setErr(errText(e, 'That zip could not be read.'));
      return;
    }
    if (entries.length === 0) {
      setErr('That zip holds no PDF documents.');
      return;
    }
    const failed = [];
    setBatch({ running: true, done: 0, total: entries.length, failed });
    for (const entry of entries) {
      try {
        await pdfUpload.mutate(zipEntryForm(entry, effectiveCollection));
      } catch (e) {
        failed.push({ path: entry.path, error: errText(e, 'Upload failed') });
      }
      setBatch((current) => ({ ...current, done: (current?.done || 0) + 1, failed: [...failed] }));
    }
    onIngested();
    if (failed.length === 0) {
      reset();
      return;
    }
    setBatch({ running: false, done: entries.length, total: entries.length, failed });
  };

  if (!open) {
    return (
      <button className={variant === 'ghost' ? 'p-btn ghost' : 'p-btn'} onClick={() => setOpen(true)}>
        Add source
      </button>
    );
  }


  /* A PDF and pasted text are two doors into the same library, so they get the
     same box and each carries its own action. The dialog itself therefore has
     no primary button to compete with them: the footer holds only Cancel. The
     previous layout put "Upload PDF" inside a nested panel and "Save text
     source" in the footer, two accent buttons of equal weight with no way to
     tell which one was the dialog's action. */
  return (
    <div className="p-modalback">
      <div className="p-panel p-modal p-modal-lg" role="dialog" aria-modal="true" aria-label="Add source">
        <div className="p-modalhead">
          <h3>Add source</h3>
          <p>Saved to your reusable source library. Review and explicitly approve it before generating a course.</p>
        </div>

        <div className="p-modalbody">
          <div className="p-fieldset p-fieldrow">
            <label className="p-field">
              <span>Source title</span>
              <input
                className="p-input"
                placeholder="Scouting and Patrolling"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <small>Optional for a PDF — the uploaded document supplies its own.</small>
            </label>
            <label className="p-field">
              <span>Source identifier</span>
              <input
                className="p-input"
                aria-label="Source identifier"
                placeholder="MCWP 2-10"
                value={sourceId}
                onChange={(e) => setSourceId(e.target.value)}
              />
              <small>Optional. The publication name citations are printed under.</small>
            </label>
          </div>

          <div>
            <p className="p-sectionlab">Add the material</p>
            <div className="p-choices">
              <section className="p-choice">
                <h4>Upload a PDF, or a zip of PDFs</h4>
                <p>
                  Pages are preserved so instructors and learners can inspect a cited passage. A zip
                  becomes one document per PDF, grouped under its collection.
                </p>
                <div className="p-filepick">
                  <label className="p-btn ghost p-filebtn">
                    <input
                      type="file"
                      accept="application/pdf,.pdf,application/zip,application/x-zip-compressed,.zip"
                      aria-label="PDF or zip source file"
                      onChange={(e) => { setFile(e.target.files?.[0] || null); setBatch(null); setErr(null); }}
                    />
                    {file ? 'Choose a different file' : 'Choose a PDF or zip'}
                  </label>
                  <span className="p-filename">{file ? file.name : 'No file chosen'}</span>
                </div>
                <label className="p-field">
                  <span>Collection</span>
                  <input
                    className="p-input"
                    aria-label="Collection"
                    placeholder={zipSelected ? `Defaults to "${collectionFromFilename(file.name)}"` : 'e.g. Lesson plans'}
                    value={collection}
                    onChange={(e) => setCollection(e.target.value)}
                    maxLength={80}
                  />
                  <small>Optional. Groups the documents together and prefixes their citation labels.</small>
                </label>
                <button
                  type="button"
                  className="p-btn"
                  onClick={zipSelected ? handleZipUpload : handlePdfUpload}
                  disabled={busy || !file || Boolean(batch?.running)}
                >
                  {batch?.running
                    ? `Uploading ${batch.done}/${batch.total}…`
                    : pdfUpload.loading
                      ? 'Uploading…'
                      : zipSelected ? 'Upload zip' : 'Upload PDF'}
                </button>
                {batch && !batch.running && (
                  <div role="status" style={{ marginTop: '0.5rem' }}>
                    <p className="p-src" style={{ margin: 0 }}>
                      {batch.done - batch.failed.length} of {batch.total} added
                      {batch.failed.length > 0 ? `, ${batch.failed.length} refused` : ''}.
                    </p>
                    {batch.failed.length > 0 && (
                      // Named rather than counted: a refused PDF is one the
                      // instructor has to go and look at, and the rest landed.
                      <ul style={{ margin: '0.35rem 0 0', paddingLeft: '1.1rem' }}>
                        {batch.failed.map((entry) => (
                          <li key={entry.path} style={{ fontSize: '0.86em' }}>{entry.path} — {entry.error}</li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}
              </section>

              <section className="p-choice">
                <h4>Paste text</h4>
                <p>For an extract, or a document you already hold as text. A title is required.</p>
                <label className="p-field">
                  <span>Source text</span>
                  <textarea
                    className="p-input"
                    aria-label="Source text"
                    placeholder="Paste source text here…"
                    value={text}
                    onChange={(e) => setText(e.target.value)}
                    rows={3}
                  />
                </label>
                <button
                  type="button"
                  className="p-btn"
                  onClick={handleSubmit}
                  disabled={busy || !title.trim() || !text.trim()}
                >
                  {ingest.loading ? 'Saving…' : 'Save text source'}
                </button>
              </section>
            </div>
          </div>

          {err && <p className="s-shell-error" role="alert">{err}</p>}
        </div>

        <div className="p-modalfoot">
          <span className="p-footnote">A new source is PENDING until you approve it.</span>
          <button className="p-btn ghost" onClick={reset} disabled={busy}>
            {batch && !batch.running ? 'Close' : 'Cancel'}
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
                  </div>
                  <div className="s-card-school">
                    {c.sections} sections · <strong>{c.hasPendingRevision || c.record?.hasPendingRevision ? `${c.status === 'APPROVED' ? 'Published' : 'Draft'} · revision needs review` : c.status === 'APPROVED' ? 'Published' : 'Needs review'}</strong>
                  </div>
                </div>
                <span className="s-quick-arrow">→</span>
              </button>
              <RowActions
                label="course"
                title={c.name || c.title}
                endpoint={`/api/learning/courses/${c.id}`}
                canRename
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
  // The stream ended without reporting how it ended — see handleSubmit.
  const [lostStream, setLostStream] = useState(false);
  const draft = useApiStream('/courses/draft/stream');
  const approvedSources = sources.filter((source) => source.status === 'APPROVED');
  const approvedGroups = groupSourcesByCollection(approvedSources).length;
  const selectedIds = sourceIds.filter((id) => approvedSources.some((source) => source.id === id));

  const handleSubmit = async () => {
    if (selectedIds.length === 0 || draft.loading) return;
    setErr(null);
    setEvents([]);
    setLostStream(false);
    // Whether the stream ever opened. A throw before the first event is a
    // request that failed; a throw after one is a connection that died under a
    // generation the server is still running, which is a different fact.
    let reported = false;
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
        (event) => {
          reported = true;
          setEvents((current) => [...(current || []), event]);
        },
      );
      // The stream carries its own failure so the partial progress stays on
      // screen next to the reason, rather than collapsing to one error line.
      if (last?.phase === 'failed') return;
      if (last?.phase !== 'saved') {
        // draftCourseStream ends with 'saved' or 'failed'. Neither arrived, so
        // the response body ended early — a proxy idle timeout, a dropped
        // connection, a machine that slept — while the generation it was
        // reporting on carried on server-side and saved minutes later. Falling
        // through silently here is the whole defect: the instructor is shown a
        // stalled list and no outcome, concludes it failed, and generates the
        // same course a second time. Say what is actually known instead, and
        // refresh the library now in case it has already landed.
        setLostStream(true);
        await onDrafted?.();
        return;
      }
      setOpen(false);
      setTitle('');
      setObjective('');
      setSourceIds([]);
      setEvents(null);
      onDrafted(last.record);
    } catch (e) {
      // Once the stream had opened, the read that threw is the connection
      // breaking, not the draft failing. "Failed to draft course" would be the
      // client asserting an outcome it does not have — and the outcome it
      // guesses is the one that gets the course generated twice.
      if (reported) {
        setLostStream(true);
        await onDrafted?.();
        return;
      }
      setErr(errText(e, 'Failed to draft course'));
    }
  };

  const closeModal = () => {
    setOpen(false);
    setEvents(null);
    // A generation this modal lost the stream to may have finished saving while
    // the notice was on screen, so leave the library showing what is there now.
    if (lostStream) {
      setLostStream(false);
      onDrafted?.();
    }
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

  /* Once the stream is running, the work is the content. The setup folds into
     a disclosure so live progress sits at the top of the body rather than
     below a form nobody is editing any more — at 1440x675 it was under the
     fold. A <details> rather than another piece of state: the instructor can
     still open it to check what they asked for, and nothing here has to
     remember that they did. */
  const generating = draft.loading || Array.isArray(events);

  /* The form, lifted out so it can be shown two ways: plainly while the
     instructor is filling it in, and folded into a disclosure once the
     stream starts, when the work is what they came to watch. */
  const setup = (
    <>
    <div>
      <p className="p-sectionlab">Sources</p>
      <div className="p-btnrow">
        <IngestSourceModal onIngested={onRetrySources} variant="ghost" />
      </div>
      {sources.filter((source) => source.status === 'PENDING').map((source) => (
        <details className="p-disclose" key={source.id} style={{ margin: '0.75rem 0' }}>
          <summary>{source.title} · Review and approve source</summary>
          <SourceCard source={source} onApproved={onRetrySources} />
        </details>
      ))}
      <fieldset
        disabled={sourceUnavailable}
        style={{
          border: '1px solid var(--p-border-strong)',
          borderRadius: '12px',
          padding: '0.65rem 0.8rem',
          margin: '0.75rem 0 0',
        }}
      >
        <legend style={{ padding: '0 0.35rem', fontSize: '0.82em', fontWeight: 600, color: 'var(--p-dim)' }}>
          Approved sources
        </legend>
        {approvedSources.map((s) => (
          <label key={s.id} style={{ display: 'flex', gap: '0.6rem', alignItems: 'flex-start', padding: '0.35rem 0', cursor: 'pointer' }}>
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
        <div className="s-shell-error" role="alert" style={{ marginTop: '0.75rem' }}>
          <p style={{ margin: '0 0 0.5rem' }}>{errText(sourcesError, 'Could not load approved sources.')}</p>
          <button type="button" className="p-btn ghost" onClick={onRetrySources}>Retry loading sources</button>
        </div>
      )}
      {sourcesLoading && <p role="status" style={{ marginTop: '0.75rem' }}>Loading sources…</p>}
      {!sourcesLoading && !sourcesError && approvedSources.length === 0 && (
        <p className="p-src" style={{ margin: '0.75rem 0 0' }}>No approved sources yet. Add a source above, then open its review and approve it.</p>
      )}
    </div>

    <div>
      <p className="p-sectionlab">Generate from selected sources</p>
      <p className="p-src" style={{ margin: '0 0 0.75rem' }}>
        The title and objectives are written from the sources you select. Fill either in only to
        override what the model would choose.
      </p>
      <div className="p-fieldset">
        <label className="p-field">
          <span>Course title</span>
          <input
            className="p-input"
            aria-label="Course title"
            placeholder="Written from the sources"
            value={title}
            onChange={(e) => setTitle(e.target.value)}
          />
        </label>
        <label className="p-field">
          <span>Objectives</span>
          <textarea
            className="p-input"
            aria-label="Course objectives"
            placeholder="One per line"
            value={objective}
            onChange={(e) => setObjective(e.target.value)}
            rows={4}
          />
          <small>Typed objectives are grounded exactly as written and skip outline generation.</small>
        </label>
      </div>
    </div>
    </>
  );

  return (
    <div className="p-modalback">
      <div className="p-panel p-modal p-modal-lg" role="dialog" aria-modal="true" aria-label="Create course">
        <div className="p-modalhead">
          <h3>Create course</h3>
          <p>Add a PDF or paste text, review and approve it, then select it for this course. Existing approved sources can be reused.</p>
        </div>

        <div className="p-modalbody">
          {generating ? (
            <details className="p-setup">
              <summary>Sources and generation settings</summary>
              {setup}
            </details>
          ) : setup}

          {err && <p className="s-shell-error" role="alert">{err}</p>}
          {Array.isArray(events) && (
            <section className="p-progress" aria-label="Course generation progress" aria-live="polite">
              <GenerationProgress events={events} interrupted={lostStream} />
            </section>
          )}
        </div>

        {/* When the stream was lost, the notice above says in words that
            generating again is what produces two copies of the course. The
            buttons have to say the same thing, because on a modal footer the
            buttons are what gets read: the crimson primary WAS "Try again",
            which is the one action the paragraph beside it asks the instructor
            not to take, and an affordance beats a sentence every time.

            Keyed on the same condition the notice is, `events` included, so
            the footer can never contradict a paragraph that is not there.

            So the roles swap. Waiting is the correct action, so waiting gets
            the primary; regenerating stays reachable, at ghost weight, named
            for what it actually does rather than as a neutral retry. This is
            the only state where the two differ -- a generation that failed
            outright has nothing to duplicate, and "Try again" is right there. */}
        {lostStream && Array.isArray(events) ? (
          <div className="p-modalfoot">
            <button className="p-btn ghost" onClick={handleSubmit} disabled={draft.loading || sourceUnavailable || selectedIds.length === 0}>
              Generate a second copy anyway
            </button>
            <button className="p-btn" onClick={closeModal} disabled={draft.loading}>
              Close and check the course list
            </button>
          </div>
        ) : (
          <div className="p-modalfoot">
            <button className="p-btn ghost" onClick={closeModal} disabled={draft.loading}>
              {Array.isArray(events) && !draft.loading ? 'Close' : 'Cancel'}
            </button>
            <button className="p-btn" onClick={handleSubmit} disabled={draft.loading || sourceUnavailable || selectedIds.length === 0}>
              {draft.loading ? 'Generating…' : Array.isArray(events) ? 'Try again' : 'Generate course'}
            </button>
          </div>
        )}
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
  // Matches the backend's one-time id normalisation. New payloads always carry
  // persisted ids; this fallback only keeps pre-id records addressable.
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

/* Which choice is keyed correct, by position and by text.
   `correctOptionId` is resolved in questionBlock above, from whichever of the
   payload shapes this draft uses; an id that matches no option means the key
   did not survive, and that has to be said rather than shown as "no key". */
function keyedAnswer(question) {
  const options = Array.isArray(question?.options) ? question.options : [];
  const index = options.findIndex((option) => option?.id === question?.correctOptionId);
  if (index < 0) return null;
  return { position: index + 1, text: options[index]?.text || '' };
}

function QuestionRevisionControl({ question, version, onSubmit, busy }) {
  const keyed = keyedAnswer(question);
  return (
    <div className="course-question-review">
      <div className="course-question-review-head">
        <span>Question review · {question.phase}</span>
        <code>{question.questionId}</code>
      </div>
      {/* The answer key, written out.

          The preview above renders the choices as buttons a learner picks from:
          nothing marks the key, and clicking one grades that click rather than
          revealing the key. An instructor was therefore being asked to ratify
          an answer key by guessing at it, under a banner promising the keys are
          theirs to see. The rationale goes with it — it is the evidence for the
          key, and it is otherwise only reachable by picking the right choice. */}
      <div className="course-question-review-key">
        {keyed ? (
          <p>
            <span>Keyed answer</span> {keyed.position}. {keyed.text}
          </p>
        ) : (
          <p className="is-unkeyed">
            No keyed answer on this question — it cannot be scored until a revision supplies one.
          </p>
        )}
        {question.explanation ? <p className="is-rationale">{question.explanation}</p> : null}
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
  // The SCORM version a refused export offered to package as a ratified subset.
  const [partialExport, setPartialExport] = useState(null);
  const { data: envelope, loading, error: draftError, refetch } = useApiQuery(`/courses/${course.id}`);
  const { data: sources } = useApiQuery('/sources');
  const revise = useApiMutation(`/courses/${course.id}/revise`, 'POST');
  const approve = useApiMutation(`/courses/${course.id}/approve`, 'POST');
  const writePages = useApiMutation(`/courses/${course.id}/pages`, 'POST');
  const [preview, setPreview] = useState(false);

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

  // Lesson pages are a second grounded pass over each section's passage.
  // New drafts get them during generation; this writes them for a course
  // drafted before that pass existed, or fills in sections it refused.
  const handleWritePages = async () => {
    setErr(null);
    setNotice('');
    try {
      const result = await writePages.mutate();
      const written = result?.sections?.filter((s) => s.pages > 0).length || 0;
      setNotice(`Lesson pages written for ${written} of ${result?.sections?.length || 0} sections.`);
      await refresh();
    } catch (error) {
      setErr(errText(error, 'Lesson pages could not be written.'));
    }
  };

  /* The export refuses a course that is still part-way through item review,
     and names what is unratified. An instructor who genuinely wants the
     ratified subset -- to pilot it in the receiving LMS while review continues
     -- says so on a second, deliberate click; the package they get is labelled
     a partial release inside its own manifest. The offer only appears after the
     server has refused, so the safe export stays the one button. */
  const exportScorm = (release, { partial = false } = {}) => {
    setErr(null);
    setPartialExport(null);
    return downloadAuthenticated(
      `/api/learning/export?courseId=${course.id}&version=${release}${partial ? '&partial=true' : ''}`,
      `${course.id}-scorm-${release}${partial ? '-partial' : ''}.zip`,
    ).catch((error) => {
      setErr(error.message);
      if (!partial && /awaiting instructor review/.test(error.message || '')) setPartialExport(release);
    });
  };

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
          {/* A gap in what the course teaches is a fact the approver needs at
              full size, not at footnote size in the faint grey. */}
          <p className="p-sectionlab">Not covered by this course</p>
          <ul style={{ margin: '0.4rem 0 0', paddingLeft: '1.1rem', fontSize: '0.9em', lineHeight: 1.5 }}>
            {notCovered.map((entry) => (
              <li key={entry.objective} style={{ marginBottom: '0.25rem' }}>
                {entry.objective}
                {entry.reason ? <span style={{ color: 'var(--p-dim)' }}> &mdash; {entry.reason}</span> : null}
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
        <button type="button" className={`p-btn${preview ? '' : ' ghost'}`} onClick={() => setPreview((v) => !v)} disabled={showingLoading}>
          {preview ? 'Back to review' : 'Preview as a learner'}
        </button>
        {!showingLoading && sections.some((s) => s?.lesson && !s.refused) && (
          <button type="button" className="p-btn ghost" onClick={handleWritePages} disabled={writePages.loading || Boolean(pendingRevision) || approve.loading}>
            {writePages.loading
              ? 'Writing lesson pages…'
              : sections.some((s) => Array.isArray(s?.pages) && s.pages.length)
                ? `Rewrite lesson pages (${sections.filter((s) => Array.isArray(s?.pages) && s.pages.length).length}/${sections.filter((s) => s?.lesson && !s.refused).length} written)`
                : 'Write lesson pages'}
          </button>
        )}
        {status === 'APPROVED' && !hasPendingRevision && (
          <>
            <button type="button" className="p-btn ghost" onClick={() => exportScorm('1.2')}>Export SCORM 1.2</button>
            <button type="button" className="p-btn ghost" onClick={() => exportScorm('2004')}>Export SCORM 2004</button>
            {partialExport && (
              <button type="button" className="p-btn ghost" onClick={() => exportScorm(partialExport, { partial: true })}>
                Export the ratified subset as a partial release
              </button>
            )}
          </>
        )}
      </div>

      {preview && !showingLoading && (
        <div className="p-panel" style={{ marginBottom: '1.25rem' }}>
          <p className="p-src" style={{ marginTop: 0 }}>
            Exactly what a learner sees, on the same player. Your copy carries the answer keys, so checks grade here; a learner&apos;s copy does not, and grades on the server.
          </p>
          <CoursePreview key={version} course={{ id: course.id, name: draft?.title || course.name || 'Course draft' }} draft={draft} />
        </div>
      )}

      {!preview && <CourseReadiness
        courseId={course.id}
        version={version}
        candidate={draft}
        pending={hasPendingRevision}
        published={status === 'APPROVED'}
        busy={approve.loading || Boolean(pendingRevision)}
        unavailable={showingLoading || Boolean(draftError) || !envelope}
        onApprove={handleApprove}
      />}

      {/* Approving the course released this snapshot; it did not release the
          items in it. Every materialised item starts PENDING and a learner only
          ever sees APPROVED, so the gate stays open until a human closes it. */}
      {status === 'APPROVED' && !showingLoading && !preview && (
        <CourseItemReview courseId={course.id} onChanged={onChanged} />
      )}

      {showingLoading && <p>Loading generated course…</p>}
      {!showingLoading && !preview && (
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
      <details className="p-panel p-disclose">
        <summary>Optional learning tools · syllabus and mastery plan</summary>
        <p className="p-src">These tools do not block course publication. Objective rubrics and Fidelity check are in the rail, under Quality checks.</p>
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
