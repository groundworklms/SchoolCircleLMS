// /api/learning/sources/:id -- One source with its page text and passages (owner, or anyone once APPROVED).
import { learningRoute } from '../../../../../lib/learning/http';
import { getSource } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => getSource(identity, input));
