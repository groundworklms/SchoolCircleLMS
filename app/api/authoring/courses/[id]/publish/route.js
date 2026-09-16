import { authoringRoute } from '../../../../../../lib/authoring/http.js';
import { createAuthoringService } from '../../../../../../lib/authoring/service.js';

export const runtime = 'nodejs';
const service = createAuthoringService();

export const POST = authoringRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, params, body }) => service.publishCourse(identity, { params, body }),
);
