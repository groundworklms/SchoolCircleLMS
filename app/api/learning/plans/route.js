// /api/learning/plans -- whole-course plans (survey -> outline -> map -> build).
// See lib/learning/course-plan.js for why a course this size is built one
// bounded step per request.
import { learningRoute } from '../../../../lib/learning/http';
import { createPlan, listPlans } from '../../../../lib/learning/course-plan';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['INSTRUCTOR'], body: 'none' }, ({ identity }) => listPlans(identity));
export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => createPlan(identity, input));
