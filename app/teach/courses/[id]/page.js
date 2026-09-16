'use client';

import { use } from 'react';
import { CourseEditorPage, InstructorAccess } from '../../../_authoring/editor';

export default function TeachCourseEditorPage({ params, request }) {
  const resolvedParams = params && typeof params.then === 'function' ? use(params) : params;
  const courseId = resolvedParams?.id;
  if (!courseId) {
    return <div className="authoring-access"><h1>Course not found</h1><p>A course ID is required to open the editor.</p></div>;
  }
  return (
    <InstructorAccess>
      <CourseEditorPage courseId={courseId} request={request} />
    </InstructorAccess>
  );
}

export { CourseEditorPage };