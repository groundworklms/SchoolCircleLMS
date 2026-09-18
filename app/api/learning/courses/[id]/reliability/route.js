// /api/learning/courses/:id/reliability -- chance-corrected agreement between
// the grader and this instructor across the sessions they have rated on this
// course. Rubricon's own arithmetic; see lib/learning/reliability.js.
import { learningRoute } from '../../../../../../lib/learning/http';
import { courseReliability } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  ({ identity, ...input }) => courseReliability(identity, input),
);
