import { requireAnyRole } from '../auth.js';

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
  return Response.json(
    {
      error: status >= 500 ? 'Roster service unavailable. Please retry.' : (error?.message || 'Request failed'),
      code,
      ...(error?.auth ? { auth: error.auth } : {}),
    },
    { status, headers: HEADERS },
  );
}

async function parseBody(request) {
  if (request.method === 'GET' || request.method === 'HEAD') return {};
  const declared = Number(request.headers?.get?.('content-length'));
  if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
    const error = new Error('Request body is too large.');
    error.code = 'PAYLOAD_TOO_LARGE';
    throw error;
  }
  const raw = await request.text();
  if (new TextEncoder().encode(raw).byteLength > MAX_BODY_BYTES) {
    const error = new Error('Request body is too large.');
    error.code = 'PAYLOAD_TOO_LARGE';
    throw error;
  }
  if (!raw.trim()) return {};
  try {
    const body = JSON.parse(raw);
    if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error('object expected');
    return body;
  } catch {
    const error = new Error('Invalid JSON body.');
    error.code = 'BAD_REQUEST';
    throw error;
  }
}

function response(result) {
  if (result instanceof Response) return result;
  return Response.json(result?.json ?? result ?? {}, {
    status: result?.status || 200,
    headers: HEADERS,
  });
}

export function rosterRoute({ roles = null } = {}, run) {
  return async (request, context) => {
    try {
      const identity = roles ? await requireAnyRole(request, roles) : null;
      const params = context?.params ? await context.params : {};
      const body = await parseBody(request);
      return response(await run({ identity, params, body, request }));
    } catch (error) {
      return errorResponse(error);
    }
  };
}

export { errorResponse, statusFor };