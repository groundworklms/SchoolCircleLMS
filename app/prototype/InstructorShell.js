'use client';

import './student.css';

import { COURSES } from './data';
import { I, RailButton, UserMenu } from './shell';
import { InstructorSettings } from './Settings';
import Curriculum from './Curriculum';
import LiveControl from './LiveControl';
import Mastery from './Mastery';
import AAR from './AAR';
import Roster from './Roster';
import { SourcesView, CoursesLibrary, CourseDraft } from './Library';
import { InstructorFidelity, RubricsView } from './InstructorFeatures';
import { useLearningCourses, resolveCourse } from './learning';
import { useAuth } from '../_auth/AuthProvider';
import { accountDisplay } from '../_auth/account-display';

/* Instructor shell. Same rail and content column as the student side; what
   changes is who is signed in and what is in the rail.

   The rail has two halves. The library (courses, sources, rubrics) is the
   persisted learning loop and is not tied to a course. Teaching lists the
   courses: real drafts and approved courses from /api/learning first, then the
   mock demo courses. A real course gets the views the API can back (draft,
   fidelity, class mastery, AAR); a mock course keeps the click-through set. */

const INSTRUCTOR = { name: 'SSgt Okafor', initials: 'SO', role: 'Instructor' };

const LIBRARY = [
  { id: 'courses', label: 'AI course drafts', icon: I.courses },
  { id: 'sources', label: 'Sources', icon: I.dashboard },
  { id: 'rubrics', label: 'Rubrics', icon: I.dashboard },
];
// The manual course builder (app/_authoring, PR #73) is its own page for now.
const MANUAL_BUILDER = '/teach/courses';

const MOCK_VIEWS = [
  { id: 'builder', label: 'Curriculum' },
  { id: 'roster', label: 'Roster' },
  { id: 'control', label: 'Run Live Session' },
  { id: 'mastery', label: 'Class Mastery' },
  { id: 'aar', label: 'Course AAR' },
  { id: 'settings', label: 'Course settings' },
];

const REAL_VIEWS = [
  { id: 'builder', label: 'Course draft' },
  { id: 'fidelity', label: 'Doctrinal fidelity' },
  { id: 'mastery', label: 'Class Mastery' },
  { id: 'aar', label: 'Course AAR' },
  { id: 'settings', label: 'Course settings' },
];

const SCREENS = {
  builder: Curriculum,
  roster: Roster,
  control: LiveControl,
  mastery: Mastery,
  aar: AAR,
  settings: InstructorSettings,
};

