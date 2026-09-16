// Legacy entry point retained for clients that have not moved yet. Doctrine
// questions must still name a course; this delegates to the same authenticated
// course-scoped student tutor and never queries a global Anchor corpus.
import { learningRoute } from '../../../lib/learning/http.js';
import { tutor } from '../../../lib/learning/core.js';

export const runtime = 'nodejs';
export const maxDuration = 120;

export const POST = learningRoute(
  { roles: ['LEARNER', 'INSTRUCTOR'], maxBodyBytes: 16 * 1024 },
  ({ identity, ...input }) => tutor(identity, input),
);
