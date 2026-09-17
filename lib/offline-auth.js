/**
 * Local operator sessions for a network-pulled deployment.
 *
 * WHY THIS EXISTS
 * ---------------
 * The hosted product authenticates with Firebase (lib/firebase-auth.js): the
 * browser signs in against Google's identity endpoints and the server verifies
 * the resulting ID token against Google's public certificates. Both halves need
 * the network, and an ID token expires in about an hour. With the uplink pulled
 * nobody can sign in and every live session dies inside the hour, which is the
 * single remaining blocker to running SchoolCircle disconnected.
 *
 * This module mints and verifies a session that is signed and checked entirely
 * on the local machine. It is NOT a second way into the hosted deployment: it
 * only exists when an operator has deliberately turned it on with `AUTH_MODE`
 * and supplied a local signing secret, and it is a peer of the Firebase path,
 * never a fallback for it. A Firebase token that fails to verify is still
 * anonymous; nothing here makes it a login.
 *
 * SIGNING SCHEME
 * --------------
 *   token = "scoffline" "." "v1" "." base64url(payload JSON) "." base64url(mac)
 *   mac   = HMAC-SHA256(key, "scoffline.v1." + base64url(payload JSON))
 *   key   = scrypt(OFFLINE_AUTH_SECRET, "schoolcircle/offline-auth/v1", 32)
 *
 * The MAC covers the literal base64url payload text rather than a re-serialized
 * object, so there is no canonicalization gap between what was signed and what
 * is checked. Symmetric HMAC is the right primitive here because the only party
 * that mints and the only party that verifies are the same process on the same
 * box; an asymmetric scheme would add a keypair to manage and buy nothing.
 *
 * The token deliberately carries FOUR dot-separated segments. A Firebase ID
 * token always has three, and `verifyFirebaseIdToken` rejects anything else
 * outright, so an offline token can never be mistaken for a Firebase one even
 * if the two paths were somehow reached in the wrong order.
 *
 * WHAT IS *NOT* IN THE TOKEN
 * --------------------------
 * No role, and no display name. The payload carries a subject and a realm and
 * nothing else that matters. Authorization always comes from the Prisma `User`
 * row that the subject maps to (lib/auth.js `resolveOfflineUser`), exactly as
 * it does for Firebase, so a token holder can never assert its own role.
 */
