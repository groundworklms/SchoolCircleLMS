'use client';

import { useState } from 'react';
import './Focused.css';

import { COURSES } from './data';
import { TODO, UPCOMING, REQUIREMENTS } from './agenda';
import {
  focusedAgendaItems,
  focusedCourseListState,
  focusedCourseRow,
  focusedLiveCourses,
  focusedItemDestination,
} from './focused-dashboard-data';

function errorMessage(error, fallback) {
  return error?.error || error?.message || fallback;
}

function ActionItems({ onOpen, onCalendar, courses }) {
  const items = focusedAgendaItems(TODO, UPCOMING);
  const courseById = new Map([
    ...Object.values(COURSES).map((course) => [course.id, course]),
    ...(Array.isArray(courses) ? courses : []).map((course) => [course.id, course]),
  ]);

  const openItem = (item) => {
    const destination = focusedItemDestination(item);
    if (destination.type === 'calendar') {
      onCalendar(destination.title);
      return;
    }
    onOpen(destination.courseId, destination.view);
  };

  return (
    <section>
      <h2 className="f-section-title">Up Next · Demo</h2>
      {items.length === 0 ? (
        <p className="f-empty">Nothing is due right now.</p>
      ) : (
        <div className="f-task-grid">
          {items.map((item, index) => {
            const course = item.courseId ? courseById.get(item.courseId) : null;
            const destination = focusedItemDestination(item);
            const destinationLabel = destination.type === 'calendar'
              ? 'calendar'
              : `${destination.view} in ${course?.name || item.courseId}`;
            return (
              <button
                key={`${item.title}-${index}`}
                type="button"
                className={`f-task-card${item.late ? ' f-late' : ''}`}
                onClick={() => openItem(item)}
                aria-label={`Open ${item.title} in ${destinationLabel}`}
              >
                <div className="f-task-course">{course?.name || item.kind}</div>
                <div className="f-task-title">{item.title}</div>
                <div className="f-task-meta">
                  <strong>{item.due}</strong>
                  {item.minutes ? ` · ~${item.minutes}m` : ''}
                  {item.exam && <span className="f-task-exam">EXAM</span>}
                </div>
              </button>
            );
          })}
        </div>
      )}
    </section>
  );
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
        <span className="f-course-id">{row.id}</span>
        <span className="f-course-name">{row.name}</span>
      </div>
      <div className="f-course-prog">
        {row.hasProgress ? (
          <>
            <div className="f-prog-bar">
              <div className="f-prog-fill" style={{ width: `${row.progress}%` }} />
            </div>
            <span className="f-prog-text">Wk {row.week}/{row.weeks}</span>
          </>
        ) : (
          <span className="f-prog-text f-course-sections">
            {row.sections === null ? 'Course' : `${row.sections} sections`}
            {row.status === 'APPROVED' ? ' · approved' : ''}
          </span>
        )}
      </div>
    </button>
  );
}

function DemoCourseRow({ course, onOpen }) {
  const row = focusedCourseRow(course);
  return (
    <button
      type="button"
      className="f-course-row"
      onClick={() => onOpen(row.id, 'home')}
      aria-label={`Open ${row.name} demo course home`}
    >
      <div className="f-course-info">
        <span className="f-course-id">{row.id}</span>
        <span className="f-course-name">{row.name}</span>
      </div>
      <div className="f-course-prog">
        <div className="f-prog-bar">
          <div className="f-prog-fill" style={{ width: `${row.progress || 0}%` }} />
        </div>
        <span className="f-prog-text">Wk {row.week}/{row.weeks}</span>
      </div>
    </button>
  );
}

function CourseList({
  courses,
  loading,
  error,
  onOpen,
}) {
  const list = focusedLiveCourses(courses);
  const demos = Object.values(COURSES);
  const state = focusedCourseListState(courses, { loading, error });
  return (
    <section>
      <h2 className="f-section-title">Active Courses</h2>
      {state === 'loading' && <p className="f-status" role="status">Loading courses…</p>}
      {state === 'error' && (
        <p className="f-status f-status-error" role="alert">
          Unable to load courses: {errorMessage(error, 'The learning service is unavailable.')}
        </p>
      )}
      {state === 'empty' && (
        <p className="f-empty">No active courses.</p>
      )}
      {state === 'ready' && (
        <div className="f-course-list">
          {list.map((course) => <CourseRow key={course.id} course={course} onOpen={onOpen} />)}
        </div>
      )}

      <details className="f-demo-courses">
        <summary className="f-section-title">Demo courses (not enrolled)</summary>
        <div className="f-course-list">
          {demos.map((course) => <DemoCourseRow key={course.id} course={course} onOpen={onOpen} />)}
        </div>
      </details>
    </section>
  );
}

function RequirementsDisclosure({ onCalendar }) {
  const [open, setOpen] = useState(false);
  const overdue = REQUIREMENTS.filter((requirement) => requirement.state === 'Overdue').length;

  return (
    <section>
      <div className="f-disclosure-wrapper">
        <button
          type="button"
          className={`f-disclosure-btn${open ? ' open' : ''}`}
          onClick={() => setOpen((isOpen) => !isOpen)}
          aria-expanded={open}
          aria-controls="requirements-content"
        >
          <div className="f-disclosure-title">
            <h2>Required Training</h2>
            {overdue > 0 && <span className="f-badge critical">{overdue} Overdue</span>}
          </div>
          <span className="f-disclosure-icon" aria-hidden="true">{open ? '⌃' : '⌄'}</span>
        </button>
        {open && (
          <div id="requirements-content" className="f-disclosure-content">
            <p className="f-disclosure-note">
              Requirements are tracked on Calendar. Select one to review its date and status.
            </p>
            {REQUIREMENTS.map((requirement) => (
              <button
                type="button"
                className="f-req-row"
                key={requirement.name}
                onClick={() => onCalendar(requirement.name)}
                aria-label={`Open calendar for ${requirement.name} requirement, status ${requirement.state}`}
              >
                <span className="f-req-dot" style={{ backgroundColor: requirement.color }} />
                <span className="f-req-name">{requirement.name}</span>
                <span className="f-req-state" style={{ color: requirement.color }}>{requirement.state}</span>
              </button>
            ))}
          </div>
        )}
      </div>
    </section>
  );
}

export default function FocusedDashboard({
  courses = [],
  loading = false,
  error = null,
  onOpen,
  onCalendar,
}) {
  return (
    <div className="focused-dashboard-content">
      <header className="f-header">
        <div className="f-header-title">Dashboard</div>
        <div className="f-header-date">
          {new Date().toLocaleDateString('en-US', {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </div>
      </header>
      <div className="f-main">
        <div className="f-container">
          <ActionItems courses={courses} onOpen={onOpen} onCalendar={onCalendar} />
          <CourseList courses={courses} loading={loading} error={error} onOpen={onOpen} />
          <RequirementsDisclosure onCalendar={onCalendar} />
        </div>
      </div>
    </div>
  );
}