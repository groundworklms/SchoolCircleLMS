// /api/learning/aar/critiques -- Persist a critique set for a course; POST /api/learning/aar reads it (Hotwash).
import { learningRoute } from '../../../../../lib/learning/http';
import { recordCritiques } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => recordCritiques(identity, input));
