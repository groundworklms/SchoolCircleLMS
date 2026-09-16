/**
 * Route-handler plumbing for app/api/learning/** (Next.js App Router).
 *
 * Every learning route is `learningRoute({ roles, body }, run)`: identity is
 * resolved from the bearer token (lib/auth.js), the request is parsed once,
 * `run` returns a plain result, and every thrown error is mapped to the shared
 * status/code contract (docs/learning-api.md "Error contract"). Handlers in
 * ./core.js and ./evidence.js therefore know nothing about Request/Response
 * and can be exercised directly by tests.
 */
import { requireAnyRole } from '../auth.js';
import { primeModelSettings } from '../model-settings.js';

const UNAVAILABLE_CODES = new Set([
  'NO_PROVIDER',
  'MODEL_UNAVAILABLE',
  'MODEL_BAD_RESPONSE',
  'NO_RUBRICON',
  'RUBRICON_UNAVAILABLE',
  'NO_WHETSTONE',
  'WHETSTONE_UNAVAILABLE',
  'ARSENAL_UNAVAILABLE',
  'NO_DOCTRINE_SERVICE',
  'AUTH_UNAVAILABLE',
]);

/** HTTP status for an adapter/handler error. Mirrors the Express `sendError` table. */
export function errorStatus(error) {
  if (Number.isInteger(error?.status)) return error.status;
  const code = error?.code || 'ERROR';
  if (code === 'BAD_REQUEST' || error instanceof TypeError) return 400;
  if (code === 'AUTH_REQUIRED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'NOT_FOUND') return 404;
  if (UNAVAILABLE_CODES.has(code)) return 503;
  if (code === 'RUBRIC_NOT_APPROVABLE' || code === 'CONFLICT') return 409;
  return 500;
}

export function errorResponse(error) {
  const status = errorStatus(error);
  const code = error?.code || (error instanceof TypeError ? 'BAD_REQUEST' : 'ERROR');
  if (status >= 500 && code === 'ERROR') console.error('[learning]', error);
  return Response.json(
    {
      error: error?.message || 'Request failed',
      code,
      ...(error?.auth ? { auth: error.auth } : {}),
      // Grounding failures carry the validator's own issue list. Passing it
      // through lets the review screen point at the sections that need work
      // instead of showing one long concatenated sentence.
      ...(error?.validation ? { validation: error.validation } : {}),
    },
    { status },
  );
}

export function notFound(message) {
  const error = new Error(message || 'Learning record not found');
  error.code = 'NOT_FOUND';
  return error;
}

async function parseBody(request, kind) {
  if (kind === 'none' || request.method === 'GET' || request.method === 'HEAD') return {};
  if (kind === 'form') return request.formData();
  const text = await request.text();
  if (!text.trim()) return {};
  try {
    const parsed = JSON.parse(text);
    return parsed && typeof parsed === 'object' ? parsed : {};
  } catch {
    const error = new Error('Invalid JSON body');
    error.code = 'BAD_REQUEST';
    throw error;
  }
}

function toResponse(result) {
  if (result instanceof Response) return result;
  const status = result?.status || 200;
  if (result && 'json' in result) return Response.json(result.json, { status });
  return new Response(result?.body ?? null, { status, headers: result?.headers || {} });
}

/**
 * @param {{ roles?: string[] | null, body?: 'json' | 'form' | 'none' }} options
 *   `roles` null/undefined = unauthenticated route.
 * @param {(input: { identity, params, query, body, request }) => Promise<any>} run
 *   Returns `{ status?, json }`, `{ status?, body, headers }`, or a Response.
 */
export function learningRoute(options, run) {
  const { roles = null, body: bodyKind = 'json' } = options || {};
  return async (request, context) => {
    try {
      // Refresh the operator-chosen provider once per request so the
      // synchronous textProvider() lookups downstream see current settings.
      await primeModelSettings();
      const identity = roles ? await requireAnyRole(request, roles) : null;
      const params = context?.params ? await context.params : {};
      const query = Object.fromEntries(new URL(request.url).searchParams);
      const body = await parseBody(request, bodyKind);
      return toResponse(await run({ identity, params, query, body, request }));
    } catch (error) {
      return errorResponse(error);
    }
  };
}
