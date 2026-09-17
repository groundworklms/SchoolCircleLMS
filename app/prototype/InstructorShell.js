'use client';

import { Fragment, useEffect, useRef, useState } from 'react';
import './student.css';

import { I, RailButton, UserMenu } from './shell';
import InstructorCoursesMenu from './InstructorCoursesMenu';
import { expandCourse, expandOnCourseSelection, initialExpandedCourseIds, toggleExpandedCourse } from './instructorCourseTreeState.mjs';
import { COURSES } from './data';
import { InstructorSettings } from './Settings';
import LiveControl from './LiveControl';
import Mastery from './Mastery';
import AAR from './AAR';
import Roster from './Roster';
import { SourcesView, CoursesLibrary, CourseDraft } from './Library';
import { CourseRubrics, InstructorFidelity, RubricsView } from './InstructorFeatures';
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
   The nested sample-course tree is a read-only orientation surface. It never
   substitutes for a service-backed authoring record: real courses remain in
   the Teaching section and the Course library child remains the authoring
   route. The student shell still carries its own demo content.

   Courses published through the retired manual workflow appear as "Legacy"
   and expose a roster view only. Authoring them is gone (those endpoints
   answer 410), but their enrolled learners and results were deliberately
   preserved, so the roster has to remain reachable. */

const INSTRUCTOR = { name: 'SSgt Okafor', initials: 'SO', role: 'Instructor' };
const SAMPLE_COURSES = Object.values(COURSES);

// Ordered by how often an instructor needs them -- the course list first, the
// account last. They were briefly four one-item groups under four headings,
// which cost four lines of chrome to say nothing: a heading earns its place by
// telling you what several items have in common, and one item has nothing to
// have in common with.
const LIBRARY = [
  { id: 'courses', label: 'Courses', icon: I.courses },
  { id: 'sources', label: 'Sources', icon: I.sources },
  { id: 'rubrics', label: 'Rubrics', icon: I.rubrics },
  // Three of these four carried the same generic icon, which is the same as
  // carrying none: an icon that does not distinguish its item is decoration
  // with a click target under it.
  { id: 'settings', label: 'Settings', icon: I.settings },
];

/* The course sub-rail, grouped the way the work actually splits.
 *
 * These four were one bucket called "Advanced tools", which is not a category:
 * it says how hard they are rather than what they are for, and a heading that
 * describes nothing is a heading nobody opens. It also put a pre-publish check
 * and an after-action review side by side as though they belonged to the same
 * moment. They do not -- two of them help decide whether to publish, and two
 * only have anything to say once a class has been through the course.
 *
 * Ungrouped items are the spine of the job and stay at the top, in the order
 * they are reached: review the draft, then the class on it, then its settings. */
const COURSE_GROUPS = [
  { id: null, label: null },
  { id: 'quality', label: 'Quality checks' },
  { id: 'results', label: 'How the class did' },
];

const REAL_VIEWS = [
  { id: 'builder', label: 'Review & publish' },
  { id: 'roster', label: 'Roster' },
  { id: 'settings', label: 'Course settings' },
  { id: 'fidelity', label: 'Fidelity check', group: 'quality' },
  // How each objective of THIS course is judged. The library's Rubrics screen
  // is still the whole collection; this is one course's own coverage.
  { id: 'rubrics', label: 'Objective rubrics', group: 'quality' },
  { id: 'mastery', label: 'Class mastery', group: 'results' },
  { id: 'aar', label: 'Course AAR', group: 'results' },
];

// Fixture courses must never reach service-backed tools. These are the
// approved local destinations: the live-session simulator, hand-authored AAR,
// and preference-only course settings are safe; Class Mastery is shown as
// unavailable below because its existing screen queries cohort analytics.
const SAMPLE_VIEWS = [
  { id: 'builder', label: 'Sample overview' },
  { id: 'control', label: 'Run Live Session' },
  { id: 'mastery', label: 'Class Mastery' },
  { id: 'aar', label: 'Course AAR' },
  { id: 'settings', label: 'Course settings' },
];

