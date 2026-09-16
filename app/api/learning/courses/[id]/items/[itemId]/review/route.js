import { learningRoute } from '../../../../../../../../lib/learning/http';
import { reviewCourseItem } from '../../../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) =>
  reviewCourseItem(identity, input),
);
