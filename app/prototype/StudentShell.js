'use client';

import { useEffect, useRef, useState } from 'react';
import './student.css';

import FocusedDashboard from './FocusedDashboard';
import StudentCalendar from './StudentCalendar';
import StudentInbox, { useRosterInbox } from './StudentInbox';
import CourseChat from './CourseChat';
import { I, RailButton, UserMenu } from './shell';
import { StudentSettings } from './Settings';
import { usePrefs } from './prefs';
import { useLearningCourses, resolveCourse } from './learning';
import {
  RealCourseHome,
  CourseReader,
  MasterySession,
  StudyPlan,
  LearnerProgress,
} from './LearnerFeatures';
import { useAuth } from '../_auth/AuthProvider';
import { accountDisplay } from '../_auth/account-display';
import CoursesMenu from './CoursesMenu';
import {
  expandCourse,
  expandOnCourseSelection,
  initialExpandedCourseIds,
  pruneExpandedCourseIds,
  toggleExpandedCourse,
} from './courseTreeState.mjs';

/* The learner shell is a thin presentation layer over generated courses.
   Course records are the only source of course cards, navigation, and course
   content; there is no local course, agenda, or persona fixture to fall back
   to. The dashboard and disclosure tree are the focused learner layout. */

const STUDENT = { name: 'Student', initials: 'ST' };

