// /api/learning/courses/:id/approve -- Human approval gate for a course
// draft/revision. The body must contain the exact reviewed { version }.
import { learningRoute } from '../../../../../../lib/learning/http';
import { approveCourse } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';

// Approval now also measures HHEM entailment for every item it is about to
// materialise (lib/learning/verify-support.js), which is a real model run per
// claim on the doctrine board. That work is bounded by its own budget
// (DOCTRINE_VERIFY_BUDGET_MS, 60s by default) and happens BEFORE the
// transaction opens -- but the route has to outlast it, or a platform default
// would kill the request mid-verification and fail an approval for no reason
// other than a slow verifier. 120s, the same ceiling the revise route uses.
export const maxDuration = 120;

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => approveCourse(identity, input));
