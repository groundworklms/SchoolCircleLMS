import { learningRoute } from '../../../../../lib/learning/http';
import { getPlan } from '../../../../../lib/learning/course-plan';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['INSTRUCTOR'], body: 'none' }, ({ identity, ...input }) => getPlan(identity, input));
