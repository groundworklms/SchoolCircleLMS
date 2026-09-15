const FIREBASE_TOKEN_ISSUER = 'https://securetoken.google.com';
const ADMIN_APP_NAME_PREFIX = 'schoolcircle-firebase-';

function firstNonEmpty(...values) {
  return values.find((value) => typeof value === 'string' && value.trim())?.trim() || null;
}

/**
 * The project id is public Firebase client configuration. No service-account
 * credential is read here: firebase-admin can verify Firebase ID-token
 * signatures using Google's public certificates when initialized with only the
 * explicit project id.
 */
export function firebaseProjectId() {
  return firstNonEmpty(
    process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
    process.env.VITE_FIREBASE_PROJECT_ID,
    process.env.FIREBASE_PROJECT_ID,
  );
}

export function firebaseConfigured() {
  return Boolean(firebaseProjectId());
}

export function firebaseExternalId(uid, projectId = firebaseProjectId()) {
  if (!projectId || typeof uid !== 'string' || !uid.trim()) return null;
  return `firebase:${projectId}:${uid.trim()}`;
}

let firebaseAuthCache = null;

async function getFirebaseAdminAuth() {
  const projectId = firebaseProjectId();
  if (!projectId) return null;
  const cacheKey = projectId;

  if (!firebaseAuthCache || firebaseAuthCache.key !== cacheKey) {
    const promise = (async () => {
      // Keep this import optional so Replit-only deployments remain usable
      // until the Firebase bridge dependency is installed by the package
      // owner. A missing verifier always fails closed.
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
    firebaseAuthCache = { key: cacheKey, promise };
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
 * signature, issuer, audience, subject, and expiry checks against the
 * explicit project id; the additional issuer/audience checks make the trust
 * boundary obvious and fail closed if a verifier ever returns unexpected
 * claims.
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
    // Invalid, expired, incorrectly-audienced, or unverifiable Firebase
    // tokens are anonymous. Never treat verifier failure as a login.
    return null;
  }
}

function publicConfigValue(...names) {
  return firstNonEmpty(...names);
}

/**
 * Firebase web configuration is public by design. This endpoint exposes only
 * NEXT_PUBLIC_/VITE_ client values and never service-account credentials.
 */
export function firebasePublicConfig() {
  const config = {
    apiKey: publicConfigValue(
      process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
      process.env.VITE_FIREBASE_API_KEY,
    ),
    authDomain: publicConfigValue(
      process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
      process.env.VITE_FIREBASE_AUTH_DOMAIN,
    ),
    projectId: publicConfigValue(
      process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      process.env.VITE_FIREBASE_PROJECT_ID,
    ),
    storageBucket: publicConfigValue(
      process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
      process.env.VITE_FIREBASE_STORAGE_BUCKET,
    ),
    messagingSenderId: publicConfigValue(
      process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
      process.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
    ),
    appId: publicConfigValue(
      process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
      process.env.VITE_FIREBASE_APP_ID,
    ),
  };
  return {
    configured: Boolean(config.apiKey && config.authDomain && config.projectId && config.appId),
    config,
  };
}