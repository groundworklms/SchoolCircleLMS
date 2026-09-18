// /api/learning/courses/:id/items/:itemId/suggest -- a rewritten version of one
// question, for a human to accept, edit or ignore.
//
// Deliberately POST and deliberately not a mutation: it saves nothing, touches
// no course and creates no revision. Item review runs on a course that is
// already APPROVED and may already have learners in it, so an AI edit that
// applied itself would change a published course out from under them. The
// suggestion goes into the form and the existing save path -- which ratifies
// the item and records who did it -- is what makes it real.
import { learningRoute } from '../../../../../../../../lib/learning/http';
import { suggestCourseItem } from '../../../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) =>
  suggestCourseItem(identity, input),
);
