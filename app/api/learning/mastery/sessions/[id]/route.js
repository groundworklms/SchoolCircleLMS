// /api/learning/mastery/sessions/:id -- One owned mastery session (learner-safe view; indicators are never returned).
import { learningRoute } from '../../../../../../lib/learning/http';
import { getMasterySession } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => getMasterySession(identity, input));
