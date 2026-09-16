// /api/learning/sources/:id/approve -- Human approval gate for a source. Only the owning instructor.
import { learningRoute } from '../../../../../../lib/learning/http.js';
import { approveSource } from '../../../../../../lib/learning/core.js';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => approveSource(identity, input));
