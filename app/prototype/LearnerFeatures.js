'use client';

import { useEffect, useRef, useState } from 'react';
import { downloadAuthenticated, useApiQuery, useApiMutation } from '../_learning/useLearning';
import CourseLesson from '../_course/CoursePresentation';
import { pageOf, publicationName } from '../_course/provenance';
import { SourceViewer } from './SourceViewer';

/* Learner-side arsenal features for a real (LearningRecord) course: the
   approved course as a reader, Whetstone mastery sessions, the Cadence study
   plan, Sextant progress and the Waypoint learning profile. Everything shown
   here came through an instructor's approval on the server — this UI never
   sees pending material, and it never fills a gap with a demo number. */

function errText(e, fallback) {
  return e?.error || e?.message || fallback;
}

function Err({ msg }) {
  return msg ? <p className="s-shell-error" role="alert">{msg}</p> : null;
}

function pct(v) {
  return typeof v === 'number' ? `${Math.round(v <= 1 ? v * 100 : v)}%` : '—';
}

/* ---------- course home ---------- */

export function RealCourseHome({ course, go }) {
  const { data: envelope, loading } = useApiQuery(`/courses/${course.id}`);
  /* Structure from the course record; COUNTS from the delivery projection.
     The record no longer carries the draft's questions to a learner (see
     lib/learning/core.js `learnerCourseProjection`), and counting them there
     was promising a number of checks that included ones no instructor had
     ratified. What is counted here is what this learner can actually open. */
  const { data: delivery } = useApiQuery(`/courses/${course.id}/attempts`);
  const draft = envelope?.course;
  const sections = draft?.sections || [];
  const objectives = draft?.objectives || [];
  const sourceId = draft?.sourceIds?.[0];
  const approvedChecks = (delivery?.items || []).length;

  return (
    <div className="s-two">
      <div>
        <div className="s-pagehead">
          <h1>{course.name}</h1>
          <p>{course.school}</p>
        </div>

        <div className="s-hero">
          <div className="s-hero-tile wide">
            <div className="s-label">Course</div>
            <div className="s-hero-num">
              {sections.length} <span>sections</span>
            </div>
            <div className="s-hero-sub">Drafted from the approved source and reviewed by your instructor.</div>
          </div>
          <div className="s-hero-tile">
            <div className="s-label">Items</div>
            <div className="s-hero-num">{approvedChecks}</div>
            <div className="s-hero-sub">approved pre and post checks</div>
          </div>
          <div className="s-hero-tile">
            <div className="s-label">Grounding</div>
            <div className="s-hero-num small" style={{ color: 'var(--p-good)' }}>Cited</div>
            <div className="s-hero-sub">every item traces to the source</div>
          </div>
        </div>

        {sections[0] && (
          <button className="s-continue" onClick={() => go('lessons')}>
            <span className="s-continue-body">
              <span className="s-continue-lab">Start with</span>
              <span className="s-continue-title">{sections[0].title || 'Section 1'}</span>
              <span className="s-continue-meta">Section 1 of {sections.length}</span>
            </span>
            <span className="s-continue-btn">Open lesson</span>
          </button>
        )}

        <h4 className="s-label">In this course</h4>
        <div className="s-quick">
          {[
            ['lessons', 'Lessons', 'The approved course, section by section, with its pre and post checks.'],
            ['mastery', 'Mastery session', 'Whetstone asks, you answer in your own words, it grades against the source.'],
            ['path', 'Learning Path', 'Three courses of action from the syllabus and your available time.'],
            ['progress', 'My Progress', 'What your saved sessions show. Yours only.'],
          ].map(([id, t, d]) => (
            <button className="s-quick-btn" key={id} onClick={() => go(id)}>
              <span className="s-quick-t">{t}</span>
              <span className="s-quick-d">{d}</span>
              <span className="s-quick-arrow">→</span>
            </button>
          ))}
        </div>

        {objectives.length > 0 && (
          <>
            <h4 className="s-label">Objectives</h4>
            <ol className="s-obj">
              {objectives.map((o) => (
                <li key={o}>{o}</li>
              ))}
            </ol>
          </>
        )}
        {loading && <p>Loading course…</p>}
      </div>

      <aside className="s-agenda">
        {sourceId && <SourceViewer sourceId={sourceId} compact />}
      </aside>
    </div>
  );
}

/* ---------- reader ---------- */

/**
 * The publication a course's sections cite, by name.
 *
 * A section's `cite` is "<source record id> p.85" — the record id is the
 * authenticated page-opening key (lib/learning/core.js `sourcePassages`), and
 * it is a cuid. A learner must never be handed that as a citation, and unlike
 * a materialised Item the section carries no `pubId` to use instead. The
 * approved-source list is the id -> publication-name map the Sources screen
 * already reads; it is the light projection (ids, titles, page counts — no
 * document text), so naming the publication costs one small request rather
 * than re-downloading the source.
 *
 * Returns '' until it resolves, and '' if the list cannot be read. The caller
 * withholds the citation line in that window rather than printing the key.
 */
function usePublicationName(sourceRecordId) {
  const { data } = useApiQuery('/sources', { enabled: Boolean(sourceRecordId) });
  if (!sourceRecordId || !Array.isArray(data)) return '';
  const record = data.find((source) => source?.id === sourceRecordId);
  // `sourceId` is the Anchor publication label ("TC 3-22.9"); `title` is the
  // document's own title, which is what a file upload records.
  return publicationName(record?.sourceId || record?.title || '');
}

