/**
 * /api/auth/offline/session -- exchange a local operator passphrase for a
 * locally-signed session, for a deployment running with the network pulled.
 *
 * This route DOES NOT EXIST unless the deployment opted in with
 * `AUTH_MODE=offline` plus a usable `OFFLINE_AUTH_SECRET`: without that it
 * answers 404 for every method, with the same body a missing route would
 * produce. That is deliberate -- on the hosted deployment there is nothing here
 * to probe, and no response that distinguishes "turned off" from "not built".
 *
 * The minted token is verified with no network call (lib/offline-auth.js) and
 * maps to a real Prisma `User` row, so `identity.id` / `identity.role` and every
 * ownership check downstream behave exactly as they do for a Firebase session.
 * The role is the row's, never the roster's, for an account that already exists.
 */
import {
  authenticateOfflineOperator,
  clearOfflineLoginFailures,
  offlineAuthEnabled,
  offlineLoginThrottle,
  offlineSessionHours,
  recordOfflineLoginFailure,
  signOfflineSession,
} from '../../../../../lib/offline-auth.js';
import { resolveOfflineUser } from '../../../../../lib/auth.js';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const headers = { 'Cache-Control': 'private, no-store' };

/** Byte-for-byte what Next.js serves for an unknown API path shape. */
function notFound() {
  return Response.json({ error: 'Not found', code: 'NOT_FOUND' }, { status: 404, headers });
}

/**
 * Readiness probe so the login screen can show the offline form only when the
 * server will actually honour it. Reports no operator names: a subject is half
 * a credential and this read is unauthenticated.
 */
export async function GET() {
  if (!offlineAuthEnabled()) return notFound();
  return Response.json(
    { enabled: true, sessionHours: offlineSessionHours() },
    { headers },
  );
}

export async function POST(request) {
  if (!offlineAuthEnabled()) return notFound();

  let body;
  try {
    body = await request.json();
  } catch {
    return Response.json({ error: 'A JSON body is required.', code: 'BAD_REQUEST' }, { status: 400, headers });
  }

  const subject = typeof body?.subject === 'string' ? body.subject.trim() : '';
  const passphrase = typeof body?.passphrase === 'string' ? body.passphrase : '';
  if (!subject || !passphrase) {
    return Response.json(
      { error: 'An operator id and passphrase are required.', code: 'BAD_REQUEST' },
      { status: 400, headers },
    );
  }

  const throttle = offlineLoginThrottle(subject);
  if (!throttle.allowed) {
    return Response.json(
      { error: 'Too many sign-in attempts. Wait a moment and try again.', code: 'TOO_MANY_REQUESTS' },
      { status: 429, headers: { ...headers, 'Retry-After': String(throttle.retryAfterSeconds) } },
    );
  }

  const operator = authenticateOfflineOperator(subject, passphrase);
  if (!operator) {
    recordOfflineLoginFailure(subject);
    // One message for an unknown operator and a wrong passphrase alike.
    return Response.json(
      { error: 'That operator id and passphrase were not accepted.', code: 'AUTH_REQUIRED' },
      { status: 401, headers },
    );
  }

  const session = signOfflineSession(operator.subject);
  if (!session) {
    return Response.json(
      { error: 'Local operator sessions are not configured on this deployment.', code: 'AUTH_UNAVAILABLE' },
      { status: 503, headers },
    );
  }

  let user;
  try {
    // Resolve through the same path an API request takes, so a session is only
    // ever handed out when it already maps to a usable User row.
    user = await resolveOfflineUser(session.token);
  } catch {
    return Response.json(
      { error: 'Identity service unavailable', code: 'AUTH_UNAVAILABLE' },
      { status: 503, headers },
    );
  }
  if (!user) {
    return Response.json(
      { error: 'Identity service unavailable', code: 'AUTH_UNAVAILABLE' },
      { status: 503, headers },
    );
  }

  clearOfflineLoginFailures(subject);
  return Response.json(
    {
      token: session.token,
      expiresAt: new Date(session.expiresAt).toISOString(),
      user: {
        id: user.id,
        name: user.name,
        rank: user.rank || null,
        branch: user.branch || null,
        payGrade: user.payGrade || null,
        profileCompletedAt: user.profileCompletedAt || null,
        role: user.role,
        externalId: user.externalId,
        email: user.email || null,
        offline: true,
      },
    },
    { headers },
  );
}
