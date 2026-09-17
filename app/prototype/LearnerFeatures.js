'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { downloadAuthenticated, useApiQuery, useApiMutation } from '../_learning/useLearning';
import { pageOf, provenanceOf, publicationName } from '../_course/provenance';
import { SourceViewer } from './SourceViewer';
import LessonPlayer from './LessonPlayer';
import { localGrade } from './lesson-blocks';
import { usePrefs, setPref } from './prefs';
import { lessonPagesForCourse, lessonPagesForSection } from '../../lib/learning/lesson-pages';

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
 * a materialised Item the section carries no `pubId` to use instead.
 *
 * This used to mean fetching the whole approved-source list client-side to
 * find one row. getCourse now resolves the label server-side, into
 * `course.sourcePublications` (lib/learning/core.js `coursePublicationLabels`)
 * — it already has to read the source record to authorize the course for
 * this viewer, so handing the label back costs nothing further: no request
 * beyond the course fetch every one of these screens already makes.
 *
 * Returns '' until the course has loaded, and '' if the id is not among the
 * ones the course resolved a label for. The caller withholds the citation
 * line in that window rather than printing the key.
 */
function publicationFor(course, sourceRecordId) {
  if (!sourceRecordId) return '';
  const label = course?.sourcePublications?.[sourceRecordId];
  return typeof label === 'string' && label ? publicationName(label) : '';
}

/**
 * A fresh idempotency key per (check, chosen option).
 *
 * The same rule used by the learner attempt transport: a failed request keeps
 * its key, so retrying
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

/* The approved course as lessons, on the same player the authored lessons use.
 *
 * EVERY WORD OF CONTENT ON THIS SCREEN COMES FROM /courses/:id/attempts, which
 * returns only what an instructor has ratified item by item -- the lesson
 * prose, the structured teaching content that rides on the same LESSON row
 * (pages, diagram, flashcards; see lib/learning/project-course.js
 * `lessonContent`), and the checks alike. That is the whole gate: a PENDING or
 * withheld item is simply not in that response, so it cannot be rendered, and
 * the reader has nothing to fall back on that would render it anyway. The
 * course record is used only for what course approval actually released: the
 * section list, their titles and order, and which source they are grounded in.
 *
 * Answer keys and rationale are in neither response. The rationale reaches the
 * learner only in the reply to their own answer, after they have committed to
 * a choice, and the server never names the keyed option on a miss. */

const progressKey = (courseId, sectionId) => `progress.${courseId}:${sectionId}`;

function sectionStatus(prog, lesson) {
  if (prog?.complete) return 'complete';
  const started = (prog?.seen?.length || 0) > 1 || Object.keys(prog?.answers || {}).length > 0;
  if (started) return 'current';
  return 'upcoming';
}

/* One delivered section, in the shape lib/learning/lesson-pages.js reads:
   what the release ratified for this section index, and nothing else. */
function deliveredSection(section, index, delivery, publication) {
  const prose = (delivery?.lessons || []).find((entry) => entry.sectionIndex === index) || null;
  const released = Boolean(prose?.released);
  const content = released && prose.content && typeof prose.content === 'object' ? prose.content : {};
  const checks = (delivery?.items || []).filter((item) => item.sectionIndex === index);
  const question = (item) => ({ id: item.id, stem: item.stem, options: item.options || [] });
  // The row's own citation, named to a publication: `pubId` stamped at
  // materialisation, else the approved-source list's name. Without a name
  // there is no line -- a record id is not a citation.
  const pub = released ? (prose.citation?.pubId || publication) : '';
  const cited = released && prose.citation?.citation && pub
    ? provenanceOf({ citation: prose.citation.citation, pubId: pub, page: prose.citation.page ?? pageOf(prose.citation.citation) })
    : null;
  return {
    id: String(section?.id || `section-${index + 1}`),
    title: section?.title || `Section ${index + 1}`,
    annex: section?.annex && typeof section.annex === 'object' ? section.annex : null,
    code: typeof section?.code === 'string' ? section.code : '',
    lesson: released ? prose.text : '',
    withheld: Boolean(prose && !released),
    publication,
    intro: content.intro,
    pages: content.pages,
    labels: content.labels,
    diagram: content.diagram,
    flashcards: content.flashcards,
    cite: cited?.text || '',
    pre: checks.filter((item) => item.phase !== 'post').map(question),
    post: checks.filter((item) => item.phase === 'post').map(question),
  };
}

