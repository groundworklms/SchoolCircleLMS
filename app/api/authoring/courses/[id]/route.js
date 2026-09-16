import { authoringRoute, retiredAuthoringRoute } from '../../../../../lib/authoring/http.js';
import { createAuthoringService } from '../../../../../lib/authoring/service.js';

export const runtime = 'nodejs';
const service = createAuthoringService();

export const GET = authoringRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, ...input }) => service.getCourse(identity, input),
);

export const PATCH = retiredAuthoringRoute();

// DELETE is cleanup, not a revival of manual authoring: create, save, publish
// and archive stay retired at 410. #78 deliberately preserved records from
// that workflow, which leaves instructors with remnants they had no way to
// clear. A course learners have used is archived rather than removed, so their
// progress and attempts survive.
export const DELETE = authoringRoute(
  { roles: ['INSTRUCTOR'], body: 'none' },
  ({ identity, ...input }) => service.deleteCourse(identity, input),
);
