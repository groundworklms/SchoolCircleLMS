// /api/learning/profile/cohort -- Instructor cohort profile aggregate; suppressed below five distinct learners.
import { learningRoute } from '../../../../../lib/learning/http';
import { evidenceHandlers } from '../../../../../lib/learning/evidence';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().getCohortProfile(identity, input));
