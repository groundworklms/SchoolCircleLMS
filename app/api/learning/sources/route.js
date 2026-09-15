// /api/learning/sources -- Persisted Quarry sources: list (learners see APPROVED only) and instructor ingest.
import { learningRoute } from '../../../../lib/learning/http';
import { createSource, listSources } from '../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => listSources(identity, input));
export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => createSource(identity, input));
