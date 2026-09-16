// /api/learning/analytics -- Sextant analytics for the caller; ?scope=cohort is instructor-only and cohort-suppressed.
import { learningRoute } from '../../../../lib/learning/http';
import { evidenceHandlers } from '../../../../lib/learning/evidence';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().getAnalytics(identity, input));
