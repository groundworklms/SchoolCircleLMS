'use client';

import { useEffect, useState } from 'react';
import './student.css';

import { I, RailButton, UserMenu } from './shell';
import { InstructorSettings } from './Settings';
import LiveControl from './LiveControl';
import Mastery from './Mastery';
import AAR from './AAR';
import Roster from './Roster';
import { SourcesView, CoursesLibrary, CourseDraft } from './Library';
import { InstructorFidelity, RubricsView } from './InstructorFeatures';
import { courseFromRecord, useLearningCourses } from './learning';
import { useAuth } from '../_auth/AuthProvider';
import { accountDisplay } from '../_auth/account-display';

/* Instructor shell. Same rail and content column as the student side; what
   changes is who is signed in and what is in the rail.

   The library is the persisted learning loop, grouped by how often each part
   is used: Courses is the authoring path (source selection → generation →
   review → approval/publish), Sources is reusable supporting material, and
   Rubrics is an optional advanced tool.

   A course gets its tools only after the learning service has resolved it.
   There are no sample courses here: an instructor's rail shows the real ones
   they own, and an unresolved id is an explicit not-found rather than a
   placeholder standing in for a course. The student shell still carries demo
   content, which is why the shared resolveCourse is left alone.

   Courses published through the retired manual workflow appear as "Legacy"
   and expose a roster view only. Authoring them is gone (those endpoints
   answer 410), but their enrolled learners and results were deliberately
   preserved, so the roster has to remain reachable. */

const INSTRUCTOR = { name: 'SSgt Okafor', initials: 'SO', role: 'Instructor' };

const LIBRARY_PRIMARY = [
  { id: 'courses', label: 'Courses', icon: I.courses },
];

const LIBRARY_SECONDARY = [
  { id: 'sources', label: 'Sources', icon: I.dashboard },
];

const LIBRARY_ADVANCED = [
  { id: 'rubrics', label: 'Rubrics', icon: I.dashboard },
];

const LIBRARY_ACCOUNT = [
  { id: 'settings', label: 'Settings', icon: I.dashboard },
];

const LIBRARY = [
  ...LIBRARY_PRIMARY,
  ...LIBRARY_SECONDARY,
  ...LIBRARY_ADVANCED,
  ...LIBRARY_ACCOUNT,
];

const REAL_VIEWS = [
  { id: 'builder', label: 'Review & publish' },
  { id: 'roster', label: 'Roster', secondary: true },
  { id: 'fidelity', label: 'Fidelity check', advanced: true },
  { id: 'mastery', label: 'Class Mastery', advanced: true },
  { id: 'aar', label: 'Course AAR', advanced: true },
  { id: 'settings', label: 'Course settings' },
];

export function courseListWithSelectedFallback(courses, selectedCourse) {
  const list = Array.isArray(courses) ? courses : [];
  if (!selectedCourse?.id || list.some((item) => item.id === selectedCourse.id)) return list;
  return [...list, courseFromRecord(selectedCourse)];
}

