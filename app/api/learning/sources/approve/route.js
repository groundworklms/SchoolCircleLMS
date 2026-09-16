// /api/learning/sources/approve -- Batch approval: { ids } -> { approved, failed }.
// The same owner-only gate as /sources/:id/approve, applied per id; partial
// success is reported, never rolled back.
import { learningRoute } from '../../../../../lib/learning/http.js';
import { approveSources } from '../../../../../lib/learning/core.js';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => approveSources(identity, input));