/**
 * A fresh idempotency key per (check, chosen option).
 *
 * The same rule the published reader uses (app/prototype/published/client.js
 * `createStableAttemptManager`): a failed request keeps its key, so retrying
 * the SAME answer replays rather than banks a second attempt, while choosing a
 * different option is deliberately a new attempt and gets a new key.
 */
function attemptKeyFor(keys, itemId, optionId) {
  const previous = keys.get(itemId);
  if (previous && previous.optionId === optionId) return previous.attemptId;
  const attemptId = typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function'
    ? crypto.randomUUID()
    : `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  keys.set(itemId, { optionId, attemptId });
  return attemptId;
}

/**
 * What a learner is shown where an unratified lesson's prose would have gone.
 *
 * THE OPTIONS, AND WHY THIS ONE. Hiding the whole section was the obvious
 * alternative and is worse: section numbering is how a learner and an
 * instructor refer to the same thing out loud ("section 4"), the course would
 * silently shrink for some readers and not others, and any check in that
 * section that HAD been approved would quietly become unanswerable — evidence
 * missing from their record with nothing on screen to explain it. Leaving the
 * body blank is worse still: an empty page is indistinguishable from a broken
 * one, and a learner who cannot interpret it has no idea whether to wait, to
 * reload, or to ask.
 *
 * So the section stays, its approved checks stay, and the missing prose is
 * named. The copy says what SchoolCircle HAS done (drafted this section from
 * the source) and what it has NOT (had it approved), and it does not dress the
 * refusal up as an outage: this is the product working, and a learner reading
 * it should come away understanding the rule rather than suspecting a bug.
 *
 * PENDING and withheld read the same. The learner is told the text is not
 * approved, which is true of both; which way their instructor is leaning on a
 * passage is not theirs to read off a screen.
 */
function UnreleasedLesson({ publication, hasChecks }) {
  return (
    <aside className="s-ls-callout note" role="note">
      <div className="s-ls-callout-t">Lesson text not released</div>
      <p>
        SchoolCircle drafted this section from{' '}
        {publication ? <strong>{publication}</strong> : 'the approved source'}, and your
        instructor has not approved the text. Nothing unreviewed reaches a student, so
        it is not shown here.
      </p>
      <p>
        {hasChecks
          ? 'The checks below were approved separately and are yours to answer now.'
          : 'Nothing else in this section has been approved yet either, so there is nothing here to work through until your instructor has reviewed it.'}
      </p>
    </aside>
  );
}

/* The approved course, one section at a time.
 *
 * EVERY WORD OF CONTENT ON THIS SCREEN COMES FROM /courses/:id/attempts, which
 * returns only what an instructor has ratified item by item — the lesson prose
 * and the checks alike. That is the whole gate: a PENDING or withheld item is
 * simply not in that response, so it cannot be rendered, and the reader has
 * nothing to fall back on that would render it anyway.
 *
 * It used to be half true. The checks came from there, but the prose came from
 * the authoring draft at /courses/:id, which no ratification decision touches,
 * so a lesson an instructor had not approved — or had approved a DIFFERENT
 * wording of, since REVISE edits the row and not the draft — was what a learner
 * read. The course record is now used only for what course approval actually
 * released: the section list, their titles and order, and which source they are
 * grounded in.
 *
 * Answer keys and rationale are in neither response. The rationale reaches the
 * learner only in the reply to their own answer, after they have committed to a
 * choice. */
export function CourseReader({ course }) {
  const { data: envelope, loading, error } = useApiQuery(`/courses/${course.id}`);
  const { data: delivery } = useApiQuery(`/courses/${course.id}/attempts`);
  const record = useApiMutation(`/courses/${course.id}/attempts`, 'POST');
  const [i, setI] = useState(0);
  const [saving, setSaving] = useState({});
  // Answers recorded in THIS sitting, over the ones the server returned for
  // earlier ones. Both are the same shape the shared presentation reads, so a
  // reload and a fresh answer light up the same way.
  const [justAnswered, setJustAnswered] = useState({});
  const [answerError, setAnswerError] = useState(null);
  const attemptKeys = useRef(new Map());
  const sections = envelope?.course?.sections || [];
  const publication = usePublicationName(envelope?.course?.sourceIds?.[0]);
  const cur = sections[i];

  const onAnswer = async (itemId, optionId) => {
    const attemptId = attemptKeyFor(attemptKeys.current, itemId, optionId);
    setSaving((current) => ({ ...current, [itemId]: true }));
    setAnswerError(null);
    try {
      const response = await record.mutate({
        itemId,
        optionId,
        attemptId,
        releaseId: delivery?.releaseId,
      });
      if (response?.result) {
        setJustAnswered((current) => ({
          ...current,
          [itemId]: {
            optionId: response.result.optionId,
            correct: response.result.correct,
            feedback: response.result.feedback,
          },
        }));
      }
      return response;
    } catch (e) {
      // The shared presentation swallows the rejection; saying what went wrong
      // is the reader's job, and an unrecorded answer must not look recorded.
      setAnswerError(errText(e, 'That answer was not recorded. Choose it again to retry.'));
      throw e;
    } finally {
      setSaving((current) => ({ ...current, [itemId]: false }));
    }
  };

  if (loading) return <p>Loading course…</p>;
  if (error) return <Err msg={errText(error, 'Could not load this course.')} />;
  if (!sections.length) return <p className="p-src">This course has no sections yet.</p>;

  const answers = { ...(delivery?.answers || {}), ...justAnswered };
  /* The ratified prose for this section, if the release has any. Absent
     entirely when the section never had a lesson to ratify; present with
     `released: false` when it has one an instructor has not approved — which
     is the case the notice below exists to explain. */
  const prose = (delivery?.lessons || []).find((entry) => entry.sectionIndex === i) || null;
  const withheld = Boolean(prose && !prose.released);
  const checks = (delivery?.items || []).filter((item) => item.sectionIndex === i);
  /* No `title`: the section heading belongs to the reader (below), and passing
     it here as well printed every section title twice, once small and once
     large. The citation is handed over as the resolved shape -- publication
     name, page, and the stored locator untouched -- so the learner is cited to
     a publication and the key stays addressable but unread. Without a name
     there is no line: a record id is not a citation.

     It is the LESSON ROW's citation now, read from the same row as the words
     it sits under. Materialisation resolves a citation per item, so the row
     names the passage the lesson itself was written from rather than the
     section's primary label; and because one row is behind both, a page number
     can no longer vouch for a wording that is not the one on screen. `pubId`
     is the publication label stamped at materialisation; the approved-source
     list stays as the fallback for a release materialised without one. */
  const cited = prose?.citation || null;
  const citedPublication = cited?.pubId || publication;
  const lesson = {
    id: String(cur.id || `section-${i + 1}`),
    citation: cited?.citation && citedPublication
      ? {
          citation: cited.citation,
          pubId: citedPublication,
          page: cited.page ?? pageOf(cited.citation),
        }
      : null,
    blocks: [
      ...(prose?.released && prose.text ? [{
        id: prose.id,
        type: 'text',
        body: prose.text,
      }] : []),
      /* Placed by `sectionIndex`, which is the materialised Section.order and
         therefore this section's own index. The block id IS the Item id, so
         the answer the learner sends back is attributable to the exact row an
         instructor ratified -- no id is reconstructed here. A choice has no id
         of its own on that row: the keyed answer is an index into `options`,
         so the index is what identifies the choice on the way back. */
      ...checks.map((item) => ({
        id: item.id,
        type: 'check',
        title: item.phase === 'post' ? 'After you read' : 'Before you read',
        prompt: item.stem,
        options: (item.options || []).map((text, optionIndex) => ({
          id: String(optionIndex),
          text,
        })),
      })),
    ],
  };

  return (
    <div className="s-reader">
      <aside className="s-reader-toc">
        <h4 className="s-label">Sections</h4>
        <ol className="s-reader-list">
          {sections.map((s, j) => (
            <li key={s.id || s.sectionId || s.title || `section-${j + 1}`}>
              <button className={`s-reader-row${j === i ? ' on' : ''}`} onClick={() => setI(j)}>
                <span className="s-reader-id">{j + 1}</span>
                <span className="s-reader-title">{s.title || `Section ${j + 1}`}</span>
              </button>
            </li>
          ))}
        </ol>
      </aside>

      <article className="s-reader-body">
        <div className="s-reader-head">
          <span className="s-reader-kicker">Section {i + 1} of {sections.length}</span>
          <h1>{cur.title || `Section ${i + 1}`}</h1>
        </div>
        <Err msg={answerError} />
        {withheld ? (
          <UnreleasedLesson publication={publication} hasChecks={checks.length > 0} />
        ) : null}
        {/* The presentation's own empty state ("This lesson has no content
            yet") is true but uninformative, and printing it under a notice
            that has just said exactly why the section is empty reads like two
            different explanations. When the notice is up and there is nothing
            ratified to render, the notice is the whole answer. */}
        {lesson.blocks.length > 0 || !withheld ? (
          <CourseLesson
            content={lesson}
            progress={{ answers }}
            onAnswer={onAnswer}
            busy={saving}
          />
        ) : null}

        <div className="s-reader-nav">
          <button className="s-lesson-navbtn" disabled={i === 0} onClick={() => setI(i - 1)}>← Previous</button>
          <button className="s-lesson-navbtn" disabled={i >= sections.length - 1} onClick={() => setI(i + 1)}>Next →</button>
        </div>
      </article>
    </div>
  );
}

/* ---------- mastery (Whetstone) ---------- */

/*
 * A reload returns every saved session owned by this learner. Prefer the
 * current approved shared-plan revision, then an ACTIVE record, then the
 * newest record returned by the API. Selecting a saved row never mutates it;
 * starting a new session creates a new immutable record.
 */
export function selectMasterySession(sessions, masteryPlan, selectedId = null) {
  if (!Array.isArray(sessions) || sessions.length === 0) return null;
  if (selectedId) {
    const selected = sessions.find((session) => session.id === selectedId);
    // An explicit selection can be the id returned by a just-created session
    // while the refresh is still replacing the old list. Do not silently
    // resume a different saved record during that window.
    return selected || null;
  }

  const approvedRevision =
    masteryPlan?.status === 'APPROVED' && masteryPlan.revision
      ? masteryPlan.revision
      : null;
  if (approvedRevision) {
    const currentPlanSessions = sessions.filter(
      (session) => session?.masteryPlanRevision === approvedRevision,
    );
    if (currentPlanSessions.length > 0) {
      return currentPlanSessions.find((session) => session.status === 'ACTIVE') || currentPlanSessions[0];
    }
  }
  return sessions.find((session) => session.status === 'ACTIVE') || sessions[0];
}

export function MasterySession({ course }) {
  const { data: envelope } = useApiQuery(`/courses/${course.id}`);
  const masteryPlan = envelope?.course?.masteryPlan?.status === 'APPROVED'
    ? envelope.course.masteryPlan
    : envelope?.course?.masteryPlan || null;
  const sourceId = masteryPlan?.sourceId || envelope?.course?.sourceIds?.[0];
  const publication = usePublicationName(sourceId);
  const { data: sessions, loading, refetch } = useApiQuery(`/mastery/sessions?courseId=${course.id}`);
  const startSession = useApiMutation('/mastery/sessions', 'POST');
  const [answer, setAnswer] = useState('');
  const [err, setErr] = useState(null);
  const [last, setLast] = useState(null); // last turn's { verdict, feedback }
  const [selectedId, setSelectedId] = useState(null);
  const [pendingSessionId, setPendingSessionId] = useState(null);
  const inputRef = useRef(null);

  const selected = selectMasterySession(sessions, masteryPlan, pendingSessionId || selectedId);
  const active = selected?.status === 'ACTIVE' ? selected : null;
  const done = (sessions || []).filter((s) => s.status === 'COMPLETE');
  const turn = useApiMutation(`/mastery/sessions/${active?.id}/turn`, 'POST');

  useEffect(() => {
    if (pendingSessionId) {
      if (sessions?.some((session) => session.id === pendingSessionId)) {
        setSelectedId(pendingSessionId);
        setPendingSessionId(null);
      }
      return;
    }
    if (!sessions?.length) {
      setSelectedId(null);
      return;
    }
    const preferred = selectMasterySession(sessions, masteryPlan, selectedId);
    if (preferred && preferred.id !== selectedId) setSelectedId(preferred.id);
  }, [sessions, masteryPlan, selectedId, pendingSessionId]);

  useEffect(() => {
    if (active && inputRef.current) inputRef.current.focus();
  }, [active?.id, active?.currentQuestion]);

  const handleStart = async () => {
    setErr(null);
    setLast(null);
    if (masteryPlan?.status !== 'APPROVED') {
      return setErr('The shared mastery plan is not approved yet. New sessions are unavailable until the instructor approves it.');
    }
    if (!sourceId) return setErr('This course has no source document to grade against.');
    try {
      const result = await startSession.mutate({ sourceId, courseId: course.id });
      if (result?.id) setPendingSessionId(result.id);
      await refetch();
      // The effect above also guards the stale-list render, but selecting
      // after the refresh makes the intended record explicit for a fast
      // response where React batches the query state update.
      if (result?.id) setSelectedId(result.id);
    } catch (e) {
      setErr(errText(e, 'Could not start the session'));
    }
  };

  const handleTurn = async () => {
    if (!answer.trim() || !active || turn.loading) return;
    setErr(null);
    try {
      const res = await turn.mutate({ answer });
      setLast(res.result || null);
      setAnswer('');
      await refetch();
    } catch (e) {
      if (e?.code === 'CONFLICT') {
        setErr('This session changed elsewhere — refreshed to the latest state.');
        refetch();
      } else {
        setErr(errText(e, 'Could not submit the answer'));
      }
    }
  };

  const verdictColor = (v) =>
    v === 'mastered' ? 'var(--p-good)' : v === 'competent' ? 'var(--p-accent)' : v === 'developing' ? 'var(--p-warning)' : 'var(--p-dim)';
  const approvedRevision = masteryPlan?.status === 'APPROVED' ? masteryPlan.revision : null;
  const sessionNeedsApprovedPlan = Boolean(
    selected &&
    approvedRevision &&
    selected.masteryPlanRevision !== approvedRevision,
  );

  return (
    <>
      <h2 className="p-h">Mastery session</h2>
      <p className="p-sub">
        Whetstone asks about the approved source and grades what you say against it — in your own
        words, no multiple choice. Each answer is scored on a rubric your instructor approved.
      </p>
      <div className="p-btnrow" style={{ marginBottom: '0.75rem', alignItems: 'flex-end' }}>
        <button
          type="button"
          className="p-btn ghost"
          onClick={() => refetch()}
          disabled={loading}
        >
          {loading ? 'Reloading…' : 'Reload saved sessions'}
        </button>
        {sessions?.length > 0 && (
          <label className="p-field s-mastery-pick">
            <span>Selected session</span>
            <select
              className="p-input"
              value={selected?.id || ''}
              onChange={(event) => {
                setLast(null);
                setSelectedId(event.target.value || null);
              }}
            >
              {sessions.map((session) => (
                <option key={session.id} value={session.id}>
                  Session {session.id.slice(-6)} · {session.status}{session.masteryPlanRevision ? ` · ${session.masteryPlanRevision}` : ''}
                </option>
              ))}
            </select>
          </label>
        )}
      </div>

      <Err msg={err} />
      {loading && <p>Loading sessions…</p>}

      {!loading && !selected && (
        <div className="p-panel">
          <h3>Start a session</h3>
          <p className="p-src" style={{ marginBottom: '1rem' }}>
            Grounded on {publication || 'the approved source'}. A session runs until every criterion is assessed or the turn limit is reached.
          </p>
          {masteryPlan?.status === 'PENDING' && (
            <p className="p-src" role="status" style={{ color: 'var(--p-warning)' }}>
              The shared mastery plan is pending instructor approval. New sessions are unavailable until it is approved.
            </p>
          )}
          {!masteryPlan && (
            <p className="p-src" role="status" style={{ color: 'var(--p-warning)' }}>
              This course has no approved shared mastery plan yet. Ask the instructor to review and approve it before starting.
            </p>
          )}
          <button className="p-btn" onClick={handleStart} disabled={startSession.loading || !sourceId || masteryPlan?.status !== 'APPROVED'}>
            {startSession.loading ? 'Starting…' : masteryPlan?.status === 'APPROVED' ? 'Start session with approved plan' : 'Start mastery session'}
          </button>
        </div>
      )}

      {selected && !active && (
        <div className="p-panel">
          <h3>Saved mastery session</h3>
          <p style={{ margin: '0 0 0.35rem' }}>
            <strong>{selected.status === 'COMPLETE' ? 'Complete' : 'Ended'}</strong>
            {selected.report?.score !== undefined && ` · Score ${pct(selected.report.score)}`}
          </p>
          {selected.masteryPlanRevision && (
            <p className="p-src" style={{ margin: '0 0 0.35rem' }}>
              Shared-plan revision: <code>{selected.masteryPlanRevision}</code>
            </p>
          )}
          {sessionNeedsApprovedPlan && (
            <p className="p-src" role="status" style={{ color: 'var(--p-warning)' }}>
              This saved session predates the current approved shared mastery plan. Your previous record is preserved; start a new session for the current revision.
            </p>
          )}
          {selected.transcript?.length > 0 && (
            <details style={{ marginTop: '0.75rem' }}>
              <summary className="p-src" style={{ cursor: 'pointer' }}>Saved transcript ({selected.transcript.length} messages)</summary>
              <ol className="s-obj">
                {selected.transcript.map((t, i) => (
                  <li key={i} style={{ whiteSpace: 'pre-wrap' }}>{typeof t === 'string' ? t : t.text || JSON.stringify(t)}</li>
                ))}
              </ol>
            </details>
          )}
          <button
            className="p-btn ghost"
            onClick={handleStart}
            disabled={startSession.loading || !sourceId || masteryPlan?.status !== 'APPROVED'}
            style={{ marginTop: '0.8rem' }}
          >
            {startSession.loading ? 'Starting…' : 'Start another session'}
          </button>
        </div>
      )}

      {active && (
        <div className="p-panel s-mastery">
          <h3>Question</h3>
          {active.masteryPlanRevision && (
            <p className="p-src">
              Shared-plan revision: <code>{active.masteryPlanRevision}</code>
            </p>
          )}
          {sessionNeedsApprovedPlan && (
            <>
              <p className="p-src" role="status" style={{ color: 'var(--p-warning)' }}>
                This session predates the current approved shared plan. It is read-only; start a new session for the current revision.
              </p>
              <button className="p-btn ghost" onClick={handleStart} disabled={startSession.loading || !sourceId}>
                {startSession.loading ? 'Starting…' : 'Start current-plan session'}
              </button>
            </>
          )}
          <p className="s-mastery-q">{active.currentQuestion || 'Session initialised — submit any answer to receive the first question.'}</p>

          {last && (
            <div className="p-rationale" style={{ marginBottom: '1rem' }}>
              <span className="p-rlab" style={{ color: verdictColor(last.verdict) }}>{last.verdict || 'Graded'}</span>
              <p style={{ margin: 0 }}>{last.feedback}</p>
            </div>
          )}

          <div className="s-mastery-answer">
            <label className="p-field">
              <span>Your answer</span>
              <textarea
                ref={inputRef}
                className="p-input"
                placeholder="Answer in your own words…"
                value={answer}
                onChange={(e) => setAnswer(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && !e.shiftKey) {
                    e.preventDefault();
                    handleTurn();
                  }
                }}
              />
            </label>
            <button className="p-btn" onClick={handleTurn} disabled={turn.loading || !answer.trim() || sessionNeedsApprovedPlan}>
              {turn.loading ? 'Grading…' : 'Submit'}
            </button>
          </div>

          {active.criteria?.length > 0 && (
            <div style={{ marginTop: '1rem' }}>
              <h4 className="s-label">Criteria</h4>
              <ul className="p-req">
                {active.criteria.map((c, i) => (
                  <li className="p-reqrow" key={i}>
                    <span style={{ color: verdictColor(c.verdict), fontSize: '0.8em' }}>●</span>
                    <span className="p-reqname">{c.elo || c.competency || `Criterion ${i + 1}`}</span>
                    <span style={{ color: verdictColor(c.verdict), fontSize: '0.82em' }}>{c.verdict || 'not yet assessed'}</span>
                  </li>
                ))}
              </ul>
            </div>
          )}

          {active.transcript?.length > 0 && (
            <details style={{ marginTop: '1rem' }}>
              <summary className="p-src" style={{ cursor: 'pointer' }}>Transcript ({active.transcript.length})</summary>
              <ol className="s-obj">
                {active.transcript.map((t, i) => (
                  <li key={i} style={{ whiteSpace: 'pre-wrap' }}>{typeof t === 'string' ? t : t.text || JSON.stringify(t)}</li>
                ))}
              </ol>
            </details>
          )}
        </div>
      )}

      {done.length > 0 && (
        <div className="p-panel">
          <h3>Completed sessions</h3>
          <div className="p-tablewrap">
            <table className="p-table">
              <thead>
                <tr><th>Session</th><th className="p-num">Score</th><th>Criteria</th></tr>
              </thead>
              <tbody>
                {done.map((s) => (
                  <tr key={s.id} aria-selected={selected?.id === s.id}>
                    <td>
                      <button type="button" className="p-btn ghost" onClick={() => { setLast(null); setSelectedId(s.id); }}>
                        <code>{s.id.slice(-6)}</code>
                      </button>
                    </td>
                    <td className="p-num">{pct(s.report?.score)}</td>
                    <td>
                      {(s.criteria || []).map((c, i) => (
                        <span key={i} style={{ color: verdictColor(c.verdict), marginRight: '0.6rem' }}>{c.elo || c.competency}: {c.verdict}</span>
                      ))}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
           {!active && !selected && (
            <button className="p-btn ghost" onClick={handleStart} disabled={startSession.loading || !sourceId} style={{ marginTop: '0.8rem' }}>
              {startSession.loading ? 'Starting…' : 'Start another session'}
            </button>
          )}
        </div>
      )}
    </>
  );
}

/* ---------- learning path (Cadence) ---------- */

const COA_META = {
  catch_up: { icon: '▼', color: 'var(--p-critical)', blurb: 'Catch-up plan. More minutes per day, front-loaded on what is due first.' },
  maintain: { icon: '●', color: 'var(--p-good)', blurb: 'Maintenance plan. Keeps pace with the syllabus at your available time.' },
  get_ahead: { icon: '▲', color: 'var(--p-accent)', blurb: 'Extension plan. Finishes early and leaves room for review.' },
};

function fmtDate(iso) {
  const d = new Date(`${iso}T00:00:00`);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleDateString(undefined, { weekday: 'short', day: 'numeric', month: 'short' });
}

export function StudyPlan({ course }) {
  const { data, loading, error, refetch } = useApiQuery(`/study-plan?courseId=${course.id}`);
  const create = useApiMutation('/study-plan', 'POST');
  const [availability, setAvailability] = useState(60);
  const [coa, setCoa] = useState(null);
  const [err, setErr] = useState(null);

  const plan = data?.plan;
  const coaKeys = plan ? Object.keys(plan.coas) : [];
  const activeKey = coa && plan?.coas[coa] ? coa : plan?.recommended;
  const active = plan?.coas[activeKey];

  const handleCreate = async () => {
    setErr(null);
    try {
      await create.mutate({
        courseId: course.id,
        asOf: new Date().toISOString().split('T')[0],
        availability,
        ics: { calendarName: `${course.name} — study plan`, startHour: 18 },
      });
      refetch();
    } catch (e) {
      setErr(errText(e, 'Could not build a plan'));
    }
  };

  const notFound = error?.code === 'STUDY_PLAN_NOT_FOUND' || error?.status === 404;

  return (
    <>
      <h2 className="p-h">My Learning Path</h2>
      <p className="p-sub">
        Built by Cadence from the course syllabus and your available time. Three courses of action,
        because &quot;behind&quot; and &quot;ahead&quot; need different plans — not the same plan at a
        different speed.
      </p>

      <Err msg={err} />
      {loading && <p>Loading plan…</p>}
      {error && !notFound && <Err msg={errText(error, 'Could not load the plan.')} />}

      {(notFound || (!loading && !error && !plan)) && (
        <div className="p-panel">
          <h3>No plan yet</h3>
          <p className="p-src" style={{ marginBottom: '1rem' }}>
            Cadence needs the course syllabus (your instructor attaches it) and how much time you can give each day.
          </p>
          <div className="s-plan-setup">
            <label className="p-field">
              <span>Minutes per day</span>
              <input
                type="number"
                min="10"
                max="480"
                className="p-input"
                value={availability}
                onChange={(e) => setAvailability(parseInt(e.target.value, 10) || 60)}
              />
            </label>
            <button className="p-btn" onClick={handleCreate} disabled={create.loading}>
              {create.loading ? 'Building…' : 'Build my plan'}
            </button>
          </div>
        </div>
      )}

      {plan && (
        <>
          <div className="p-tiles">
            <div className="p-tile">
              <div className="p-tilelab">Status</div>
              <div className="p-tileval" style={{ fontSize: '1.15em', color: plan.status === 'behind' ? 'var(--p-critical)' : 'var(--p-good)' }}>{(plan.status || '').replace('_', ' ')}</div>
              <div className="p-tilenote">as of {fmtDate(plan.asOf)}</div>
            </div>
            <div className="p-tile">
              <div className="p-tilelab">Recommended</div>
              <div className="p-tileval" style={{ fontSize: '1.15em' }}>{plan.coas[plan.recommended]?.label}</div>
              <div className="p-tilenote">{plan.coas[plan.recommended]?.days} days</div>
            </div>
            <div className="p-tile">
              <div className="p-tilelab">Total time</div>
              <div className="p-tileval">{Math.round((active?.totalMinutes || 0) / 60 * 10) / 10}<span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}>h</span></div>
              <div className="p-tilenote">{active?.label.toLowerCase()} plan</div>
            </div>
            <div className="p-tile">
              <div className="p-tilelab">Late risk</div>
              <div className="p-tileval" style={{ color: active?.lateRisk ? 'var(--p-warning)' : 'var(--p-good)' }}>{active?.lateRisk ?? 0}</div>
              <div className="p-tilenote">blocks past due</div>
            </div>
          </div>

          <div className="p-panel">
            <h3>Course of action</h3>
            <div className="p-coa">
              {coaKeys.map((k) => {
                const c = plan.coas[k];
                const m = COA_META[k] || { icon: '●', color: 'var(--p-dim)', blurb: '' };
                return (
                  <button key={k} className={`p-coacard${activeKey === k ? ' on' : ''}`} onClick={() => setCoa(k)}>
                    <h4>
                      <span style={{ color: m.color }}>{m.icon}</span>
                      {c.label}
                      {c.recommended && <span className="p-examtag" style={{ marginLeft: '0.4rem' }}>RECOMMENDED</span>}
                    </h4>
                    <p>{m.blurb} {c.blocks.length} blocks over {c.days} days.</p>
                  </button>
                );
              })}
            </div>
          </div>

          <div className="p-panel">
            <h3>Plan — {active?.label.toLowerCase()}</h3>
            <ul className="p-plan">
              {(active?.blocks || []).map((b, i) => (
                <li className="p-planrow" key={i}>
                  <span className="p-pldate">{fmtDate(b.date)}</span>
                  <span className="p-pltask">{b.task}</span>
                  <span className="p-plnote">{b.minutes} min{b.kind && b.kind !== 'study' ? ` · ${b.kind}` : ''}</span>
                </li>
              ))}
            </ul>
            <div className="p-btnrow" style={{ marginTop: '0.8rem' }}>
              <button
                type="button"
                className="p-btn ghost"
                onClick={() => downloadAuthenticated(`/api/learning/study-plan?courseId=${course.id}&format=ics`, 'schoolcircle-study-plan.ics').catch((e) => setErr(e.message))}
              >
                Download calendar (.ics)
              </button>
              <button type="button" className="p-btn ghost" onClick={handleCreate} disabled={create.loading}>
                {create.loading ? 'Rebuilding…' : 'Rebuild plan'}
              </button>
            </div>
          </div>
        </>
      )}
    </>
  );
}

/* ---------- progress (Sextant) ---------- */

export function LearnerProgress({ courseId }) {
  const { data: analytics, loading, error } = useApiQuery(courseId ? `/analytics?courseId=${courseId}` : '/analytics');

  if (loading) return <p>Loading progress…</p>;
  if (error) return <Err msg={errText(error, 'Could not load progress.')} />;
  if (!analytics) return null;

  const { gain, gaps, mastery } = analytics;
  const rows = Array.isArray(mastery) ? mastery : [];
  const gapRows = Array.isArray(gaps) ? gaps : [];

  return (
    <>
      <h2 className="p-h">My Progress</h2>
      <p className="p-sub">What your saved mastery sessions show, by competency. Yours only — instructors see the class, never one Marine.</p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Competencies</div>
          <div className="p-tileval">{rows.length}</div>
          <div className="p-tilenote">assessed</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Mastered</div>
          <div className="p-tileval" style={{ color: 'var(--p-good)' }}>{rows.filter((r) => r.masteredRate >= 0.5).length}</div>
          <div className="p-tilenote">at or above half</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Learning gain</div>
          <div className="p-tileval">{gain?.status === 'insufficient_evidence' ? '—' : pct(gain?.overall?.normalizedGain ?? gain?.overall?.gain)}</div>
          <div className="p-tilenote">{gain?.status === 'insufficient_evidence' ? 'needs pre + post' : 'pre → post'}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Gaps</div>
          <div className="p-tileval" style={{ color: gapRows.length ? 'var(--p-warning)' : 'var(--p-good)' }}>{gapRows.length}</div>
          <div className="p-tilenote">objectives to revisit</div>
        </div>
      </div>

      <div className="p-panel">
        <h3>Mastery by competency</h3>
        {rows.length === 0 ? (
          <p className="p-src">{analytics.evidence?.mastery?.reason || 'No completed mastery sessions yet. Start one from the course.'}</p>
        ) : (
          <div className="p-tablewrap">
            <table className="p-table">
              <thead>
                <tr><th>Competency</th><th className="p-num">Mastered</th><th className="p-num">Competent</th><th className="p-num">Developing</th><th className="p-num">Rate</th></tr>
              </thead>
              <tbody>
                {rows.map((r, i) => (
                  <tr key={r.competency || i}>
                    <td>{r.competency}</td>
                    <td className="p-num">{r.mastered ?? '—'}</td>
                    <td className="p-num">{r.competent ?? '—'}</td>
                    <td className="p-num">{r.developing ?? '—'}</td>
                    <td className="p-num" style={{ color: r.masteredRate < 0.5 ? 'var(--p-critical)' : 'var(--p-good)' }}>{pct(r.masteredRate)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {gapRows.length > 0 && (
        <div className="p-panel">
          <h3>Needs work</h3>
          <ul className="p-req">
            {gapRows.map((g, i) => (
              <li className="p-reqrow" key={g.objective || i}>
                <span style={{ color: 'var(--p-critical)', fontSize: '0.8em' }}>●</span>
                <span className="p-reqname">{g.objective}</span>
                <span style={{ color: 'var(--p-critical)', fontSize: '0.82em' }}>{pct(g.missRate)} missed</span>
              </li>
            ))}
          </ul>
        </div>
      )}
    </>
  );
}

/* ---------- learning profile (Waypoint) ---------- */

// Waypoint's default instrument: 1..5 Likert, two items per dimension.
const INSTRUMENT = [
  ['v1', 'I learn best from diagrams, maps, or a live demonstration.'],
  ['v2', 'A chart helps me more than a paragraph of text.'],
  ['b1', 'I understand a topic better when someone explains it out loud.'],
  ['b2', 'Talking it through with others helps it stick.'],
  ['r1', 'I prefer a written study guide I can reread on my own.'],
  ['r2', 'I take detailed notes and review them later.'],
  ['h1', 'I learn by doing the task myself, not watching.'],
  ['h2', 'I need practical reps before it really sinks in.'],
  ['p1', 'I do better setting my own schedule than following a fixed one.'],
  ['p2', 'A rigid class pace tends to slow me down or leave me behind.'],
  ['s1', 'I want a clear, step-by-step path with explicit objectives.'],
  ['s2', 'Open-ended, figure-it-out tasks stress me more than they help.'],
];
const LIKERT = ['Strongly disagree', 'Disagree', 'Neutral', 'Agree', 'Strongly agree'];
const MODALITY = { visual: 'Visual', verbal: 'Aural', reading: 'Read / write', hands_on: 'Hands-on' };

export function WaypointSurvey() {
  const { data, loading, error, refetch } = useApiQuery('/profile');
  const save = useApiMutation('/profile', 'POST');
  const [taking, setTaking] = useState(false);
  const [responses, setResponses] = useState({});
  const [err, setErr] = useState(null);

  const notFound = error?.code === 'PROFILE_NOT_FOUND' || error?.status === 404;
  const profile = data?.profile;

  const begin = () => {
    setResponses(data?.responses || {});
    setTaking(true);
  };

  const submit = async () => {
    setErr(null);
    try {
      await save.mutate({ responses });
      setTaking(false);
      refetch();
    } catch (e) {
      setErr(errText(e, 'Could not save your profile'));
    }
  };

  if (loading) return <p>Loading…</p>;
  if (error && !notFound) return <Err msg={errText(error, 'Could not load your profile.')} />;

  if (profile && !taking) {
    return (
      <div>
        <div className="s-profile">
          <div className="s-profile-name">{MODALITY[profile.dominantModality] || profile.dominantModality || 'Balanced'}</div>
          <div className="s-profile-note">
            {(data.recommendations || []).slice(0, 2).join(' ')}
          </div>
          <div className="s-profile-meta">
            Pace: {profile.pace} · structure: {profile.structure} · {profile.answered} of {INSTRUMENT.length} answered · shared with your instructors as part of the class profile only
          </div>
        </div>
        <div className="p-btnrow" style={{ marginTop: '0.9rem' }}>
          <button className="p-btn ghost" onClick={begin}>Retake</button>
        </div>
      </div>
    );
  }

  if (!taking) {
    return (
      <div>
        <p className="s-settings-p">
          Twelve quick statements. Waypoint turns them into a learning profile that shapes how your study plan is
          built; instructors see the class profile (never individual answers) when they plan lessons.
        </p>
        <button className="p-btn" onClick={begin}>Start</button>
      </div>
    );
  }

  const answered = INSTRUMENT.filter(([id]) => Number.isInteger(responses[id])).length;

  return (
    <div className="s-waypoint">
      {INSTRUMENT.map(([id, text], i) => (
        <div className="s-waypoint-q" key={id}>
          <div className="s-survey-q" style={{ fontSize: '1em' }}>{i + 1}. {text}</div>
          <div className="s-waypoint-scale" role="radiogroup" aria-label={text}>
            {LIKERT.map((label, j) => (
              <button
                key={j}
                type="button"
                role="radio"
                aria-checked={responses[id] === j + 1}
                className={responses[id] === j + 1 ? 'on' : ''}
                title={label}
                onClick={() => setResponses((r) => ({ ...r, [id]: j + 1 }))}
              >
                {j + 1}
              </button>
            ))}
          </div>
        </div>
      ))}
      <Err msg={err} />
      <div className="p-btnrow" style={{ marginTop: '0.9rem', alignItems: 'center' }}>
        <button className="p-btn" onClick={submit} disabled={save.loading || answered === 0}>
          {save.loading ? 'Saving…' : 'Save profile'}
        </button>
        <button className="p-btn ghost" onClick={() => setTaking(false)}>Cancel</button>
        <span className="p-src">{answered} of {INSTRUMENT.length} answered</span>
      </div>
    </div>
  );
}
