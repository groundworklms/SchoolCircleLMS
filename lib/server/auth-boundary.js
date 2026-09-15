import { Router } from './router.js';
import { db } from './db.js';
import {
  firebaseConfigured,
  firebaseExternalId,
  firebasePublicConfig,
  verifyFirebaseIdToken,
} from './firebase-auth.js';
import {
  AuthConfigurationError,
  callbackUrl,
  clientId,
  getOidcConfig,
  oidc,
  oidcClaims,
  profileFromClaims,
  requestOrigin,
  safeReturnTo,
  sameOriginRequest,
  upsertVerifiedUser,
} from './oidc.js';
import {
  clearOidcCookies,
  clearSessionCookie,
  createSessionToken,
  getBearerToken,
  getSessionToken,
  requestCookies,
  sessionConfigured,
  setOidcCookie,
  setSessionCookie,
  verifySessionToken,
} from './session.js';

const OIDC_COOKIE_TTL = 10 * 60 * 1000;

function isUsableUser(user) {
  return Boolean(
    user &&
    typeof user.id === 'string' &&
    user.id.length > 0 &&
    typeof user.externalId === 'string' &&
    user.externalId.length > 0
  );
}


export async function resolveSessionUser(session, userClient = db.user) {
  if (!session?.userId || !session?.subject) return null;
  const user = await userClient.findUnique({
    where: { id: session.userId },
    select: { id: true, name: true, role: true, externalId: true },
  });
  return isUsableUser(user) && user.externalId === session.subject ? user : null;
}

export async function resolveFirebaseUser(
  idToken,
  userClient = db.user,
  verifier = verifyFirebaseIdToken,
) {
  const profile = await verifier(idToken);
  if (!profile || typeof profile.uid !== 'string' || !profile.uid.trim()) {
    return null;
  }

  const externalId = firebaseExternalId(profile.uid);
  if (!externalId) return null;
  const user = await userClient.upsert({
    where: { externalId },
    create: {
      externalId,
      name: profile.name,
    },
    update: {
      name: profile.name,
    },
    select: { id: true, name: true, role: true, externalId: true },
  });
  if (!isUsableUser(user) || user.externalId !== externalId) return null;

  // Keep the Prisma role authoritative. Only verified, non-authorization
  // profile fields are copied onto the request user.
  return {
    ...user,
    email: profile.email || null,
    firstName: profile.firstName || null,
    lastName: profile.lastName || null,
    profileImageUrl: profile.profileImageUrl || null,
  };
}

/**
 * Load a signed session and then resolve the user from Prisma.  The session
 * cannot carry a role: role checks later in auth.js always read the current
 * Prisma User row.  Invalid or expired cookies are anonymous and are never
 * promoted to an identity.
 */
export async function authBoundary(req, res, next) {
  req.isAuthenticated = () =>
    isUsableUser(req.user) && typeof req.user.id === 'string';

  const bearerToken = getBearerToken(req);
  const token = getSessionToken(req);
  if (!token) {
    next();
    return;
  }

  const session = verifySessionToken(token);
  if (!session && bearerToken) {
    try {
      const user = await resolveFirebaseUser(bearerToken);
      if (user) {
        req.user = user;
        req.auth = { provider: 'firebase', user };
      }
    } catch {
      // Firebase verifier or Prisma failures remain anonymous. Never turn a
      // failed external token check into a partially trusted identity.
    }
    next();
    return;
  }
  if (!session) {
    if (requestCookies(req).sid === token) clearSessionCookie(res);
    next();
    return;
  }

  const cookieToken = requestCookies(req).sid;
  const isCookieSession =
    typeof cookieToken === 'string' &&
    cookieToken === token &&
    !/^Bearer\s+/i.test(String(req.headers.authorization || ''));
  const mutatingMethod = /^(POST|PUT|PATCH|DELETE)$/i.test(req.method || '');
  if (isCookieSession && mutatingMethod && !sameOriginRequest(req)) {
    res.status(403).json({
      error: 'Cross-origin state-changing requests are not allowed',
      code: 'CSRF_ORIGIN_MISMATCH',
    });
    return;
  }

  try {
    const user = await resolveSessionUser(session);
    if (!user) {
      if (requestCookies(req).sid === token) clearSessionCookie(res);
      next();
      return;
    }

    // `role` is included for server-side callers, but came from Prisma above,
    // never from the session token or a client-controlled header.
    req.user = { ...(session.profile || {}), ...user };
    req.auth = { user: req.user, session };
  } catch {
    // Do not turn a DB failure into an authenticated request.  The downstream
    // identity guard will return its explicit unavailable response.
    if (requestCookies(req).sid === token) clearSessionCookie(res);
  }

  next();
}

function authError(res, status, error, fallback) {
  const code = error?.code || (status >= 500 ? 'AUTH_UNAVAILABLE' : 'AUTH_FAILED');
  res.status(status).json({ error: fallback, code });
}

