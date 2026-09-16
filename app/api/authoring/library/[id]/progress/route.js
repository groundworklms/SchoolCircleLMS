import { authoringRoute } from '../../../../../../lib/authoring/http.js';
import { createAuthoringService } from '../../../../../../lib/authoring/service.js';

export const runtime = 'nodejs';
const service = createAuthoringService();

export const POST = authoringRoute(
  { roles: ['LEARNER', 'INSTRUCTOR'] },
  ({ identity, params, body }) => service.completeBlock(identity, { params, body }),
);
