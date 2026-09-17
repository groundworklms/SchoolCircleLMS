'use client';

import { useMemo, useState } from 'react';
import LessonPlayer from './LessonPlayer';
import { localGrade } from './lesson-blocks';
import { POIS } from './poi';
import { contentFor } from './lessonContent';
import { usePrefs, setPref } from './prefs';
import { countForLesson } from './Discussions';
import { useDoctrineCourse } from './grounded';
import { provenanceOf, publicationName } from '../_course/provenance';

/* ---------- real cited items from the DB (issue #8) ----------
   The lesson reader's structure is POI-driven and real; its teaching CONTENT was mock.
   This pulls the human-ratified (APPROVED) items — with their Anchor citations — from the
   seeded course database via GET /api/courses, matched to the course (and section) on screen.
   It degrades silently: on the static Pages build (no API/DB), if the DB is unreachable, or if
   this course has no grounded items seeded yet, the reader still works and the card stays hidden. */

/* Grounded key-points card: real APPROVED lesson claims for THIS course, scoped to the current
   section when the DB has one, each with a clickable citation that expands the paragraph/page
   locator — the "trust on tap" moment from 06-learner-loop. Silent unless matching items exist. */
function GroundedKeyPoints({ course, lesson }) {
  const { status, db } = useDoctrineCourse(course.id);
  const [open, setOpen] = useState(null);

  // Offline/static, DB unreachable, or no grounded items for this course yet: stay silent.
  if (status !== 'ready' || !db) return null;

  const withLessons = db.sections.filter((s) => (s.items || []).some((it) => it.kind === 'LESSON'));
  const scoped = withLessons.filter((s) => s.title === lesson?.annex?.title);
  const sections = scoped.length ? scoped : withLessons;
  const lessons = sections.flatMap((s) =>
    (s.items || []).filter((it) => it.kind === 'LESSON').map((it) => ({ ...it, section: s.title }))
  );
  if (!lessons.length) return null;

  return (
    <div className="s-gkp">
      <div className="s-gkp-head">
        <span className="s-gkp-t">Grounded key points</span>
        <span className="s-gkp-src">✓ Verified from {db.sourceId} · {scoped.length ? 'this section' : 'this course'} · live from the database</span>
      </div>
      <ul className="s-gkp-list">
        {lessons.map((it, i) => {
          const c = it.citation || {};
          /* The learner is who this citation is for, so the pill names the
             publication and the page. `citation.citation` is the locator the
             source viewer addresses a passage by — a source record id — and it
             stays on `title` rather than being read out as the citation. */
          const provenance = provenanceOf(c);
          const isOpen = open === i;
          return (
            <li key={it.id} className={`s-gkp-item${isOpen ? ' open' : ''}`}>
              <p className="s-gkp-stem">{it.stem}</p>
              <button
                className="s-gkp-cite"
                onClick={() => setOpen(isOpen ? null : i)}
                aria-expanded={isOpen}
                title={provenance?.locator || undefined}
              >
                <span className="s-gkp-cite-mark">§</span>
                <span className="s-gkp-cite-txt">{provenance?.text || 'No citation recorded'}</span>
                <span className="s-gkp-cite-chev">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="s-gkp-passage">
                  <div className="s-gkp-loc">
                    <span><b>Publication</b> {publicationName(c.pubId) || '—'}</span>
                    {c.page && <span><b>Page</b> {c.page}</span>}
                    {typeof it.support === 'number' && (
                      <span><b>HHEM support</b> {(it.support * 100).toFixed(0)}%</span>
                    )}
                  </div>
                  <div className="s-gkp-note">Full passage text opens from Anchor when the grounding service is connected.</div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </div>
  );
}

/* Student · Lessons. The course as the POI lays it out — annexes as modules,
   lessons in order, exams where they fall. Structure, IDs, and hours are REAL
   (parsed from the POI Combined Report). Completion state is mock, derived from
   the course's week-of-N so it agrees with the rest of the student side. */

// Annexes the POI lists that a student does not "take" in sequence.
const ADMIN = new Set(['Z']);

/* Walk the POI in order and mark each lesson complete / current / upcoming by
   where course.week falls in the total hours. */
function sequence(course) {
  const poi = POIS[course.id];
  const annexes = poi.annexes.filter((a) => a.lessons.length > 0);
  const teach = annexes.filter((a) => !ADMIN.has(a.letter));
  const total = teach.reduce((s, a) => s + a.lessons.reduce((t, l) => t + l.hours, 0), 0);
  const cut = total * ((course.week - 1) / course.weeks) + total / course.weeks / 2; // mid-week
  let acc = 0;
  let current = null;
  const flat = [];
  const byAnnex = teach.map((a) => {
    const lessons = a.lessons.map((l) => {
      const start = acc;
      acc += l.hours;
      let status;
      if (acc <= cut) status = 'complete';
      else if (start <= cut && !current) {
        status = 'current';
        current = { ...l, annex: a };
      } else status = 'upcoming';
      const row = { ...l, annex: a, status };
      flat.push(row);
      return row;
    });
    const done = lessons.filter((l) => l.status === 'complete').length;
    return { ...a, lessons, done, status: done === lessons.length ? 'complete' : done > 0 || lessons.some((l) => l.status === 'current') ? 'current' : 'upcoming' };
  });
  const admin = annexes.filter((a) => ADMIN.has(a.letter)).map((a) => ({
    ...a,
    lessons: a.lessons.map((l) => ({ ...l, annex: a, status: 'admin' })),
    done: 0,
    status: 'admin',
  }));
  return { poi, annexes: [...byAnnex, ...admin], flat, current, total, done: flat.filter((l) => l.status === 'complete').length };
}

// What the course home shows as "continue".
function currentLesson(course) {
  return sequence(course).current;
}

/* Lessons must be completed consecutively, in POI order (see Lessons list
   below) — this is the same rule expressed as a plain id set, so anything
   that needs to know "has this student reached lesson X yet" (e.g. gating
   the Ask-the-doctrine widget to material already covered) can reuse it
   without recomputing the sequence logic. */
function unlockedLessonIds(course, progress) {
  const seq = sequence(course);
  const ids = new Set();
  let priorSatisfied = true;
  for (const l of seq.flat) {
    if (priorSatisfied) ids.add(l.id);
    // A lesson counts as "done enough to move past" either because the
    // student actually finished it, or because the course's week-based
    // schedule already places it behind the student (the mock progress the
    // rest of the demo — "13/48 done" — is built from). Otherwise a fresh
    // profile with no real per-lesson completions yet would find nearly the
    // whole course locked despite the dashboard saying it is mid-course.
    const satisfied = l.status === 'complete' || !!progress?.[l.id]?.complete;
    if (!satisfied) priorSatisfied = false;
  }
  return { ids, flat: seq.flat };
}

const STATUS = {
  complete: { label: 'Complete', mark: '✓' },
  current: { label: 'In progress', mark: '●' },
  upcoming: { label: 'Upcoming', mark: '' },
  admin: { label: 'Admin', mark: '' },
};

// Mock lesson materials. Every lesson gets the same shape; the outline name is
// derived from the lesson so it reads as specific.
function materialsFor(l) {
  const slug = l.title.replace(/[^A-Za-z0-9]+/g, '_');
  const items = [
    { name: `Student_Outline_${slug}.pdf`, kind: 'Student outline', size: '1.2 MB', approved: true },
    { name: `${l.id}_Slides.pdf`, kind: 'Instructor slides', size: '4.8 MB', approved: true },
  ];
  if (l.kind === 'exam') return [{ name: `${l.id}_Exam_Instructions.pdf`, kind: 'Exam instructions', size: '80 KB', approved: true }];
  if (/safety/i.test(l.title)) items.push({ name: 'Safety_Annex_C.pdf', kind: 'Reference', size: '640 KB', approved: true });
  if (/circuit|theory|regulator|supply|supplies/i.test(l.title)) items.push({ name: 'TM-XXXXX-12_extract.pdf', kind: 'Reference (TM)', size: '2.1 MB', approved: true });
  return items;
}

/* ---------- lesson player ---------- */

/* An authored (mock) lesson on the shared player. Content comes from
   lessonContent.js, progress lives in prefs, and checks grade locally
   because the authored items carry their own key. The practice and
   attachments screens are this course's own; the player hands them back. */

function LessonPage({ course, lesson, seq, page, onBack, onPick, onPage, go, onOpenThread }) {
  const qCount = countForLesson(course, lesson.id);
  const i = seq.flat.findIndex((l) => l.id === lesson.id);
  const prev = i > 0 ? seq.flat[i - 1] : null;
  const next = i >= 0 && i < seq.flat.length - 1 ? seq.flat[i + 1] : null;
  const isExam = lesson.kind === 'exam';
  const content = useMemo(() => contentFor(lesson, course), [lesson, course]);
  const mats = materialsFor(lesson);
  const prefs = usePrefs();

  const renderItem = (cur) => {
    if (cur.type === 'practice') {
      return (
        <>
          <h2 className="s-lp-h">{cur.title}</h2>
          <p className="s-ls-p">{cur.text}</p>
          <div className="p-btnrow">
            <button className="p-btn" onClick={() => go('materials')}>Open practice set</button>
            <span style={{ fontSize: '0.85em', color: 'var(--p-faint)' }}>Opens Study Materials for this course</span>
          </div>
        </>
      );
    }
    if (cur.type === 'attachments') {
      return (
        <>
          <h2 className="s-lp-h">{cur.title}</h2>
          <ul className="p-files">
            {mats.map((m) => (
              <li className="p-file" key={m.name}>
                <span className="p-fname">
                  {m.name}
                  <div className="p-fmeta">{m.kind} · {m.size}</div>
                </span>
                {m.approved && <span className="p-live on">Instructor-approved</span>}
                <button className="p-btn ghost" style={{ height: '2rem', fontSize: '0.82em' }}>Open</button>
              </li>
            ))}
          </ul>
        </>
      );
    }
    return null;
  };

  return (
    <LessonPlayer
      lessonId={lesson.id}
      kicker={<>Annex {lesson.annex.letter} · {lesson.title} <code>{lesson.id}</code></>}
      title={lesson.title}
      titleTag={isExam ? <span className="p-examtag" style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }}>EXAM</span> : null}
      intro={content.intro}
      facts={[[`${lesson.hours} h`, 'of instruction'], [`~${Math.max(8, content.items.length * 3)} min`, 'to read']]}
      items={content.items}
      notAuthored={content.scaffold}
      page={page}
      onPage={onPage}
      progress={prefs.progress?.[lesson.id]}
      onProgress={(next) => setPref(`progress.${lesson.id}`, next)}
      grade={localGrade}
      onBack={onBack}
      prev={prev}
      next={next}
      onPick={onPick}
      renderItem={renderItem}
      overviewExtra={<GroundedKeyPoints course={course} lesson={lesson} />}
      sideExtra={
        <button className="s-lp-q" onClick={() => onOpenThread(null, lesson.id)}>
          <span className="s-lp-q-n">{qCount}</span>
          <span className="s-lp-q-t">
            <span>{qCount === 1 ? 'question' : 'questions'} on this lesson</span>
            <span className="s-lp-q-s">Ask or answer in Discussions</span>
          </span>
        </button>
      }
    />
  );
}


/* ---------- module list ---------- */

function Lessons({ course, go, lessonId, page, onOpenLesson, onOpenThread }) {
  const seq = useMemo(() => sequence(course), [course]);
  const prefs = usePrefs();
  const [open, setOpen] = useState(() => {
    const o = {};
    for (const a of seq.annexes) o[a.letter] = a.status === 'current';
    return o;
  });

  // Lessons must be completed consecutively, in POI order: a lesson unlocks
  // once every teaching lesson before it is actually marked complete.
  // Already-completed lessons and the current one stay open for review.
  const unlocked = useMemo(() => unlockedLessonIds(course, prefs.progress).ids, [course, prefs.progress]);
  const isLocked = (l) => l.status !== 'admin' && !unlocked.has(l.id);

  // The open lesson is in the URL; the list is the no-lesson state.
  const setPicked = (l) => onOpenLesson(l ? l.id : null);
  const picked = lessonId ? seq.flat.find((l) => l.id === lessonId) || seq.annexes.flatMap((a) => a.lessons).find((l) => l.id === lessonId) : null;

  if (picked && isLocked(picked)) {
    // Name the EARLIEST unsatisfied lesson, using the same rule unlockedLessonIds
    // applies (schedule-complete or actually completed). A reverse scan on
    // progress alone pointed at the lesson just before this one, which is
    // usually locked itself, bouncing the student through a chain of "Locked".
    const need = seq.flat
      .slice(0, seq.flat.findIndex((l) => l.id === picked.id))
      .find((l) => !(l.status === 'complete' || prefs.progress?.[l.id]?.complete));
    return (
      <div className="s-lp-locked">
        <button className="s-crumbs-inline" onClick={() => setPicked(null)}>← All lessons</button>
        <div className="s-ls-callout note" style={{ marginTop: '1rem' }}>
          <div className="s-ls-callout-t">Locked</div>
          <div>
            Lessons unlock in order. Finish {need ? <><code>{need.id}</code> {need.title}</> : 'the lessons before this one'} first.
          </div>
        </div>
        {need && <button className="p-btn" style={{ marginTop: '0.9rem' }} onClick={() => setPicked(need)}>Go to {need.title}</button>}
      </div>
    );
  }

  if (picked) {
    return (
      <LessonPage
        course={course}
        lesson={picked}
        seq={seq}
        page={page}
        onBack={() => setPicked(null)}
        onPick={setPicked}
        onPage={(n) => onOpenLesson(picked.id, n)}
        go={go}
        onOpenThread={onOpenThread}
      />
    );
  }

  const pct = Math.round((seq.done / seq.flat.length) * 100);

  return (
    <>
      <h2 className="p-h">Lessons</h2>
      <p className="p-sub">
        The course as the Program of Instruction lays it out. Annex and lesson structure, IDs, and hours are parsed from
        the real POI; completion is tracked as you go.
      </p>

      <div className="p-tiles">
        <div className="p-tile">
          <div className="p-tilelab">Progress</div>
          <div className="p-tileval">{seq.done}<span style={{ fontSize: '0.5em', color: 'var(--p-dim)' }}>/{seq.flat.length}</span></div>
          <div className="p-tilenote">lessons complete · {pct}%</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Where you are</div>
          <div className="p-tileval" style={{ fontSize: '1.05em' }}>{seq.current ? seq.current.title : '—'}</div>
          <div className="p-tilenote">{seq.current ? `Annex ${seq.current.annex.letter} · ${seq.current.id}` : ''}</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Course hours</div>
          <div className="p-tileval">{Math.round(seq.total)}</div>
          <div className="p-tilenote">of {seq.poi.totalHours} incl. admin</div>
        </div>
        <div className="p-tile">
          <div className="p-tilelab">Annexes</div>
          <div className="p-tileval">{seq.annexes.filter((a) => a.status !== 'admin').length}</div>
          <div className="p-tilenote">{seq.annexes.filter((a) => a.status === 'complete').length} complete</div>
        </div>
      </div>

      {seq.current && (
        <button className="s-continue" onClick={() => setPicked(seq.current)}>
          <span className="s-continue-body">
            <span className="s-continue-lab">Continue</span>
            <span className="s-continue-title">{seq.current.title}</span>
            <span className="s-continue-meta">Annex {seq.current.annex.letter} — {seq.current.annex.title} · {seq.current.id} · {seq.current.hours} h</span>
          </span>
          <span className="s-continue-btn">Open lesson</span>
        </button>
      )}

      <div className="s-modules">
        {seq.annexes.map((a) => {
          const isOpen = !!open[a.letter];
          return (
            <section key={a.letter} className={`s-module ${a.status}`}>
              <button className="s-module-head" onClick={() => setOpen((o) => ({ ...o, [a.letter]: !isOpen }))}>
                <span className="s-module-twisty">{isOpen ? '▾' : '▸'}</span>
                <span className="s-module-letter">{a.letter}</span>
                <span className="s-module-title">{a.title}</span>
                <span className="s-module-meta">
                  {a.lessons.length} {a.lessons.length === 1 ? 'item' : 'items'} · {a.hours} h
                </span>
                {a.status === 'admin' ? (
                  <span className="s-module-status admin">Administrative</span>
                ) : (
                  <span className={`s-module-status ${a.status}`}>
                    {a.status === 'complete' ? '✓ Complete' : a.status === 'current' ? `${a.done}/${a.lessons.length} done` : 'Upcoming'}
                  </span>
                )}
              </button>
              {isOpen && (
                <ol className="s-lessons">
                  {a.lessons.map((l) => {
                    const locked = isLocked(l);
                    return (
                      <li key={l.id}>
                        <button
                          className={`s-lesson ${l.status}${locked ? ' locked' : ''}`}
                          disabled={locked}
                          title={locked ? 'Complete the lessons before this one first' : undefined}
                          onClick={() => setPicked(l)}
                        >
                          <span className="s-lesson-mark">{locked ? '🔒' : STATUS[l.status].mark}</span>
                          <code>{l.id}</code>
                          <span className="s-lesson-title">
                            {l.title}
                            {l.kind === 'exam' && <span className="p-examtag" style={{ marginLeft: '0.5rem' }}>EXAM</span>}
                          </span>
                          <span className="s-lesson-hours">{l.hours} h</span>
                          <span className="s-lesson-status">{l.status === 'admin' ? '' : locked ? 'Locked' : STATUS[l.status].label}</span>
                        </button>
                      </li>
                    );
                  })}
                </ol>
              )}
            </section>
          );
        })}
      </div>
    </>
  );
}

export default Lessons;
export { currentLesson, unlockedLessonIds };
