// /api/learning/aar -- Hotwash after-action review: saved memo, or build from the persisted critique set.
import { learningRoute } from '../../../../lib/learning/http';
import { evidenceHandlers } from '../../../../lib/learning/evidence';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().getAar(identity, input));
export const POST = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().createAar(identity, input));
