// /api/learning/mastery/sessions -- Whetstone mastery sessions for the caller: list, or start one against an approved course.
import { learningRoute } from '../../../../../lib/learning/http';
import { listMasterySessions, startMastery } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => listMasterySessions(identity, input));
export const POST = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => startMastery(identity, input));
