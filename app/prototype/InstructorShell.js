'use client';

import './student.css';

import { COURSES } from './data';
import { I, RailButton, UserMenu } from './shell';
import { InstructorSettings } from './Settings';
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

   The library is the persisted learning loop: courses, sources and rubrics.
   A course gets its tools only after it has been resolved from either the
   learning service or the explicitly labelled sample area below. */

const INSTRUCTOR = { name: 'SSgt Okafor', initials: 'SO', role: 'Instructor' };

const LIBRARY = [
  { id: 'courses', label: 'Courses', icon: I.courses },
  { id: 'sources', label: 'Sources', icon: I.dashboard },
  { id: 'rubrics', label: 'Rubrics', icon: I.dashboard },
  { id: 'settings', label: 'Settings', icon: I.dashboard },
];

const MOCK_VIEWS = [
  { id: 'builder', label: 'Sample overview' },
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
  builder: SampleCourse,
  roster: Roster,
  control: LiveControl,
  mastery: Mastery,
  aar: AAR,
  settings: InstructorSettings,
};

function SampleCourse({ course }) {
  return (
    <StatusMessage title={course?.name || 'Sample course'}>
      <span>
        Sample course · view only. Create and review AI-generated courses from the signed-in Courses library.
      </span>
    </StatusMessage>
  );
}

function StatusMessage({ title, children }) {
  return (
    <>
      <h2 className="p-h">{title}</h2>
      {children && <p className="p-sub">{children}</p>}
    </>
  );
}

function CourseUnavailable({ courseId, title = 'Course unavailable', children }) {
  return (
    <StatusMessage title={title}>
      {children || (
        <>
          Course <code>{courseId || 'unknown'}</code> is not available here. Return to Courses.
        </>
      )}
    </StatusMessage>
  );
}

