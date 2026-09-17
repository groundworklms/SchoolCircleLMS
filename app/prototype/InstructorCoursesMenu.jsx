import { I } from './shell';
import InstructorCourseTreeNav from './InstructorCourseTreeNav';

export default function InstructorCoursesMenu({
  expanded,
  onToggle,
  label = 'Courses',
  menuId = 'instructor-courses-menu',
  ...courseProps
}) {
  return (
    <div className="s-instructor-courses-menu">
      <button
        type="button"
        className="s-rail-btn s-instructor-courses-button"
        onClick={onToggle}
        aria-expanded={expanded}
        aria-controls={menuId}
        aria-current={courseProps.selectedCourseId ? undefined : courseProps.selectedView === 'courses' ? 'page' : undefined}
      >
        <span className="s-rail-ico" aria-hidden="true">{I.courses}</span>
        <span className="s-rail-lab">{label}</span>
        <span className="s-instructor-courses-chevron" aria-hidden="true">{expanded ? '⌄' : '›'}</span>
      </button>
      <div id={menuId} className="s-instructor-courses-nested" hidden={!expanded}>
        <InstructorCourseTreeNav {...courseProps} />
      </div>
    </div>
  );
}
