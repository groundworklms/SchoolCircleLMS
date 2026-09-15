// /api/learning/courses/:id/syllabus -- Attach the dated syllabus Cadence plans against. Real YYYY-MM-DD dates only.
import { learningRoute } from '../../../../../../lib/learning/http';
import { attachSyllabus } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => attachSyllabus(identity, input));
