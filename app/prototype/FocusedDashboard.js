'use client';

import './Focused.css';
import {
  focusedCourseListState,
  focusedCourseRow,
  focusedLiveCourses,
} from './focused-dashboard-data';

function errorMessage(error, fallback) {
  return error?.error || error?.message || fallback;
}

function CourseRow({ course, onOpen }) {
  const row = focusedCourseRow(course);
  return (
    <button
      type="button"
      className="f-course-row"
      onClick={() => onOpen(row.id, 'home')}
      aria-label={`Open ${row.name} course home`}
    >
      <div className="f-course-info">
        <span className="f-course-name">{row.name}</span>
      </div>
      <div className="f-course-prog">
        {row.hasProgress ? (
          <>
            <div className="f-prog-bar"><div className="f-prog-fill" style={{ width: `${row.progress}%` }} /></div>
            <span className="f-prog-text">Wk {row.week}/{row.weeks}</span>
          </>
        ) : (
          <span className="f-prog-text f-course-sections">
            {row.sections === null ? 'Course' : `${row.sections} sections`}
          </span>
        )}
      </div>
    </button>
  );
}

function CourseList({ courses, loading, error, onOpen }) {
  const state = focusedCourseListState(courses, { loading, error });
  const list = focusedLiveCourses(courses);
  return (
    <section>
      <h2 className="f-section-title">Active Courses</h2>
      {state === 'loading' && <p className="f-status" role="status">Loading courses…</p>}
      {state === 'error' && (
        <p className="f-status f-status-error" role="alert">
          Unable to load courses: {errorMessage(error, 'The learning service is unavailable.')}
        </p>
      )}
      {state === 'empty' && <p className="f-empty">No active courses.</p>}
      {state === 'ready' && (
        <div className="f-course-list">
          {list.map((course) => <CourseRow key={course.id} course={course} onOpen={onOpen} />)}
        </div>
      )}
    </section>
  );
}

export default function FocusedDashboard({
  courses = [],
  loading = false,
  error = null,
  onOpen,
}) {
  return (
    <div className="focused-dashboard-content">
      <header className="f-header">
        <div className="f-header-title">Dashboard</div>
        <div className="f-header-date">Your courses</div>
      </header>
      <div className="f-main">
        <div className="f-container">
          <CourseList courses={courses} loading={loading} error={error} onOpen={onOpen} />
        </div>
      </div>
    </div>
  );
}