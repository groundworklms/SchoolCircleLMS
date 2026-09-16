'use client';

import './student.css';

import { I, RailButton, UserMenu } from './shell';
import { InstructorSettings } from './Settings';
import LiveControl from './LiveControl';
import Mastery from './Mastery';
import AAR from './AAR';
import Roster from './Roster';
import { SourcesView, CoursesLibrary, CourseDraft } from './Library';
import { InstructorFidelity, RubricsView } from './InstructorFeatures';
import { useLearningCourses } from './learning';
import { useAuth } from '../_auth/AuthProvider';
import { accountDisplay } from '../_auth/account-display';

/* Instructor shell. Same rail and content column as the student side; what
   changes is who is signed in and what is in the rail.

   The library is the persisted learning loop: courses, sources and rubrics.
   A course gets its tools only after it has been resolved from either the
   learning service or the explicitly labelled sample area below. Legacy
   manual records remain available to instructors for roster management only. */

const INSTRUCTOR = { name: 'SSgt Okafor', initials: 'SO', role: 'Instructor' };

const LIBRARY = [
  { id: 'courses', label: 'Courses', icon: I.courses },
  { id: 'sources', label: 'Sources', icon: I.dashboard },
  { id: 'rubrics', label: 'Rubrics', icon: I.dashboard },
  { id: 'settings', label: 'Settings', icon: I.dashboard },
];

const REAL_VIEWS = [
  { id: 'builder', label: 'Course draft' },
  { id: 'fidelity', label: 'Doctrinal fidelity' },
  { id: 'roster', label: 'Roster' },
  { id: 'mastery', label: 'Class Mastery' },
  { id: 'aar', label: 'Course AAR' },
  { id: 'settings', label: 'Course settings' },
];

const LEGACY_MANUAL_VIEWS = [
  { id: 'roster', label: 'Roster' },
];

