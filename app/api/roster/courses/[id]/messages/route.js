import { createRosterService } from '../../../../../../lib/roster/service.js';
import { rosterRoute } from '../../../../../../lib/roster/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const service = createRosterService();

export const POST = rosterRoute(
  { roles: ['INSTRUCTOR'] },
  ({ identity, params, body }) => service.sendMessages(identity, { params, body }),
);