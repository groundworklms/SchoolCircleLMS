'use client';

import { usePathname, useRouter } from 'next/navigation';
import {
  canAccessLocation,
  canAccessRole,
  href,
  parse,
  publishedCourseHref,
} from './routes';

export {
  canAccessLocation,
  canAccessRole,
  href,
  parse,
  publishedCourseHref,
} from './routes';

/* URL-backed navigation for the prototype.

   Every screen has a real address, so refresh keeps your place, back/forward
   work, and a screen can be linked to directly:

      /prototype                                   student dashboard
      /prototype/courses | calendar | inbox | settings
      /prototype/published/:courseId               published student reader
     /prototype/course/:courseId                  course home
     /prototype/course/:courseId/:view            lessons | path | materials | assignments | live | progress
     /prototype/course/:courseId/lessons/:lessonId/:page   page number inside the lesson (1-based)
     /prototype/course/:courseId/discussions/:threadId
     /prototype/instructor/:courseId/:view        builder | control | fidelity | mastery | aar | settings
      /prototype/instructor                         instructor library (courses)
      /prototype/instructor/courses | sources | rubrics | settings

   A courseId is either a mock course key (data.js) or a LearningRecord id
   from /api/learning/courses; the shells resolve which (see learning.js).

   `parse` turns a pathname into a location object; `href` turns one back into
   a pathname. Screens never touch the router directly — they call `go`. */

export function useNav() {
  const pathname = usePathname();
  const router = useRouter();
  const loc = parse(pathname);
  // Partial updates: go({ view: 'lessons' }) keeps the current course.
  const go = (patch) => router.push(href({ ...loc, ...patch }));
  return { ...loc, go };
}
