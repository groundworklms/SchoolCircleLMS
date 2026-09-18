// /api/learning/mastery/sessions/:id/rate -- the instructor's own verdicts on a
// session they own, so the agreement between them and the grader can be
// measured. Owner-scoped exactly like every other session read: this never
// reaches a learner's answers.
import { learningRoute } from '../../../../../../../lib/learning/http';
import { rateMasterySession } from '../../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, ...input }) => rateMasterySession(identity, input),
);
