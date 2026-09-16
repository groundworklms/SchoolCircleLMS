// /api/learning/tutor -- Sourcerer cite-or-refuse tutor over selected approved passages. Every turn is recorded.
import { learningRoute } from '../../../../lib/learning/http';
import { tutor } from '../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const POST = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => tutor(identity, input));
