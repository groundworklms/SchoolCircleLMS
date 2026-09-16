// /api/learning/rubrics -- the signed-in instructor's own rubrics.
//
// There was no list route, so the rubrics screen could only show the one it
// had just generated and there was no way to rename or remove an old one.
// Rubrics stay owner-private; unlike sources, approving one does not make it
// readable to others.
import { learningRoute } from '../../../../lib/learning/http';
import { listRubrics } from '../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  ({ identity }) => listRubrics(identity),
);
