// /api/learning/courses/:id/approve -- Human approval gate for a course
// draft/revision. The body must contain the exact reviewed { version }.
import { learningRoute } from '../../../../../../lib/learning/http';
import { approveCourse } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => approveCourse(identity, input));