/* Lessons grouped the way the course was planned: one module per annex when
   the sections carry one (a planned course), else the whole course as one
   module. Lesson codes are the plan's ("B.03") or a running number. */
function modulesOf(lessons, courseName) {
  const modules = [];
  const byKey = new Map();
  lessons.forEach((l, index) => {
    const annex = l.annex && typeof l.annex === 'object' ? l.annex : null;
    const key = annex ? String(annex.letter || annex.title) : '__course';
    if (!byKey.has(key)) {
      const mod = {
        key,
        letter: annex ? annex.letter || String(modules.length + 1) : String(lessons.length),
        title: annex ? annex.title || `Annex ${annex.letter}` : courseName,
        lessons: [],
      };
      byKey.set(key, mod);
      modules.push(mod);
    }
    byKey.get(key).lessons.push({ ...l, code: l.code || (annex && /^[A-Z]+\.\d+$/.test(l.id) ? l.id : String(index + 1)) });
  });
  return modules;
}

/* The lesson list and player, shared by the learner reader and the instructor
   preview. `lessons` is what lessonPagesForCourse built; `grade` resolves a
   check; `serverAnswers` are answers already on record for this learner. */
function CourseLessons({ course, lessons, grade, serverAnswers = {}, notice = null, lessonId, page, onOpenLesson, pending = false }) {
  const prefs = usePrefs();
  // The open lesson and page live in the URL when the shell provides them
  // (deep links, back button); the instructor preview keeps them locally.
  const [localPicked, setLocalPicked] = useState(null);
  const [localPage, setLocalPage] = useState(1);
  const picked = onOpenLesson ? lessonId || null : localPicked;
  const pageNumber = onOpenLesson ? page || 1 : localPage;
  const open = (l, pg = 1) => {
    if (onOpenLesson) onOpenLesson(l ? l.id : null, l ? pg : null);
    else { setLocalPicked(l ? l.id : null); setLocalPage(pg); }
  };
  const setPage = (pg) => (onOpenLesson ? onOpenLesson(picked, pg) : setLocalPage(pg));

  // Until the ratified set is known there is nothing to open: the section
  // titles (released by course approval) are listed, and nothing else.
  const teach = pending ? lessons : lessons.filter((l) => l.items.length > 0);
  // Answers the server has on record win over the browser's copy, so a reload
  // on another device shows the same checks answered the same way.
  const progOf = (l) => {
    const local = prefs.progress?.[`${course.id}:${l.id}`] || {};
    const answers = { ...(local.answers || {}) };
    for (const item of l.items) {
      if (item.type !== 'check' || !item.itemId) continue;
      const recorded = serverAnswers[item.itemId];
      if (!recorded) continue;
      const pickedIndex = Number(recorded.optionId);
      answers[item.id] = {
        picked: pickedIndex,
        correct: recorded.correct === true,
        answer: recorded.correct === true ? pickedIndex : null,
        rationale: recorded.feedback || '',
      };
    }
    return { ...local, answers };
  };
  const withStatus = teach.map((l) => ({ ...l, status: pending ? 'upcoming' : sectionStatus(progOf(l), l) }));
  const done = withStatus.filter((l) => l.status === 'complete').length;
  const current = withStatus.find((l) => l.status !== 'complete') || null;
  const authored = teach.filter((l) => l.authored).length;

  const lesson = picked && !pending ? withStatus.find((l) => l.id === picked) : null;

  if (!withStatus.length) {
    return <p className="p-src">Nothing in this course has been released to learners yet. Your instructor reviews each lesson and check before it is shown.</p>;
  }

  if (lesson) {
    const i = withStatus.findIndex((l) => l.id === lesson.id);
    const prev = i > 0 ? withStatus[i - 1] : null;
    const next = i < withStatus.length - 1 ? withStatus[i + 1] : null;
    return (
      <LessonPlayer
        lessonId={`${course.id}:${lesson.id}`}
        kicker={<>{lesson.annex ? `Annex ${lesson.annex.letter} · ${lesson.annex.title}` : `Lesson ${i + 1} of ${withStatus.length} · ${course.name}`}{lesson.code ? <> <code>{lesson.code}</code></> : null}</>}
        title={lesson.title}
        intro={lesson.intro}
        facts={[[`~${Math.max(5, lesson.items.length * 3)} min`, 'to read'], ['✓', 'cited to source']]}
        items={lesson.items}
        page={pageNumber}
        onPage={setPage}
        progress={progOf(lesson)}
        onProgress={(nextProg) => setPref(progressKey(course.id, lesson.id), nextProg)}
        grade={(item, k) => grade(item, k, lesson)}
        onBack={() => open(null)}
        prev={prev}
        next={next}
        onPick={(l) => open(l)}
        overviewExtra={<>
          {lesson.cite && <p className="p-src" style={{ marginTop: '0.75rem' }}>Written from and checked against <strong>{lesson.cite}</strong>.</p>}
          {!lesson.authored && lesson.items.some((it) => it.type === 'page') ? (
            <div className="s-ls-callout note" style={{ marginTop: '1rem' }}>
              <div className="s-ls-callout-t">Short form</div>
              <div>This lesson is the grounded lesson paragraph, its checks and cards. Your instructor can expand it into full pages from the course review screen.</div>
            </div>
          ) : null}
        </>}
      />
    );
  }

  const pct = Math.round((done / withStatus.length) * 100);
  return (
    <>
      <h2 className="p-h">Lessons</h2>
      <p className="p-sub">
        One lesson per objective, written from the approved source and released by your instructor item by item.
        Every page, check and card had to trace to the cited passage before it could be shown.
      </p>
      {notice}

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Progress</div>
          <div className="p-tileval">{done}<span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}>/{withStatus.length}</span></div>
          <div className="p-tilenote">lessons complete · {pct}%</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Where you are</div>
          <div className="p-tileval" style={{ fontSize: '1.05em' }}>{current ? current.title : 'All done'}</div>
          <div className="p-tilenote">{current ? `Lesson ${withStatus.indexOf(current) + 1}` : 'Every lesson finished'}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Checks</div>
          <div className="p-tileval">{withStatus.reduce((n, l) => n + l.items.filter((it) => it.type === 'check').length, 0)}</div>
          <div className="p-tilenote">across the course</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Grounding</div>
          <div className="p-tileval" style={{ color: 'var(--p-good)', fontSize: '1.05em' }}>Cited</div>
          {/* Two different measures, so they are said as two clauses rather
              than stacking the positive word straight over a small number:
              every lesson IS cited (grounding), and separately, `authored` of
              them have been expanded from the snippet to full pages (depth).
              "0 of 4 in full pages" under a lone "Cited" read as "0 of 4 cited". */}
          <div className="p-tilenote">every lesson traces to the source · {authored} of {withStatus.length} in full pages</div>
        </div>
      </div>

      {pending && <p className="p-src">Loading what your instructor has released…</p>}
      {current && !pending && (
        <button className="s-continue" onClick={() => open(current)}>
          <span className="s-continue-body">
            <span className="s-continue-lab">{current.status === 'current' ? 'Continue' : 'Start'}</span>
            <span className="s-continue-title">{current.title}</span>
            <span className="s-continue-meta">Lesson {withStatus.indexOf(current) + 1} of {withStatus.length}{current.cite ? ` · ${current.cite}` : ''}</span>
          </span>
          <span className="s-continue-btn">Open lesson</span>
        </button>
      )}

      <div className="s-modules">
        {modulesOf(withStatus, course.name).map((mod) => {
          const modDone = mod.lessons.filter((l) => l.status === 'complete').length;
          const modStatus = modDone === mod.lessons.length ? 'complete' : mod.lessons.some((l) => l.status !== 'upcoming') ? 'current' : 'upcoming';
          return (
            <section key={mod.key} className={`s-module ${modStatus}`}>
              <div className="s-module-head" style={{ cursor: 'default' }}>
                <span className="s-module-twisty">▾</span>
                <span className="s-module-letter">{mod.letter}</span>
                <span className="s-module-title">{mod.title}</span>
                <span className="s-module-meta">{mod.lessons.length} {mod.lessons.length === 1 ? 'lesson' : 'lessons'}</span>
                <span className={`s-module-status ${modStatus}`}>{modStatus === 'complete' ? '✓ Complete' : modStatus === 'current' ? `${modDone}/${mod.lessons.length} done` : 'Upcoming'}</span>
              </div>
              <ol className="s-lessons">
                {mod.lessons.map((l) => (
                  <li key={l.id}>
                    <button className={`s-lesson ${l.status}`} disabled={pending} onClick={() => open(l)}>
                      <span className="s-lesson-mark">{l.status === 'complete' ? '✓' : l.status === 'current' ? '●' : ''}</span>
                      <code>{l.code}</code>
                      <span className="s-lesson-title">{l.title}</span>
                      <span className="s-lesson-hours">{l.items.filter((it) => it.type === 'page').length} pages</span>
                      <span className="s-lesson-status">{pending ? 'Loading' : l.status === 'complete' ? 'Complete' : l.status === 'current' ? 'In progress' : 'Upcoming'}</span>
                    </button>
                  </li>
                ))}
              </ol>
            </section>
          );
        })}
      </div>
    </>
  );
}

