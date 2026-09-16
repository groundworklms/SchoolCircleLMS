// /api/learning/sources/:id -- One source with its page text and passages
// (owner, or anyone once APPROVED), plus owner PDF/removal controls.
import { learningRoute } from '../../../../../lib/learning/http.js';
import {
  getSource,
  removeSource,
} from '../../../../../lib/learning/core.js';

export const runtime = 'nodejs';

export const GET = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, ({ identity, ...input }) => getSource(identity, input));
export const DELETE = learningRoute({ roles: ['INSTRUCTOR'], body: 'none' }, ({ identity, ...input }) => removeSource(identity, input));
