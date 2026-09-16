'use client';

import { useEffect, useMemo, useState } from 'react';
import { POIS } from './poi';
import { contentFor } from './lessonContent';
import { usePrefs, setPref } from './prefs';
import { countForLesson } from './Discussions';
import { useDoctrineCourse } from './grounded';

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
          const isOpen = open === i;
          return (
            <li key={it.id} className={`s-gkp-item${isOpen ? ' open' : ''}`}>
              <p className="s-gkp-stem">{it.stem}</p>
              <button className="s-gkp-cite" onClick={() => setOpen(isOpen ? null : i)} aria-expanded={isOpen}>
                <span className="s-gkp-cite-mark">§</span>
                <span className="s-gkp-cite-txt">{c.citation || 'citation'}</span>
                <span className="s-gkp-cite-chev">{isOpen ? '▾' : '▸'}</span>
              </button>
              {isOpen && (
                <div className="s-gkp-passage">
                  <div className="s-gkp-loc">
                    <span><b>Publication</b> {c.pubId || '—'}</span>
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

/* A lesson is a sequence of items, one per screen. Progress (which items are
   done, how checks were answered) persists per lesson in prefs. A check has
   to be answered before Next unlocks — the Moodle question-page rule. */

function Block({ block, blockKey, explored, onExplore }) {
  switch (block.type) {
    case 'p':
      return <p className="s-ls-p">{block.text}</p>;
    case 'h':
      return <h4 className="s-ls-h4">{block.text}</h4>;
    case 'list':
      return (
        <ul className="s-ls-list">
          {block.items.map((t) => (
            <li key={t}>{t}</li>
          ))}
        </ul>
      );
    case 'callout':
      return (
        <aside className={`s-ls-callout ${block.kind}`}>
          <div className="s-ls-callout-t">{block.title}</div>
          <div>{block.text}</div>
        </aside>
      );
    case 'terms':
      return (
        <dl className="s-ls-terms">
          {block.items.map(([t, d]) => (
            <div key={t}>
              <dt>{t}</dt>
              <dd>{d}</dd>
            </div>
          ))}
        </dl>
      );
    case 'figure':
      return (
        <figure className="s-ls-fig">
          <div className="s-ls-fig-art" dangerouslySetInnerHTML={{ __html: block.svg }} />
          <figcaption>{block.caption}</figcaption>
        </figure>
      );
    case 'example':
      return (
        <div className="s-ls-ex">
          <div className="s-ls-ex-t">{block.title}</div>
          <ol>
            {block.steps.map((st) => (
              <li key={st}>{st}</li>
            ))}
          </ol>
          {block.result && <div className="s-ls-ex-r">{block.result}</div>}
        </div>
      );
    case 'accordion':
      return <Accordion items={block.items} />;
    case 'hotspots':
      return <Hotspots block={block} explored={explored || []} onExplore={(i) => onExplore(blockKey, i)} />;
    case 'video':
      return <InteractiveVideo block={block} />;
    case 'flashcards':
      return <Flashcards cards={block.cards} />;
    default:
      return null;
  }
}

/* ---- H5P-style interactive blocks ---- */

function Accordion({ items }) {
  const [open, setOpen] = useState(0);
  return (
    <div className="s-acc">
      {items.map((it, i) => (
        <div key={it.title} className={`s-acc-item${open === i ? ' open' : ''}`}>
          <button className="s-acc-head" onClick={() => setOpen(open === i ? -1 : i)} aria-expanded={open === i}>
            <span>{it.title}</span>
            <span className="s-acc-chev">{open === i ? '−' : '+'}</span>
          </button>
          {open === i && <div className="s-acc-body">{it.text}</div>}
        </div>
      ))}
    </div>
  );
}

function Hotspots({ block, explored, onExplore }) {
  const [on, setOn] = useState(null);
  const seen = new Set(explored);
  const pick = (i) => {
    setOn(on === i ? null : i);
    if (!seen.has(i)) onExplore(i);
  };
  const spot = on != null ? block.spots[on] : null;
  const allSeen = seen.size >= block.spots.length;
  return (
    <figure className="s-ls-fig s-hs">
      <div className="s-ls-fig-art s-hs-art">
        <div dangerouslySetInnerHTML={{ __html: block.svg }} />
        {block.spots.map((sp, i) => (
          <button
            key={sp.title}
            className={`s-hs-dot${on === i ? ' on' : ''}${seen.has(i) ? ' seen' : ''}`}
            style={{ left: `${sp.x}%`, top: `${sp.y}%` }}
            onClick={() => pick(i)}
            aria-label={sp.title}
          >
            {i + 1}
          </button>
        ))}
      </div>
      <div className="s-hs-panel">
        {spot ? (
          <>
            <div className="s-hs-title">{on + 1} · {spot.title}</div>
            <div className="s-hs-text">{spot.text}</div>
          </>
        ) : (
          <div className="s-hs-text" style={{ color: allSeen ? 'var(--p-good)' : 'var(--p-faint)' }}>
            {seen.size} of {block.spots.length} explored{allSeen ? ' — all explored' : ', tap each point to continue'}
          </div>
        )}
      </div>
      <figcaption>{block.caption}</figcaption>
    </figure>
  );
}

function fmt(t) {
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}

function InteractiveVideo({ block }) {
  const [t, setT] = useState(0);
  const [openPrompt, setOpenPrompt] = useState(null);
  const [picked, setPicked] = useState({});
  const pr = openPrompt != null ? block.prompts[openPrompt] : null;
  const jump = (i) => {
    setT(block.prompts[i].at);
    setOpenPrompt(i);
  };
  return (
    <div className="s-vid">
      <div className="s-vid-screen">
        <div className="s-vid-poster">
          <span className="s-vid-play">▶</span>
          <span>{block.poster}</span>
        </div>
        {pr && (
          <div className="s-vid-overlay">
            <div className="s-vid-ov-lab">{fmt(pr.at)} · {pr.kind === 'question' ? 'Question' : 'Note'}</div>
            {pr.kind === 'note' ? (
              <div className="s-vid-ov-text">{pr.text}</div>
            ) : (
              <>
                <div className="s-vid-ov-text">{pr.q}</div>
                <div className="s-vid-ov-a">
                  {pr.answers.map((a, i) => {
                    const p = picked[openPrompt];
                    let cls = '';
                    if (p != null) cls = a.correct ? ' correct' : i === p ? ' wrong' : '';
                    return (
                      <button key={a.text} className={`p-ans${cls}`} disabled={p != null} onClick={() => setPicked({ ...picked, [openPrompt]: i })}>
                        <span className="p-anskey">{String.fromCharCode(65 + i)}</span>
                        <span>{a.text}</span>
                      </button>
                    );
                  })}
                </div>
              </>
            )}
            <button className="p-btn ghost" style={{ height: '2rem', fontSize: '0.82em', marginTop: '0.6rem' }} onClick={() => setOpenPrompt(null)}>Continue</button>
          </div>
        )}
      </div>
      <div className="s-vid-bar">
        <span className="s-vid-time">{fmt(t)}</span>
        <div className="s-vid-track" onClick={(e) => { const r = e.currentTarget.getBoundingClientRect(); setT(Math.round(((e.clientX - r.left) / r.width) * block.duration)); }}>
          <div className="s-vid-fill" style={{ width: `${(t / block.duration) * 100}%` }} />
          {block.prompts.map((p, i) => (
            <button
              key={p.at}
              className={`s-vid-mark ${p.kind}${picked[i] != null ? ' done' : ''}`}
              style={{ left: `${(p.at / block.duration) * 100}%` }}
              onClick={(e) => { e.stopPropagation(); jump(i); }}
              title={`${fmt(p.at)} · ${p.kind}`}
            />
          ))}
        </div>
        <span className="s-vid-time">{fmt(block.duration)}</span>
      </div>
      <div className="s-vid-foot">{block.title} · {block.prompts.filter((p) => p.kind === 'question').length} questions in the video. Tap a marker to jump to it.</div>
    </div>
  );
}

function Flashcards({ cards }) {
  const [i, setI] = useState(0);
  const [flipped, setFlipped] = useState(false);
  const card = cards[i];
  const go = (n) => {
    setFlipped(false);
    setI((i + n + cards.length) % cards.length);
  };
  return (
    <div className="s-fc">
      <button className={`s-fc-card${flipped ? ' flipped' : ''}`} onClick={() => setFlipped((f) => !f)}>
        <span className="s-fc-side">{card.front}</span>
        <span className="s-fc-side back">{card.back}</span>
      </button>
      <div className="s-fc-nav">
        <button className="p-btn ghost" onClick={() => go(-1)}>←</button>
        <span className="s-fc-count">{i + 1} of {cards.length} · tap the card to flip</span>
        <button className="p-btn ghost" onClick={() => go(1)}>→</button>
      </div>
    </div>
  );
}

function CheckItem({ item, answer, onAnswer }) {
  const picked = answer ?? null;
  return (
    <div className="s-chk">
      <div className="s-chk-lab">Check your understanding</div>
      <div className="s-chk-q">{item.q}</div>
      <div className="s-chk-a">
        {item.answers.map((a, i) => {
          let cls = '';
          if (picked !== null) {
            if (a.correct) cls = ' correct';
            else if (i === picked) cls = ' wrong';
          }
          return (
            <button key={a.text} className={`p-ans${cls}`} disabled={picked !== null} onClick={() => onAnswer(i)}>
              <span className="p-anskey">{String.fromCharCode(65 + i)}</span>
              <span>{a.text}</span>
            </button>
          );
        })}
      </div>
      {picked !== null && (
        <div className="p-rationale">
          <span className="p-rlab">{item.answers[picked].correct ? 'Correct — here is why' : 'Not quite — here is why'}</span>
          {item.rationale}
        </div>
      )}
    </div>
  );
}

const KIND = { page: 'Read', check: 'Check', practice: 'Practice', attachments: 'Files', overview: 'Overview' };

function LessonPage({ course, lesson, seq, page, onBack, onPick, onPage, go, onOpenThread }) {
  const qCount = countForLesson(course, lesson.id);
  const i = seq.flat.findIndex((l) => l.id === lesson.id);
  const prev = i > 0 ? seq.flat[i - 1] : null;
  const next = i >= 0 && i < seq.flat.length - 1 ? seq.flat[i + 1] : null;
  const isExam = lesson.kind === 'exam';
  const content = useMemo(() => contentFor(lesson, course), [lesson, course]);
  const mats = materialsFor(lesson);
  const prefs = usePrefs();
  const prog = prefs.progress?.[lesson.id] || { seen: [], answers: {}, hotspots: {}, complete: false };

  // Screen 1 is the overview; items follow.
  const screens = useMemo(
    () => [{ id: `${lesson.id}#0`, type: 'overview', title: 'Overview' }, ...content.items],
    [content, lesson.id]
  );
  const idx = Math.min(Math.max((page || 1) - 1, 0), screens.length - 1);
  const cur = screens[idx];

  const save = (patch) => setPref(`progress.${lesson.id}`, { ...prog, ...patch });

  // Seeing a screen records it. Checks record only when answered.
  useEffect(() => {
    if (cur.type !== 'check' && !prog.seen.includes(cur.id)) save({ seen: [...prog.seen, cur.id] });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cur.id]);

  // A page with interactive diagram callouts stays gated until every callout
  // on it has been opened — pages with none are never held up by this.
  const unexploredHotspots = (sc) =>
    sc.type === 'page' &&
    sc.blocks.some((b, bi) => b.type === 'hotspots' && (prog.hotspots?.[`${sc.id}::${bi}`]?.length || 0) < b.spots.length);
  const onExplore = (blockKey, i) =>
    save({ hotspots: { ...prog.hotspots, [blockKey]: [...new Set([...(prog.hotspots?.[blockKey] || []), i])] } });

  const doneIds = new Set([...prog.seen, ...Object.keys(prog.answers)]);
  const isDone = (sc) => (sc.type === 'check' ? prog.answers[sc.id] != null : doneIds.has(sc.id));
  const isGatedScreen = (sc) => (sc.type === 'check' && prog.answers[sc.id] == null) || unexploredHotspots(sc);
  const gated = isGatedScreen(cur);
  const doneCount = screens.filter(isDone).length;
  const pct = Math.round((doneCount / screens.length) * 100);
  const checks = content.items.filter((it) => it.type === 'check');
  const correct = checks.filter((c) => prog.answers[c.id] != null && c.answers[prog.answers[c.id]].correct).length;
  const atEnd = idx === screens.length - 1;
  const allDone = screens.every(isDone);

  // Sequential: you can jump back freely, forward only as far as you've unlocked.
  const firstLocked = screens.findIndex((sc, k) => k > 0 && isGatedScreen(sc));
  const maxReach = firstLocked === -1 ? screens.length - 1 : firstLocked;
  const canOpen = (k) => k <= maxReach;

  const goTo = (k) => onPage(Math.min(Math.max(k, 0), screens.length - 1) + 1);
  const finish = () => save({ complete: true });

  return (
    <div className="s-lp">
      <div className="s-lp-main">
        <div className="s-lp-top">
          <button className="s-crumbs-inline" onClick={onBack}>← All lessons</button>
          <span className="s-lp-topmeta">
            Annex {lesson.annex.letter} · {lesson.title} <code>{lesson.id}</code>
          </span>
        </div>

        <div className="s-lp-progress">
          <div className="s-lp-bar"><div className="s-lp-fill" style={{ width: `${pct}%` }} /></div>
          <span className="s-lp-count">{idx + 1} of {screens.length}</span>
        </div>

        <article className="s-lp-card" key={cur.id}>
          <div className="s-lp-kind">{KIND[cur.type]}{content.scaffold && cur.type !== 'overview' ? ' · not yet authored' : ''}</div>

          {cur.type === 'overview' && (
            <>
              <h1 className="s-ls-title">
                {lesson.title}
                {isExam && <span className="p-examtag" style={{ marginLeft: '0.5rem', verticalAlign: 'middle' }}>EXAM</span>}
              </h1>
              <p className="s-ls-intro">{content.intro}</p>
              <div className="s-lp-facts">
                <div><b>{content.items.filter((it) => it.type === 'page').length}</b> pages</div>
                <div><b>{checks.length}</b> checks</div>
                <div><b>{lesson.hours} h</b> of instruction</div>
                <div><b>~{Math.max(8, content.items.length * 3)} min</b> to read</div>
              </div>
              <GroundedKeyPoints course={course} lesson={lesson} />
              {prog.complete && <div className="s-ls-callout tip" style={{ marginTop: '1rem' }}><div className="s-ls-callout-t">Completed</div><div>You have finished this lesson. Pages stay open for review.</div></div>}
            </>
          )}

          {cur.type === 'page' && (
            <>
              <h2 className="s-lp-h">{cur.title}</h2>
              {cur.blocks.map((b, bi) => (
                <Block
                  key={bi}
                  block={b}
                  blockKey={`${cur.id}::${bi}`}
                  explored={prog.hotspots?.[`${cur.id}::${bi}`]}
                  onExplore={onExplore}
                />
              ))}
            </>
          )}

          {cur.type === 'check' && (
            <CheckItem item={cur} answer={prog.answers[cur.id]} onAnswer={(k) => save({ answers: { ...prog.answers, [cur.id]: k } })} />
          )}

          {cur.type === 'practice' && (
            <>
              <h2 className="s-lp-h">{cur.title}</h2>
              <p className="s-ls-p">{cur.text}</p>
              <div className="p-btnrow">
                <button className="p-btn" onClick={() => go('materials')}>Open practice set</button>
                <span style={{ fontSize: '0.85em', color: 'var(--p-faint)' }}>Opens Study Materials for this course</span>
              </div>
            </>
          )}

          {cur.type === 'attachments' && (
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
          )}
        </article>

        <div className="s-lp-nav">
          <button className="p-btn ghost" disabled={idx === 0} onClick={() => goTo(idx - 1)}>← Previous</button>
          <span className="s-lp-navmid">
            {gated
              ? (cur.type === 'check' ? 'Answer to continue' : 'Explore every callout to continue')
              : cur.type === 'overview' ? (prog.complete ? 'Review' : 'Start the lesson') : ''}
          </span>
          {!atEnd ? (
            <button className="p-btn" disabled={gated} onClick={() => goTo(idx + 1)}>
              {cur.type === 'overview' ? (prog.complete ? 'Review →' : 'Start →') : 'Next →'}
            </button>
          ) : prog.complete ? (
            next ? <button className="p-btn" onClick={() => onPick(next)}>Next lesson: {next.title} →</button> : <button className="p-btn ghost" onClick={onBack}>Back to lessons</button>
          ) : (
            <button className="p-btn" disabled={!allDone} onClick={finish} title={allDone ? '' : 'Answer every check first'}>
              Finish lesson ✓
            </button>
          )}
        </div>
      </div>

      <aside className="s-lp-side">
        <div className="s-outline">
          <div className="s-label">Lesson map</div>
          <ol className="s-map">
            {screens.map((sc, k) => {
              const done = isDone(sc);
              const locked = !canOpen(k);
              const ans = sc.type === 'check' && prog.answers[sc.id] != null ? sc.answers[prog.answers[sc.id]].correct : null;
              return (
                <li key={sc.id}>
                  <button className={`s-map-item${k === idx ? ' on' : ''}${locked ? ' locked' : ''}`} disabled={locked} onClick={() => goTo(k)}>
                    <span className={`s-map-mark ${sc.type}${done ? ' done' : ''}${ans === false ? ' miss' : ''}`}>
                      {done ? (ans === false ? '!' : '✓') : locked ? '' : ''}
                    </span>
                    <span className="s-map-text">
                      <span className="s-map-title">{sc.title}</span>
                      <span className="s-map-kind">{KIND[sc.type]}{ans === false ? ' · missed' : ''}</span>
                    </span>
                  </button>
                </li>
              );
            })}
          </ol>
          <div className="s-outline-foot">
            {doneCount} of {screens.length} done{checks.length ? ` · ${correct}/${checks.length} checks correct` : ''}
          </div>
        </div>
        <button className="s-lp-q" onClick={() => onOpenThread(null, lesson.id)}>
          <span className="s-lp-q-n">{qCount}</span>
          <span className="s-lp-q-t">
            <span>{qCount === 1 ? 'question' : 'questions'} on this lesson</span>
            <span className="s-lp-q-s">Ask or answer in Discussions</span>
          </span>
        </button>
        <div className="s-lp-jump">
          {prev && <button className="s-lesson-navbtn" onClick={() => onPick(prev)}><span>← Previous lesson</span><b>{prev.title}</b></button>}
          {next && <button className="s-lesson-navbtn" onClick={() => onPick(next)}><span>Next lesson →</span><b>{next.title}</b></button>}
        </div>
      </aside>
    </div>
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
    const need = seq.flat.slice(0, seq.flat.findIndex((l) => l.id === picked.id)).reverse().find((l) => !prefs.progress?.[l.id]?.complete);
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
