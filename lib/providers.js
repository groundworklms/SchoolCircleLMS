/**
 * Capability registry.
 *
 * Media generation is four different capabilities, not one "AI provider" —
 * they fail independently, they have different on-prem stories, and at the
 * event some will be unavailable. So each resolves its own backend and each
 * degrades on its own without taking the others down.
 *
 * onPrem: how realistic a self-hosted fallback is if the event compute is
 * air-gapped. This is the column that actually matters for planning.
 */

import { cachedModelSettings, storedApiKey } from './model-settings.js';

export const OPENROUTER_BASE_URL = 'https://openrouter.ai/api/v1';
export const OPENROUTER_MODEL_ID = 'google/gemini-3.1-pro-preview';

function canonicalBaseUrl(value) {
  return typeof value === 'string' ? value.trim().replace(/\/+$/, '') : '';
}

/**
 * A self-hosted endpoint is the offline posture and legitimately needs no
 * credential, so "ready without a key" is only accepted for one. A hosted API
 * without a key would otherwise look configured and fail on first use.
 */
function isLoopbackOrPrivate(baseUrl) {
  let host;
  try {
    host = new URL(baseUrl).hostname;
  } catch {
    return false;
  }
  if (host === 'localhost' || host.endsWith('.localhost') || host.endsWith('.local')) return true;
  if (host === '::1' || host === '[::1]') return true;
  return (
    /^127\./.test(host)
    || /^10\./.test(host)
    || /^192\.168\./.test(host)
    || /^172\.(1[6-9]|2\d|3[01])\./.test(host)
    || /^169\.254\./.test(host)
  );
}

function providerNameFor(baseUrl) {
  return isExplicitOpenRouterBaseUrl(baseUrl) ? 'openrouter' : 'openai-compatible';
}

/**
 * A credential supplied by deployment configuration, for `baseUrl`.
 *
 * This is what lets the key stay in Secret Manager while the model is chosen in
 * Settings: the panel needs no API key field at all in that setup, and
 * SETTINGS_ENCRYPTION_KEY is only needed by someone who wants to type a key
 * into the UI instead.
 */
function envCredentialFor(baseUrl) {
  if (isExplicitOpenRouterBaseUrl(baseUrl)) {
    return process.env.OPENROUTER_API_KEY?.trim() || '';
  }
  // MODEL_API_KEY is the documented name; OPENAI_API_KEY is accepted so a
  // deployment already holding its credential under that conventional name does
  // not need a second copy of the same secret.
  return process.env.MODEL_API_KEY?.trim() || process.env.OPENAI_API_KEY?.trim() || '';
}

export function isExplicitOpenRouterBaseUrl(value) {
  return canonicalBaseUrl(value) === OPENROUTER_BASE_URL;
}

const CAPABILITIES = {
  text: {
    label: 'Text',
    used: 'Study guides, question banks, learning plans, AAR analysis',
    env: ['MODEL_BASE_URL', 'MODEL_ID', 'MODEL_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'],
    onPrem: 'straightforward — any served open-weight LLM',
    critical: true,
  },
  grounding: {
    label: 'Doctrine grounding',
    used: 'Citations, source-checked answers, and refusal when the corpus is silent',
    env: ['DOCTRINE_BASE_URL'],
    // The only row here whose on-prem story is not a plan: this capability is offline by
    // construction. A cloud grounding service would defeat its own purpose at a
    // schoolhouse with no reliable network.
    onPrem: 'already offline - it is the point, not the fallback',
    // Not critical: with DOCTRINE_BASE_URL unset the app behaves exactly as it does
    // today. Marking it critical would add a fifth blocking capability and paint a red
    // required dot on the capabilities screen for something nobody has configured yet.
    critical: false,
  },
  speech: {
    label: 'Speech',
    used: 'Narrated study guides, listen-on-the-move review',
    env: ['SPEECH_API_KEY', 'SPEECH_BASE_URL'],
    onPrem: 'feasible — open TTS models run on modest hardware',
    // The browser can do this with no key and no network at all.
    browserFallback: true,
  },
  image: {
    label: 'Images',
    used: 'Illustrative graphics for lessons',
    env: ['IMAGE_API_KEY', 'IMAGE_BASE_URL'],
    onPrem: 'heavy but possible — diffusion models need a real GPU',
    caution: 'Generated technical diagrams are frequently wrong. Instructor review required.',
  },
  video: {
    label: 'Video',
    used: 'Shared lesson intros (build-time only, never per student)',
    env: ['VIDEO_API_KEY', 'VIDEO_BASE_URL'],
    onPrem: 'not realistic on hackathon timelines',
    caution: 'Minutes per clip and real cost. Build-time only.',
  },
};

