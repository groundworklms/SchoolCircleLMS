/**
 * Runtime configuration for the text-generation provider.
 *
 * AI generation is the only course-authoring path, so which model answers is
 * operational configuration, not a build artifact. This module keeps that
 * choice in the database and lets an operator change it from Settings ->
 * Generation model: either a self-hosted OpenAI-compatible endpoint (the
 * offline posture, no key required) or a hosted API of their choice.
 *
 * Shape of the decision:
 *   - Stored settings win over MODEL_BASE_URL / MODEL_ID when enabled, and the
 *     active source is always reported so "I changed it and nothing happened"
 *     is diagnosable. Environment variables remain the bootstrap and the way a
 *     locked-down deployment can ship pre-configured.
 *   - There is exactly one row. It is deployment-wide config, not per-user, so
 *     a single cached snapshot shared by concurrent requests is correct here
 *     (unlike per-request state, which must never be module-level).
 *   - The API key is sealed by lib/settings-crypto.js before it is written and
 *     is never part of the object handed to a route, so it cannot leak through
 *     an existing serializer. The transport asks for it separately.
 */
import { db, updateLearningRecordIfVersion } from './db.js';
import {
  isSealedSecret,
  openSecret,
  sealSecret,
  secretStorageReady,
  secretStorageReason,
} from './settings-crypto.js';

export const MODEL_SETTINGS_ID = 'system-model-settings';
export const MODEL_SETTINGS_TYPE = 'SYSTEM_MODEL_SETTINGS';
const ACTIVE = 'ACTIVE';
const DISABLED = 'DISABLED';

// Long enough that a burst of generation calls does not re-read the row per
// request; short enough that a Settings change takes effect without a restart
// and without cross-instance invalidation. A write invalidates locally at once.
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
 * Validate an operator-supplied endpoint.
 *
 * Private and loopback addresses are deliberately allowed: the offline posture
 * *is* a self-hosted endpoint on the local network. The write path is gated on
 * the operator passphrase instead, which is what makes choosing a destination
 * an authorized action rather than an open redirect.
 */
export function normaliseBaseUrl(value) {
  const raw = trimmed(value);
  if (!raw) throw settingsError('An endpoint URL is required.');
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw settingsError('The endpoint must be a full URL, for example https://host/v1.');
  }
  if (url.protocol !== 'https:' && url.protocol !== 'http:') {
    throw settingsError('The endpoint must use http or https.');
  }
  if (url.username || url.password) {
    throw settingsError('Put credentials in the API key field, not in the endpoint URL.');
  }
  if (url.search || url.hash) {
    throw settingsError('The endpoint must not carry a query string or fragment.');
  }
  // Callers append `/chat/completions`, so store the base without a trailing slash.
  return `${url.origin}${url.pathname.replace(/\/+$/, '')}`;
}

export function normaliseModelId(value) {
  const model = trimmed(value);
  if (!model) throw settingsError('A model id is required.');
  if (model.length > 200) throw settingsError('That model id is too long.');
  return model;
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
  const modelId = trimmed(payload.modelId);
  return {
    enabled: record.status === ACTIVE && Boolean(baseUrl && modelId),
    baseUrl,
    modelId,
    apiKeyEnvelope: isSealedSecret(payload.apiKey) ? payload.apiKey : null,
    keyHint: typeof payload.apiKey?.hint === 'string' ? payload.apiKey.hint : null,
    updatedBy: trimmed(payload.updatedBy) || null,
    updatedAt: record.updatedAt ? new Date(record.updatedAt).toISOString() : null,
    version: record.version,
    status: record.status,
  };
}

/**
 * Refresh the cached snapshot if it has expired. Safe to call on every
 * provider-dependent request.
 *
 * A database failure here falls back to the previous snapshot (or to the
 * environment) rather than failing the request: an unreachable settings row
 * must not take down generation that environment variables can already serve.
 * The failure is logged once per process so it stays visible without flooding.
 */
export async function primeModelSettings() {
  if (Date.now() - cache.at < CACHE_TTL_MS) return cache.value;
  try {
    const record = await db.learningRecord.findUnique({ where: { id: MODEL_SETTINGS_ID } });
    cache = { at: Date.now(), value: toSettings(record) };
    readFailureLogged = false;
  } catch (error) {
    // Keep serving the last known value; only the freshness is lost.
    cache = { at: Date.now(), value: cache.value };
    if (!readFailureLogged) {
      // Identify the failure without echoing the error body: a Prisma
      // initialisation message can carry the DATABASE_URL.
      const label = error?.code || error?.name || 'unknown error';
      console.error(
        `[model-settings] could not read stored provider settings (${label}); `
        + 'falling back to MODEL_BASE_URL/MODEL_ID',
      );
      readFailureLogged = true;
    }
  }
  return cache.value;
}

/** The cached snapshot, without touching the database. */
export function cachedModelSettings() {
  return cache.value;
}

export function invalidateModelSettings() {
  cache = { at: 0, value: null };
}

/**
 * The stored API key in plaintext, or ''. Deliberately separate from the
 * provider status object so the secret has no path into a JSON response.
 */
export function storedApiKey() {
  const settings = cache.value;
  if (!settings?.enabled || !settings.apiKeyEnvelope) return '';
  return openSecret(settings.apiKeyEnvelope) || '';
}

/* -------------------------------- writing -------------------------------- */

