// /api/learning/study-plan -- Cadence study plan for the caller: saved plan (json/ics/reminders) or build from the persisted syllabus.
import { learningRoute } from '../../../../lib/learning/http';
import { evidenceHandlers } from '../../../../lib/learning/evidence';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().getStudyPlan(identity, input));
export const POST = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().createStudyPlan(identity, input));
