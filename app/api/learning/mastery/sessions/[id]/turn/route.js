// /api/learning/mastery/sessions/:id/turn -- Grade one answer with compare-and-set on the session version (409 on a stale turn).
import { learningRoute } from '../../../../../../../lib/learning/http';
import { masteryTurn } from '../../../../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const POST = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => masteryTurn(identity, input));
