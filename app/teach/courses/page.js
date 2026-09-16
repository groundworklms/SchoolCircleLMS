'use client';

import { CoursesPage, InstructorAccess } from '../../_authoring/editor';

/*
 * Keep the route wrapper tiny so the authoring page can also be mounted by an
 * isolated browser harness with an injected request implementation.
 */
export default function TeachCoursesPage({ request }) {
  return (
    <InstructorAccess>
      <CoursesPage request={request} />
    </InstructorAccess>
  );
}

export { CoursesPage };