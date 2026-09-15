import { dispatchRequest } from '../../../lib/server/router.js';
import { authBoundary, registry } from '../../../lib/server/integration.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const maxDuration = 120;

async function handle(request) {
  return dispatchRequest(request, registry, {
    prefix: '/api',
    middleware: [authBoundary],
  });
}

export const GET = handle;
export const POST = handle;
export const PUT = handle;
export const PATCH = handle;
export const DELETE = handle;
export const OPTIONS = handle;