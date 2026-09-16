'use client';

import './editor.css';

/*
 * Public authoring seam.  Keep route-facing exports here while the actual
 * views and field editors live in focused modules.
 */
export {
  requestJson,
  authoringRequest,
  InstructorAccess,
  errorMessage,
} from './editor-shared';

export {
  createAuthoringId,
  duplicateWithFreshIds,
  newBlock,
  newLesson,
  emptyDraft,
  cloneValue,
  normalizeDraft,
  normalizeCourse,
  moveArrayItem,
  isDraftDirty,
} from './editor-pure.mjs';

export { CoursesPage } from './editor-list';
export { CourseEditorPage } from './editor-main';
export { CoursesPage as InstructorCourseList } from './editor-list';
export { CourseEditorPage as InstructorCourseEditor } from './editor-main';
