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
import { primeDoctrineSettings } from '../doctrine-settings.js';

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
  'STUDENT_GROUNDING_UNAVAILABLE',
  'STUDENT_GROUNDING_REQUIRED_STAGE_UNAVAILABLE',
  'STUDENT_GROUNDING_SERVICE_ERROR',
]);

const BAD_GATEWAY_CODES = new Set([
  'STUDENT_GROUNDING_UNREACHABLE',
  'STUDENT_GROUNDING_BAD_RESPONSE',
  'STUDENT_GROUNDING_STAGE_ERROR',
]);

function payloadTooLarge(message = 'Request body is too large') {
  const error = new Error(message);
  error.code = 'PAYLOAD_TOO_LARGE';
  error.status = 413;
  return error;
}

/** HTTP status for an adapter/handler error. Mirrors the Express `sendError` table. */
export function errorStatus(error) {
  if (Number.isInteger(error?.status)) return error.status;
  const code = error?.code || 'ERROR';
  if (code === 'BAD_REQUEST' || error instanceof TypeError) return 400;
  if (code === 'AUTH_REQUIRED') return 401;
  if (code === 'FORBIDDEN') return 403;
  if (code === 'NOT_FOUND') return 404;
  if (BAD_GATEWAY_CODES.has(code)) return 502;
  if (UNAVAILABLE_CODES.has(code)) return 503;
  if (code === 'RUBRIC_NOT_APPROVABLE' || code === 'CONFLICT') return 409;
  return 500;
}

export function errorResponse(error) {
  const status = errorStatus(error);
  const code = error?.code || (error instanceof TypeError ? 'BAD_REQUEST' : 'ERROR');
  const studentGroundingFailure =
    typeof code === 'string' && code.startsWith('STUDENT_GROUNDING_');
  if (status >= 500 && code === 'ERROR') console.error('[learning]', error);
  return Response.json(
    {
      error: studentGroundingFailure
        ? 'Grounded tutor service is unavailable. Please try again.'
        : error?.message || 'Request failed',
      code,
      ...(error?.auth ? { auth: error.auth } : {}),
    },
    { status },
  );
}

export function notFound(message) {
  const error = new Error(message || 'Learning record not found');
  error.code = 'NOT_FOUND';
  return error;
}

async function requestText(request, maxBodyBytes) {
  if (!Number.isInteger(maxBodyBytes) || maxBodyBytes < 1) return request.text();
  const declaredLength = Number(request.headers.get('content-length'));
  if (Number.isFinite(declaredLength) && declaredLength > maxBodyBytes) {
    throw payloadTooLarge();
  }
  // Do not wait for Request.text() to buffer an unbounded upload. Content-Length
  // can be absent or dishonest, so enforce the same cap as the stream arrives.
  if (!request.body?.getReader) return request.text();
  const reader = request.body.getReader();
  let bytes = 0;
  const decoder = new TextDecoder();
  let text = '';
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      bytes += value.byteLength;
      if (bytes > maxBodyBytes) {
        await reader.cancel();
        throw payloadTooLarge();
      }
      text += decoder.decode(value, { stream: true });
    }
  } finally {
    reader.releaseLock();
  }
  return text + decoder.decode();
}

async function parseBody(request, kind, { maxBodyBytes } = {}) {
  if (kind === 'none' || request.method === 'GET' || request.method === 'HEAD') return {};
  if (kind === 'form') return request.formData();
  const text = await requestText(request, maxBodyBytes);
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
 * @param {{ roles?: string[] | null, body?: 'json' | 'form' | 'none', maxBodyBytes?: number }} options
 *   `roles` null/undefined = unauthenticated route.
 * @param {(input: { identity, params, query, body, request }) => Promise<any>} run
 *   Returns `{ status?, json }`, `{ status?, body, headers }`, or a Response.
 */
export function learningRoute(options, run) {
  const { roles = null, body: bodyKind = 'json', maxBodyBytes } = options || {};
  return async (request, context) => {
    try {
      // Refresh the operator-chosen provider and doctrine endpoint once per
      // request so the synchronous textProvider()/doctrineProvider() lookups
      // downstream see current settings. Both degrade to the environment on a
      // read failure, so neither can fail the request.
      await Promise.all([primeModelSettings(), primeDoctrineSettings()]);
      const identity = roles ? await requireAnyRole(request, roles) : null;
      const params = context?.params ? await context.params : {};
      const query = Object.fromEntries(new URL(request.url).searchParams);
      const body = await parseBody(request, bodyKind, { maxBodyBytes });
      return toResponse(await run({ identity, params, query, body, request }));
    } catch (error) {
      return errorResponse(error);
    }
  };
}