export function capabilities() {
  return Object.entries(CAPABILITIES).map(([id, c]) => {
    const text = id === 'text' ? textProvider() : null;
    const via =
      id === 'text'
        ? text?.ready
          ? text.provider === 'openrouter'
            ? 'MODEL_BASE_URL + MODEL_ID + OPENROUTER_API_KEY'
            : 'MODEL_BASE_URL + MODEL_ID'
          : null
        : c.env.find((k) => process.env[k]);
    const ready = Boolean(via) || Boolean(c.browserFallback);
    return {
      id,
      label: c.label,
      used: c.used,
      onPrem: c.onPrem,
      critical: Boolean(c.critical),
      caution: c.caution || null,
      ready,
      via: via ? via : c.browserFallback ? 'browser (no key)' : null,
      env: c.env,
      degraded: !via && Boolean(c.browserFallback),
    };
  });
}

/**
 * Resolve the text provider.
 *
 * Stored settings (Settings -> Generation model, lib/model-settings.js) win
 * over the environment when enabled, so the provider can change without a
 * redeploy; the environment stays the bootstrap and the way a locked-down
 * deployment ships pre-configured. `source` names the winner so a change that
 * appears not to take effect is diagnosable rather than mysterious.
 *
 * This stays synchronous -- the settings snapshot is primed once per request by
 * `primeModelSettings()` -- and it deliberately never returns the API key. The
 * status object is serialized straight to clients by /api/generate and
 * /api/learning/status; the transport reads the credential separately through
 * `textProviderCredential()`.
 */
export function textProvider() {
  const stored = cachedModelSettings();
  if (stored?.enabled) {
    const baseUrl = canonicalBaseUrl(stored.baseUrl);
    const model = stored.modelId;
    const hosted = !isLoopbackOrPrivate(baseUrl);
    const typedKey = storedApiKey();
    const fromEnv = typedKey ? '' : envCredentialFor(baseUrl);
    if (hosted && !typedKey && !fromEnv) {
      return {
        provider: providerNameFor(baseUrl),
        model,
        baseUrl,
        source: 'settings',
        credential: null,
        ready: false,
        reason:
          'This endpoint needs an API key. Supply one from deployment configuration '
          + '(MODEL_API_KEY or OPENAI_API_KEY in Secret Manager), or enter one here, which '
          + 'additionally requires SETTINGS_ENCRYPTION_KEY.',
      };
    }
    return {
      provider: providerNameFor(baseUrl),
      model,
      baseUrl,
      source: 'settings',
      // Which side supplied the credential, so the panel can say so. Never the
      // credential itself -- this object is serialized to clients.
      credential: typedKey ? 'settings' : (fromEnv ? 'environment' : null),
      ready: true,
    };
  }

  const baseUrl = canonicalBaseUrl(process.env.MODEL_BASE_URL);
  const model = typeof process.env.MODEL_ID === 'string' ? process.env.MODEL_ID.trim() : '';
  if (!baseUrl) {
    return {
      provider: null,
      ready: false,
      source: null,
      reason:
        'No text model configured. Choose one in Settings -> Generation model, or set '
        + 'MODEL_BASE_URL and MODEL_ID for an explicit model endpoint.',
    };
  }
  if (!model) {
    // An endpoint with no model chosen yet. Still report the endpoint and the
    // credential: the model picker reads the endpoint's catalogue to offer the
    // choice, so withholding baseUrl here made listing models require a model
    // already being selected. A deployment can therefore ship MODEL_BASE_URL
    // plus a key and leave the model to an instructor, which is the intended
    // setup (see docs/generation-provider.md).
    return {
      provider: providerNameFor(baseUrl),
      baseUrl,
      source: 'env',
      credential: envCredentialFor(baseUrl) ? 'environment' : null,
      ready: false,
      reason:
        'No model chosen yet. Pick one in Settings -> Generation model, or set MODEL_ID to '
        + 'give this deployment a default.',
    };
  }
  if (isExplicitOpenRouterBaseUrl(baseUrl)) {
    if (!process.env.OPENROUTER_API_KEY?.trim()) {
      return {
        provider: 'openrouter',
        model,
        baseUrl,
        source: 'env',
        ready: false,
        reason:
          'OpenRouter is explicitly selected but OPENROUTER_API_KEY is unset; no cloud fallback is enabled.',
      };
    }
    return {
      provider: 'openrouter',
      model,
      baseUrl,
      source: 'env',
      ready: true,
    };
  }
  return {
    provider: 'openai-compatible',
    model,
    baseUrl,
    source: 'env',
    ready: true,
  };
}

/**
 * The credential for the active provider, or ''. Kept out of `textProvider()`
 * so a secret has no route into any JSON response.
 */
export function textProviderCredential() {
  const stored = cachedModelSettings();
  if (stored?.enabled) {
    // A key typed into Settings wins; otherwise fall back to the deployment's,
    // resolved against the endpoint the settings chose rather than the one the
    // environment names.
    return storedApiKey() || envCredentialFor(canonicalBaseUrl(stored.baseUrl));
  }
  return envCredentialFor(process.env.MODEL_BASE_URL);
}
