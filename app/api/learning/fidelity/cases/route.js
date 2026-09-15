// /api/learning/fidelity/cases -- Persist Understudy benchmark cases against APPROVED sources; POST /api/learning/fidelity runs them.
import { learningRoute } from '../../../../../lib/learning/http';
import { recordFidelityCases } from '../../../../../lib/learning/core';

export const runtime = 'nodejs';

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => recordFidelityCases(identity, input));
