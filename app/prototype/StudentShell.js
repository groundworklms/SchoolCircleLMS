'use client';

import { useEffect, useRef } from 'react';

import './student.css';

import { COURSES } from './data';
import StudentPath from './StudentPath';
import StudyMaterials from './StudyMaterials';
import LiveSession from './LiveSession';
import MyProgress from './MyProgress';
import StudentCalendar from './StudentCalendar';
import StudentInbox, { useInboxMessages } from './StudentInbox';
import Assignments, { dueSoon } from './Assignments';
import Lessons, { currentLesson } from './Lessons';
import CourseChat from './CourseChat';
import { TODO, UPCOMING } from './agenda';
import { I, RailButton, UserMenu } from './shell';
import Grades from './Grades';
import Discussions from './Discussions';
import { StudentSettings } from './Settings';
import { usePrefs } from './prefs';
import { useLearningCourses, resolveCourse } from './learning';
import { RealCourseHome, CourseReader, MasterySession, StudyPlan, LearnerProgress } from './LearnerFeatures';
import LibraryList from './published/Library';
import PublishedCourseReader from './published/CourseReader';
import { useAuth } from '../_auth/AuthProvider';
import { accountDisplay } from '../_auth/account-display';

/* Student shell. Canvas-shaped — global icon rail, dashboard with course cards,
   course sub-nav, breadcrumb, and a To-Do column — on a neutral palette.
   The screens it mounts are untouched; this file only decides where they sit.

   Courses come from two places (see learning.js): approved LearningRecord
   courses from /api/learning, which get the views the API can back (reader,
   Whetstone mastery, Cadence path, Sextant progress), and the mock demo
   courses, which keep the full click-through set. */

const STUDENT = { name: 'Cpl Rivera', initials: 'CR' };

const COURSE_NAV = [
  { id: 'home', label: 'Home' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'path', label: 'Learning Path' },
  { id: 'materials', label: 'Study Materials' },
  { id: 'assignments', label: 'Assignments' },
  { id: 'grades', label: 'Grades' },
  { id: 'discussions', label: 'Discussions' },
  { id: 'live', label: 'Live Session' },
  { id: 'progress', label: 'My Progress' },
];

// Views a real (approved LearningRecord) course supports.
const REAL_COURSE_NAV = [
  { id: 'home', label: 'Home' },
  { id: 'lessons', label: 'Lessons' },
  { id: 'mastery', label: 'Mastery Session' },
  { id: 'path', label: 'Learning Path' },
  { id: 'progress', label: 'My Progress' },
];

function RealProgress({ course }) {
  return <LearnerProgress courseId={course.id} />;
}

const REAL_SCREENS = {
  lessons: CourseReader,
  mastery: MasterySession,
  path: StudyPlan,
  progress: RealProgress,
};

const SCREENS = {
  lessons: Lessons,
  path: StudentPath,
  materials: StudyMaterials,
  assignments: Assignments,
  grades: Grades,
  discussions: Discussions,
  live: LiveSession,
  progress: MyProgress,
};

/* ---------- small pieces ---------- */

function courseAvg(course) {
  return Math.round(course.topics.reduce((s, t) => s + t.mastery, 0) / course.topics.length);
}

/* To do + Coming up. Lives inside the content column, next to the main
   content, rather than as a full-height strip on the far edge. */