function redirectToLogin(res) {
  res.redirect('/api/login');
}

export const authRouter = Router();

authRouter.get('/auth/user', (req, res) => {
  if (!req.isAuthenticated()) {
    res.json({ user: null });
    return;
  }

  // Only role from the Prisma-backed request user is returned.  Profile fields
  // originated in the verified ID token and are not authorization inputs.
  res.json({
    user: {
      id: req.user.id,
      name: req.user.name,
      role: req.user.role,
      externalId: req.user.externalId,
      email: req.user.email || null,
      firstName: req.user.firstName || null,
      lastName: req.user.lastName || null,
      profileImageUrl: req.user.profileImageUrl || null,
    },
  });
});

authRouter.get('/auth/firebase-config', (_req, res) => {
  res.json(firebasePublicConfig());
});

authRouter.get('/login', async (req, res) => {
  try {
    const config = await getOidcConfig();
    const redirectUri = callbackUrl(req);
    const state = oidc.randomState();
    const nonce = oidc.randomNonce();
    const codeVerifier = oidc.randomPKCECodeVerifier();
    const codeChallenge = await oidc.calculatePKCECodeChallenge(codeVerifier);
    const authorizationUrl = oidc.buildAuthorizationUrl(config, {
      redirect_uri: redirectUri,
      scope: 'openid email profile offline_access',
      code_challenge: codeChallenge,
      code_challenge_method: 'S256',
      prompt: 'login consent',
      state,
      nonce,
    });

    setOidcCookie(res, 'oidc_code_verifier', codeVerifier, OIDC_COOKIE_TTL);
    setOidcCookie(res, 'oidc_nonce', nonce, OIDC_COOKIE_TTL);
    setOidcCookie(res, 'oidc_state', state, OIDC_COOKIE_TTL);
    setOidcCookie(
      res,
      'oidc_return_to',
      safeReturnTo(req.query.returnTo),
      OIDC_COOKIE_TTL,
    );
    res.redirect(authorizationUrl.href);
  } catch (error) {
    authError(res, error instanceof AuthConfigurationError ? 503 : 502, error, 'Unable to start authentication');
  }
});

// OIDC providers may add query parameters not represented by an API schema.
authRouter.get('/callback', async (req, res) => {
  const cookies = requestCookies(req);
  const codeVerifier = cookies.oidc_code_verifier;
  const nonce = cookies.oidc_nonce;
  const expectedState = cookies.oidc_state;
  const returnTo = safeReturnTo(cookies.oidc_return_to);
  const clearTransaction = () => clearOidcCookies(res);

  if (!codeVerifier || !nonce || !expectedState) {
    clearTransaction();
    redirectToLogin(res);
    return;
  }

  let tokens;
  try {
    const config = await getOidcConfig();
    const currentUrl = new URL(
      `${callbackUrl(req)}?${new URL(req.originalUrl || req.url, requestOrigin(req)).searchParams}`,
    );
    tokens = await oidc.authorizationCodeGrant(config, currentUrl, {
      pkceCodeVerifier: codeVerifier,
      expectedNonce: nonce,
      expectedState,
      idTokenExpected: true,
    });
  } catch {
    clearTransaction();
    redirectToLogin(res);
    return;
  }

  try {
    const profile = profileFromClaims(oidcClaims(tokens));
    const user = await upsertVerifiedUser(profile);
    const sessionToken = createSessionToken({
      userId: user.id,
      subject: user.externalId,
      profile,
    });

    clearTransaction();
    setSessionCookie(res, sessionToken);
    res.redirect(returnTo);
  } catch (error) {
    clearTransaction();
    authError(res, 503, error, 'Unable to create an authenticated session');
  }
});

authRouter.get('/logout', async (req, res) => {
  const returnTo = safeReturnTo(req.query.returnTo);
  clearSessionCookie(res);

  try {
    const config = await getOidcConfig();
    const postLogoutRedirectUri = new URL(returnTo, `${requestOrigin(req)}/`).href;
    const endSessionUrl = oidc.buildEndSessionUrl(config, {
      client_id: clientId(),
      post_logout_redirect_uri: postLogoutRedirectUri,
    });
    res.redirect(endSessionUrl.href);
  } catch {
    // A local session can still be cleared if provider discovery is unavailable.
    // Never leave the browser authenticated because logout discovery failed.
    res.redirect(returnTo);
  }
});

export function authReadiness() {
  const replitConfigured = sessionConfigured() && Boolean(
    process.env.OIDC_CLIENT_ID || process.env.REPL_ID,
  );
  const firebase = firebaseConfigured();
  const configured = replitConfigured || firebase;
  return {
    ready: configured,
    provider: 'replit-oidc',
    acceptsHeaderRoles: false,
    firebase: { configured: firebase },
    ...(configured
      ? {}
      : {
          reason:
            'No verified Replit OIDC or Firebase session provider is configured; authenticated routes remain closed.',
        }),
  };
}