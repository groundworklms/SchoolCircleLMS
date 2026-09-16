import { learningRoute } from '../../../../../../lib/learning/http';
import { listCourseItems } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['INSTRUCTOR'], body: 'none' }, ({ identity, ...input }) =>
  listCourseItems(identity, input),
);
