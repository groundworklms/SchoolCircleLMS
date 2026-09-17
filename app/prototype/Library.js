'use client';

import { useEffect, useReducer, useRef, useState } from 'react';
import { downloadAuthenticated, useApiQuery, useApiMutation, useCourseJob } from '../_learning/useLearning';
import CourseLesson from '../_course/CoursePresentation';
import { pageOf, publicationName, withoutPage } from '../_course/provenance';
import { InstructorMasteryPlan, InstructorSyllabus } from './InstructorFeatures';
import { CourseReadiness } from './CourseReadiness';
import { CourseItemReview } from './ItemReview';
import { GenerationProgress, ThinCoverageNotice, skippedByReason } from './GenerationProgress';
import { CoursePreview } from './LearnerFeatures';
import { RowActions } from './RowActions';
import { SourceLibraryCard, SourcePreviewDialog } from './SourceLibraryPreview';
import { collectionFromFilename, isPdfFile, isZipFile, pdfEntriesFromZip, zipEntryForm } from './source-upload';
import { groupSourcesByCollection, sourceMatchesQuery } from './source-groups';
import { CoursePlanner, PlanCourseModal, PlansList, usePlans } from './CoursePlanner';
import './source-library.css';

/* The instructor library — the parts of the persisted learning loop that are
   not tied to one course on screen: source documents (Quarry) and the course
   drafts they feed (Coursewright). Every approval here is a human click; the
   server never self-approves, and a learner never sees anything PENDING. */

function errText(e, fallback) {
  return e?.error || e?.message || fallback;
}

/* ---------- sources ---------- */

export { groupSourcesByCollection } from './source-groups';

/* A collection larger than this opens collapsed: the Basic Electronics zip is a
   hundred lesson PDFs and a shelf that renders them all buries every other
   collection under a single wall of cards. Small collections stay open -- there
   is nothing to hide behind a disclosure. */
const SHELF_COLLAPSE_OVER = 12;

