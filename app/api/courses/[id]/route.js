import { dispatchRequest } from '../../../../lib/server/router.js';
import { authBoundary, registry } from '../../../../lib/server/integration.js';

// Keep this native Next entry point on the same verified identity boundary as
// the rest of /api. The route registry owns the role-aware course projection;
// this adapter must not query Prisma directly and accidentally bypass it.
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(request) {
  return dispatchRequest(request, registry, {
    prefix: '/api',
    middleware: [authBoundary],
  });
}