export default function InstructorShell({ nav, onSwitchRole }) {
  const { ready: authReady, profile, signOut, signOutError } = useAuth();
  const {
    authenticated,
    name: displayName,
    rank: displayRank,
    initials,
  } = accountDisplay({ ready: authReady, profile, demo: INSTRUCTOR });
  const learning = useLearningCourses();

  const inLibrary = nav.area === 'library';
  const libraryView = inLibrary && LIBRARY.find((l) => l.id === nav.view) ? nav.view : 'courses';

  // Which course is on screen. A real id that has not loaded yet resolves to
  // null; while the list is loading we hold rather than bounce to the default.
  const resolved = resolveCourse(nav.courseId, learning.courses);
  const pending = !inLibrary && !resolved && learning.loading;
  const course = resolved || COURSES['M092721'];
  const isReal = Boolean(course.record);
  const VIEWS = isReal ? REAL_VIEWS : MOCK_VIEWS;
  const view = VIEWS.find((v) => v.id === nav.view) ? nav.view : 'builder';
  const current = VIEWS.find((v) => v.id === view);

  const go = (patch) => nav.go({ role: 'instructor', area: 'course', courseId: course.id, view, ...patch });
  const goLibrary = (v) => nav.go({ role: 'instructor', area: 'library', courseId: null, view: v });
  const openCourse = (id) => nav.go({ role: 'instructor', area: 'course', courseId: id, view: 'builder' });
  const handleSignOut = async () => {
    try {
      await signOut();
      window.location.href = '/';
    } catch {
      // AuthProvider exposes the explicit error in the shell.
    }
  };

  let body;
  if (pending) {
    body = <p>Loading course…</p>;
  } else if (inLibrary) {
    if (libraryView === 'sources') body = <SourcesView />;
    else if (libraryView === 'rubrics') body = <RubricsView />;
    else {
      body = (
        <CoursesLibrary
          courses={learning.courses}
          loading={learning.loading}
          error={learning.error}
          onOpen={openCourse}
          onDrafted={learning.refetch}
        />
      );
    }
  } else if (isReal) {
    if (view === 'builder') body = <CourseDraft key={course.id} course={course} onChanged={learning.refetch} />;
    else if (view === 'fidelity') {
      body = (
        <>
          <h2 className="p-h">Doctrinal fidelity</h2>
          <p className="p-sub">
            Understudy asks the tutor what a learner would ask and grades every answer against the
            approved sources. A course ships only when its answers hold to doctrine.
          </p>
          <InstructorFidelity key={course.id} courseId={course.id} />
        </>
      );
    } else {
      const Screen = SCREENS[view];
      body = <Screen key={course.id} course={course} account={profile} authenticated={authenticated} instructorName={displayName} />;
    }
  } else {
    const Screen = SCREENS[view];
    body = <Screen key={course.id} course={course} account={profile} authenticated={authenticated} instructorName={displayName} />;
  }

  const crumbTail = inLibrary
    ? LIBRARY.find((l) => l.id === libraryView).label
    : current.label;

  return (
    <div className="s-root">
      <nav className="s-rail">
        <UserMenu
          name={displayName}
          role={INSTRUCTOR.role}
          rank={displayRank}
          initials={initials}
          inst
          items={[
            { label: 'Settings', hint: inLibrary ? 'Course settings' : course.id, onClick: () => go({ view: 'settings' }) },
            ...(onSwitchRole ? [{ label: 'View as student', onClick: onSwitchRole }, 'divider'] : ['divider']),
            { label: 'Sign out', danger: true, onClick: handleSignOut },
          ]}
        />

        <div className="s-rail-sec" style={{ paddingTop: '0.2rem' }}>Library</div>
        <RailButton icon={I.courses} label="Course builder" onClick={() => { window.location.href = MANUAL_BUILDER; }} />
        {LIBRARY.map((l) => (
          <RailButton key={l.id} icon={l.icon} label={l.label} on={inLibrary && libraryView === l.id} onClick={() => goLibrary(l.id)} />
        ))}

        <div className="s-rail-sec">Teaching</div>
        {learning.courses.map((c) => (
          <RailButton
            key={c.id}
            sub
            on={!inLibrary && c.id === course.id}
            icon={<span className="s-rail-dot" style={{ background: c.status === 'APPROVED' ? 'var(--p-good)' : 'var(--p-warning)' }} />}
            label={c.name}
            onClick={() => openCourse(c.id)}
          />
        ))}
        {Object.values(COURSES).map((c) => (
          <RailButton
            key={c.id}
            sub
            on={!inLibrary && c.id === course.id}
            icon={<span className="s-rail-dot" style={{ background: c.id === 'M092721' ? 'var(--p-accent)' : 'var(--p-dim)' }} />}
            label={c.name.replace(' Course', '')}
            onClick={() => openCourse(c.id)}
          />
        ))}

        {!inLibrary && (
          <>
            <div className="s-rail-sec">
              <span className="s-rail-sec-name">{course.name}</span>
              {!isReal && <code>{course.id}</code>}
            </div>
            {VIEWS.map((v) => (
              <RailButton key={v.id} sub on={view === v.id} label={v.label} onClick={() => go({ view: v.id })} />
            ))}
          </>
        )}

        <div className="s-rail-spacer" />
        {onSwitchRole && (
          <RailButton icon={I.swap} label="View as student" onClick={onSwitchRole} />
        )}
        <RailButton icon={I.back} label="Planning board" onClick={() => { window.location.href = '/plan'; }} />
      </nav>

      <div className="s-content">
        <div className="s-crumbs">
          <span className="s-crumb-cur">Instructor</span>
          <span className="s-crumb-sep">/</span>
          {inLibrary ? (
            <span className="s-crumb-cur">Library</span>
          ) : (
            <button onClick={() => go({ view: 'builder' })}>{course.name}</button>
          )}
          <span className="s-crumb-sep">/</span>
          <span className="s-crumb-cur">{crumbTail}</span>
          <span className="s-crumb-spacer" />
          {!inLibrary && !isReal && (
            <span className="s-lastlogin">{course.students} students · Week {course.week} of {course.weeks}</span>
          )}
          {!inLibrary && isReal && (
            <span className="s-lastlogin">{course.sections} sections · {course.status === 'APPROVED' ? 'Approved' : 'Draft'}</span>
          )}
        </div>
        <main className="s-main">
          <div className="s-container">
            <div className="p-roleband inst">
              <strong>Instructor view</strong>
              <span>Every AI output lands here for review before it reaches a student.</span>
            </div>
            {signOutError && (
              <div className="s-shell-error" role="alert">
                {signOutError.error || signOutError.message || 'Unable to sign out. Please try again.'}
              </div>
            )}
            {body}
          </div>
        </main>
      </div>
    </div>
  );
}
