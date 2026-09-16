/**
 * Runtime configuration for the doctrine (Anchor) endpoint.
 *
 * The grounding engine is a physical object on a USB cable. It moves between
 * laptops, so which address serves it is operational state, not a build
 * artifact: requiring a redeploy to point at a board someone just plugged in
 * is the wrong shape. This module keeps that address in the database and lets
 * an instructor set it from Settings -> Doctrine engine.
 *
 * Shape of the decision, mirroring lib/model-settings.js:
 *   - A stored address wins over DOCTRINE_BASE_URL when enabled, and the active
 *     source is always reported, so "I changed it and nothing happened" is
 *     diagnosable. The environment stays the bootstrap and the way a
 *     locked-down deployment ships pre-configured.
 *   - There is exactly one row. It is deployment-wide config, not per-user, so
 *     a single cached snapshot shared by concurrent requests is correct here.
 *   - No secret is involved. An Anchor base URL is an address, not a
 *     credential, so this deliberately does NOT use lib/settings-crypto.js and
 *     does NOT add an operator passphrase: the authenticated INSTRUCTOR role
 *     enforced by learningRoute is the gate. That is a smaller gate than the
 *     model provider's on purpose -- pointing at a grounding service cannot
 *     exfiltrate approved source text the way an arbitrary generation endpoint
 *     can, because this adapter only ever sends a question and reads citations.
 */
import { db, updateLearningRecordIfVersion } from './db.js';
import { setStoredDoctrineBaseUrl } from './doctrine.js';

export const DOCTRINE_SETTINGS_ID = 'system-doctrine-settings';
export const DOCTRINE_SETTINGS_TYPE = 'SYSTEM_DOCTRINE_SETTINGS';
const ACTIVE = 'ACTIVE';
const DISABLED = 'DISABLED';

// Same reasoning as model-settings: long enough that a burst of grounded asks
// does not re-read the row per request, short enough that a Settings change
// takes effect without a restart. A write invalidates locally at once.
const CACHE_TTL_MS = 10_000;

let cache = { at: 0, value: null };
let readFailureLogged = false;

/* ------------------------------ validation ------------------------------ */