const SCREENS = {
  roster: Roster,
  control: LiveControl,
  mastery: Mastery,
  aar: AAR,
  settings: InstructorSettings,
};

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
  const learning = useLearningCourses({ includeManual: true });

  const inLibrary = nav.area === 'library';
  const inCourse = nav.area === 'course';
  const libraryEntry = inLibrary ? LIBRARY.find((l) => l.id === nav.view) : null;
  const libraryView = libraryEntry?.id || null;
  const invalidArea = !inLibrary && !inCourse;

  // null; while the list is loading we hold rather than bounce to a sample
  // course. An unresolved id is an explicit service/not-found state below.
  // Instructors see only real courses. A sample id is not resolved here at
  // all, so an old sample deep link is an explicit not-found rather than a
  // read-only placeholder sitting where a real course should be.
  const course = inCourse
    ? (learning.courses.find((c) => c.id === nav.courseId) || null)
    : null;
  const isReal = Boolean(course?.record);
  const isManual = Boolean(course?.manual);
  // main removed sample/mock courses for instructors, so there is no mock view
  // set to fall back to; `course` is only ever a real course or null here and the
  // `course ?` guard below covers the null case.
  const VIEWS = isManual ? LEGACY_MANUAL_VIEWS : REAL_VIEWS;
  const current = course
    ? VIEWS.find((v) => v.id === nav.view) || (nav.view ? null : VIEWS[0])
    : null;
  const view = current?.id || null;

  const go = (patch) => {
    const requested = patch.view || view || (isManual ? 'roster' : 'builder');
    const nextView = isManual && requested !== 'roster' ? 'roster' : requested;
    nav.go({
      role: 'instructor',
      area: 'course',
      courseId: course?.id || nav.courseId,
      view: nextView,
      ...patch,
      ...(isManual && nextView !== patch.view ? { view: nextView } : {}),
    });
  };
  const goLibrary = (v) => nav.go({ role: 'instructor', area: 'library', courseId: null, view: v });
  const openCourse = (id) => {
    const target = learning.courses.find((candidate) => candidate.id === id);
    nav.go({ role: 'instructor', area: 'course', courseId: id, view: target?.manual ? 'roster' : 'builder' });
  };
  const handleSignOut = async () => {
    try {
      await signOut();
      window.location.href = '/';
    } catch {
      // AuthProvider exposes the explicit error in the shell.
    }
  };

  const courseLookupLoading = inCourse && !course && Boolean(nav.courseId) && (
    !authReady || (learning.enabled && (learning.loading || learning.manualLoading))
  );
  const courseServiceError = inCourse && !course && !courseLookupLoading && Boolean(learning.error || learning.manualError);
  const courseUnavailable = inCourse && !course && !courseLookupLoading && !courseServiceError && !learning.enabled;
  const courseNotFound = inCourse && !course && !courseLookupLoading && !courseServiceError && !courseUnavailable;
  const unsupportedRealView = Boolean(course?.record && nav.view && !current);
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
        Sign in with an instructor account to load this course.
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
        course={null}
        account={profile}
        authenticated={authenticated}
        tab={nav.tab}
        onTab={(t) => nav.go({
          role: 'instructor', area: 'library', courseId: null, view: 'settings', tab: t,
        })}
      />
    );
  } else if (inLibrary && !learning.enabled) {
    body = (
      <>
        <h2 className="p-h">Sign in required</h2>
        <p className="p-sub">
          Sign in to use Sources, Courses and Rubrics.
        </p>
      </>
    );
  } else if (inLibrary) {
    if (libraryView === 'sources') body = <SourcesView />;
    else if (libraryView === 'rubrics') body = <RubricsView />;
    else {
      body = (
        <CoursesLibrary
          courses={learning.courses.filter((candidate) => !candidate.manual)}
          loading={learning.loading}
          error={learning.error}
          onOpen={openCourse}
          onDrafted={learning.refetch}
        />
      );
    }
  } else if (inCourse && unsupportedRealView) {
    body = (
      <CourseUnavailable courseId={course.id} title={isManual ? 'Legacy course tool unavailable' : 'Course tool unavailable'}>
        {isManual
          ? 'Legacy manual courses are available here for roster management only. Choose Roster under the selected course.'
          : 'This tool is not available for this service-backed course. Choose one of the tools listed under the selected course.'}
      </CourseUnavailable>
    );
  } else if (isReal) {
    if (isManual) {
      const Screen = SCREENS[view];
      body = Screen ? (
        <Screen key={course.id} course={course} account={profile} authenticated={authenticated} instructorName={displayName} />
      ) : (
        <CourseUnavailable courseId={course.id} title="Legacy course tool unavailable">
          Legacy manual courses are available here for roster management only. Choose Roster under the selected course.
        </CourseUnavailable>
      );
    } else if (view === 'builder') body = <CourseDraft key={course.id} course={course} onChanged={learning.refetch} />;
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
      body = <Screen key={course.id} course={course} account={profile} authenticated={authenticated} instructorName={displayName} courseScoped={view === 'settings'} />;
    }
  } else {
    body = <CourseUnavailable courseId={nav.courseId} title="Course not found" />;
  }

  const crumbTail = inLibrary
    ? (libraryEntry?.label || 'Not found')
    : (current?.label || (inCourse ? 'Course' : 'Not found'));

  return (
    <div className="s-root">
      <nav className="s-rail s-rail-instructor" aria-label="Instructor navigation">
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

        <div className="s-rail-scroll" tabIndex={0} role="region" aria-label="Library and course navigation">
        <div className="s-rail-sec" style={{ paddingTop: '0.2rem' }}>Library</div>
        {LIBRARY.map((l) => (
          <RailButton key={l.id} icon={l.icon} label={l.label} on={inLibrary && libraryView === l.id} onClick={() => goLibrary(l.id)} />
        ))}

        {learning.courses.length > 0 && (
          <>
            <div className="s-rail-sec">Teaching</div>
            {learning.courses.map((c) => (
              <RailButton
                key={c.id}
                sub
                on={inCourse && c.id === course?.id}
                icon={<span className="s-rail-dot" style={{ background: c.manual ? 'var(--p-dim)' : c.status === 'APPROVED' ? 'var(--p-good)' : 'var(--p-warning)' }} />}
                label={c.manual ? `Legacy · ${c.name}` : c.name}
                onClick={() => openCourse(c.id)}
              />
            ))}
          </>
        )}
        {/* main removed the instructor-side sample-course rail along with the
            COURSES fixture import; instructors see only real courses. */}

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

        </div>
        <div className="s-rail-footer">
        {onSwitchRole && (
          <RailButton icon={I.swap} label="View as student" onClick={onSwitchRole} />
        )}
        <RailButton icon={I.back} label="Planning board" onClick={() => { window.location.href = '/plan'; }} />
        </div>
      </nav>

      <div className="s-content">
        <div className="s-crumbs">
          <span className="s-crumb-cur">Instructor</span>
          <span className="s-crumb-sep">/</span>
          {inLibrary ? (
            <span className="s-crumb-cur">Library</span>
          ) : inCourse && course ? (
            <button onClick={() => go({ view: isManual ? 'roster' : 'builder' })}>{course.name}</button>
          ) : (
            <span className="s-crumb-cur">Not found</span>
          )}
          <span className="s-crumb-sep">/</span>
          <span className="s-crumb-cur">{crumbTail}</span>
          <span className="s-crumb-spacer" />
          {inCourse && course && !isReal && view !== 'roster' && (
            <span className="s-lastlogin">{course.students} students · Week {course.week} of {course.weeks}</span>
          )}
          {inCourse && course && isReal && !isManual && (
            <span className="s-lastlogin">
              {course.sections} sections · {course.hasPendingRevision ? 'Pending review · revised course' : course.status === 'APPROVED' ? 'Approved' : 'Draft'}
            </span>
          )}
          {inCourse && course && isManual && (
            <span className="s-lastlogin">{course.school}</span>
          )}
        </div>
        <main className="s-main">
          <div className="s-container">
            {signOutError && (
              <div className="s-shell-error" role="alert">
                {signOutError.error || signOutError.message || 'Unable to sign out. Please try again.'}
              </div>
            )}
            {learning.manualError && (
              <div className="s-shell-error" role="alert">
                {learning.manualError.error || learning.manualError.message || 'Unable to load manual courses.'}
              </div>
            )}
            {body}
          </div>
        </main>
      </div>
    </div>
  );
}
