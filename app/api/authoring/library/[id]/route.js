import { authoringRoute } from '../../../../../lib/authoring/http.js';
import { createAuthoringService } from '../../../../../lib/authoring/service.js';

export const runtime = 'nodejs';
const service = createAuthoringService();

export const GET = authoringRoute(
  { roles: ['LEARNER', 'INSTRUCTOR'] },
  ({ identity, params, query }) => service.getLibrary(identity, { params, query }),
);