export function SourcesView() {
  const { data: sources, loading, error, refetch } = useApiQuery('/sources');
  const [previewSource, setPreviewSource] = useState(null);
  const [query, setQuery] = useState('');
  const groups = groupSourcesByCollection(sources);
  const pendingState = loading || (sources == null && !error);

  // Filter each collection by the search box, then drop the ones a search
  // emptied. The counts and pending tallies shown on a shelf are the filtered
  // view's, so "12 documents" always matches what is under the heading.
  const needle = query.trim();
  const visibleGroups = groups
    .map((group) => {
      const matched = group.sources.filter((src) => sourceMatchesQuery(src, needle));
      return { ...group, sources: matched, pending: matched.filter((s) => s.status !== 'APPROVED') };
    })
    .filter((group) => group.sources.length > 0);
  const totalCount = groups.reduce((sum, group) => sum + group.sources.length, 0);
  const searching = needle.length > 0;

  return (
    <>
      <div className="s-pagehead s-pagehead-row source-library-head">
        <div>
          <h1>Source documents</h1>
        </div>
        <IngestSourceModal onIngested={refetch} />
      </div>

      {/* The search box only earns its place once there are enough documents to
          scroll past; below that the shelves are the whole list. */}
      {!pendingState && !error && totalCount > SHELF_COLLAPSE_OVER && (
        <div className="source-search">
          <input
            type="search"
            className="p-input source-search-input"
            aria-label="Search source documents by title"
            placeholder={`Search ${totalCount} documents by title…`}
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
      )}

      {pendingState && <SourceShelfSkeleton />}
      {error && <div className="s-shell-error source-library-error" role="alert"><p>{errText(error, 'Could not load sources.')}</p><button className="p-btn ghost" onClick={refetch}>Try again</button></div>}
      {!pendingState && !error && (
        <div className="source-library">
          {groups.length === 0 && <SourceShelf title="Source documents" count={0} empty="No documents yet. Add a PDF, a zip of PDFs, or pasted text." />}
          {groups.length > 0 && visibleGroups.length === 0 && (
            <p className="source-search-empty" role="status">No documents match “{needle}”.</p>
          )}
          {visibleGroups.map((group) => (
            <SourceShelf
              key={group.name}
              title={group.name}
              count={group.sources.length}
              pendingCount={group.pending.length}
              // Open when small, or whenever a search is narrowing the list --
              // a match hidden inside a collapsed shelf reads as no match.
              defaultOpen={group.sources.length <= SHELF_COLLAPSE_OVER}
              forceOpen={searching}
              // A whole collection the instructor does not own is preview-only:
              // the server refuses rename and delete on records that are not
              // theirs, so say so once on the heading rather than leaving every
              // card looking like a removal that silently does nothing.
              note={group.sources.every((s) => !s.canRemove)
                ? 'Shared with you — preview only. The account that added these manages them.'
                : null}
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

function SourceShelf({ title, count, pendingCount = 0, empty, actions, note = null, children, defaultOpen = true, forceOpen = false }) {
  const [open, setOpen] = useState(defaultOpen);
  // forceOpen (an active search) wins over the manual state so a filtered shelf
  // can never hide a hit behind its own disclosure.
  const isOpen = forceOpen || open;
  const caption = pendingCount > 0
    ? `${count} ${count === 1 ? 'document' : 'documents'} · ${pendingCount} ${pendingCount === 1 ? 'needs' : 'need'} approval`
    : `${count} ${count === 1 ? 'document' : 'documents'}`;
  return (
    <details
      className="source-shelf"
      aria-label={title}
      open={isOpen}
      onToggle={(e) => { if (!forceOpen) setOpen(e.currentTarget.open); }}
    >
      <summary className="source-shelf-heading">
        <span className="source-shelf-title"><h2>{title}</h2><span>{caption}</span></span>
      </summary>
      {actions && <div className="source-shelf-actions">{actions}</div>}
      {note && <p className="source-shelf-note">{note}</p>}
      {count === 0
        ? <div className="source-shelf-empty">{empty}</div>
        : (isOpen ? <div className="source-card-list">{children}</div> : null)}
    </details>
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
  // Named "loading", not left to read as an empty library. The 1.6s /sources
  // call used to leave the page as a bare header an instructor could easily
  // take for "you have no sources"; this says which it is.
  return (
    <div className="source-library" aria-label="Loading source library">
      <p className="source-loading-caption" role="status">Loading your sources…</p>
      <section className="source-shelf"><div className="source-skeleton title" /><div className="source-skeleton card" /><div className="source-skeleton card" /></section>
      <section className="source-shelf"><div className="source-skeleton title" /><div className="source-skeleton card" /></section>
    </div>
  );
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
          <p>Saved to your source library. Approve it before generating a course.</p>
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
                  A zip becomes one document per PDF, grouped under its collection.
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
  // The Courses page shows no source list of its own -- only the two creation
  // modals read sources, and only once opened. Fetching on page load spent
  // ~1.5s on a request nothing on screen uses, so defer it until the instructor
  // reaches for either modal (hover, focus or click of the button row below).
  // useReducer, never useState, for the same reason openPlanId below is one: the
  // test harness feeds useState positionally and a slot here would shift every
  // slot the modals expect.
  const [sourcesWanted, wantSources] = useReducer(() => true, false);
  const {
    data: sources,
    loading: sourcesLoading,
    error: sourcesError,
    refetch: refetchSources,
  } = useApiQuery('/sources', { enabled: sourcesWanted });
  // A whole-course plan opens in place of the library; the shell's course
  // navigation is unchanged, and the plan hands off to onOpen for its draft.
  const plans = usePlans();
  // useReducer rather than useState on purpose: the render harness in
  // tests/ui-rendering.test.mjs feeds useState positionally, and a state
  // slot here would shift every slot the draft dialog below expects.
  const [openPlanId, setOpenPlanId] = useReducer((_, next) => next, null);
  if (openPlanId) {
    return (
      <CoursePlanner
        planId={openPlanId}
        onBack={() => { setOpenPlanId(null); plans.refetch(); onDrafted?.(); }}
        onOpenCourse={(id) => { onDrafted?.(); onOpen(id); }}
      />
    );
  }
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
        {/* Reaching for either creation control -- hovering, tabbing to it, or
            clicking it -- is what pulls the source list, so the deferred fetch
            is in flight before the modal it feeds has finished opening. */}
        <div className="p-btnrow" onPointerEnter={wantSources} onFocusCapture={wantSources} onClickCapture={wantSources}>
          <PlanCourseModal
            sources={Array.isArray(sources) ? sources : []}
            onCreated={(plan) => { plans.refetch(); setOpenPlanId(plan.id); }}
          />
          <DraftCourseModal
            courses={Array.isArray(courses) ? courses : []}
            sources={Array.isArray(sources) ? sources : []}
            sourcesLoading={sourcesPending}
            sourcesError={sourcesError}
            onRetrySources={refetchSources}
            onDrafted={onDrafted}
          />
        </div>
      </div>

      {/* The two controls do different jobs and sat unlabelled side by side. */}
      <p className="p-src s-courses-hint">
        <strong>Plan a full course</strong> builds a multi-section course from many sources.
        {' '}<strong>Create course</strong> generates a single draft from the sources you pick.
      </p>

      <PlansList plans={Array.isArray(plans.data) ? plans.data : []} onOpen={setOpenPlanId} onChanged={plans.refetch} />

      {loading && <p>Loading courses…</p>}
      {error && <p className="s-shell-error" role="alert">{errText(error, 'Could not load courses.')}</p>}
      {sourcesWanted && sourcesPending && <p>Loading approved sources…</p>}
      {sourcesError && (
        <div className="s-shell-error" role="alert">
          <p style={{ margin: '0 0 0.5rem' }}>
            {errText(sourcesError, 'Could not load approved sources.')}
          </p>
          <button type="button" className="p-btn ghost" onClick={refetchSources}>Retry loading sources</button>
        </div>
      )}
      {!sourcesPending && !sourcesError && Array.isArray(sources) && approvedSources.length === 0 && (
        <p>No approved sources yet. Use Create course to add and approve them.</p>
      )}
      {!loading && !error && courses.length === 0 && <p>No courses yet. Create one from your sources.</p>}
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

// How often the library is refreshed while waiting for a generation whose
// stream was lost, and for how long. Ten seconds is frequent enough that the
// course appears within a beat of being saved, and ten minutes is longer than
// any generation observed while being slow enough to be nearly free.
const WATCH_INTERVAL_MS = 10000;
const WATCH_LIMIT_MS = 600000;

function DraftCourseModal({ courses = [], sources, sourcesLoading, sourcesError, onRetrySources, onDrafted }) {
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
  /* Which courses existed when this generation started.
   *
   * The stream is the REPORTING; the generation is a server-side job that
   * carries on without it. So a dropped connection -- a deploy rolling the
   * proxy idle timeout, a laptop sleeping -- leaves a course that finishes and
   * saves minutes later with nobody watching. Telling the instructor to go and
   * look in a few minutes was honest and it was work this screen can do
   * itself: a course whose id was not here when we started is the one this run
   * produced.
   *
   * ONE CASE THIS CANNOT RESCUE, observed on 2026-09-17: when the connection
   * drops because the SERVER was replaced -- a deploy rolling the instance
   * mid-generation -- the job died with it, and there is no course coming. The
   * watch below is indistinguishable from the other cases while it runs, so it
   * waits out its window and then stops. That is the right behaviour, and it
   * is worth knowing that a deploy during a generation costs that generation:
   * the only real fix is generation that survives its process, which is a
   * queue and a job record rather than a request. */
  const knownCourseIds = useRef(null);
  /* A course the snapshot did not have is the one this run produced.
   * Derived rather than held in state: it is a fact about the props this
   * render already has, and a copy of it could only ever disagree with them. */
  const arrived =
    lostStream && knownCourseIds.current
      ? courses.find((course) => course?.id && !knownCourseIds.current.has(course.id)) || null
      : null;
  /* A job, not a held-open stream.
   *
   * The stream was cut at five minutes by the platform, which on a real course
   * is around section five -- and the generation died with it, so the modal's
   * "the reporting stopped, not the generation" was true of the design and not
   * of what happened. Generation now runs off the request and this polls it.
   * See lib/learning/job.js. */
  const draft = useCourseJob();
  const approvedSources = sources.filter((source) => source.status === 'APPROVED');
  const approvedGroups = groupSourcesByCollection(approvedSources);
  const selectedIds = sourceIds.filter((id) => approvedSources.some((source) => source.id === id));

  const handleSubmit = async () => {
    if (selectedIds.length === 0 || draft.loading) return;
    setErr(null);
    setEvents([]);
    setLostStream(false);
    knownCourseIds.current = new Set(courses.map((course) => course?.id).filter(Boolean));
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
        },
        (event) => {
          reported = true;
          setEvents((current) => [...(current || []), event]);
        },
      );
      // A job whose row stopped being written to. The instance that owned it is
      // gone -- which is what a deploy mid-generation looks like from here --
      // and that is a different thing from a connection dropping under a
      // generation still running: there is nothing to wait for.
      // Polling gave up after a run of failed requests. The job is unaffected
      // -- it is a row, and the watch below finds the course it produces -- so
      // this reports the same way a stall does rather than as a failure.
      if (last?.phase === 'unreachable' || last?.phase === 'stalled') {
        setLostStream(true);
        await onDrafted?.();
        return;
      }
      // The job carries its own failure so the partial progress stays on
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

  /* Keep looking, and stop as soon as it lands.
   *
   * Refetching once at the moment the stream drops almost never finds it: the
   * generation still has sections to write. So the library is refreshed on an
   * interval until a course appears that was not in the snapshot, or until the
   * window closes -- long enough for a twelve-section course, and bounded so a
   * generation that really did die does not leave a tab polling forever. */
  useEffect(() => {
    if (!lostStream || arrived) return undefined;
    let cancelled = false;
    let elapsed = 0;
    const timer = setInterval(() => {
      elapsed += WATCH_INTERVAL_MS;
      if (cancelled) return;
      if (elapsed >= WATCH_LIMIT_MS) {
        clearInterval(timer);
        return;
      }
      onDrafted?.();
    }, WATCH_INTERVAL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [lostStream, arrived, onDrafted]);

  /* Pick up a generation that is already running.
   *
   * A job lives on a row rather than in this tab, so a reload, a second tab or
   * a laptop that slept leaves one running with nobody watching -- and the
   * polling is what keeps the server working on it, so nobody watching is
   * exactly how a job stalls. Asking on the way in both reattaches the report
   * and restarts the work.
   *
   * Once, on mount. A generation the instructor starts from this modal is
   * followed by handleSubmit already, and asking again would have two loops
   * feeding the same event list.
   */
  const rejoined = useRef(false);
  useEffect(() => {
    if (rejoined.current) return;
    rejoined.current = true;
    let cancelled = false;
    (async () => {
      const jobs = await draft.running();
      const job = jobs[0];
      if (cancelled || !job?.id) return;
      setOpen(true);
      setEvents([]);
      knownCourseIds.current = new Set(courses.map((course) => course?.id).filter(Boolean));
      try {
        const last = await draft.follow(job.id, (event) => {
          setEvents((current) => [...(current || []), event]);
        });
        if (cancelled) return;
        if (last?.phase === 'saved') {
          setOpen(false);
          setEvents(null);
          onDrafted?.(last.record);
          return;
        }
        if (last?.phase === 'unreachable' || last?.phase === 'stalled') {
          setLostStream(true);
          await onDrafted?.();
        }
      } catch {
        // A job that cannot be followed is not a page that should fail to
        // load. The course list behind this is still correct.
        if (!cancelled) setLostStream(true);
      }
    })();
    return () => { cancelled = true; };
    // Deliberately not re-run: `rejoined` makes it once-only, and listing the
    // changing props would only make that harder to see.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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
        {approvedGroups.map((group) => {
          const groupIds = group.sources.map((source) => source.id);
          const allSelected = groupIds.every((id) => selectedIds.includes(id));
          /* A collection is usually a whole zip -- fifty lesson plans -- and a
             course is usually built from all of it, so the group toggles as one.
             The heading is skipped when the list is short and ungrouped: a
             single document does not need a "Select all 1". */
          const showHeading = approvedGroups.length > 1 || groupIds.length > 1;
          return (
            <div key={group.name} className="source-pick-group">
              {showHeading && (
                <div className="source-pick-heading">
                  <strong>{group.name}</strong>
                  <button
                    type="button"
                    className="p-btn ghost"
                    aria-label={allSelected ? `Clear ${group.name}` : `Select all ${groupIds.length} in ${group.name}`}
                    onClick={() => setSourceIds((current) => allSelected
                      ? current.filter((id) => !groupIds.includes(id))
                      : [...current, ...groupIds.filter((id) => !current.includes(id))])}
                  >
                    {allSelected ? 'Clear' : `Select all ${groupIds.length}`}
                  </button>
                </div>
              )}
              {group.sources.map((s) => (
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
                    <small style={{ display: 'block', color: 'var(--p-faint)' }}>
                      {s.pages || 0} pages{s.sourceId && s.sourceId !== s.title ? ` · ${s.sourceId}` : ''}
                    </small>
                  </span>
                </label>
              ))}
            </div>
          );
        })}
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
        <p className="p-src" style={{ margin: '0.75rem 0 0' }}>No approved sources yet. Add one above, then approve it.</p>
      )}
    </div>

    <div>
      <p className="p-sectionlab">Generate from selected sources</p>
      <p className="p-src" style={{ margin: '0 0 0.75rem' }}>
        Title and objectives are written from your selected sources. Fill either in only to override.
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
          <p>Add a PDF or paste text, approve it, then select it. Existing approved sources can be reused.</p>
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
              <GenerationProgress events={events} interrupted={lostStream} watching={lostStream && !arrived} arrived={Boolean(arrived)} />
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
            {/* Once the course has landed, regenerating is no longer a
                defensible second copy of something that might not exist -- it
                is a duplicate of a course sitting in the list. So the escape
                hatch goes away and the primary says what happened. */}
            {!arrived && (
              <button className="p-btn ghost" onClick={handleSubmit} disabled={draft.loading || sourceUnavailable || selectedIds.length === 0}>
                Generate a second copy anyway
              </button>
            )}
            <button className="p-btn" onClick={closeModal} disabled={draft.loading}>
              {arrived ? 'The course is ready — open the list' : 'Close and check the course list'}
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

/* Name a lesson's citation the same way the learner reader does.
   A section `cite` is "<source record id> p.N" (lib/learning/core.js
   `sourcePassages`) -- the record id is the authenticated page-opening key,
   never a citation a person reads. `course.sourcePublications` is the
   id -> publication label map getCourse already resolved server-side
   (`coursePublicationLabels`); it is the very map the learner reader names a
   citation from (LearnerFeatures `publicationFor`). Resolve the id to that
   publication and hand provenanceOf a `pubId`, so the builder prints
   "AY27 8670 ... Moodle p.135" exactly as the reader does instead of the raw
   key. An already-structured citation is left alone; a bare record id that
   will not resolve is withheld, because a key on screen is worse than no
   citation at all. */
function resolveLessonCitation(raw, sourcePublications) {
  if (raw && typeof raw === 'object') return raw;
  const locator = typeof raw === 'string' ? raw.trim() : '';
  if (!locator) return '';
  const key = withoutPage(locator);
  const label = sourcePublications && typeof sourcePublications === 'object' ? sourcePublications[key] : '';
  const name = typeof label === 'string' ? publicationName(label) : '';
  if (name) return { citation: locator, pubId: name, page: pageOf(locator) };
  // A cuid names nothing to a reader; withhold it rather than print the key.
  if (/^c[a-z0-9]{20,}$/i.test(key)) return '';
  return locator;
}

function courseLessons(course) {
  const sourcePublications = course?.sourcePublications;
  // The citation resolves off the id -> publication map, and the raw locator
  // rides in on `citation` (or a legacy `cite`); fold both into the resolved
  // `citation` so CoursePresentation's `citation || cite` cannot fall back to
  // the key it was meant to replace.
  const named = (lesson) => ({
    ...lesson,
    citation: resolveLessonCitation(lesson?.citation ?? lesson?.cite, sourcePublications),
    cite: undefined,
  });
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
      return named({ ...lesson, id: lessonId, sectionId, blocks, questionRefs });
    });
  }
  const sections = Array.isArray(course?.sections) ? course.sections : [];
  return sections.map((section, index) => named(lessonFromSection(section, index)));
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
              full size, not at footnote size in the faint grey -- but the
              COUNT is that fact, and the list is the detail behind it. A
              source with two dozen topics produced two dozen rows each ending
              in the same clause, which reads as two dozen failures when it is
              the course declining to claim coverage it does not have. Folded,
              grouped by reason, and phrased the same way the generation panel
              phrases it, because it is the same fact at a later moment. */}
          <details>
            <summary className="p-sectionlab" style={{ cursor: 'pointer', listStyle: 'revert' }}>
              {notCovered.length === 1
                ? '1 topic in these sources is not in this course'
                : `${notCovered.length} topics in these sources are not in this course`}
            </summary>
            {skippedByReason(notCovered).map((group) => (
              <div key={group.reason} style={{ marginTop: '0.5rem' }}>
                <p style={{ margin: 0, fontSize: '0.82em', color: 'var(--p-faint)' }}>{group.reason}</p>
                <ul style={{ margin: '0.2rem 0 0', paddingLeft: '1.1rem', fontSize: '0.9em', lineHeight: 1.5 }}>
                  {group.objectives.map((objective) => (
                    <li key={objective} style={{ marginBottom: '0.25rem' }}>{objective}</li>
                  ))}
                </ul>
              </div>
            ))}
          </details>
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
          <button type="button" className="p-btn ghost" onClick={handleWritePages} disabled={writePages.loading || Boolean(pendingRevision) || hasPendingRevision || approve.loading}>
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
            Exactly what a learner sees. Your copy carries the answer keys, so checks grade here; a learner&apos;s grades on the server.
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
        <p className="p-src">Optional; don&apos;t block publication. Objective rubrics and Fidelity check are in the rail, under Quality checks.</p>
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
