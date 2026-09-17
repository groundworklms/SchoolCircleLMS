'use client';

import { COURSE_NAV, coursePanelId } from './courseTreeState.mjs';

/* Disclosure navigation for the enrolled courses in the student rail. The
   course title and chevron are separate controls: the title opens a dashboard
   when collapsed, collapses the group in place when expanded, and the chevron
   only changes disclosure state. */
export default function CourseTreeNav({
  selectedCourseId = null,
  selectedView = null,
  expandedCourseIds = {},
  onToggleCourse = () => {},
  onExpandCourse = () => {},
  onOpenCourse = () => {},
  courses = [],
  navForCourse = () => COURSE_NAV,
}) {
  const visibleCourses = (Array.isArray(courses) ? courses : []).filter(
    (course) => course && course.id !== null && course.id !== undefined && String(course.id),
  );
  return (
    <div className="s-course-tree" role="group" aria-label="Enrolled courses">
      {visibleCourses.map((course) => {
        const courseId = String(course.id);
        const courseName = course.name || `Course ${courseId}`;
        const isSelected = selectedCourseId !== null
          && selectedCourseId !== undefined
          && String(selectedCourseId) === courseId;
        const isHome = isSelected && (!selectedView || selectedView === 'home');
        const isExpanded = Boolean(expandedCourseIds[courseId]);
        const panelId = coursePanelId(courseId);
        const toggleLabel = `${isExpanded ? 'Collapse' : 'Expand'} ${courseName} navigation`;
        const items = (navForCourse(course) || []).filter(
          (item) => item && item.id !== null && item.id !== undefined && String(item.id),
        );

        return (
          <div className={`s-course-group${isSelected ? ' selected' : ''}`} key={courseId}>
            <div className="s-course-parent">
              <button
                type="button"
                className={`s-rail-btn s-course-link${isSelected ? ' selected' : ''}${isHome ? ' on' : ''}`}
                onClick={() => {
                  if (isExpanded) {
                    onToggleCourse(courseId);
                    return;
                  }
                  onExpandCourse(courseId);
                  onOpenCourse(courseId, 'home');
                }}
                aria-label={isExpanded ? toggleLabel : `Open ${courseName} course dashboard`}
                aria-expanded={isExpanded}
                aria-controls={panelId}
                aria-current={isHome ? 'page' : undefined}
                title={courseName}
              >
                <span
                  className="s-rail-dot"
                  style={{ background: 'var(--p-good)' }}
                  aria-hidden="true"
                />
                <span className="s-rail-lab">{courseName.replace(' Course', '')}</span>
              </button>
              <button
                type="button"
                className={`s-course-toggle${isSelected ? ' selected' : ''}`}
                onClick={() => onToggleCourse(courseId)}
                aria-expanded={isExpanded}
                aria-controls={panelId}
                aria-label={toggleLabel}
                title={toggleLabel}
              >
                <span className="s-course-chevron" aria-hidden="true">{isExpanded ? '⌄' : '›'}</span>
              </button>
            </div>
            <div id={panelId} className="s-course-children" hidden={!isExpanded}>
              {items.map((item) => {
                const itemId = String(item.id);
                const isActive = isSelected
                  && selectedView !== null
                  && selectedView !== undefined
                  && String(selectedView) === itemId;
                return (
                  <button
                    type="button"
                    key={itemId}
                    className={`s-rail-btn s-course-child${isActive ? ' on' : ''}`}
                    onClick={() => onOpenCourse(courseId, itemId)}
                    aria-label={`Open ${item.label} in ${courseName}`}
                    aria-current={isActive ? 'page' : undefined}
                    title={`${courseName}: ${item.label}`}
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

export { COURSE_NAV };