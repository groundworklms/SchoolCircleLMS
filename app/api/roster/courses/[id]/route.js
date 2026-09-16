import { createRosterService } from '../../../../../lib/roster/service.js';
import { rosterRoute } from '../../../../../lib/roster/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const service = createRosterService();

export const GET = rosterRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, params }) => service.getStudents(identity, { params }),
);

export const POST = rosterRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, params, body }) => service.addStudents(identity, { params, body }),
);

export const PATCH = rosterRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, params, body }) => service.updateStudents(identity, { params, body }),
);