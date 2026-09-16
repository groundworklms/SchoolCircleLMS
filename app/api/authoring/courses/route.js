import { authoringRoute, retiredAuthoringRoute } from '../../../../lib/authoring/http.js';
import { createAuthoringService } from '../../../../lib/authoring/service.js';

export const runtime = 'nodejs';
const service = createAuthoringService();

export const GET = authoringRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity }) => service.listCourses(identity),
);

export const POST = retiredAuthoringRoute();
