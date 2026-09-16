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

// A recipient must be able to get rid of a message. Scoped to `identity.id` inside
// the service, so a learner can only ever hide their own row.
export const DELETE = rosterRoute(
  { roles: ['LEARNER', 'INSTRUCTOR'] },
  ({ identity, body }) => service.deleteMessage(identity, { body }),
);