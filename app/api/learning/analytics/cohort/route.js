// /api/learning/analytics/cohort -- Explicit instructor cohort analytics URL (same suppression as ?scope=cohort).
import { learningRoute } from '../../../../../lib/learning/http';
import { evidenceHandlers } from '../../../../../lib/learning/evidence';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().getCohortAnalytics(identity, input));
