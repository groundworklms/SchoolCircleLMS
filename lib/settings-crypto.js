/**
 * Authenticated encryption for operator-entered secrets stored in the database.
 *
 * The product configures its generation provider at runtime (Settings ->
 * Generation model) rather than at build time, so a live API key has to live
 * somewhere the running app can read it. Cloud SQL is encrypted at rest by the
 * platform, but that does not protect the value from anyone holding a database
 * session, a backup, or Prisma Studio. So the key is sealed with AES-256-GCM
 * before it is written and only ever opened in server memory.
 *
 * SETTINGS_ENCRYPTION_KEY is a one-time deployment secret: set it once, and the
 * provider, model id and API key can then be changed from the UI forever
 * without a redeploy. It is deliberately NOT auto-generated -- a key the
 * process invents cannot survive a restart, and silently losing the ability to
 * decrypt is worse than refusing to encrypt.
 *
 * When it is unset, `sealSecret` throws. Callers must surface that as an
 * explicit, actionable error and must never fall back to storing plaintext.
 */
import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
  scryptSync,
  timingSafeEqual,
} from 'node:crypto';

export const SECRET_ALGORITHM = 'A256GCM';
const CIPHER = 'aes-256-gcm';
const IV_BYTES = 12;
const KEY_BYTES = 32;

function keyMaterial() {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!raw) return null;
  // Accept either encoding a `openssl rand` invocation naturally produces.
  const decoded = /^[0-9a-fA-F]{64}$/.test(raw)
    ? Buffer.from(raw, 'hex')
    : Buffer.from(raw, 'base64');
  return decoded.length === KEY_BYTES ? decoded : null;
}

/** True when a usable 32-byte SETTINGS_ENCRYPTION_KEY is configured. */
export function secretStorageReady() {
  return keyMaterial() !== null;
}

/**
 * Why sealing is unavailable, for an operator-facing message. Distinguishes
 * "not set up yet" from "set up wrong", because the fix differs.
 */
export function secretStorageReason() {
  const raw = process.env.SETTINGS_ENCRYPTION_KEY?.trim();
  if (!raw) {
    return 'SETTINGS_ENCRYPTION_KEY is not set on this deployment, so an API key cannot be stored. '
      + 'Generate one with `openssl rand -base64 32`, add it to Secret Manager, and reference it '
      + 'from apphosting.yaml. An endpoint that needs no API key can be saved without it.';
  }
  return 'SETTINGS_ENCRYPTION_KEY is not a 32-byte key. Supply 32 bytes as base64 or hex '
    + '(`openssl rand -base64 32`).';
}

export function secretStorageError() {
  const error = new Error(secretStorageReason());
  error.code = 'SECRET_STORAGE_UNAVAILABLE';
  error.status = 503;
  return error;
}

/**
 * Seal a plaintext secret. Returns the stored envelope; the plaintext never
 * appears in the return value, and `alg` is recorded so a future algorithm
 * change can still open old envelopes.
 */
export function sealSecret(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new TypeError('a non-empty secret is required');
  }
  const key = keyMaterial();
  if (!key) throw secretStorageError();

  const iv = randomBytes(IV_BYTES);
  const cipher = createCipheriv(CIPHER, key, iv);
  const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
  return {
    alg: SECRET_ALGORITHM,
    iv: iv.toString('base64'),
    ct: ct.toString('base64'),
    tag: cipher.getAuthTag().toString('base64'),
    // A stable, non-reversible hint so the UI can show which key is in place
    // and an operator can tell "unchanged" from "replaced" without the value.
    hint: plaintext.length > 4 ? `****${plaintext.slice(-4)}` : '****',
  };
}

export function isSealedSecret(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.alg === SECRET_ALGORITHM
    && typeof value.iv === 'string'
    && typeof value.ct === 'string'
    && typeof value.tag === 'string',
  );
}

/**
 * Open a sealed secret. Returns null rather than throwing when the envelope is
 * absent or unreadable: a rotated or mistyped SETTINGS_ENCRYPTION_KEY should
 * degrade to "no credential" (an explicit 503 from the provider) instead of
 * taking down every request that merely reads configuration.
 */
export function openSecret(envelope) {
  if (!isSealedSecret(envelope)) return null;
  const key = keyMaterial();
  if (!key) return null;
  try {
    const decipher = createDecipheriv(CIPHER, key, Buffer.from(envelope.iv, 'base64'));
    decipher.setAuthTag(Buffer.from(envelope.tag, 'base64'));
    const plaintext = Buffer.concat([
      decipher.update(Buffer.from(envelope.ct, 'base64')),
      decipher.final(),
    ]).toString('utf8');
    return plaintext || null;
  } catch {
    // Wrong key or tampered ciphertext. Nothing here is safe to log.
    return null;
  }
}

/* --------------------------- passphrase hashing --------------------------- */

/*
 * The operator passphrase is verified, never recovered, so it is hashed rather
 * than sealed. That matters for more than hygiene: hashing needs no key, which
 * is what lets an operator set the passphrase from the panel on a deployment
 * with no secrets configured at all. Sealing it would have required
 * SETTINGS_ENCRYPTION_KEY and reintroduced the redeploy this is meant to avoid.
 */
const SCRYPT_PARAMS = { N: 16384, r: 8, p: 1, keylen: 32 };
export const PASSPHRASE_ALGORITHM = 'scrypt';

export function hashPassphrase(passphrase) {
  if (typeof passphrase !== 'string' || passphrase.trim().length < 8) {
    const error = new Error('The operator passphrase must be at least 8 characters.');
    error.code = 'BAD_REQUEST';
    error.status = 400;
    throw error;
  }
  const salt = randomBytes(16);
  const hash = scryptSync(passphrase.trim(), salt, SCRYPT_PARAMS.keylen, SCRYPT_PARAMS);
  return {
    alg: PASSPHRASE_ALGORITHM,
    salt: salt.toString('base64'),
    hash: hash.toString('base64'),
    ...SCRYPT_PARAMS,
  };
}

export function isHashedPassphrase(value) {
  return Boolean(
    value
    && typeof value === 'object'
    && !Array.isArray(value)
    && value.alg === PASSPHRASE_ALGORITHM
    && typeof value.salt === 'string'
    && typeof value.hash === 'string',
  );
}

/** Verify a passphrase against a stored hash. False on anything malformed. */
export function passphraseMatches(provided, stored) {
  if (typeof provided !== 'string' || !provided.trim()) return false;
  if (!isHashedPassphrase(stored)) return false;
  try {
    const expected = Buffer.from(stored.hash, 'base64');
    const actual = scryptSync(
      provided.trim(),
      Buffer.from(stored.salt, 'base64'),
      expected.length,
      {
        N: stored.N || SCRYPT_PARAMS.N,
        r: stored.r || SCRYPT_PARAMS.r,
        p: stored.p || SCRYPT_PARAMS.p,
      },
    );
    return actual.length === expected.length && timingSafeEqual(actual, expected);
  } catch {
    return false;
  }
}

/**
 * Constant-time comparison for the operator passphrase, so a wrong guess
 * cannot be narrowed down by timing the response.
 */
export function secretEquals(provided, expected) {
  if (typeof provided !== 'string' || typeof expected !== 'string') return false;
  if (!provided || !expected) return false;
  const a = Buffer.from(provided, 'utf8');
  const b = Buffer.from(expected, 'utf8');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}
