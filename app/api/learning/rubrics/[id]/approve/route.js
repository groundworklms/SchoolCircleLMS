// /api/learning/rubrics/:id/approve -- Approve a rubric only if validation, grounding, and traceability all pass (else 409).
import { learningRoute } from '../../../../../../lib/learning/http';
import { approveRubric } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => approveRubric(identity, input));