export function CourseReader({ course, lessonId, page, onOpenLesson }) {
  const { data: envelope, loading, error } = useApiQuery(`/courses/${course.id}`);
  const { data: delivery, loading: deliveryLoading, error: deliveryError } = useApiQuery(`/courses/${course.id}/attempts`);
  const record = useApiMutation(`/courses/${course.id}/attempts`, 'POST');
  const attemptKeys = useRef(new Map());
  const sections = envelope?.course?.sections || [];
  const publication = publicationFor(envelope?.course, envelope?.course?.sourceIds?.[0]);

  const lessons = useMemo(() => {
    return sections.map((section, index) => {
      const delivered = deliveredSection(section, index, delivery, publication);
      return {
        id: delivered.id,
        title: delivered.title,
        cite: delivered.cite,
        annex: delivered.annex,
        code: delivered.code,
        ...lessonPagesForSection(delivered, { id: delivered.id, sourceLabel: publication }),
      };
    });
  }, [sections, delivery, publication]);

  /* A check resolves through the attempts route: the same idempotency key
     rule as before -- a retry of the same choice replays, a different choice
     is a new attempt -- and the reply is the only place rationale appears. */
  const grade = async (item, k) => {
    const optionId = String(k);
    const attemptId = attemptKeyFor(attemptKeys.current, item.itemId, optionId);
    const response = await record.mutate({ itemId: item.itemId, optionId, attemptId, releaseId: delivery?.releaseId });
    const result = response?.result;
    if (!result || typeof result.correct !== 'boolean') throw new Error('That answer was not recorded. Choose it again to retry.');
    return { picked: k, correct: result.correct, answer: result.correct ? k : null, rationale: result.feedback || '' };
  };

  if ((loading && !envelope) || (deliveryLoading && !delivery)) return <p>Loading course…</p>;
  if (error) return <Err msg={errText(error, 'Could not load this course.')} />;
  if (deliveryError) return <Err msg={errText(deliveryError, 'Could not load what has been released for this course.')} />;
  if (!sections.length) return <p className="p-src">This course has no sections yet.</p>;

  return (
    <CourseLessons
      course={course}
      lessons={lessons}
      grade={grade}
      serverAnswers={delivery?.answers || {}}
      pending={!delivery}
      lessonId={lessonId}
      page={page}
      onOpenLesson={onOpenLesson}
    />
  );
}

