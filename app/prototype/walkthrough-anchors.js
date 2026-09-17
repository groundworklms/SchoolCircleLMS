/* Which screen the guided tour is pointing at.
 *
 * Derived from the route rather than threaded through every screen component as
 * a prop, so there is exactly one place that decides it and it reads the same
 * location the router does. Kept free of React and CSS imports so
 * test/walkthrough-steps.test.mjs can call it directly and prove that every
 * step in the script targets an anchor the shells actually render -- the
 * companion to proving every step targets an address the router serves.
 */

export function instructorTourAnchor(nav) {
  if (nav?.area === 'library') {
    if (nav.view === 'courses') return 'instructor-library';
    if (nav.view === 'sources') return 'nav-sources';
    if (nav.view === 'rubrics') return 'rubric-generator';
    return null;
  }
  if (nav?.area === 'course') {
    if (nav.view === 'builder') return 'course-builder';
    if (nav.view === 'fidelity') return 'course-fidelity';
    if (nav.view === 'roster') return 'course-roster';
    if (nav.view === 'aar') return 'course-aar';
  }
  return null;
}

export function studentTourAnchor(nav) {
  if (nav?.area === 'dashboard') return 'student-dashboard';
  if (nav?.area === 'course') {
    if (nav.view === 'lessons') return 'lesson-reader';
    if (nav.view === 'mastery') return 'mastery-session';
    if (nav.view === 'progress') return 'learner-progress';
  }
  return null;
}

/** The anchor for a location, whichever shell owns it. */
export function tourAnchor(location) {
  return location?.role === 'instructor'
    ? instructorTourAnchor(location)
    : studentTourAnchor(location);
}

/* Anchors that are a specific element rather than a whole screen, and so are
   attached at the component instead of the shell. Listed here so the test can
   tell "deliberately element-level" apart from "nothing renders this". */
export const ELEMENT_ANCHORS = new Set(['ask-tutor']);
