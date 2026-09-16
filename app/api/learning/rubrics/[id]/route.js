// /api/learning/rubrics/:id -- One rubric record with its validation and traceability (owner only).
//
// PATCH renames it; DELETE removes it, but refuses while any mastery session
// grades against it -- a completed session would otherwise become
// unexplainable after the fact.
import { learningRoute } from '../../../../../lib/learning/http';
import { deleteRubric, getRubric, renameRubric } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => getRubric(identity, input));

export const PATCH = learningRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, ...input }) => renameRubric(identity, input),
);

export const DELETE = learningRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  ({ identity, ...input }) => deleteRubric(identity, input),
);
