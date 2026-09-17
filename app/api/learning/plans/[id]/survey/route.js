// One bounded step of a whole-course plan; the client repeats it until the
// plan's status moves on. See lib/learning/course-plan.js.
import { learningRoute } from '../../../../../../lib/learning/http';
import { surveyPlanStep } from '../../../../../../lib/learning/course-plan';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => surveyPlanStep(identity, input));
