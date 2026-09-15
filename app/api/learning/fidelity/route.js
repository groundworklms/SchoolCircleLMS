// /api/learning/fidelity -- Understudy fidelity benchmark: saved evaluation, or run the persisted cases (503 without a model).
import { learningRoute } from '../../../../lib/learning/http';
import { evidenceHandlers } from '../../../../lib/learning/evidence';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().getFidelity(identity, input));
export const POST = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => evidenceHandlers().runFidelity(identity, input));