function Agenda({ courseId, onOpen }) {
  const todo = TODO.filter((t) => !courseId || !t.courseId || t.courseId === courseId);
  const up = UPCOMING.filter((t) => !courseId || t.courseId === courseId);
  return (
    <aside className="s-agenda">
      <section className="s-box">
        <h4 className="s-label">To do</h4>
        <ul className="s-list">
          {todo.map((t) => (
            <li key={t.title} className={t.late ? 'late' : ''}>
              <span className="s-tick" />
              <button className="s-item" onClick={() => t.courseId && onOpen(t.courseId, t.view)}>
                <span className="s-item-title">{t.title}</span>
                <span className="s-item-meta">
                  {t.courseId ? <code>{COURSES[t.courseId]?.id || t.courseId}</code> : t.kind} · {t.due}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
      <section className="s-box">
        <h4 className="s-label">Coming up</h4>
        <ul className="s-list">
          {up.map((t) => (
            <li key={t.title}>
              <span className={`s-dot${t.exam ? ' exam' : ''}`} />
              <button className="s-item" onClick={() => onOpen(t.courseId, t.view)}>
                <span className="s-item-title">{t.title}</span>
                <span className="s-item-meta">
                  <code>{COURSES[t.courseId]?.id || t.courseId}</code> · {t.when}
                  {t.exam && <span className="p-examtag" style={{ marginLeft: '0.4rem' }}>EXAM</span>}
                </span>
              </button>
            </li>
          ))}
        </ul>
      </section>
    </aside>
  );
}

/* ---------- dashboard ---------- */

function RealCourseCard({ c, onOpen }) {
  return (
    <button className="s-card" onClick={() => onOpen(c.id, 'home')}>
      <div className="s-card-head">
        <div>
          <div className="s-card-title">{c.name}</div>
          <div className="s-card-school">{c.school}</div>
        </div>
        <div className="s-card-avg">
          <span style={{ color: 'var(--p-good)' }}>✓</span>
          <small>cited</small>
        </div>
      </div>
      <div className="s-card-foot">
        <span>{c.sections} sections · {c.status === 'APPROVED' ? 'approved by your instructor' : 'generated course'}</span>
      </div>
    </button>
  );
}

function Dashboard({
  onOpen,
  realCourses = [],
  learningLoading = false,
  learningError = null,
}) {
  const list = Object.values(COURSES);

  // Up next: anything overdue, then the first due item per course.
  const upNext = [
    ...TODO.filter((t) => t.late),
    ...list.map((c) => TODO.find((t) => t.courseId === c.id)).filter(Boolean),
  ];

  return (
    <div className="s-two">
      <div>
        <div className="s-pagehead">
          <h1>Dashboard</h1>
          {learningLoading ? (
            <p role="status">Loading courses…</p>
          ) : learningError ? (
            <p className="s-shell-error" role="alert">
              Unable to load courses: {learningError.error || learningError.message || 'the learning service is unavailable.'}
            </p>
          ) : (
            <p>{realCourses.length} available course{realCourses.length === 1 ? '' : 's'}</p>
          )}
        </div>

        <h4 className="s-label">Up next · Demo</h4>
        <div className="s-next">
          {upNext.map((t) => (
            <button
              key={t.title}
              className={`s-next-card${t.late ? ' late' : ''}`}
              onClick={() => t.courseId && onOpen(t.courseId, t.view)}
            >
              <span className="s-next-kind">{t.courseId ? COURSES[t.courseId]?.name || t.courseId : t.kind}</span>
              <span className="s-next-title">{t.title}</span>
              <span className="s-next-meta">
                <b>{t.due}</b>
                {t.minutes ? ` · ~${t.minutes} min` : ''}
              </span>
            </button>
          ))}
        </div>

        <h4 className="s-label">Available courses</h4>
        <div className="s-cards">
          {realCourses.map((c) => (
            <RealCourseCard key={c.id} c={c} onOpen={onOpen} />
          ))}
          {!realCourses.length && !learningLoading && !learningError && (
            <p className="s-cal-empty">No courses available.</p>
          )}
        </div>

        <details>
          <summary className="s-label">Demo courses (not enrolled)</summary>
          <div className="s-cards">
            {list.map((c) => {
              const avg = courseAvg(c);
              const pct = Math.round((c.week / c.weeks) * 100);
              const next = UPCOMING.find((u) => u.courseId === c.id);
              return (
                <button className="s-card" key={c.id} onClick={() => onOpen(c.id, 'home')}>
                  <div className="s-card-head">
                    <div>
                      <div className="s-card-title">
                        {c.name} <code>{c.id}</code>
                      </div>
                      <div className="s-card-school">Demo · {c.school}</div>
                    </div>
                    <div className="s-card-avg">
                      <span>{avg}%</span>
                      <small>demo mastery</small>
                    </div>
                  </div>
                  <div className="s-prog">
                    <div className="s-prog-track"><div className="s-prog-fill" style={{ width: `${pct}%` }} /></div>
                    <span>Week {c.week} of {c.weeks}</span>
                  </div>
                  {next && <div className="s-card-foot"><span>Next: {next.title.split(' — ')[0]} · {next.when}</span></div>}
                </button>
              );
            })}
          </div>
        </details>

        <h4 className="s-label">Required training · Demo</h4>
        <div className="s-req">
          {[
            ['Annual cyber awareness', 'Complete', 'var(--p-good)'],
            ['Rank EPME — enrolled', 'In progress', 'var(--p-warning)'],
            ['CY range qualification', 'Due in 22 days', 'var(--p-warning)'],
            ['Course prerequisite packet', 'Complete', 'var(--p-good)'],
            ['FY safety standdown', 'Overdue', 'var(--p-critical)'],
          ].map(([name, state, color]) => (
            <div className="s-req-row" key={name}>
              <span style={{ color, fontSize: '0.75em' }}>●</span>
              <span className="s-req-name">{name}</span>
              <span style={{ color, fontSize: '0.85em' }}>{state}</span>
            </div>
          ))}
        </div>
      </div>

      <Agenda courseId={null} onOpen={onOpen} />
    </div>
  );
}

function Courses({
  onOpen,
  onOpenPublished,
  realCourses = [],
  learningLoading = false,
  learningError = null,
}) {
  const list = Object.values(COURSES);
  return (
    <div className="s-two">
      <div>
        <div className="s-pagehead">
          <h1>Courses</h1>
        </div>

        <h4 className="s-label">Available courses</h4>
        {learningLoading && <p role="status">Loading courses…</p>}
        {learningError && (
          <div className="s-shell-error" role="alert">
            Unable to load courses: {learningError.error || learningError.message || 'the learning service is unavailable.'}
          </div>
        )}
        <div className="s-courselist">
          {realCourses.map((c) => (
            <button className="s-courserow" key={c.id} onClick={() => onOpen(c.id, 'home')}>
              <div className="s-courserow-main">
                <div className="s-card-title">{c.name}</div>
                <div className="s-card-school">{c.school}</div>
                <div className="s-prog"><span>{c.sections} sections</span></div>
              </div>
              <div className="s-card-avg">
                <span style={{ color: 'var(--p-good)' }}>✓</span>
                <small>cited</small>
              </div>
              <span className="s-quick-arrow">→</span>
            </button>
          ))}
          {!realCourses.length && !learningLoading && !learningError && (
            <p className="s-cal-empty">No courses available.</p>
          )}
        </div>

        <h4 className="s-label">Published courses</h4>
        <LibraryList onOpen={onOpenPublished} />

        <details>
          <summary className="s-label">Demo courses and training (not enrolled)</summary>
          <div className="s-courselist">
            {list.map((c) => {
              const avg = courseAvg(c);
              const pct = Math.round((c.week / c.weeks) * 100);
              const next = UPCOMING.find((u) => u.courseId === c.id);
              return (
                <button className="s-courserow" key={c.id} onClick={() => onOpen(c.id, 'home')}>
                  <div className="s-courserow-main">
                    <div className="s-card-title">
                      {c.name} <code>{c.id}</code>
                    </div>
                    <div className="s-card-school">Demo · {c.school}</div>
                    <div className="s-prog">
                      <div className="s-prog-track"><div className="s-prog-fill" style={{ width: `${pct}%` }} /></div>
                      <span>Week {c.week} of {c.weeks}{next ? ` · Next: ${next.title.split(' — ')[0]} · ${next.when}` : ''}</span>
                    </div>
                  </div>
                  <div className="s-card-avg">
                    <span>{avg}%</span>
                    <small>demo mastery</small>
                  </div>
                  <span className="s-quick-arrow">→</span>
                </button>
              );
            })}
          </div>
        </details>

        <h4 className="s-label">Required training</h4>
        <div className="s-courselist">
          {[
            ['Annual cyber awareness', 'CY training', 'Complete', 'var(--p-good)'],
            ['Rank EPME — Sergeants Course', 'EPME', 'In progress · 40%', 'var(--p-warning)'],
            ['CY range qualification', 'CY training', 'Due in 22 days', 'var(--p-warning)'],
            ['FY safety standdown', 'FY training', 'Overdue', 'var(--p-critical)'],
          ].map(([name, kind, state, color]) => (
            <div className="s-courserow static" key={name}>
              <div className="s-courserow-main">
                <div className="s-card-title" style={{ fontSize: '0.98em' }}>{name}</div>
                <div className="s-card-school">{kind} · auto-enrolled</div>
              </div>
              <span style={{ color, fontSize: '0.85em', fontWeight: 600 }}>{state}</span>
            </div>
          ))}
        </div>

        <h4 className="s-label">Completed</h4>
        <div className="s-courselist">
          {[
            ['Marine Corps Institute — Math for Marines', 'MCI 1334', 'Jun 2026'],
            ['Basic Electronics Course — prerequisite packet', 'M092721-P', 'Aug 2026'],
          ].map(([name, code, when]) => (
            <div className="s-courserow static done" key={name}>
              <div className="s-courserow-main">
                <div className="s-card-title" style={{ fontSize: '0.98em' }}>
                  {name} <code>{code}</code>
                </div>
              </div>
              <span style={{ color: 'var(--p-faint)', fontSize: '0.85em' }}>{when}</span>
            </div>
          ))}
        </div>
      </div>

      <details>
        <summary className="s-label">Demo schedule</summary>
        <Agenda courseId={null} onOpen={onOpen} />
      </details>
    </div>
  );
}

/* ---------- course view ---------- */

function CourseHome({ course, go, onOpen }) {
  const avg = courseAvg(course);
  const weakest = [...course.topics].sort((a, b) => a.mastery - b.mastery)[0];
  const strongest = [...course.topics].sort((a, b) => b.mastery - a.mastery)[0];
  const pct = Math.round((course.week / course.weeks) * 100);
  return (
    <div className="s-two">
      <div>
        <div className="s-pagehead">
          <h1>
            {course.name} <code>{course.id}</code>
          </h1>
          <p>{course.school}</p>
        </div>

        <div className="s-hero">
          <div className="s-hero-tile wide">
            <div className="s-label">This week</div>
            <div className="s-hero-num">
              Week {course.week} <span>of {course.weeks}</span>
            </div>
            <div className="s-prog">
              <div className="s-prog-track"><div className="s-prog-fill" style={{ width: `${pct}%` }} /></div>
              <span>{pct}% through the POI</span>
            </div>
          </div>
          <div className="s-hero-tile">
            <div className="s-label">Overall mastery</div>
            <div className="s-hero-num">{avg}%</div>
            <div className="s-hero-sub">across {course.topics.length} topics</div>
          </div>
          <div className="s-hero-tile">
            <div className="s-label">Needs work</div>
            <div className="s-hero-num small" style={{ color: 'var(--p-critical)' }}>{weakest.name}</div>
            <div className="s-hero-sub">{weakest.mastery}% — at risk</div>
          </div>
          <div className="s-hero-tile">
            <div className="s-label">Strongest</div>
            <div className="s-hero-num small" style={{ color: 'var(--p-good)' }}>{strongest.name}</div>
            <div className="s-hero-sub">{strongest.mastery}%</div>
          </div>
        </div>

        {(() => {
          const cur = currentLesson(course);
          return cur ? (
            <button className="s-continue" onClick={() => go('lessons')}>
              <span className="s-continue-body">
                <span className="s-continue-lab">Continue where you left off</span>
                <span className="s-continue-title">{cur.title}</span>
                <span className="s-continue-meta">Annex {cur.annex.letter} — {cur.annex.title} · {cur.id} · {cur.hours} h</span>
              </span>
              <span className="s-continue-btn">Open lesson</span>
            </button>
          ) : null;
        })()}

        <div className="s-label s-label-row">
          <span>Assignments due</span>
          <button className="s-label-link" onClick={() => go('assignments')}>All assignments →</button>
        </div>
        <div className="s-due">
          {dueSoon(course.id).map((a) => (
            <button className="s-due-row" key={a.id} onClick={() => go('assignments')}>
              <span className="s-due-main">
                <span className="s-due-title">{a.title}</span>
                <span className="s-due-meta">{a.type} · {a.points} pts</span>
              </span>
              <span className="s-due-when">{a.dueLabel}</span>
              <span className="s-due-status" style={{ color: a.status === 'in-progress' ? 'var(--p-warning)' : 'var(--p-dim)' }}>
                {a.status === 'in-progress' ? `In progress · ${a.progress}%` : 'Not started'}
              </span>
            </button>
          ))}
          {dueSoon(course.id).length === 0 && <p className="s-cal-empty" style={{ padding: '0.8rem 1rem' }}>Nothing due.</p>}
        </div>

        <h4 className="s-label">In this course</h4>
        <div className="s-quick">
          {[
            ['lessons', 'Lessons', 'The course as the POI lays it out — annexes, lessons, exams.'],
            ['path', 'Learning Path', 'Your plan for the week, in three courses of action.'],
            ['materials', 'Study Materials', 'Study guide, key terms, and practice with rationale.'],
            ['assignments', 'Assignments', 'Graded work from your instructors, with due dates and feedback.'],
            ['grades', 'Grades', 'Your grade and standing by annex, with the counseling record.'],
            ['discussions', 'Discussions', 'Questions attached to the lesson they are about. Instructors answer here.'],
            ['live', 'Live Session', 'Join the classroom game when the instructor starts it.'],
            ['progress', 'My Progress', 'Mastery by topic. Yours only.'],
          ].map(([id, t, d]) => (
            <button className="s-quick-btn" key={id} onClick={() => go(id)}>
              <span className="s-quick-t">{t}</span>
              <span className="s-quick-d">{d}</span>
              <span className="s-quick-arrow">→</span>
            </button>
          ))}
        </div>

        <h4 className="s-label">Objectives</h4>
        <ol className="s-obj">
          {course.objectives.map((o) => (
            <li key={o}>{o}</li>
          ))}
        </ol>
      </div>

      <Agenda courseId={course.id} onOpen={onOpen} />
    </div>
  );
}

function CourseUnavailable({ courseId, error }) {
  return (
    <div className="s-shell-error" role="alert">
      <h2>Course unavailable</h2>
      <p>
        {courseId
          ? `No accessible course matches “${courseId}”.`
          : 'A course ID is required to open this course.'}
      </p>
      {error ? <p>{error.error || error.message || 'The course service did not return this record.'}</p> : null}
    </div>
  );
}

function UnsupportedCourseTool({ course, view }) {
  return (
    <div className="s-shell-error" role="alert">
      <h2>Tool unavailable</h2>
      <p>
        {course?.name || 'This course'} does not support the “{view || 'unknown'}” learner tool.
        Choose one of the tools listed for this course.
      </p>
    </div>
  );
}

/* ---------- shell ---------- */

export default function StudentShell({ nav, onSwitchRole, role: profileRole }) {
  const { ready: authReady, profile, signOut, signOutError } = useAuth();
  const {
    authenticated,
    name: displayName,
    rank: displayRank,
    initials,
  } = accountDisplay({ ready: authReady, profile, demo: STUDENT });
  const handleSignOut = async () => {
    try {
      await signOut();
      window.location.href = '/';
    } catch {
      // AuthProvider exposes the explicit error in the shell.
    }
  };

  // Location comes from the URL (see nav.js); these are the three moves the shell makes.
  const { area, courseId, view, lessonId, page, threadId } = nav;
  const prefs = usePrefs();
  const learning = useLearningCourses();
  const isPublished = area === 'published';
  const course = isPublished ? null : resolveCourse(courseId, learning.courses);
  const isReal = Boolean(course?.record);
  const pendingCourse = !isPublished && area === 'course' && Boolean(courseId) && !course && learning.loading;
  const NAV = isReal ? REAL_COURSE_NAV : COURSE_NAV;
  const inboxUnread = useInboxMessages().filter((m) => m.unread).length;

  // Remember the lesson + page you were on per course, so leaving Lessons for
  // another screen and coming back resumes where you left off instead of the
  // lesson list.
  const lessonMemory = useRef({});
  useEffect(() => {
    if (area === 'course' && view === 'lessons' && lessonId) {
      lessonMemory.current[courseId] = { lessonId, page };
    }
  }, [area, view, courseId, lessonId, page]);

  const setArea = (a) => nav.go({ area: a, courseId: null, view: null, lessonId: null, page: null });
  const setView = (v) => {
    const remembered = v === 'lessons' ? lessonMemory.current[courseId] : null;
    nav.go({ area: 'course', courseId, view: v, lessonId: remembered?.lessonId ?? null, page: remembered?.page ?? null, threadId: null });
  };
  const open = (id, v = 'home') => nav.go({ area: 'course', courseId: id, view: v || 'home', lessonId: null, page: null });
  const openPublished = (id) => nav.go({ area: 'published', courseId: id, view: null, lessonId: null, page: null, threadId: null });
  const openLesson = (id, pg = null) => nav.go({ area: 'course', courseId, view: 'lessons', lessonId: id, page: pg, threadId: null });
  const openThread = (id, forLesson = null) => nav.go({ area: 'course', courseId, view: 'discussions', threadId: id, lessonId: forLesson, page: null });

  const crumbs = [{ label: 'Dashboard', onClick: () => setArea('dashboard') }];
  if (area === 'course' && course) {
    crumbs.push({ label: course.name, onClick: () => setView('home') });
    if (view !== 'home') crumbs.push({ label: (NAV.find((n) => n.id === view) || NAV[0]).label });
  } else if (area === 'published') {
    crumbs.push({ label: 'Courses', onClick: () => setArea('courses') });
    crumbs.push({ label: `Published course${courseId ? ` · ${courseId}` : ''}` });
  } else if (area === 'courses') crumbs.push({ label: 'Courses' });
  else if (area === 'calendar') crumbs.push({ label: 'Calendar' });
  else if (area === 'inbox') crumbs.push({ label: 'Inbox' });
  else if (area === 'settings') crumbs.push({ label: 'Settings' });

  let body;
  if (area === 'published') {
    body = <PublishedCourseReader courseId={courseId} onBack={() => setArea('courses')} />;
  } else if (pendingCourse) body = <p role="status">Loading course…</p>;
  else if (area === 'course' && !course) body = <CourseUnavailable courseId={courseId} error={learning.error} />;
  else if (area === 'dashboard') {
    body = (
      <Dashboard
        onOpen={open}
        realCourses={learning.courses}
        learningLoading={learning.loading}
        learningError={learning.error}
      />
    );
  }
  else if (area === 'courses') {
    body = (
      <Courses
        onOpen={open}
        onOpenPublished={openPublished}
        realCourses={learning.courses}
        learningLoading={learning.loading}
        learningError={learning.error}
      />
    );
  }
  else if (area === 'calendar') body = <StudentCalendar onOpen={open} />;
  else if (area === 'inbox') body = <StudentInbox onOpen={open} onArea={setArea} />;
  else if (area === 'settings') {
    body = (
      <StudentSettings
        onSignOut={handleSignOut}
        account={profile}
        authenticated={authenticated}
        tab={nav.tab}
        onTab={(t) => nav.go({ area: 'settings', courseId: null, view: null, tab: t })}
      />
    );
  }
  else if (isReal && view === 'home') body = <RealCourseHome key={course.id} course={course} go={setView} />;
  else if (isReal) {
    const Screen = REAL_SCREENS[view];
    body = Screen
      ? <Screen key={`${course.id}:${view}`} course={course} />
      : <UnsupportedCourseTool course={course} view={view} />;
  }
  else if (view === 'home') body = <CourseHome course={course} go={setView} onOpen={open} />;
  else {
    const Screen = SCREENS[view];
    body = Screen
      ? <Screen key={course.id} course={course} go={setView} lessonId={lessonId} page={page} onOpenLesson={openLesson} threadId={threadId} onOpenThread={openThread} lessonFilter={view === 'discussions' ? lessonId : null} />
      : <UnsupportedCourseTool course={course} view={view} />;
  }

  return (
    <div className="s-root" style={{ '--scale': prefs.textScale }}>
      <nav className="s-rail">
        <UserMenu
          name={displayName}
          role={!profileRole ? 'Student' : profileRole === 'BOTH' ? 'Learner · Instructor' : 'Learner'}
          rank={displayRank}
          initials={initials}
          items={[
            { label: 'Settings', hint: 'Reminders · How I learn', onClick: () => setArea('settings') },
            { label: 'My progress', onClick: () => open('M092721', 'progress') },
            'divider',
            { label: 'Sign out', danger: true, onClick: handleSignOut },
          ]}
        />
        <RailButton icon={I.dashboard} label="Dashboard" on={area === 'dashboard'} onClick={() => setArea('dashboard')} />
        <RailButton icon={I.courses} label="Courses" on={area === 'courses'} onClick={() => setArea('courses')} />
        <RailButton icon={I.calendar} label="Calendar" on={area === 'calendar'} onClick={() => setArea('calendar')} />
        <RailButton icon={I.inbox} label="Inbox" on={area === 'inbox'} onClick={() => setArea('inbox')} badge={inboxUnread} />

        {area === 'course' && course ? (
          <>
            <div className="s-rail-sec">
              <span className="s-rail-sec-name">{course.name}</span>
              {!isReal && <code>{course.id}</code>}
            </div>
            {NAV.map((n) => (
              <RailButton key={n.id} label={n.label} sub on={view === n.id} onClick={() => setView(n.id)} />
            ))}
          </>
        ) : (
          <>
            <div className="s-rail-sec">Available courses</div>
            {learning.courses.map((c) => (
              <RailButton
                key={c.id}
                sub
                icon={<span className="s-rail-dot" style={{ background: 'var(--p-good)' }} />}
                label={c.name}
                onClick={() => open(c.id, 'home')}
              />
            ))}
            <div className="s-rail-sec">Demo samples</div>
            {Object.values(COURSES).map((c) => (
              <RailButton
                key={c.id}
                sub
                icon={<span className="s-rail-dot" style={{ background: c.id === 'M092721' ? 'var(--p-accent)' : 'var(--p-dim)' }} />}
                label={`${c.name.replace(' Course', '')} · demo`}
                onClick={() => open(c.id, 'home')}
              />
            ))}
          </>
        )}

        <div className="s-rail-spacer" />
        {onSwitchRole && (
          <RailButton icon={I.swap} label="View as instructor" onClick={onSwitchRole} />
        )}
        <RailButton icon={I.back} label="Planning board" onClick={() => { window.location.href = '/'; }} />
      </nav>

      <div className="s-content">
        <div className="s-crumbs">
          {crumbs.map((c, i) => (
            <span key={c.label}>
              {i > 0 && <span className="s-crumb-sep">/</span>}
              {c.onClick && i < crumbs.length - 1 ? (
                <button onClick={c.onClick}>{c.label}</button>
              ) : (
                <span className="s-crumb-cur">{c.label}</span>
              )}
            </span>
          ))}
          <span className="s-crumb-spacer" />
          <span className="s-lastlogin">Last login 12 Sep 26 at 0742</span>
        </div>
        <main className="s-main">
          <div className="s-container">
            {signOutError && (
              <div className="s-shell-error" role="alert">
                {signOutError.error || signOutError.message || 'Unable to sign out. Please try again.'}
              </div>
            )}
            {body}
          </div>
        </main>
      </div>

      {!isPublished && <CourseChat key={course?.id || 'doctrine'} course={course} view={view} />}
    </div>
  );
}
