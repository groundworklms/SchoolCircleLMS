import { requireAnyRole } from '../auth.js';
import { authoringError } from './service.js';

const HEADERS = {
  'Cache-Control': 'private, no-store',
  Vary: 'Authorization',
};
const MAX_BODY_BYTES = 1024 * 1024;

function statusFor(error) {
  if (Number.isInteger(error?.status)) return error.status;
  if (error?.code === 'AUTH_REQUIRED') return 401;
  if (error?.code === 'FORBIDDEN') return 403;
  if (error?.code === 'NOT_FOUND') return 404;
  if (error?.code === 'CONFLICT') return 409;
  if (error?.code === 'PAYLOAD_TOO_LARGE') return 413;
  if (error?.code === 'BAD_REQUEST' || error instanceof TypeError) return 400;
  return 500;
}

function errorResponse(error) {
  const status = statusFor(error);
  const code = error?.code || (status >= 500 ? 'ERROR' : 'BAD_REQUEST');
  const message = status >= 500
    ? 'Authoring service unavailable. Please retry.'
    : (error?.message || 'Request failed');
  // Database diagnostics can contain connection details or submitted content.
  if (status >= 500) console.error('[authoring] Unexpected service failure');
  return Response.json({ error: message, code }, { status, headers: HEADERS });
}

async function parseBody(request, kind) {
  if (kind === 'none' || request.method === 'GET' || request.method === 'HEAD') return {};
  if (kind !== 'json') return {};
  const declared = Number(request.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    throw authoringError('Request body is too large.', 'PAYLOAD_TOO_LARGE');
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    throw authoringError('Request body is too large.', 'PAYLOAD_TOO_LARGE');
  }
  if (!raw.trim()) return {};
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('object expected');
    }
    return body;
  } catch {
    throw authoringError('Invalid JSON body.', 'BAD_REQUEST');
  }
}

function response(result) {
  if (result instanceof Response) return result;
  if (result && Object.hasOwn(result, 'json')) {
    return Response.json(result.json, { status: result.status || 200, headers: HEADERS });
  }
  return Response.json(result ?? {}, { headers: HEADERS });
}

/**
 * Request/response boundary for every manual-authoring route. Service methods
 * remain framework-free, which allows native PostgreSQL and in-memory tests to
 * exercise exactly the same authorization and persistence behavior.
 */
export function authoringRoute({ roles = null, body: bodyKind = 'json' } = {}, run) {
  return async (request, context) => {
    try {
      const identity = roles ? await requireAnyRole(request, roles) : null;
      const params = context?.params ? await context.params : {};
      const query = Object.fromEntries(new URL(request.url).searchParams);
      const body = await parseBody(request, bodyKind);
      return response(await run({ identity, params, query, body, request }));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

/**
 * Manual course mutation endpoints remain addressable so old clients receive a
 * deterministic retirement response. They deliberately skip authentication
 * and the service entirely: a retired request cannot reach a database write.
 */
export function retiredAuthoringRoute(message = 'Manual course authoring is retired. Use AI course authoring.') {
  return async () => Response.json(
    {
      error: message,
      code: 'MANUAL_AUTHORING_RETIRED',
    },
    { status: 410, headers: HEADERS },
  );
}

export { HEADERS as authoringHeaders, errorResponse };