import { createHmac, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

import { isHashedPassphrase, passphraseMatches, secretEquals } from './settings-crypto.js';

export const OFFLINE_TOKEN_PREFIX = 'scoffline';
export const OFFLINE_TOKEN_VERSION = 'v1';
export const OFFLINE_EXTERNAL_ID_NAMESPACE = 'offline';

const SIGNED_PREFIX = `${OFFLINE_TOKEN_PREFIX}.${OFFLINE_TOKEN_VERSION}`;
const KDF_INFO = 'schoolcircle/offline-auth/v1';
const KDF_PARAMS = { N: 16384, r: 8, p: 1 };
const KEY_BYTES = 32;
const MIN_SECRET_CHARS = 32;
const MAX_TOKEN_CHARS = 4096;

const DEFAULT_REALM = 'local';
const DEFAULT_SESSION_HOURS = 12;
const MIN_SESSION_HOURS = 1;
const MAX_SESSION_HOURS = 168; // one week; a longer local session should be re-issued deliberately.

const ROLES = new Set(['INSTRUCTOR', 'LEARNER', 'BOTH']);

/*
 * Subjects and realms become one colon-delimited `User.externalId` segment, so
 * they must not be able to contain a colon (or anything else that would let one
 * subject spell another subject's external id).
 */
const SAFE_LABEL = /^[A-Za-z0-9][A-Za-z0-9._@-]{0,127}$/;

function trimmed(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function b64url(buffer) {
  return Buffer.from(buffer).toString('base64url');
}

/* ------------------------------ configuration ----------------------------- */

/** True when this deployment has explicitly asked for local operator auth. */
export function offlineModeRequested() {
  return trimmed(process.env.AUTH_MODE)?.toLowerCase() === 'offline';
}

function rawSecret() {
  const secret = trimmed(process.env.OFFLINE_AUTH_SECRET);
  return secret && secret.length >= MIN_SECRET_CHARS ? secret : null;
}

export function offlineRealm() {
  const realm = trimmed(process.env.OFFLINE_AUTH_REALM) || DEFAULT_REALM;
  return SAFE_LABEL.test(realm) ? realm : null;
}

export function offlineSessionHours() {
  const raw = Number.parseFloat(trimmed(process.env.OFFLINE_AUTH_SESSION_HOURS) || '');
  if (!Number.isFinite(raw)) return DEFAULT_SESSION_HOURS;
  return Math.min(MAX_SESSION_HOURS, Math.max(MIN_SESSION_HOURS, raw));
}

/**
 * Enabled only when the mode was asked for AND a usable local signing secret
 * and realm are present. Every entry point in this module checks this, so a
 * half-configured deployment mints and accepts nothing rather than falling back
 * to something weaker.
 */
export function offlineAuthEnabled() {
  return Boolean(offlineModeRequested() && rawSecret() && offlineRealm());
}

/** Why offline auth is unavailable, for an operator-facing message. */
export function offlineAuthReason() {
  if (!offlineModeRequested()) {
    return 'AUTH_MODE is not set to "offline" on this deployment, so local operator sign-in is disabled.';
  }
  if (!rawSecret()) {
    return `AUTH_MODE=offline is set but OFFLINE_AUTH_SECRET is missing or shorter than ${MIN_SECRET_CHARS} characters. `
      + 'Generate one with `openssl rand -base64 48` and supply it through the deployment secret store.';
  }
  if (!offlineRealm()) {
    return 'OFFLINE_AUTH_REALM must be a short label of letters, digits, dot, dash, underscore or @.';
  }
  return null;
}

let keyCache = null;

/*
 * scrypt is intentionally expensive, so the derived key is cached against the
 * secret that produced it. Re-deriving per request would put ~60ms of CPU on
 * every authenticated call.
 */
function signingKey() {
  const secret = rawSecret();
  if (!secret) return null;
  if (keyCache?.secret !== secret) {
    keyCache = { secret, key: scryptSync(secret, KDF_INFO, KEY_BYTES, KDF_PARAMS) };
  }
  return keyCache.key;
}

/* -------------------------------- operators ------------------------------- */

/**
 * The operator roster, as deployment configuration. Each entry carries a
 * scrypt hash produced by `hashPassphrase` (see
 * scripts/offline/operator-passphrase.mjs) -- never a plaintext passphrase --
 * so the roster can be read without yielding a way in.
 *
 * `role` seeds a brand-new `User` row and is ignored for an existing one, which
 * is the same rule the Firebase path uses for `name`: provider configuration
 * seeds an account, persisted choices win afterwards. It therefore cannot
 * escalate an account that already exists.
 */
export function offlineOperators() {
  const raw = trimmed(process.env.OFFLINE_AUTH_OPERATORS);
  if (!raw) return [];
  let parsed;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return [];
  }
  if (!Array.isArray(parsed)) return [];

  const seen = new Set();
  const operators = [];
  for (const entry of parsed) {
    if (!entry || typeof entry !== 'object' || Array.isArray(entry)) continue;
    const subject = trimmed(entry.subject);
    if (!subject || !SAFE_LABEL.test(subject) || seen.has(subject)) continue;
    if (!isHashedPassphrase(entry.passphrase)) continue;
    const role = trimmed(entry.role)?.toUpperCase();
    seen.add(subject);
    operators.push({
      subject,
      name: trimmed(entry.name) || `Offline operator ${subject}`,
      role: role && ROLES.has(role) ? role : null,
      email: trimmed(entry.email),
      passphrase: entry.passphrase,
    });
  }
  return operators;
}

export function findOfflineOperator(subject) {
  const wanted = trimmed(subject);
  if (!wanted) return null;
  return offlineOperators().find((operator) => operator.subject === wanted) || null;
}

/**
 * Verify an operator passphrase against the roster. Returns the operator or
 * null; never says which half was wrong.
 *
 * A miss for an unknown subject still pays one scrypt verification against a
 * throwaway hash, so "no such operator" and "wrong passphrase" cannot be told
 * apart by timing the response.
 */
export function authenticateOfflineOperator(subject, passphrase) {
  if (!offlineAuthEnabled()) return null;
  const operator = findOfflineOperator(subject);
  if (!operator) {
    passphraseMatches(typeof passphrase === 'string' ? passphrase : 'x', decoyPassphrase());
    return null;
  }
  return passphraseMatches(passphrase, operator.passphrase) ? operator : null;
}

let decoy = null;
function decoyPassphrase() {
  if (!decoy) {
    // Same scrypt parameters as a real entry, so the wasted work matches.
    decoy = {
      alg: 'scrypt',
      salt: randomBytes(16).toString('base64'),
      hash: randomBytes(32).toString('base64'),
      N: KDF_PARAMS.N,
      r: KDF_PARAMS.r,
      p: KDF_PARAMS.p,
      keylen: KEY_BYTES,
    };
  }
  return decoy;
}

/* ------------------------------- external ids ----------------------------- */

/**
 * `User.externalId` for a local operator, namespaced the same way Firebase
 * subjects are (`firebase:<project>:<uid>`) so the two can share one table and
 * can never collide. This is why no Prisma migration is needed.
 */
export function offlineExternalId(subject, realm = offlineRealm()) {
  const safeSubject = trimmed(subject);
  const safeRealm = trimmed(realm);
  if (!safeSubject || !SAFE_LABEL.test(safeSubject)) return null;
  if (!safeRealm || !SAFE_LABEL.test(safeRealm)) return null;
  return `${OFFLINE_EXTERNAL_ID_NAMESPACE}:${safeRealm}:${safeSubject}`;
}

/* ---------------------------- session tokens ------------------------------ */

function mac(payloadB64, key) {
  return b64url(createHmac('sha256', key).update(`${SIGNED_PREFIX}.${payloadB64}`).digest());
}

/**
 * Mint a session token for an authenticated operator. `now` is injectable for
 * tests only.
 */
export function signOfflineSession(subject, { now = Date.now(), hours = offlineSessionHours() } = {}) {
  if (!offlineAuthEnabled()) return null;
  const key = signingKey();
  const realm = offlineRealm();
  const safeSubject = trimmed(subject);
  if (!key || !realm || !safeSubject || !SAFE_LABEL.test(safeSubject)) return null;

  const issuedAt = Math.floor(now / 1000);
  const expiresAt = issuedAt + Math.round(hours * 3600);
  // Fixed key order; the MAC covers the encoded text, so this only has to be
  // stable enough to read back.
  const payload = JSON.stringify({
    v: 1,
    sub: safeSubject,
    realm,
    iat: issuedAt,
    exp: expiresAt,
    jti: b64url(randomBytes(12)),
  });
  const payloadB64 = b64url(Buffer.from(payload, 'utf8'));
  return {
    token: `${SIGNED_PREFIX}.${payloadB64}.${mac(payloadB64, key)}`,
    subject: safeSubject,
    realm,
    issuedAt: issuedAt * 1000,
    expiresAt: expiresAt * 1000,
  };
}

/** Cheap shape test: does this look like one of our tokens at all? */
export function isOfflineSessionToken(token) {
  return (
    typeof token === 'string'
    && token.length <= MAX_TOKEN_CHARS
    && token.startsWith(`${SIGNED_PREFIX}.`)
    && token.split('.').length === 4
  );
}

/**
 * Verify a session token with no network call of any kind. Returns the session
 * or null; anything unparseable, unsigned, wrongly-signed, wrong-realm or
 * expired is anonymous.
 */
export function verifyOfflineSessionToken(token, { now = Date.now() } = {}) {
  if (!offlineAuthEnabled() || !isOfflineSessionToken(token)) return null;
  const key = signingKey();
  const realm = offlineRealm();
  if (!key || !realm) return null;

  const [, , payloadB64, signature] = token.split('.');
  if (!payloadB64 || !signature) return null;

  // Constant-time compare of the two base64url MACs (settings-crypto).
  if (!secretEquals(signature, mac(payloadB64, key))) return null;

  let claims;
  try {
    claims = JSON.parse(Buffer.from(payloadB64, 'base64url').toString('utf8'));
  } catch {
    return null;
  }
  if (!claims || typeof claims !== 'object' || claims.v !== 1) return null;

  const subject = trimmed(claims.sub);
  if (!subject || !SAFE_LABEL.test(subject)) return null;
  // A token minted for another realm is not valid here even though the same
  // secret signed it.
  if (trimmed(claims.realm) !== realm) return null;

  const seconds = Math.floor(now / 1000);
  if (!Number.isFinite(claims.iat) || !Number.isFinite(claims.exp)) return null;
  if (claims.exp <= claims.iat || claims.exp <= seconds) return null;
  // A token stamped in the future is a clock problem or a forgery attempt with
  // a leaked key; either way do not honour it beyond a small skew.
  if (claims.iat > seconds + 300) return null;

  return {
    subject,
    realm,
    issuedAt: claims.iat * 1000,
    expiresAt: claims.exp * 1000,
  };
}

/** Readiness summary, shaped to sit alongside `firebase` in authReadiness(). */
export function offlineAuthReadiness() {
  const enabled = offlineAuthEnabled();
  return {
    enabled,
    realm: enabled ? offlineRealm() : null,
    operators: enabled ? offlineOperators().length : 0,
    sessionHours: enabled ? offlineSessionHours() : null,
    ...(enabled ? {} : { reason: offlineAuthReason() }),
  };
}

/* ------------------------------ login throttle ---------------------------- */

/*
 * A shared local box is exactly where a passphrase is worth grinding at, and
 * there is no external rate limiter in front of a disconnected deployment. This
 * is a deliberately simple in-process sliding window: it is per-process and
 * resets on restart, which is honest about what it is -- friction against a
 * script, not an account-lockout policy.
 */
const ATTEMPT_WINDOW_MS = 60_000;
const ATTEMPT_LIMIT = 5;
const attempts = new Map();

export function offlineLoginThrottle(subject, { now = Date.now() } = {}) {
  const keyName = trimmed(subject) || '<none>';
  const recent = (attempts.get(keyName) || []).filter((at) => now - at < ATTEMPT_WINDOW_MS);
  if (recent.length) attempts.set(keyName, recent);
  else attempts.delete(keyName);
  if (recent.length < ATTEMPT_LIMIT) return { allowed: true, retryAfterSeconds: 0 };
  const oldest = Math.min(...recent);
  return {
    allowed: false,
    retryAfterSeconds: Math.max(1, Math.ceil((ATTEMPT_WINDOW_MS - (now - oldest)) / 1000)),
  };
}

export function recordOfflineLoginFailure(subject, { now = Date.now() } = {}) {
  const keyName = trimmed(subject) || '<none>';
  const recent = (attempts.get(keyName) || []).filter((at) => now - at < ATTEMPT_WINDOW_MS);
  recent.push(now);
  attempts.set(keyName, recent);
}

export function clearOfflineLoginFailures(subject) {
  attempts.delete(trimmed(subject) || '<none>');
}

/** Test seam: forget every recorded attempt. */
export function resetOfflineLoginThrottle() {
  attempts.clear();
}

/* Exported for tests that need to prove the MAC is what we say it is. */
export const __testing = { mac, signingKey, timingSafeEqual };
