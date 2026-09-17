// /api/learning/courses/:id/items/approve-all -- the owner approves every item
// still PENDING on the released course, in one deliberate action.
import { learningRoute } from '../../../../../../../lib/learning/http';
import { approvePendingCourseItems } from '../../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'], body: 'none' }, ({ identity, ...input }) =>
  approvePendingCourseItems(identity, input),
);
