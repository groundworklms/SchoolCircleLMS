/**
 * Server-side identity for learning and generated course delivery APIs
 * (app/api/learning/**, app/api/auth/user, app/api/courses/**).
 *
 * The only accepted credential is a Firebase ID token sent as
 * `Authorization: Bearer <token>` (lib/firebase.js `authFetch` adds it). The
 * token is verified by firebase-admin (lib/firebase-auth.js); the verified uid
 * is mapped to a Prisma `User` row through `externalId`, and the ROLE ALWAYS
 * COMES FROM THAT ROW. There is no fallback to an x-user / x-role header, a
 * query value, or a body field, and a client can never assert its own role.
 *
 * Unconfigured Firebase (no NEXT_PUBLIC_FIREBASE_PROJECT_ID) means no identity
 * can be verified, so authenticated routes fail closed with 401. Public
 * capability/health reads remain intentionally separate; course delivery and
 * learning routes require this verified identity boundary.
 *
 * A deployment that has deliberately set `AUTH_MODE=offline` and supplied a
 * local signing secret additionally accepts a locally-signed operator session
 * (lib/offline-auth.js) as a SECOND, PEER credential. It is not a fallback: the
 * two token shapes are disjoint (an offline token has four dot-separated
 * segments, a Firebase ID token three), so neither path can ever be reached by
 * a credential intended for the other, and a Firebase token that fails to
 * verify is still anonymous. With `AUTH_MODE` unset nothing below changes.
 */
import { db } from './db.js';
import {
  firebaseConfigured,
  firebaseExternalId,
  verifyFirebaseIdToken,
} from './firebase-auth.js';
import {
  findOfflineOperator,
  isOfflineSessionToken,
  offlineAuthEnabled,
  offlineAuthReadiness,
  offlineExternalId,
  verifyOfflineSessionToken,
} from './offline-auth.js';

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
    emailVerified: profile.emailVerified === true,
    firstName: profile.firstName || null,
    lastName: profile.lastName || null,
    profileImageUrl: profile.profileImageUrl || null,
  };
}

/**
 * Verify a locally-signed operator session and upsert its user. Mirrors
 * `resolveFirebaseUser` deliberately, including the rule that matters most:
 * THE ROLE ALWAYS COMES FROM THE PRISMA ROW. The token carries no role, and the
 * roster's `role` seeds a brand-new account only (`update: {}`), exactly as the
 * Firebase path seeds `name` -- so configuration can create an offline
 * instructor but can never promote an account that already exists.
 *
 * Returns null unless offline mode is actually enabled, so this is inert on a
 * deployment that has not opted in even if a token somehow arrives.
 * `userClient` / `verifier` are test seams only.
 */
export async function resolveOfflineUser(
  token,
  userClient = db.user,
  verifier = verifyOfflineSessionToken,
) {
  if (!offlineAuthEnabled()) return null;
  const session = await verifier(token);
  if (!session || typeof session.subject !== 'string' || !session.subject.trim()) return null;

  const externalId = offlineExternalId(session.subject, session.realm);
  if (!externalId) return null;

  const operator = findOfflineOperator(session.subject);
  const user = await userClient.upsert({
    where: { externalId },
    create: {
      externalId,
      name: operator?.name || `Offline operator ${session.subject}`,
      // Seeds a new row only; see above.
      ...(operator?.role ? { role: operator.role } : {}),
    },
    update: {},
    select: USER_SELECT,
  });
  if (!isUsableUser(user) || user.externalId !== externalId) return null;

  // Same contract as the Firebase identity: non-authorization profile fields
  // only, and never a role from anywhere but the row above.
  return {
    ...user,
    email: operator?.email || null,
    // Nothing verified an offline operator's email address, so it is never
    // presented as verified.
    emailVerified: false,
    firstName: null,
    lastName: null,
    profileImageUrl: null,
    offline: true,
    offlineSubject: session.subject,
    sessionExpiresAt: session.expiresAt,
  };
}

/**
 * Identity for a Next.js Request, or null when anonymous. Throws only when the
 * identity boundary itself is unavailable (database / verifier failure), so a
 * DB outage never turns into an anonymous -- or authenticated -- request.
 *
 * `userClient` is a test seam only, in the same default-argument style as
 * `resolveFirebaseUser` above; every production caller passes one argument and
 * gets the real Prisma client.
 */
export async function resolveIdentity(request, userClient = db.user) {
  const token = getBearerToken(request);
  if (!token) return null;
  try {
    // Disjoint token shapes, checked before anything else touches them: an
    // offline session never reaches the Firebase verifier and a Firebase ID
    // token never reaches the offline one. When AUTH_MODE is unset the guard is
    // false and this is the original single-line body.
    if (offlineAuthEnabled() && isOfflineSessionToken(token)) {
      return await resolveOfflineUser(token, userClient);
    }
    return await resolveFirebaseUser(token, userClient);
  } catch (cause) {
    const error = authError('Identity service unavailable', 'AUTH_UNAVAILABLE', 503);
    error.cause = cause;
    throw error;
  }
}

export async function requireIdentity(request, userClient = db.user) {
  const identity = await resolveIdentity(request, userClient);
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

/**
 * The same verified account, judged as a learner.
 *
 * "View as student" is the control an instructor uses to check the product's
 * central promise — that nothing unreviewed reaches a student — so the preview
 * has to be answered the way a learner would be answered. It is the one caller
 * for whom that differs: the course visibility rule (canViewCourse) also
 * admits a course the caller owns, whatever its status, which made the preview
 * show an instructor their own unpublished drafts sitting next to published
 * ones and call them available.
 *
 * Dropping the instructor capability for the length of one request can only
 * ever narrow what comes back; there is no course, record or field this makes
 * reachable that the account could not already reach. That is why it is safe
 * to let the client ask for it (learningRoute), and why nothing here weakens
 * the instructor surfaces — they simply never ask.
 *
 * The identity keeps its id, so the caller's own learner evidence — attempts,
 * progress, tutor history — still resolves to them.
 */
export function learnerScopedIdentity(identity) {
  if (!identity || !hasRole(identity.role, 'INSTRUCTOR')) return identity;
  return { ...identity, role: 'LEARNER', learnerScoped: true };
}

/**
 * Identity restricted to one of `roles` (Prisma Role enum values).
 * `userClient` is a test seam only; lib/learning/http.js passes two arguments.
 */
export async function requireAnyRole(request, roles, userClient = db.user) {
  const identity = await requireIdentity(request, userClient);
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

/**
 * Readiness of the identity boundary.
 *
 * With `AUTH_MODE` unset this returns exactly the object it always has --
 * `offline` is absent, `provider` is 'firebase', and the Firebase-only reason
 * still appears -- so no caller or response body changes on a hosted
 * deployment. Only an opted-in offline deployment sees the extra key.
 */
export function authReadiness() {
  const firebase = firebaseConfigured();
  const offline = offlineAuthReadiness();
  const ready = firebase || offline.enabled;
  return {
    ready,
    provider: offline.enabled && !firebase ? 'offline' : 'firebase',
    acceptsHeaderRoles: false,
    firebase: { configured: firebase },
    ...(offline.enabled ? { offline } : {}),
    ...(ready
      ? {}
      : {
          reason:
            'Firebase Authentication is not configured on this deployment (NEXT_PUBLIC_FIREBASE_*); authenticated learning routes remain closed.',
        }),
  };
}
