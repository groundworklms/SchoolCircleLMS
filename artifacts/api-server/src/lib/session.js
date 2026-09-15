import crypto from 'node:crypto';

/**
 * The browser only receives an authenticated session value.  The session
 * contains the database user id and the OIDC subject, never a role supplied by
 * the browser. Keeping this value stateless avoids introducing a second
 * session database alongside the Prisma/Postgres boundary.
 *
 * Security limitation: clearing a stateless cookie cannot revoke a previously
 * copied bearer token. Such tokens remain valid until their seven-day expiry;
 * a downstream security task should replace this with a Prisma-backed,
 * revocable session table before enabling long-lived mobile bearer sessions.
 */
export const SESSION_COOKIE = 'sid';
export const SESSION_TTL = 7 * 24 * 60 * 60 * 1000;

function secret() {
  const value = process.env.SESSION_SECRET;
  return typeof value === 'string' && value.length > 0 ? value : null;
}

function key() {
  const value = secret();
  if (!value) {
    throw new Error('SESSION_SECRET is not configured');
  }
  return crypto.createHash('sha256').update(value, 'utf8').digest();
}

function encode(value) {
  return Buffer.from(value, 'utf8').toString('base64url');
}

function decode(value) {
  return Buffer.from(value, 'base64url').toString('utf8');
}

function signature(payload) {
  return crypto.createHmac('sha256', key()).update(payload, 'ascii').digest('base64url');
}

function safeString(value) {
  return typeof value === 'string' && value.length > 0 ? value : null;
}

/**
 * Create a signed session token.  The signature prevents a client from
 * changing the subject or user id; the role is deliberately not represented
 * here and is loaded from Prisma on every request.
 */
export function createSessionToken({ userId, subject, profile = {} }) {
  if (!safeString(userId) || !safeString(subject)) {
    throw new TypeError('A database user id and OIDC subject are required');
  }

  const now = Date.now();
  const payload = encode(
    JSON.stringify({
      v: 1,
      jti: crypto.randomBytes(24).toString('base64url'),
      userId,
      subject,
      profile: {
        email: safeString(profile.email),
        firstName: safeString(profile.firstName),
        lastName: safeString(profile.lastName),
        profileImageUrl: safeString(profile.profileImageUrl),
      },
      iat: now,
      exp: now + SESSION_TTL,
    }),
  );
  return `v1.${payload}.${signature(payload)}`;
}

/**
 * Verify an opaque session token without trusting anything from its payload
 * until its HMAC has been checked.
 */
export function verifySessionToken(token) {
  if (typeof token !== 'string') return null;

  const parts = token.split('.');
  if (parts.length !== 3 || parts[0] !== 'v1') return null;

  const [version, payload, providedSignature] = parts;
  void version;

  let expectedSignature;
  try {
    expectedSignature = signature(payload);
  } catch {
    return null;
  }

  const provided = Buffer.from(providedSignature, 'base64url');
  const expected = Buffer.from(expectedSignature, 'base64url');
  if (
    provided.length !== expected.length ||
    !crypto.timingSafeEqual(provided, expected)
  ) {
    return null;
  }

  try {
    const data = JSON.parse(decode(payload));
    if (
      !data ||
      data.v !== 1 ||
      !safeString(data.jti) ||
      !safeString(data.userId) ||
      !safeString(data.subject) ||
      !Number.isFinite(data.exp) ||
      data.exp <= Date.now() ||
      data.iat > Date.now() + 60_000
    ) {
      return null;
    }
    return {
      userId: data.userId,
      subject: data.subject,
      profile: data.profile && typeof data.profile === 'object' ? data.profile : {},
      iat: data.iat,
      exp: data.exp,
    };
  } catch {
    return null;
  }
}

function parseCookieHeader(header) {
  if (typeof header !== 'string' || !header) return {};

  const cookies = {};
  for (const pair of header.split(';')) {
    const separator = pair.indexOf('=');
    if (separator < 0) continue;
    const name = pair.slice(0, separator).trim();
    if (!name) continue;
    const rawValue = pair.slice(separator + 1).trim();
    try {
      cookies[name] = decodeURIComponent(rawValue);
    } catch {
      // Ignore malformed cookie values; they are treated as anonymous.
    }
  }
  return cookies;
}

export function requestCookies(req) {
  if (req?.cookies && typeof req.cookies === 'object') {
    return req.cookies;
  }
  return parseCookieHeader(req?.headers?.cookie);
}

export function getSessionToken(req) {
  const authorization = req?.headers?.authorization;
  if (typeof authorization === 'string') {
    const match = authorization.match(/^Bearer\s+(\S+)$/i);
    if (match) return match[1];
  }
  return requestCookies(req)[SESSION_COOKIE];
}

export function setSessionCookie(res, token) {
  res.cookie(SESSION_COOKIE, token, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge: SESSION_TTL,
  });
}

export function clearSessionCookie(res) {
  res.clearCookie(SESSION_COOKIE, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
  });
}

export function setOidcCookie(res, name, value, maxAge = 10 * 60 * 1000) {
  res.cookie(name, value, {
    httpOnly: true,
    secure: true,
    sameSite: 'lax',
    path: '/',
    maxAge,
  });
}

export function clearOidcCookies(res) {
  for (const name of [
    'oidc_code_verifier',
    'oidc_nonce',
    'oidc_state',
    'oidc_return_to',
  ]) {
    res.clearCookie(name, {
      httpOnly: true,
      secure: true,
      sameSite: 'lax',
      path: '/',
    });
  }
}

export function sessionConfigured() {
  return Boolean(secret());
}