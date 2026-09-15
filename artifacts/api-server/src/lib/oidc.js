import * as oidc from 'openid-client';
import { db } from './db.js';

const DEFAULT_ISSUER_URL = 'https://replit.com/oidc';

let cachedConfiguration = null;

export class AuthConfigurationError extends Error {
  constructor(message = 'OIDC authentication is not configured') {
    super(message);
    this.name = 'AuthConfigurationError';
    this.code = 'AUTH_NOT_CONFIGURED';
  }
}

export function issuerUrl() {
  return process.env.ISSUER_URL || DEFAULT_ISSUER_URL;
}

export function clientId() {
  const value = process.env.OIDC_CLIENT_ID || process.env.REPL_ID;
  if (typeof value !== 'string' || !value.trim()) {
    throw new AuthConfigurationError('OIDC client configuration is missing');
  }
  return value;
}

/**
 * openid-client v6 discovery is intentionally used here instead of manually
 * constructing provider endpoints.  It verifies the provider metadata and
 * supplies the configuration used by authorizationCodeGrant.
 */
export async function getOidcConfig() {
  const issuer = issuerUrl();
  const id = clientId();
  const cacheKey = `${issuer}\u0000${id}`;

  if (!cachedConfiguration || cachedConfiguration.key !== cacheKey) {
    const promise = oidc
      .discovery(new URL(issuer), id)
      .catch((error) => {
        cachedConfiguration = null;
        throw error;
      });
    cachedConfiguration = { key: cacheKey, promise };
  }
  return cachedConfiguration.promise;
}

export function requestOrigin(req) {
  const forwardedProto = String(req.headers['x-forwarded-proto'] || '')
    .split(',')[0]
    .trim()
    .toLowerCase();
  const protocol = forwardedProto || 'https';
  if (protocol !== 'http' && protocol !== 'https') {
    throw new AuthConfigurationError('The request protocol is unavailable');
  }

  const forwardedHost = String(req.headers['x-forwarded-host'] || '')
    .split(',')[0]
    .trim();
  const rawHost = forwardedHost || String(req.headers.host || '').trim();
  const host = normalizeHost(rawHost);
  if (!host) {
    throw new AuthConfigurationError('The request host is unavailable');
  }

  const allowedHosts = trustedHosts();
  const localDevelopmentHost =
    process.env.NODE_ENV !== 'production' && isLoopbackHost(host);
  if (!allowedHosts.has(host) && !(allowedHosts.size === 0 && localDevelopmentHost)) {
    throw new AuthConfigurationError('The request host is not trusted');
  }
  if (protocol === 'http' && (process.env.NODE_ENV === 'production' || !isLoopbackHost(host))) {
    throw new AuthConfigurationError('Insecure callback origins are not allowed');
  }

  return `${protocol}://${host}`;
}

export function callbackUrl(req) {
  return `${requestOrigin(req)}/api/callback`;
}

function normalizeHost(value) {
  if (typeof value !== 'string' || !value || /[\s\r\n/@]/.test(value)) {
    return null;
  }
  try {
    const parsed = new URL(`https://${value}`);
    if (parsed.pathname !== '/' || parsed.search || parsed.hash) return null;
    return parsed.host.toLowerCase().replace(/\.$/, '');
  } catch {
    return null;
  }
}

function trustedHosts() {
  const values = [
    process.env.AUTH_ALLOWED_HOSTS,
    process.env.AUTH_ALLOWED_ORIGINS,
    process.env.REPLIT_DOMAINS,
    process.env.REPLIT_DEV_DOMAIN,
    process.env.REPLIT_DEPLOYMENT_DOMAIN,
    process.env.APP_ORIGIN,
  ]
    .filter(Boolean)
    .flatMap((value) => String(value).split(','))
    .map((value) => {
      try {
        const host = value.includes('://') ? new URL(value).host : value;
        return normalizeHost(host);
      } catch {
        return null;
      }
    })
    .filter(Boolean);
  return new Set(values);
}

function normalizeOrigin(value) {
  if (typeof value !== 'string' || !value.trim()) return null;
  try {
    const parsed = new URL(value.includes('://') ? value : `https://${value}`);
    if (
      !['http:', 'https:'].includes(parsed.protocol) ||
      parsed.username ||
      parsed.password ||
      parsed.pathname !== '/' ||
      parsed.search ||
      parsed.hash
    ) {
      return null;
    }
    if (parsed.protocol === 'http:' && process.env.NODE_ENV === 'production') {
      return null;
    }
    return parsed.origin;
  } catch {
    return null;
  }
}