export default function InstructorShell({ nav, onSwitchRole, role: profileRole }) {
  const { ready: authReady, profile, signOut, signOutError } = useAuth();
  const {
    authenticated,
    name: displayName,
    rank: displayRank,
    initials,
  } = accountDisplay({ ready: authReady, profile, demo: INSTRUCTOR });
  const learning = useLearningCourses();

  const inLibrary = nav.area === 'library';
  const inCourse = nav.area === 'course';
  const libraryEntry = inLibrary ? LIBRARY.find((l) => l.id === nav.view) : null;
  const libraryView = libraryEntry?.id || null;
  const invalidArea = !inLibrary && !inCourse;

  // Which course is on screen. A real id that has not loaded yet resolves to
  // null; while the list is loading we hold rather than bounce to a sample
  // course. An unresolved id is an explicit service/not-found state below.
  const course = inCourse ? resolveCourse(nav.courseId, learning.courses) : null;
  const isReal = Boolean(course?.record);
  const VIEWS = isReal ? REAL_VIEWS : MOCK_VIEWS;
  const current = course ? VIEWS.find((v) => v.id === nav.view) || (nav.view ? null : VIEWS[0]) : null;
  const view = current?.id || null;

  const go = (patch) => nav.go({ role: 'instructor', area: 'course', courseId: course?.id || nav.courseId, view: view || 'builder', ...patch });
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

  const courseLookupLoading = inCourse && !course && Boolean(nav.courseId) && (
    !authReady || (learning.enabled && learning.loading)
  );
  const courseServiceError = inCourse && !course && !courseLookupLoading && Boolean(learning.error);
  const courseUnavailable = inCourse && !course && !courseLookupLoading && !courseServiceError && !learning.enabled;
  const courseNotFound = inCourse && !course && !courseLookupLoading && !courseServiceError && !courseUnavailable;
  const unsupportedRealView = Boolean(course?.record && nav.view && !current);
  const accountSettingsCourse = {
    id: `instructor-account${profile?.id ? `-${profile.id}` : ''}`,
    name: 'Instructor account',
  };

  let body;
  if (invalidArea) {
    body = (
      <StatusMessage title="Page not found">
        Choose a page from the instructor library.
      </StatusMessage>
    );
  } else if (inCourse && courseLookupLoading) {
    body = <p>Loading course…</p>;
  } else if (inCourse && courseServiceError) {
    body = (
      <CourseUnavailable courseId={nav.courseId} title="Course service unavailable">
        Try again or return to Courses.
      </CourseUnavailable>
    );
  } else if (inCourse && courseUnavailable) {
    body = (
      <CourseUnavailable courseId={nav.courseId}>
        Sign in with an instructor account to load this course. Sample courses are listed in the sidebar.
      </CourseUnavailable>
    );
  } else if (inCourse && courseNotFound) {
    body = <CourseUnavailable courseId={nav.courseId} title="Course not found" />;
  } else if (inLibrary && !libraryEntry) {
    body = (
      <StatusMessage title="Library page not found">
        Choose Courses, Sources, Rubrics or Settings.
      </StatusMessage>
    );
  } else if (inLibrary && libraryView === 'settings') {
    body = (
      <InstructorSettings
        course={accountSettingsCourse}
        account={profile}
        authenticated={authenticated}
      />
    );
  } else if (inLibrary && !learning.enabled) {
    body = (
      <>
        <h2 className="p-h">Sign in required</h2>
        <p className="p-sub">
          Sign in to use Sources, Courses and Rubrics. Sample courses work without an account.
        </p>
      </>
    );
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
  } else if (inCourse && unsupportedRealView) {
    body = (
      <CourseUnavailable courseId={course.id} title="Course tool unavailable">
        Choose another tool for this course.
      </CourseUnavailable>
    );
  } else if (isReal) {
    if (view === 'builder') body = <CourseDraft key={course.id} course={course} onChanged={learning.refetch} />;
    else if (view === 'fidelity') {
      body = (
        <>
          <h2 className="p-h">Doctrinal fidelity</h2>
          <p className="p-sub">
            Run learner questions against approved sources before publishing.
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
    body = Screen ? (
      <Screen key={course.id} course={course} account={profile} authenticated={authenticated} instructorName={displayName} />
    ) : (
      <CourseUnavailable courseId={course.id} title="Course tool not found" />
    );
  }

  const crumbTail = inLibrary
    ? (libraryEntry?.label || 'Not found')
    : (current?.label || (inCourse ? 'Course' : 'Not found'));

  return (
    <div className="s-root">
      <nav className="s-rail">
        <UserMenu
          name={displayName}
          role={!profileRole ? INSTRUCTOR.role : profileRole === 'BOTH' ? 'Learner · Instructor' : INSTRUCTOR.role}
          rank={displayRank}
          initials={initials}
          inst
          items={[
            { label: 'Settings', hint: 'Account settings', onClick: () => goLibrary('settings') },
            ...(onSwitchRole ? [{ label: 'View as student', onClick: onSwitchRole }, 'divider'] : ['divider']),
            { label: 'Sign out', danger: true, onClick: handleSignOut },
          ]}
        />

        <div className="s-rail-sec" style={{ paddingTop: '0.2rem' }}>Library</div>
        {LIBRARY.map((l) => (
          <RailButton key={l.id} icon={l.icon} label={l.label} on={inLibrary && libraryView === l.id} onClick={() => goLibrary(l.id)} />
        ))}

        <div className="s-rail-sec">Sample courses</div>
        {Object.values(COURSES).map((c) => (
          <RailButton
            key={c.id}
            sub
            on={inCourse && c.id === course?.id}
            icon={<span className="s-rail-dot" style={{ background: c.id === 'M092721' ? 'var(--p-accent)' : 'var(--p-dim)' }} />}
            label={c.name.replace(' Course', '')}
            onClick={() => openCourse(c.id)}
          />
        ))}

        {inCourse && course && (
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
          ) : inCourse && course ? (
            <button onClick={() => go({ view: 'builder' })}>{course.name}</button>
          ) : (
            <span className="s-crumb-cur">Not found</span>
          )}
          <span className="s-crumb-sep">/</span>
          <span className="s-crumb-cur">{crumbTail}</span>
          <span className="s-crumb-spacer" />
          {inCourse && course && !isReal && (
            <span className="s-lastlogin">{course.students} students · Week {course.week} of {course.weeks}</span>
          )}
          {inCourse && course && isReal && (
            <span className="s-lastlogin">{course.sections} sections · {course.status === 'APPROVED' ? 'Approved' : 'Draft'}</span>
          )}
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
    </div>
  );
}
