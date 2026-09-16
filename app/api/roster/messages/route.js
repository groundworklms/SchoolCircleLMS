import { createRosterService } from '../../../../lib/roster/service.js';
import { rosterRoute } from '../../../../lib/roster/http.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const service = createRosterService();

export const GET = rosterRoute(
  { roles: ['LEARNER', 'INSTRUCTOR'] },
  ({ identity }) => service.listMessages(identity),
);

export const PATCH = rosterRoute(
  { roles: ['LEARNER', 'INSTRUCTOR'] },
  ({ identity, body }) => service.markMessageRead(identity, { body }),
);