/**
 * Server-side identity for the learning API (app/api/learning/**, app/api/auth/user).
 *
 * The only accepted credential is a Firebase ID token sent as
 * `Authorization: Bearer <token>` (lib/firebase.js `authFetch` adds it). The
 * token is verified by firebase-admin (lib/firebase-auth.js); the verified uid
 * is mapped to a Prisma `User` row through `externalId`, and the ROLE ALWAYS
 * COMES FROM THAT ROW. There is no fallback to an x-user / x-role header, a
 * query value, or a body field, and a client can never assert its own role.
 *
 * Unconfigured Firebase (no NEXT_PUBLIC_FIREBASE_PROJECT_ID) means no identity
 * can be verified, so authenticated routes fail closed with 401 -- the rest of
 * the app (prototype, /api/doctrine, /api/courses ...) is unaffected and stays
 * open, exactly as before.
 */
import { db } from './db.js';
import {
  firebaseConfigured,
  firebaseExternalId,
  verifyFirebaseIdToken,
} from './firebase-auth.js';

const USER_SELECT = {
  id: true,
  name: true,
  rank: true,
  branch: true,
  payGrade: true,
  profileCompletedAt: true,
  role: true,
  externalId: true,
};

function isUsableUser(user) {
  return Boolean(
    user &&
      typeof user.id === 'string' &&
      user.id.length > 0 &&
      typeof user.externalId === 'string' &&
      user.externalId.length > 0,
  );
}

function authError(message, code, status) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function getBearerToken(request) {
  const authorization = request?.headers?.get?.('authorization');
  if (typeof authorization !== 'string') return null;
  const match = authorization.match(/^Bearer\s+(\S+)$/i);
  return match?.[1] || null;
}

/**
 * Verify a Firebase ID token and upsert its user. Returns the Prisma-backed
 * identity (role from the database) plus non-authorization profile fields, or
 * null. `userClient` / `verifier` are test seams only.
 */
export async function resolveFirebaseUser(
  idToken,
  userClient = db.user,
  verifier = verifyFirebaseIdToken,
) {
  const profile = await verifier(idToken);
  if (!profile || typeof profile.uid !== 'string' || !profile.uid.trim()) return null;

  const externalId = firebaseExternalId(profile.uid);
  if (!externalId) return null;
  const user = await userClient.upsert({
    where: { externalId },
    create: { externalId, name: profile.name },
    // Provider names seed new accounts only; persisted account choices win.
    update: {},
    select: USER_SELECT,
  });
  if (!isUsableUser(user) || user.externalId !== externalId) return null;

  // Keep the Prisma role authoritative. Only verified, non-authorization
  // profile fields are copied onto the identity.
  return {
    ...user,
    email: profile.email || null,
    firstName: profile.firstName || null,
    lastName: profile.lastName || null,
    profileImageUrl: profile.profileImageUrl || null,
  };
}

/**
 * Identity for a Next.js Request, or null when anonymous. Throws only when the
 * identity boundary itself is unavailable (database / verifier failure), so a
 * DB outage never turns into an anonymous -- or authenticated -- request.
 */
export async function resolveIdentity(request) {
  const token = getBearerToken(request);
  if (!token) return null;
  try {
    return await resolveFirebaseUser(token);
  } catch (cause) {
    const error = authError('Identity service unavailable', 'AUTH_UNAVAILABLE', 503);
    error.cause = cause;
    throw error;
  }
}

export async function requireIdentity(request) {
  const identity = await resolveIdentity(request);
  if (!identity) {
    const error = authError('Authentication required', 'AUTH_REQUIRED', 401);
    error.auth = authReadiness();
    throw error;
  }
  return identity;
}

/**
 * Return whether a persisted role grants one of the requested capabilities.
 *
 * BOTH is deliberately a capability union rather than a third, unrelated
 * authorization bucket: it can enter routes guarded for either LEARNER or
 * INSTRUCTOR. The caller's role is always the Prisma-backed value returned by
 * resolveFirebaseUser; this helper never reads a token claim or request data.
 */
export function hasRole(role, requiredRole) {
  const actual = String(role || '').toUpperCase();
  const required = String(requiredRole || '').toUpperCase();
  if (!actual || !required) return false;
  return actual === required || (actual === 'BOTH' && (required === 'LEARNER' || required === 'INSTRUCTOR'));
}

/** Identity restricted to one of `roles` (Prisma Role enum values). */
export async function requireAnyRole(request, roles) {
  const identity = await requireIdentity(request);
  const expected = new Set((roles || []).map((role) => String(role).toUpperCase()));
  if (![...expected].some((role) => hasRole(identity.role, role))) {
    throw authError(
      expected.size === 1
        ? `${[...expected][0].toLowerCase()} role required`
        : 'An authorized learning role is required',
      'FORBIDDEN',
      403,
    );
  }
  return identity;
}

export function authReadiness() {
  const firebase = firebaseConfigured();
  return {
    ready: firebase,
    provider: 'firebase',
    acceptsHeaderRoles: false,
    firebase: { configured: firebase },
    ...(firebase
      ? {}
      : {
          reason:
            'Firebase Authentication is not configured on this deployment (NEXT_PUBLIC_FIREBASE_*); authenticated learning routes remain closed.',
        }),
  };
}
