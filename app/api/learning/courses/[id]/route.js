// /api/learning/courses/:id -- One course draft; learner responses are redacted (no answer keys or rationales).
//
// PATCH renames it. DELETE removes an unapproved draft outright, but ARCHIVES
// an approved one whenever learners have recorded work: a typed Course cascades
// to Section -> Item -> Attempt/Schedule, so deleting a delivered course would
// silently erase that work. There is deliberately no force flag.
import { learningRoute } from '../../../../../lib/learning/http';
import { deleteCourse, getCourse, renameCourse } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => getCourse(identity, input));

export const PATCH = learningRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, ...input }) => renameCourse(identity, input),
);

export const DELETE = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  ({ identity, ...input }) => deleteCourse(identity, input),
);
