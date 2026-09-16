// /api/learning/courses/:id/revise -- Grounded, targeted AI revision for the
// owning instructor. The reviewed version is compare-and-set after the model
// returns; stale model output is never committed.
import { learningRoute } from '../../../../../../lib/learning/http';
import { reviseCourse } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const POST = learningRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, ...input }) => reviseCourse(identity, input),
);
