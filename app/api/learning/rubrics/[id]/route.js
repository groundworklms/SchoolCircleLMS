// /api/learning/rubrics/:id -- One rubric record with its validation and traceability (owner only).
import { learningRoute } from '../../../../../lib/learning/http';
import { getRubric } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => getRubric(identity, input));
