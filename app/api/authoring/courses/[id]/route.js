import { authoringRoute } from '../../../../../lib/authoring/http.js';
import { createAuthoringService } from '../../../../../lib/authoring/service.js';

export const runtime = 'nodejs';
const service = createAuthoringService();

export const GET = authoringRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, params }) => service.getCourse(identity, { params }),
);

export const PATCH = authoringRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, params, body }) => service.saveCourse(identity, { params, body }),
);
