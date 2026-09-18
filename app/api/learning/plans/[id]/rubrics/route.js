// One BARS rubric for the course a whole-course plan produced; the client
// repeats it until the plan's status moves on, the same as every other stage.
// See lib/learning/course-plan.js on why this is a stage and not a tail on the
// build step.
import { learningRoute } from '../../../../../../lib/learning/http';
import { rubricPlanStep } from '../../../../../../lib/learning/course-plan';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => rubricPlanStep(identity, input));