export function courseListWithSelectedFallback(
  courses,
  selectedCourse,
  { pendingRefresh = false, authoritativeCourse = null } = {},
) {
  const list = Array.isArray(courses) ? courses : [];
  if (!selectedCourse?.id || list.some((item) => item.id === selectedCourse.id)) return list;
  if (authoritativeCourse?.id === selectedCourse.id) return [...list, authoritativeCourse];
  // A POST response is only a temporary shell row until the list refetch
  // settles. Never keep an optimistic course visible after a successful
  // refresh says it does not exist.
  if (!pendingRefresh) return list;
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

const SAMPLE_SCREENS = {
  control: LiveControl,
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

function SampleCourse({ course }) {
  return (
    <>
      <h2 className="p-h">{course.name}</h2>
      <p className="p-sub">
        This sample course is view-only. Course drafts are created and reviewed from the signed-in Course library;
        sample data never creates or edits an authoring record.
      </p>
    </>
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
  const [selectedCourseRefresh, setSelectedCourseRefresh] = useState({
    course: null,
    pending: false,
    authoritative: null,
  });

  const inLibrary = nav.area === 'library';
  const inCourse = nav.area === 'course';
  const libraryEntry = inLibrary ? LIBRARY.find((l) => l.id === nav.view) : null;
  const libraryView = libraryEntry?.id || null;
  const invalidArea = !inLibrary && !inCourse;

  // Which course is on screen. Real courses are service-backed; sample
  // courses are explicitly marked in the rail as view-only. While the real
  // list is loading we hold rather than substitute anything, and an id that
  // resolves to nothing is an explicit service/not-found state below.
  //
  // Immediately after creating a course the POST has returned its id, but the
  // list query may not have committed the new row yet. Keep that creation
  // response as a short-lived shell fallback so the instructor lands in
  // review instead of seeing a false not-found state.
  const selectedCourse = selectedCourseRefresh.course;
  const selectedCreatedCourseId = selectedCourse?.id || null;
  const hasAuthoritativeSelectedCourse = Boolean(
    selectedCreatedCourseId && learning.courses.some((item) => item.id === selectedCreatedCourseId),
  );
  useEffect(() => {
    if (hasAuthoritativeSelectedCourse) {
      setSelectedCourseRefresh({ course: null, pending: false, authoritative: null });
    }
  }, [hasAuthoritativeSelectedCourse]);
  const courses = courseListWithSelectedFallback(learning.courses, selectedCourse, {
    pendingRefresh: selectedCourseRefresh.pending,
    authoritativeCourse: selectedCourseRefresh.authoritative,
  });
  const sampleCourse = inCourse ? SAMPLE_COURSES.find((candidate) => candidate.id === nav.courseId) || null : null;
  const course = inCourse
    ? (courses.find((candidate) => candidate.id === nav.courseId) || sampleCourse)
    : null;
  const isReal = Boolean(course?.record);
  const isManual = Boolean(course?.manual);
  const isSample = Boolean(course && !isReal && !isManual);
  const VIEWS = isSample ? SAMPLE_VIEWS : isManual ? LEGACY_MANUAL_VIEWS : REAL_VIEWS;
  const current = course
    ? VIEWS.find((v) => v.id === nav.view) || (nav.view ? null : VIEWS[0])
    : null;
  const view = current?.id || null;
  const activeCourseId = course?.id || null;
  const menuView = inCourse ? view : libraryView;
  const [coursesExpanded, setCoursesExpanded] = useState(() => Boolean(activeCourseId));
  const [expandedCourseIds, setExpandedCourseIds] = useState(() => initialExpandedCourseIds(activeCourseId));
  const previousCourseId = useRef(activeCourseId);

  useEffect(() => {
    setExpandedCourseIds((expanded) => expandOnCourseSelection(expanded, previousCourseId.current, activeCourseId));
    if (activeCourseId && activeCourseId !== previousCourseId.current) setCoursesExpanded(true);
    previousCourseId.current = activeCourseId;
  }, [activeCourseId]);

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
  const openCourse = (id, courseView = null) => {
    const target = learning.courses.find((candidate) => candidate.id === id);
    nav.go({
      role: 'instructor',
      area: 'course',
      courseId: id,
      view: courseView || (target?.manual ? 'roster' : 'builder'),
    });
  };
  const handleDrafted = async (created) => {
    const record = created?.record || created?.course || created;
    const id = created?.id || record?.id || null;
    if (id) {
      const optimisticCourse = {
        ...record,
        id,
        title: created?.title || record?.title || record?.name,
        status: created?.status || record?.status || 'PENDING',
        sections: created?.sections ?? record?.sections,
        sourceIds: created?.sourceIds || record?.sourceIds || [],
      };
      setSelectedCourseRefresh({
        course: optimisticCourse,
        pending: true,
        authoritative: null,
      });
      openCourse(id);
      try {
        const refreshed = await learning.refetch();
        const persisted = Array.isArray(refreshed)
          ? refreshed.find((entry) => entry?.id === id)
          : null;
        setSelectedCourseRefresh({
          course: persisted ? optimisticCourse : null,
          pending: false,
          authoritative: persisted ? courseFromRecord(persisted) : null,
        });
      } catch {
        // The learning hook exposes the request error in the shell. Drop the
        // optimistic row now so an error or missing record cannot look real.
        setSelectedCourseRefresh({ course: null, pending: false, authoritative: null });
      }
      return;
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
        // Legacy manual courses are left out: they expose a roster and nothing
        // else, so there are no course settings to send anyone to.
        courses={learning.courses.filter((entry) => !entry.manual)}
        onOpenCourseSettings={(id) => nav.go({
          role: 'instructor', area: 'course', courseId: id, view: 'settings',
        })}
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
  } else if (inCourse && isSample) {
    if (view === 'builder') body = <SampleCourse key={course.id} course={course} />;
    else if (view === 'control' || view === 'aar' || view === 'settings') {
      const Screen = SAMPLE_SCREENS[view];
      body = Screen
        ? <Screen key={course.id} course={course} account={profile} authenticated={authenticated} instructorName={displayName} courseScoped={view === 'settings'} />
        : <CourseUnavailable courseId={course.id} title="Sample course tool unavailable" />;
    } else {
      body = (
        <CourseUnavailable courseId={course.id} title="Sample course tool unavailable">
          This local sample does not connect to live analytics or authoring services. Choose another sample tool.
        </CourseUnavailable>
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
    } else if (view === 'rubrics') {
      body = (
        <>
          <h2 className="p-h">Objective rubrics</h2>
          <p className="p-sub">
            A course teaches objectives; a rubric says how performance against one of them is
            judged. Rubricon writes each one from this course&rsquo;s own approved sources, refuses
            any standard too vague to anchor, and nothing counts as assessable until you approve
            it. It does not block course review or publish.
          </p>
          <CourseRubrics key={course.id} courseId={course.id} />
        </>
      );
    } else {
      const Screen = SCREENS[view];
      body = <Screen key={course.id} course={course} account={profile} authenticated={authenticated} instructorName={displayName} courseScoped={view === 'settings'} />;
    }
  } else {
    body = <CourseUnavailable courseId={nav.courseId} title="Course not found" />;
  }

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
        <InstructorCoursesMenu
          expanded={coursesExpanded}
          onToggle={() => setCoursesExpanded((expanded) => !expanded)}
          selectedCourseId={activeCourseId}
          selectedView={menuView}
          expandedCourseIds={expandedCourseIds}
          onToggleCourse={(id) => setExpandedCourseIds((expanded) => toggleExpandedCourse(expanded, id))}
          onExpandCourse={(id) => setExpandedCourseIds((expanded) => expandCourse(expanded, id))}
          onOpenCourse={openCourse}
          onOpenLibrary={() => goLibrary('courses')}
          courses={SAMPLE_COURSES}
          items={SAMPLE_VIEWS}
          homeView="builder"
        />
        {LIBRARY.filter((item) => item.id !== 'courses').map((l) => (
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
        {inCourse && course && !isSample && (
          <>
            <div className="s-rail-sec">
              <span className="s-rail-sec-name">{course.name}</span>
              {!isReal && <code>{course.id}</code>}
            </div>
            {/* Everything an instructor reaches for while teaching the course,
                under a heading that says what the group is for. A group with
                nothing in it -- a legacy manual course has only Roster --
                prints no heading. */}
            {COURSE_GROUPS.map(({ id, label }) => {
              const group = VIEWS.filter((v) => (v.group || null) === id);
              if (group.length === 0) return null;
              return (
                <Fragment key={id || 'course'}>
                  {label && <div className="s-rail-sec">{label}</div>}
                  {group.map((v) => (
                    <RailButton key={v.id} sub on={view === v.id} label={v.label} onClick={() => go({ view: v.id })} />
                  ))}
                </Fragment>
              );
            })}
          </>
        )}

        </div>
        <div className="s-rail-footer">
        {/* Role switching is the only escape hatch the rail offers. /plan is the
            team's own hackathon board -- it stays reachable by URL for us, but it
            is not product, so it is not on an instructor's or a student's rail. */}
        {onSwitchRole && (
          <RailButton icon={I.swap} label="View as student" onClick={onSwitchRole} />
        )}
        </div>
      </nav>

      <div className="s-content">
        <main className="s-main">
          <div className="s-container">
            {/* The breadcrumb row is gone; the course status it carried is not.
                courseHeaderStatus is used rather than a raw status string so a
                pending revision still reads as needing review, and a legacy
                manual course keeps the school label it used to show. */}
            {inCourse && course && isReal && !isManual && (
              <p className="p-src" style={{ margin: '0 0 0.75rem' }}>
                {course.sections} sections · {courseHeaderStatus(course)}
              </p>
            )}
            {inCourse && course && isManual && course.school && (
              <p className="p-src" style={{ margin: '0 0 0.75rem' }}>{course.school}</p>
            )}
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
