// /api/learning/courses/:id/mastery-plan/approve -- Approve exactly the
// course owner's pending mastery-plan revision.
import { learningRoute } from '../../../../../../../lib/learning/http';
import { approveMasteryPlan } from '../../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, ...input }) => approveMasteryPlan(identity, input),
);