/**
 * Replace the provider configuration.
 *
 * `apiKey` semantics: a non-empty string sets a new key, `null` clears it, and
 * `undefined` leaves the existing one in place -- so an operator can retype the
 * endpoint without re-entering a secret the UI never showed them.
 *
 * `expectedVersion` is the version the caller last read. When supplied, a save
 * that does not match is refused with CONFLICT, so two operators editing the
 * panel at once cannot silently overwrite each other. Omitting it is
 * last-write-wins, which is the right default for a script or a first save.
 */
export async function saveModelSettings({ baseUrl, modelId, apiKey, updatedBy, expectedVersion }) {
  const nextBaseUrl = normaliseBaseUrl(baseUrl);
  const nextModelId = normaliseModelId(modelId);
  const owner = trimmed(updatedBy);
  if (!owner) throw settingsError('An operator identity is required.', 'FORBIDDEN', 403);
  if (expectedVersion !== undefined && !Number.isInteger(expectedVersion)) {
    throw settingsError('expectedVersion must be an integer when supplied.');
  }

  const existing = await db.learningRecord.findUnique({ where: { id: MODEL_SETTINGS_ID } });
  if (expectedVersion !== undefined && (existing?.version ?? null) !== expectedVersion) {
    throw settingsError(
      'These settings changed in another session. Reload and try again.',
      'CONFLICT',
      409,
    );
  }
  const current = payloadOf(existing);

  let envelope;
  if (apiKey === undefined) {
    envelope = isSealedSecret(current.apiKey) ? current.apiKey : null;
  } else if (apiKey === null || trimmed(apiKey) === '') {
    envelope = null;
  } else {
    if (!secretStorageReady()) throw settingsError(secretStorageReason(), 'SECRET_STORAGE_UNAVAILABLE', 503);
    envelope = sealSecret(trimmed(apiKey));
  }

  const payload = {
    baseUrl: nextBaseUrl,
    modelId: nextModelId,
    ...(envelope ? { apiKey: envelope } : {}),
    updatedBy: owner,
  };

  try {
    if (!existing) {
      await db.learningRecord.create({
        data: {
          id: MODEL_SETTINGS_ID,
          ownerId: owner,
          type: MODEL_SETTINGS_TYPE,
          status: ACTIVE,
          payload,
        },
      });
    } else {
      if (existing.type !== MODEL_SETTINGS_TYPE) {
        throw settingsError('The settings record is not a provider configuration.', 'CONFLICT', 409);
      }
      // Optimistic concurrency: two operators saving at once must not blend.
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
    invalidateModelSettings();
  }
  return primeModelSettings();
}

/** Stop using stored settings and fall back to the environment. Keeps history. */
export async function disableModelSettings({ updatedBy }) {
  const owner = trimmed(updatedBy);
  if (!owner) throw settingsError('An operator identity is required.', 'FORBIDDEN', 403);
  const existing = await db.learningRecord.findUnique({ where: { id: MODEL_SETTINGS_ID } });
  if (!existing) return null;
  // Drop the credential outright rather than leaving a disabled row holding a
  // live key. Destructured out explicitly so the omission is visible here
  // rather than relying on JSON serialization to discard an undefined value.
  const { apiKey: _discarded, ...kept } = payloadOf(existing);
  try {
    const updated = await updateLearningRecordIfVersion(existing.id, existing.version, {
      status: DISABLED,
      payload: { ...kept, updatedBy: owner },
    });
    if (!updated) {
      throw settingsError(
        'These settings changed in another session. Reload and try again.',
        'CONFLICT',
        409,
      );
    }
  } finally {
    invalidateModelSettings();
  }
  return primeModelSettings();
}

/* ------------------------------ presentation ------------------------------ */

/**
 * The operator-facing view. Carries a masked hint so the UI can show that a key
 * is in place and whether it changed, and never the key itself.
 */
export function publicModelSettings(settings, providerStatus) {
  return {
    configured: Boolean(settings?.enabled),
    baseUrl: settings?.baseUrl || '',
    modelId: settings?.modelId || '',
    hasApiKey: Boolean(settings?.apiKeyEnvelope),
    apiKeyHint: settings?.keyHint || null,
    updatedBy: settings?.updatedBy || null,
    updatedAt: settings?.updatedAt || null,
    version: Number.isInteger(settings?.version) ? settings.version : null,
    secretStorageReady: secretStorageReady(),
    ...(secretStorageReady() ? {} : { secretStorageReason: secretStorageReason() }),
    writable: operatorPassphraseConfigured(),
    ...(operatorPassphraseConfigured() ? {} : { writableReason: operatorPassphraseReason() }),
    active: providerStatus
      ? {
        ready: Boolean(providerStatus.ready),
        source: providerStatus.source || null,
        provider: providerStatus.provider || null,
        model: providerStatus.model || null,
        baseUrl: providerStatus.baseUrl || null,
        ...(providerStatus.ready ? {} : { reason: providerStatus.reason }),
      }
      : null,
  };
}

/* ------------------------------ authorization ----------------------------- */

export function operatorPassphraseConfigured() {
  return Boolean(process.env.MODEL_SETTINGS_KEY?.trim());
}

export function operatorPassphraseReason() {
  return 'MODEL_SETTINGS_KEY is not set on this deployment, so the generation provider cannot be '
    + 'changed from Settings. Add it to Secret Manager and reference it from apphosting.yaml.';
}