function configuredCorsOrigins() {
  return new Set(
    [
      process.env.AUTH_ALLOWED_ORIGINS,
      process.env.WEB_ORIGIN,
      process.env.FRONTEND_ORIGIN,
    ]
      .filter(Boolean)
      .flatMap((value) => String(value).split(','))
      .map(normalizeOrigin)
      .filter(Boolean),
  );
}

/**
 * The CORS package receives only the Origin header, so this callback uses the
 * same explicit deployment allowlist as requestOrigin.  It never reflects an
 * arbitrary credentialed origin.  Requests without an Origin are same-origin
 * or non-browser requests and need no CORS response headers.
 */
export function isTrustedCorsOrigin(origin) {
  const normalized = normalizeOrigin(origin);
  if (!normalized || normalized === 'null') return false;

  const configuredOrigins = configuredCorsOrigins();
  if (configuredOrigins.has(normalized)) return true;

  const host = new URL(normalized).host;
  if (!trustedHosts().has(host)) return false;
  return normalized.startsWith('https://') ||
    (process.env.NODE_ENV !== 'production' && isLoopbackHost(host));
}

export function corsOrigin(origin, callback) {
  if (typeof origin !== 'string' || !origin.trim()) {
    // Same-origin and non-browser requests do not need CORS headers.
    callback(null, false);
    return;
  }
  callback(null, isTrustedCorsOrigin(origin) ? origin : false);
}

function isLoopbackHost(host) {
  try {
    const hostname = new URL(`https://${host}`).hostname;
    return hostname === 'localhost' || hostname === '127.0.0.1' || hostname === '::1';
  } catch {
    return false;
  }
}

/**
 * Cookie-authenticated state-changing requests must prove same-origin.  A
 * bearer session is not a browser cookie and is therefore not subject to this
 * browser CSRF check.
 */
export function sameOriginRequest(req) {
  let expectedOrigin;
  try {
    expectedOrigin = new URL(requestOrigin(req)).origin;
  } catch {
    return false;
  }

  const origin = req.headers.origin;
  if (typeof origin === 'string' && origin.trim()) {
    try {
      return new URL(origin).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  const referer = req.headers.referer;
  if (typeof referer === 'string' && referer.trim()) {
    try {
      return new URL(referer).origin === expectedOrigin;
    } catch {
      return false;
    }
  }

  // Modern fetch/XHR sends Origin for mutating requests.  Rejecting requests
  // with neither header closes the form-post CSRF gap as well.
  return false;
}

export function safeReturnTo(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\r') ||
    value.includes('\n')
  ) {
    return '/';
  }
  return value;
}

function claimString(claims, ...names) {
  for (const name of names) {
    if (typeof claims?.[name] === 'string' && claims[name].trim()) {
      return claims[name].trim();
    }
  }
  return null;
}

export function profileFromClaims(claims) {
  const subject = claimString(claims, 'sub');
  if (!subject) throw new Error('The verified ID token has no subject');

  const firstName = claimString(claims, 'first_name', 'given_name');
  const lastName = claimString(claims, 'last_name', 'family_name');
  const email = claimString(claims, 'email');
  const profileImageUrl = claimString(claims, 'profile_image_url', 'picture');
  const name =
    claimString(claims, 'name') ||
    [firstName, lastName].filter(Boolean).join(' ') ||
    email ||
    `SchoolCircle user ${subject.slice(0, 8)}`;

  return {
    subject,
    name,
    email,
    firstName,
    lastName,
    profileImageUrl,
  };
}

/**
 * OIDC claims are accepted only after authorizationCodeGrant has verified the
 * ID token.  The Prisma row remains authoritative for the role; neither a
 * claim nor a request value is ever used to choose it.
 */
export async function upsertVerifiedUser(profile) {
  const user = await db.user.upsert({
    where: { externalId: profile.subject },
    create: {
      externalId: profile.subject,
      name: profile.name,
    },
    update: {
      name: profile.name,
    },
    select: {
      id: true,
      name: true,
      role: true,
      externalId: true,
    },
  });
  return user;
}

export function oidcClaims(tokens) {
  const claims = tokens?.claims?.();
  if (!claims) throw new Error('The OIDC response has no verified ID token claims');
  return claims;
}

export { oidc };