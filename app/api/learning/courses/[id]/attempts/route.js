// /api/learning/courses/:id/attempts -- a learner answering a check in a generated course.
//
// GET returns the APPROVED questions of the selected release plus this
// learner's own recorded answers; POST records one answer and returns its
// grade. Learner identity is never taken from the request body: it is the
// verified identity, exactly as every other learning route.
import { learningRoute } from '../../../../../../lib/learning/http';
import { courseAttemptHandlers } from '../../../../../../lib/learning/attempts';

export const runtime = 'nodejs';

export const GET = learningRoute(
  { roles: ['LEARNER', 'INSTRUCTOR'], body: 'none' },
  ({ identity, ...input }) => courseAttemptHandlers().getCourseAttempts(identity, input),
);

export const POST = learningRoute(
  { roles: ['LEARNER', 'INSTRUCTOR'] },
  ({ identity, ...input }) => courseAttemptHandlers().recordCourseAttempt(identity, input),
);
