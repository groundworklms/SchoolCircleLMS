'use client';

import { COURSES } from './data';

function coursePanelId(courseId) {
  return `instructor-course-nav-${String(courseId).replace(/[^a-zA-Z0-9_-]/g, '-')}`;
}

/* Instructor-only course disclosure tree. Course names and arrows are
   intentionally separate controls: selecting a name opens the default
   instructor view when collapsed, and collapses that course in place when it
   is already open. The arrow never changes the current route. */
export default function InstructorCourseTreeNav({
  selectedCourseId = null,
  selectedView = null,
  expandedCourseIds = {},
  onToggleCourse,
  onExpandCourse,
  onOpenCourse,
  onOpenLibrary,
  courses = Object.values(COURSES),
  items = [],
  homeView = 'builder',
  groupLabel = 'Instructor courses',
}) {
  return (
    <div className="s-instructor-course-tree" role="group" aria-label={groupLabel}>
      <button
        type="button"
        className="s-rail-btn s-instructor-course-library"
        onClick={onOpenLibrary}
        aria-current={!selectedCourseId && selectedView === 'courses' ? 'page' : undefined}
      >
        <span className="s-course-child-marker" aria-hidden="true">·</span>
        <span className="s-rail-lab">Course library</span>
      </button>
      {courses.map((course) => {
        const isSelected = selectedCourseId === course.id;
        const isHome = isSelected && (!selectedView || selectedView === homeView);
        const isExpanded = Boolean(expandedCourseIds[course.id]);
        const panelId = coursePanelId(course.id);
        const toggleLabel = `${isExpanded ? 'Collapse' : 'Expand'} ${course.name} navigation`;

        return (
          <div className={`s-instructor-course-group${isSelected ? ' selected' : ''}`} key={course.id}>
            <div className="s-instructor-course-parent">
              <button
                type="button"
                className={`s-rail-btn s-instructor-course-link${isSelected ? ' selected' : ''}${isHome ? ' on' : ''}`}
                onClick={() => {
                  if (isExpanded) {
                    onToggleCourse(course.id);
                    return;
                  }
                  onExpandCourse(course.id);
                  onOpenCourse(course.id, homeView);
                }}
                aria-label={isExpanded ? toggleLabel : `Open ${course.name} course dashboard`}
                aria-expanded={isExpanded}
                aria-controls={panelId}
                aria-current={isHome ? 'page' : undefined}
                title={course.name}
              >
                <span
                  className="s-rail-dot"
                  style={{ background: course.id === 'M092721' ? 'var(--p-accent)' : 'var(--p-dim)' }}
                  aria-hidden="true"
                />
                <span className="s-rail-lab">{course.name.replace(' Course', '')}</span>
              </button>
              <button
                type="button"
                className={`s-instructor-course-toggle${isSelected ? ' selected' : ''}`}
                onClick={() => onToggleCourse(course.id)}
                aria-expanded={isExpanded}
                aria-controls={panelId}
                aria-label={toggleLabel}
                title={toggleLabel}
              >
                <span className="s-course-chevron" aria-hidden="true">{isExpanded ? '⌄' : '›'}</span>
              </button>
            </div>
            <div id={panelId} className="s-instructor-course-children" hidden={!isExpanded}>
              {items.map((item) => {
                const isActive = isSelected && selectedView === item.id;
                return (
                  <button
                    type="button"
                    key={item.id}
                    className={`s-rail-btn s-instructor-course-child${isActive ? ' on' : ''}`}
                    onClick={() => onOpenCourse(course.id, item.id)}
                    aria-label={`Open ${item.label} in ${course.name}`}
                    aria-current={isActive ? 'page' : undefined}
                    title={`${course.name}: ${item.label}`}
                  >
                    <span className="s-course-child-marker" aria-hidden="true">·</span>
                    <span className="s-rail-lab">{item.label}</span>
                  </button>
                );
              })}
            </div>
          </div>
        );
      })}
    </div>
  );
}
