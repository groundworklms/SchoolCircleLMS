/**
 * Server-side Firebase identity verification.
 *
 * The browser signs in with the Firebase client SDK (lib/firebase.js) and sends
 * its ID token as `Authorization: Bearer <token>`. This module verifies that
 * token with firebase-admin using only the PUBLIC project id -- no service
 * account is read -- and returns the verified profile. Anything that fails
 * verification is anonymous; a verifier failure is never a login.
 */

const FIREBASE_TOKEN_ISSUER = 'https://securetoken.google.com';
const ADMIN_APP_NAME_PREFIX = 'schoolcircle-firebase-';

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || null;
}

/**
 * The project id is public Firebase client configuration (the same value the
 * browser bundle carries). firebase-admin can verify ID-token signatures with
 * Google's public certificates when initialized with only the project id.
 */
export function firebaseProjectId() {
  return firstNonEmpty(
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    process.env.FIREBASE_PROJECT_ID,
  );
}

export function firebaseConfigured() {
  return Boolean(firebaseProjectId());
}

/** User.externalId for a Firebase account: namespaced so it can never collide with LTI/OIDC subjects. */
export function firebaseExternalId(uid, projectId = firebaseProjectId()) {
  if (!projectId || typeof uid !== 'string' || !uid.trim()) return null;
  return `firebase:${projectId}:${uid.trim()}`;
}

let firebaseAuthCache = null;

async function getFirebaseAdminAuth() {
  const projectId = firebaseProjectId();
  if (!projectId) return null;

  if (!firebaseAuthCache || firebaseAuthCache.key !== projectId) {
    const promise = (async () => {
      const [{ getApps, initializeApp }, { getAuth }] = await Promise.all([
        import('firebase-admin/app'),
        import('firebase-admin/auth'),
      ]);
      const appName = `${ADMIN_APP_NAME_PREFIX}${projectId}`;
      const app =
        getApps().find((candidate) => candidate.name === appName) ||
        initializeApp({ projectId }, appName);
      return getAuth(app);
    })().catch((error) => {
      firebaseAuthCache = null;
      throw error;
    });
    firebaseAuthCache = { key: projectId, promise };
  }

  return firebaseAuthCache.promise;
}

function claimString(claims, ...names) {
  for (const name of names) {
    if (typeof claims?.[name] === 'string' && claims[name].trim()) {
      return claims[name].trim();
    }
  }
  return null;
}

/**
 * Verify a bearer Firebase ID token with the Admin SDK. The SDK performs
 * signature, issuer, audience, subject, and expiry checks against the explicit
 * project id; the extra issuer/audience checks here make the trust boundary
 * obvious and fail closed if a verifier ever returns unexpected claims.
 */
export async function verifyFirebaseIdToken(idToken) {
  const projectId = firebaseProjectId();
  if (
    !projectId ||
    typeof idToken !== 'string' ||
    idToken.length < 32 ||
    idToken.length > 16_384 ||
    idToken.split('.').length !== 3
  ) {
    return null;
  }

  try {
    const firebaseAuth = await getFirebaseAdminAuth();
    if (!firebaseAuth) return null;
    const claims = await firebaseAuth.verifyIdToken(idToken);
    const uid = claimString(claims, 'uid', 'sub');
    if (
      !uid ||
      claims.aud !== projectId ||
      claims.iss !== `${FIREBASE_TOKEN_ISSUER}/${projectId}` ||
      claims.sub !== uid
    ) {
      return null;
    }

    const name =
      claimString(claims, 'name') ||
      claimString(claims, 'email') ||
      `Firebase user ${uid.slice(0, 8)}`;
    return {
      uid,
      name,
      email: claimString(claims, 'email'),
      firstName: claimString(claims, 'first_name', 'given_name'),
      lastName: claimString(claims, 'last_name', 'family_name'),
      profileImageUrl: claimString(claims, 'picture'),
    };
  } catch {
    // Invalid, expired, wrongly-audienced, or unverifiable tokens are anonymous.
    return null;
  }
}
