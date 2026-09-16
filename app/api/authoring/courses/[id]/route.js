import { authoringRoute, retiredAuthoringRoute } from '../../../../../lib/authoring/http.js';
import { createAuthoringService } from '../../../../../lib/authoring/service.js';

export const runtime = 'nodejs';
const service = createAuthoringService();

export const GET = authoringRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, params }) => service.getCourse(identity, { params }),
);

export const PATCH = retiredAuthoringRoute();