const COURSE_NAV = [
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

function errorText(error, fallback = 'the learning service is unavailable.') {
  return error?.error || error?.message || fallback;
}

function Courses({
  onOpen,
  courses = [],
  learningLoading = false,
  learningError = null,
}) {
  return (
    <div>
      <div className="s-pagehead"><h1>Courses</h1></div>
      <h4 className="s-label">Available courses</h4>
      {learningLoading && <p role="status">Loading courses…</p>}
      {learningError && (
        <div className="s-shell-error" role="alert">
          Unable to load courses: {errorText(learningError)}
        </div>
      )}
      <div className="s-courselist">
        {courses.map((course) => (
          <button className="s-courserow" key={course.id} onClick={() => onOpen(course.id, 'home')}>
            <div className="s-courserow-main">
              <div className="s-card-title">{course.name}</div>
              <div className="s-card-school">{course.school}</div>
              <div className="s-prog"><span>{course.sections} sections</span></div>
            </div>
            <div className="s-card-avg">
              <span style={{ color: 'var(--p-good)' }}>✓</span><small>cited</small>
            </div>
            <span className="s-quick-arrow">→</span>
          </button>
        ))}
        {!courses.length && !learningLoading && !learningError && (
          <p className="s-cal-empty">
            Nothing published to you yet. A course appears here once an instructor approves it for
            your account.
          </p>
        )}
      </div>
    </div>
  );
}

function CourseUnavailable({ courseId, error }) {
  return (
    <div className="s-shell-error" role="alert">
      <h2>Course unavailable</h2>
      <p>{courseId ? `No accessible course matches “${courseId}”.` : 'A course ID is required to open this course.'}</p>
      {error ? <p>{errorText(error, 'The course service did not return this record.')}</p> : null}
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

export default function StudentShell({ nav, onSwitchRole, role: profileRole }) {
  const auth = useAuth();
  const { ready: authReady, user, profile, signOut, signOutError } = auth;
  const { authenticated, name: displayName, rank: displayRank, initials } =
    accountDisplay({ ready: authReady, profile, demo: STUDENT });
  const handleSignOut = async () => {
    try {
      await signOut();
      window.location.href = '/';
    } catch {
      // AuthProvider exposes the explicit error in the shell.
    }
  };

  const { area, courseId, view, lessonId, page, threadId } = nav;
  const prefs = usePrefs();
  const learning = useLearningCourses();
  const course = resolveCourse(courseId, learning.error ? [] : learning.courses);
  const pendingCourse = area === 'course' && Boolean(courseId) && !course && learning.loading;
  const inbox = useRosterInbox({ ready: authReady, user });
  const inboxUnread = inbox.messages.filter((message) => message.unread).length;
  const [expandedCourseIds, setExpandedCourseIds] = useState(() => initialExpandedCourseIds(courseId));
  const [coursesExpanded, setCoursesExpanded] = useState(() => Boolean(courseId));
  const previousCourseId = useRef(courseId);
  const previousLearningCourseIds = useRef(null);

  useEffect(() => {
    setExpandedCourseIds((expanded) => expandOnCourseSelection(expanded, previousCourseId.current, courseId));
    if (courseId) setCoursesExpanded(true);
    previousCourseId.current = courseId;
  }, [courseId]);

  const learningCourseIds = learning.courses
    .map((entry) => entry?.id)
    .filter((id) => id !== null && id !== undefined && String(id));
  const learningCourseSignature = JSON.stringify(learningCourseIds.map((id) => String(id)));
  useEffect(() => {
    if (!learning.enabled || learning.loading || learning.error) return;
    const previousIds = previousLearningCourseIds.current;
    const selectedWasReadded = courseId
      && learningCourseSignature.includes(`"${String(courseId)}"`)
      && previousIds
      && !previousIds.includes(String(courseId));
    setExpandedCourseIds((expanded) => {
      const pruned = pruneExpandedCourseIds(expanded, learningCourseIds);
      return selectedWasReadded ? expandCourse(pruned, courseId) : pruned;
    });
    previousLearningCourseIds.current = learningCourseIds.map((id) => String(id));
  }, [courseId, learning.enabled, learning.loading, learning.error, learningCourseSignature]);

  const lessonMemory = useRef({});
  useEffect(() => {
    if (area === 'course' && view === 'lessons' && lessonId) {
      lessonMemory.current[courseId] = { lessonId, page };
    }
  }, [area, view, courseId, lessonId, page]);

  const setArea = (nextArea) => nav.go({
    area: nextArea, courseId: null, view: null, lessonId: null, page: null,
  });
  const setView = (nextView) => {
    const remembered = nextView === 'lessons' ? lessonMemory.current[courseId] : null;
    nav.go({
      area: 'course', courseId, view: nextView,
      lessonId: remembered?.lessonId ?? null, page: remembered?.page ?? null, threadId: null,
    });
  };
  const open = (id, nextView = 'home') => nav.go({
    area: 'course', courseId: id, view: nextView || 'home', lessonId: null, page: null,
  });
  const openLesson = (id, nextPage = null) => nav.go({
    area: 'course', courseId, view: 'lessons', lessonId: id, page: nextPage, threadId: null,
  });
  const openThread = (id, forLesson = null) => nav.go({
    area: 'course', courseId, view: 'discussions', threadId: id, lessonId: forLesson, page: null,
  });
  const toggleCourse = (id) => setExpandedCourseIds((expanded) => toggleExpandedCourse(expanded, id));
  const expandSelectedCourse = (id) => setExpandedCourseIds((expanded) => expandCourse(expanded, id));

  const railContext = area === 'course' && course
    ? {
        section: view !== 'home' ? (COURSE_NAV.find((item) => item.id === view) || COURSE_NAV[0]).label : null,
        onUp: () => (view === 'home' ? setArea('dashboard') : setView('home')),
        up: view === 'home' ? 'Dashboard' : course.name,
      }
    : null;

  let body;
  if (pendingCourse) body = <p role="status">Loading course…</p>;
  else if (area === 'course' && !course) body = <CourseUnavailable courseId={courseId} error={learning.error} />;
  else if (area === 'dashboard') {
    body = (
      <FocusedDashboard
        onOpen={open}
        onCalendar={() => setArea('calendar')}
        courses={learning.courses}
        loading={learning.loading}
        error={learning.error}
      />
    );
  } else if (area === 'courses') {
    body = (
      <Courses
        onOpen={open}
        courses={learning.courses}
        learningLoading={learning.loading}
        learningError={learning.error}
      />
    );
  } else if (area === 'calendar') body = <StudentCalendar onOpen={open} />;
  else if (area === 'inbox') body = <StudentInbox inbox={inbox} onOpen={open} onArea={setArea} />;
  else if (area === 'settings') {
    body = (
      <StudentSettings
        onSignOut={handleSignOut}
        account={profile}
        authenticated={authenticated}
        tab={nav.tab}
        onTab={(tab) => nav.go({ area: 'settings', courseId: null, view: null, tab })}
      />
    );
  } else if (view === 'home') {
    body = <RealCourseHome key={course.id} course={course} go={setView} />;
  } else {
    const Screen = REAL_SCREENS[view];
    body = Screen
      ? <Screen key={`${course.id}:${view}`} course={course} />
      : <UnsupportedCourseTool course={course} view={view} />;
  }

  const menuItems = [
    { label: 'Settings', hint: 'Reminders · How I learn', onClick: () => setArea('settings') },
  ];
  if (learning.courses.length) {
    menuItems.push({ label: 'My progress', onClick: () => open(learning.courses[0].id, 'progress') });
  }
  menuItems.push('divider', { label: 'Sign out', danger: true, onClick: handleSignOut });

  return (
    <div className="s-root" style={{ '--scale': prefs.textScale }}>
      <nav className="s-rail" aria-label="Student navigation">
        <UserMenu
          name={displayName}
          role={!profileRole ? 'Student' : profileRole === 'BOTH' ? 'Learner · Instructor' : 'Learner'}
          rank={displayRank}
          initials={initials}
          items={menuItems}
        />
        <RailButton icon={I.dashboard} label="Dashboard" on={area === 'dashboard'} onClick={() => setArea('dashboard')} />
        <CoursesMenu
          expanded={coursesExpanded}
          onToggle={() => setCoursesExpanded((expanded) => !expanded)}
          selectedCourseId={course?.record ? courseId : null}
          selectedView={course?.record ? view : null}
          expandedCourseIds={expandedCourseIds}
          onToggleCourse={toggleCourse}
          onExpandCourse={expandSelectedCourse}
          onOpenCourse={open}
          courses={learning.courses}
          loading={learning.loading}
          error={learning.error}
          navForCourse={() => COURSE_NAV}
        />
        {prefs.showCalendar !== false && (
          <RailButton icon={I.calendar} label="Calendar" on={area === 'calendar'} onClick={() => setArea('calendar')} />
        )}
        <RailButton icon={I.inbox} label="Inbox" on={area === 'inbox'} onClick={() => setArea('inbox')} badge={inboxUnread} />
        {area === 'course' && course && (
          <div className="s-rail-sec"><span className="s-rail-sec-name">{course.name}</span></div>
        )}
        {area === 'course' && !course && (
          <div className="s-rail-sec"><span className="s-rail-sec-name">Course unavailable</span></div>
        )}
        <div className="s-rail-spacer" />
        {onSwitchRole && <RailButton icon={I.swap} label="View as instructor" onClick={onSwitchRole} />}
      </nav>

      <div className="s-content">
        <main className="s-main">
          <div className="s-container">
            {railContext && (
              <div className="s-railcontext">
                <button className="s-crumbs-inline" onClick={railContext.onUp}>← {railContext.up}</button>
                {railContext.section && <span className="s-railcontext-cur">{railContext.section}</span>}
              </div>
            )}
            {signOutError && (
              <div className="s-shell-error" role="alert">
                {errorText(signOutError, 'Unable to sign out. Please try again.')}
              </div>
            )}
            {body}
          </div>
        </main>
      </div>
      <CourseChat key={course?.id || 'generated'} course={course} view={view} />
    </div>
  );
}