function trimmed(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function settingsError(message, code = 'BAD_REQUEST', status = 400) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

/**
 * Validate an operator-supplied Anchor address.
 *
 * Private and loopback addresses are the normal case, not an exception: the
 * whole point is `http://192.168.55.1:8000` (the Orin over USB device-mode) or
 * `http://localhost:8000` (a laptop running ops/tunnel.sh).
 */
export function normaliseDoctrineBaseUrl(value) {
  const raw = trimmed(value);
  if (!raw) throw settingsError('A doctrine endpoint URL is required.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw settingsError(
      'The endpoint must be a full URL, for example http://192.168.55.1:8000.',
    );
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw settingsError('The endpoint must use http or https.');
  }
  if (url.username || url.password) {
    throw settingsError('The doctrine endpoint must not carry credentials.');
  }
  if (url.search || url.hash) {
    throw settingsError('The endpoint must not carry a query string or fragment.');
  }
  // Callers append `/api/ask`, so store the base without a trailing slash.
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

/* -------------------------------- reading -------------------------------- */

function payloadOf(record) {
  return record?.payload && typeof record.payload === 'object' && !Array.isArray(record.payload)
    ? record.payload
    : {};
}

function toSettings(record) {
  if (!record) return null;
  const payload = payloadOf(record);
  const baseUrl = trimmed(payload.baseUrl);
  return {
    enabled: record.status === ACTIVE && Boolean(baseUrl),
    baseUrl,
    updatedBy: trimmed(payload.updatedBy) || null,
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : null,
    version: record.version,
    status: record.status,
  };
}

/**
 * Refresh the cached snapshot if it has expired. Safe to call on every
 * grounding-dependent request.
 *
 * A database failure falls back to the previous snapshot (or to the
 * environment) rather than failing the request: an unreachable settings row
 * must not take down grounding that DOCTRINE_BASE_URL can already serve. The
 * failure is logged once per process so it stays visible without flooding.
 */
export async function primeDoctrineSettings() {
  if (Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const record = await db.learningRecord.findUnique({ where: { id: DOCTRINE_SETTINGS_ID } });
    cache = { at: Date.now(), value: toSettings(record) };
    // Push the decision down to the adapter, which stays free of this module so
    // the offline verification kit never loads Prisma. A disabled or absent row
    // clears the override, which is what makes DELETE fall back to the env.
    setStoredDoctrineBaseUrl(cache.value?.enabled ? cache.value.baseUrl : null);
    readFailureLogged = false;
  } catch (error) {
    // Keep serving the last known value; only the freshness is lost.
    cache = { at: Date.now(), value: cache.value };
    if (!readFailureLogged) {
      // Identify the failure without echoing the error body: a Prisma
      // initialisation message can carry the DATABASE_URL.
      const label = error?.code || error?.name || 'unknown error';
      console.error(
        `[doctrine-settings] could not read the stored doctrine endpoint (${label}); `
        + 'falling back to DOCTRINE_BASE_URL',
      );
      readFailureLogged = true;
    }
  }
  return cache.value;
}

/** The cached snapshot, without touching the database. */
export function cachedDoctrineSettings() {
  return cache.value;
}

export function invalidateDoctrineSettings() {
  cache = { at: 0, value: null };
  // The adapter keeps serving the last-known address until the next prime, so a
  // request mid-invalidation grounds against the endpoint that was in force
  // rather than silently reverting to the environment for one call.
}

/* -------------------------------- writing -------------------------------- */

/**
 * Replace the doctrine endpoint.
 *
 * `expectedVersion` is the version the caller last read. When supplied, a save
 * that does not match is refused with CONFLICT, so two instructors editing the
 * panel at once cannot silently overwrite each other.
 */
export async function saveDoctrineSettings({ baseUrl, updatedBy, expectedVersion }) {
  const nextBaseUrl = normaliseDoctrineBaseUrl(baseUrl);
  const owner = trimmed(updatedBy);
  if (!owner) throw settingsError('An operator identity is required.', 'FORBIDDEN', 403);
  if (expectedVersion !== undefined && !Number.isInteger(expectedVersion)) {
    throw settingsError('expectedVersion must be an integer when supplied.');
  }

  const existing = await db.learningRecord.findUnique({ where: { id: DOCTRINE_SETTINGS_ID } });
  if (expectedVersion !== undefined && (existing?.version ?? null) !== expectedVersion) {
    throw settingsError(
      'These settings changed in another session. Reload and try again.',
      'CONFLICT',
      409,
    );
  }

  const payload = { baseUrl: nextBaseUrl, updatedBy: owner };

  try {
    if (!existing) {
      await db.learningRecord.create({
        data: {
          id: DOCTRINE_SETTINGS_ID,
          ownerId: owner,
          type: DOCTRINE_SETTINGS_TYPE,
          status: ACTIVE,
          payload,
        },
      });
    } else {
      if (existing.type !== DOCTRINE_SETTINGS_TYPE) {
        throw settingsError('The settings record is not a doctrine configuration.', 'CONFLICT', 409);
      }
      const updated = await updateLearningRecordIfVersion(existing.id, existing.version, {
        ownerId: owner,
        status: ACTIVE,
        payload,
      });
      if (!updated) {
        throw settingsError(
          'These settings changed in another session. Reload and try again.',
          'CONFLICT',
          409,
        );
      }
    }
  } finally {
    // Even a failed write may have landed; never keep serving a stale snapshot.
    invalidateDoctrineSettings();
  }
  return primeDoctrineSettings();
}

/** Stop using the stored address and fall back to the environment. Keeps history. */
export async function disableDoctrineSettings({ updatedBy }) {
  const owner = trimmed(updatedBy);
  if (!owner) throw settingsError('An operator identity is required.', 'FORBIDDEN', 403);
  const existing = await db.learningRecord.findUnique({ where: { id: DOCTRINE_SETTINGS_ID } });
  if (!existing) return null;
  try {
    const updated = await updateLearningRecordIfVersion(existing.id, existing.version, {
      status: DISABLED,
      payload: { ...payloadOf(existing), updatedBy: owner },
    });
    if (!updated) {
      throw settingsError(
        'These settings changed in another session. Reload and try again.',
        'CONFLICT',
        409,
      );
    }
  } finally {
    invalidateDoctrineSettings();
  }
  return primeDoctrineSettings();
}

/* ------------------------------ presentation ------------------------------ */

/** The operator-facing view. No secret exists here, so nothing is redacted. */
export function publicDoctrineSettings(settings, status) {
  return {
    configured: Boolean(settings?.enabled),
    baseUrl: settings?.baseUrl || '',
    updatedBy: settings?.updatedBy || null,
    updatedAt: settings?.updatedAt || null,
    version: Number.isInteger(settings?.version) ? settings.version : null,
    envBaseUrl: trimmed(process.env.DOCTRINE_BASE_URL) || null,
    active: status
      ? {
        ready: Boolean(status.ready),
        // 'setting' | 'env' | null -- which side supplied the address in force.
        source: status.source || null,
        baseUrl: status.baseUrl || null,
        ...(status.ready ? {} : { reason: status.reason }),
      }
      : null,
  };
}
