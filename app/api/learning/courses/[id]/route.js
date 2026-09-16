// /api/learning/courses/:id -- One course draft; learner responses are redacted (no answer keys or rationales).
import { learningRoute } from '../../../../../lib/learning/http';
import { getCourse } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => getCourse(identity, input));
