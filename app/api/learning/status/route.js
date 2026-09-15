// /api/learning/status -- Readiness of auth, persistence, and the arsenal model configuration. Unauthenticated.
import { learningRoute } from '../../../../lib/learning/http';
import { learningStatus } from '../../../../lib/learning/core';

export const runtime = 'nodejs';

export const GET = learningRoute({ body: 'none' }, () => learningStatus());
