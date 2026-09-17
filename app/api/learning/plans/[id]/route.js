import { learningRoute } from '../../../../../lib/learning/http';
import { deletePlan, getPlan } from '../../../../../lib/learning/course-plan';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['INSTRUCTOR'], body: 'none' }, ({ identity, ...input }) => getPlan(identity, input));
// Removes the plan only. A course draft it built keeps its own lifecycle.
export const DELETE = learningRoute({ roles: ['INSTRUCTOR'], body: 'none' }, ({ identity, ...input }) => deletePlan(identity, input));
