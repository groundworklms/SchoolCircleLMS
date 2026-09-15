// /api/learning/courses/:id/approve -- Human approval gate for a course draft. Only the owning instructor.
import { learningRoute } from '../../../../../../lib/learning/http';
import { approveCourse } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => approveCourse(identity, input));
