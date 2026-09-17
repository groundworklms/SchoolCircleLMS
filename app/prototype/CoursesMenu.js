import { I } from './shell';
import CourseTreeNav from './CourseTreeNav';

function learningErrorMessage(error) {
  return error?.error || error?.message || 'The learning service is unavailable.';
}

export default function CoursesMenu({
  expanded,
  onToggle,
  courses = [],
  loading = false,
  error = null,
  ...courseProps
}) {
  return (
    <div className="s-courses-menu">
      <button
        type="button"
        className="s-rail-btn"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls="enrolled-courses-menu"
      >
        <span className="s-rail-ico" aria-hidden="true">{I.courses}</span>
        <span className="s-rail-lab">Courses</span>
        <span aria-hidden="true">{expanded ? '⌄' : '›'}</span>
      </button>
      <div id="enrolled-courses-menu" className="s-courses-nested" hidden={!expanded}>
        {loading ? (
          <p className="s-course-menu-state" role="status">Loading courses…</p>
        ) : error ? (
          <p className="s-course-menu-state s-course-menu-error" role="alert">
            Unable to load courses: {learningErrorMessage(error)}
          </p>
        ) : !courses.length ? (
          <p className="s-course-menu-state">No courses available.</p>
        ) : (
          <CourseTreeNav courses={courses} {...courseProps} />
        )}
      </div>
    </div>
  );
}