export function courseHeaderStatus(course) {
  const hasPendingRevision = Boolean(course?.hasPendingRevision || course?.record?.hasPendingRevision);
  if (course?.status === 'APPROVED') {
    return hasPendingRevision ? 'Published · revision needs review' : 'Published';
  }
  // Anything not approved still needs review, whether or not a revision is
  // already pending against it.
  return 'Needs review';
}

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
  const [selectedCourse, setSelectedCourse] = useState(null);

  const inLibrary = nav.area === 'library';
  const inCourse = nav.area === 'course';
  const libraryEntry = inLibrary ? LIBRARY.find((l) => l.id === nav.view) : null;
  const libraryView = libraryEntry?.id || null;
  const invalidArea = !inLibrary && !inCourse;

  // Which course is on screen. Instructors see only real courses: while the
  // list is loading we hold rather than substitute anything, and an id that
  // resolves to nothing is an explicit service/not-found state below. An old
  // sample deep link therefore reads as not-found rather than as a read-only
  // placeholder sitting where a real course should be.
  //
  // Immediately after creating a course the POST has returned its id, but the
  // list query may not have committed the new row yet. Keep that creation
  // response as a short-lived shell fallback so the instructor lands in
  // review instead of seeing a false not-found state.
  const selectedCourseId = selectedCourse?.id || null;
  const hasAuthoritativeSelectedCourse = Boolean(
    selectedCourseId && learning.courses.some((item) => item.id === selectedCourseId),
  );
  useEffect(() => {
    if (hasAuthoritativeSelectedCourse) setSelectedCourse(null);
  }, [hasAuthoritativeSelectedCourse]);
  const courses = courseListWithSelectedFallback(learning.courses, selectedCourse);
  const course = inCourse
    ? (courses.find((candidate) => candidate.id === nav.courseId) || null)
    : null;
  const isReal = Boolean(course?.record);
  const isManual = Boolean(course?.manual);
  // There is no mock view set to fall back to: `course` is only ever a
  // service-backed course, a legacy manual course, or null, and the
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
  const handleDrafted = async (created) => {
    const record = created?.record || created?.course || created;
    const id = created?.id || record?.id || null;
    if (id) {
      setSelectedCourse({
        ...record,
        id,
        title: created?.title || record?.title || record?.name,
        status: created?.status || record?.status || 'PENDING',
        sections: created?.sections ?? record?.sections,
        sourceIds: created?.sourceIds || record?.sourceIds || [],
      });
      openCourse(id);
    }
    await learning.refetch();
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
        This instructor page does not exist. Choose Courses, Sources, Rubrics or Settings from the instructor workspace.
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
          The library — Courses, Sources and Rubrics — is the persisted learning loop, and it needs a
          verified identity. Sign in to use Sources, Courses and Rubrics.
        </p>
      </>
    );
  } else if (inLibrary) {
    if (libraryView === 'sources') body = <SourcesView />;
    else if (libraryView === 'rubrics') body = <RubricsView />;
    else {
      body = (
        <CoursesLibrary
          // Legacy manual courses are included so they can be cleared: they
          // were filtered out here, which left them visible only in the rail
          // with no way to manage or remove them.
          courses={learning.courses}
          loading={learning.loading}
          error={learning.error}
          onOpen={openCourse}
          onDrafted={handleDrafted}
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
          <h2 className="p-h">Fidelity check</h2>
          <p className="p-sub">
            Optional advanced check. Understudy asks the tutor what a learner would ask and grades
            every answer against the approved sources. It does not block course review or publish.
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
        {LIBRARY_PRIMARY.map((l) => (
          <RailButton key={l.id} icon={l.icon} label={l.label} on={inLibrary && libraryView === l.id} onClick={() => goLibrary(l.id)} />
        ))}

        <div className="s-rail-sec">Secondary tools</div>
        {LIBRARY_SECONDARY.map((l) => (
          <RailButton key={l.id} icon={l.icon} label={l.label} on={inLibrary && libraryView === l.id} onClick={() => goLibrary(l.id)} />
        ))}

        <div className="s-rail-sec">Advanced tools</div>
        {LIBRARY_ADVANCED.map((l) => (
          <RailButton key={l.id} icon={l.icon} label={l.label} on={inLibrary && libraryView === l.id} onClick={() => goLibrary(l.id)} />
        ))}

        <div className="s-rail-sec">Account</div>
        {LIBRARY_ACCOUNT.map((l) => (
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
        {/* No instructor-side sample-course rail, and no COURSES fixture import:
            instructors see only the real courses they own. The student shell
            still carries demo content. */}

        {inCourse && course && (
          <>
            <div className="s-rail-sec">
              <span className="s-rail-sec-name">{course.name}</span>
              {!isReal && <code>{course.id}</code>}
            </div>
            {VIEWS.filter((v) => !v.advanced && !v.secondary).map((v) => (
              <RailButton key={v.id} sub on={view === v.id} label={v.label} onClick={() => go({ view: v.id })} />
            ))}
            {VIEWS.some((v) => v.secondary) && (
              <>
                <div className="s-rail-sec">Course tools</div>
                {VIEWS.filter((v) => v.secondary).map((v) => (
                  <RailButton key={v.id} sub on={view === v.id} label={v.label} onClick={() => go({ view: v.id })} />
                ))}
              </>
            )}
            {VIEWS.some((v) => v.advanced) && (
              <>
                <div className="s-rail-sec">Advanced tools</div>
                {VIEWS.filter((v) => v.advanced).map((v) => (
                  <RailButton key={v.id} sub on={view === v.id} label={v.label} onClick={() => go({ view: v.id })} />
                ))}
              </>
            )}
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
            <span className="s-lastlogin">{course.sections} sections · {courseHeaderStatus(course)}</span>
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
