/**
 * Browser half of the local operator session.
 *
 * `NEXT_PUBLIC_AUTH_MODE=offline` only decides whether the offline sign-in form
 * is RENDERED. It grants nothing: the server gate is `AUTH_MODE=offline` plus
 * `OFFLINE_AUTH_SECRET`, read only on the server (lib/offline-auth.js), and a
 * browser that sets this flag by itself gets a 404 from the session route and a
 * 401 from every authenticated API call. Both must be set for offline sign-in
 * to work, which is why the flag is safe to bake into the client bundle.
 *
 * The stored session is presented to the rest of the app as a Firebase-user
 * shaped object with a `getIdToken()`, so `authFetch`, `authenticatedFetch` and
 * the profile coordinator work unchanged. That object is CACHED PER TOKEN on
 * purpose: the coordinator compares users by reference to decide which response
 * may publish, so a fresh object on every render would look like a new account
 * on every render.
 */

export const OFFLINE_SESSION_KEY = 'schoolcircle.offline.session';

/** Whether the offline sign-in form should be offered by this bundle. */
export function offlineAuthUiEnabled() {
  return String(process.env.NEXT_PUBLIC_AUTH_MODE || '').trim().toLowerCase() === 'offline';
}

function defaultStorage() {
  try {
    return typeof window !== 'undefined' ? window.localStorage : null;
  } catch {
    // Storage can throw outright when blocked by policy.
    return null;
  }
}

/**
 * Validate a stored/returned session. Pure, so the expiry rule is testable
 * without a browser. An expired or malformed session is simply absent.
 */
export function normalizeOfflineSession(value, { now = Date.now() } = {}) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const token = typeof value.token === 'string' ? value.token.trim() : '';
  if (!token) return null;
  const expiresAt = Date.parse(value.expiresAt);
  // A session with no readable expiry is not trusted to be live.
  if (!Number.isFinite(expiresAt) || expiresAt <= now) return null;
  const user = value.user && typeof value.user === 'object' && !Array.isArray(value.user)
    ? value.user
    : null;
  if (!user || typeof user.id !== 'string' || !user.id) return null;
  return { token, expiresAt: new Date(expiresAt).toISOString(), user };
}

export function readOfflineSession(storage = defaultStorage(), options = {}) {
  if (!offlineAuthUiEnabled() || !storage) return null;
  let raw;
  try {
    raw = storage.getItem(OFFLINE_SESSION_KEY);
  } catch {
    return null;
  }
  if (!raw) return null;
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    parsed = null;
  }
  const session = normalizeOfflineSession(parsed, options);
  // Drop an expired or corrupt entry rather than re-reading it every render.
  if (!session) {
    try {
      storage.removeItem(OFFLINE_SESSION_KEY);
    } catch {
      /* nothing to do */
    }
  }
  return session;
}

export function storeOfflineSession(value, storage = defaultStorage(), options = {}) {
  const session = normalizeOfflineSession(value, options);
  if (!session || !storage) return null;
  try {
    storage.setItem(OFFLINE_SESSION_KEY, JSON.stringify(session));
  } catch {
    // An unwritable store still yields a usable in-memory session.
  }
  return session;
}

export function clearOfflineSession(storage = defaultStorage()) {
  if (!storage) return;
  try {
    storage.removeItem(OFFLINE_SESSION_KEY);
  } catch {
    /* nothing to do */
  }
}

let cachedUser = null;

/**
 * A stable, Firebase-user-shaped view of an offline session. `offline: true` is
 * how the client tells the two session kinds apart; the server never reads it.
 */
export function offlineUserFromSession(session) {
  if (!session?.token) return null;
  if (cachedUser?.__token === session.token) return cachedUser;
  const token = session.token;
  cachedUser = {
    __token: token,
    offline: true,
    uid: session.user?.externalId || session.user?.id || 'offline',
    email: session.user?.email || null,
    displayName: session.user?.name || null,
    emailVerified: false,
    getIdToken: async () => token,
  };
  return cachedUser;
}

/** Test seam: forget the cached user object. */
export function resetOfflineUserCache() {
  cachedUser = null;
}

/** The bearer token for the stored session, or null. */
export function offlineBearerToken(storage = defaultStorage(), options = {}) {
  return readOfflineSession(storage, options)?.token || null;
}

/**
 * Exchange an operator id and passphrase for a session. Rejects with the
 * server's message; the caller stores the result.
 */
export async function requestOfflineSession(subject, passphrase, fetchImpl = fetch) {
  const response = await fetchImpl('/api/auth/offline/session', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subject, passphrase }),
  });
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) {
    const message = response.status === 404
      ? 'Offline sign-in is not enabled on this deployment.'
      : body?.error || 'Offline sign-in failed.';
    const error = new Error(message);
    error.error = message;
    error.status = response.status;
    if (body?.code) error.code = body.code;
    throw error;
  }
  const session = normalizeOfflineSession(body);
  if (!session) {
    const error = new Error('The deployment returned an unusable offline session.');
    error.error = error.message;
    error.status = 503;
    throw error;
  }
  return session;
}