/* The instructor's own draft on the learner's player. Their copy carries the
   answer keys, so checks grade here and nothing is recorded; what a learner
   will see is exactly this, minus whatever they have not yet ratified. */
export function CoursePreview({ course, draft }) {
  const { data: sources } = useApiQuery('/sources');
  const sourceTitles = useMemo(() => {
    const map = {};
    for (const source of Array.isArray(sources) ? sources : []) {
      if (source?.id) map[source.id] = publicationName(source.sourceId || source.title || '');
    }
    return map;
  }, [sources]);
  const sourceLabel = (draft?.sourceIds || []).map((id) => sourceTitles[id]).filter(Boolean).join(', ');
  const lessons = useMemo(
    () => (draft ? lessonPagesForCourse(draft, { sourceLabel, sourceTitles }) : []),
    [draft, sourceLabel, sourceTitles],
  );
  if (!draft) return <p>Loading course…</p>;
  return (
    <CourseLessons
      course={course}
      lessons={lessons}
      grade={localGrade}
      notice={
        <div className="s-ls-callout note" style={{ marginBottom: '1rem' }}>
          <div className="s-ls-callout-t">Instructor preview</div>
          <div>Every section of the draft, keys included. A learner sees only the lessons and checks you have approved item by item.</div>
        </div>
      }
    />
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
  const publication = publicationFor(envelope?.course, sourceId);
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
