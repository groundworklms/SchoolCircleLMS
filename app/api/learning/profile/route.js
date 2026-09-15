// /api/learning/profile -- Waypoint learning profile for the caller: saved, or score a new survey response map.
import { learningRoute } from '../../../../lib/learning/http';
import { evidenceHandlers } from '../../../../lib/learning/evidence';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().getProfile(identity, input));
export const POST = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().saveProfile(identity, input));
