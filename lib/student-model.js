/**
 * Student chat model adapter.
 *
 * Learner chat normally uses the explicitly selected hosted OpenAI model. A
 * separately configured, private OpenAI-compatible server can be used when
 * hosted transport is unavailable, or as the deliberate primary for an
 * air-gapped installation that has no hosted student configuration at all.
 * Credentials never leave this module.
 */
import { primeModelSettings } from './model-settings.js';
import { textProvider, textProviderCredential } from './providers.js';
import { isIP } from 'node:net';

export const STUDENT_OPENAI_BASE_URL = 'https://api.openai.com/v1';
export const STUDENT_MODEL_REQUEST_LABEL = 'GPT 6 Astra';

const HOSTED_CATALOG_TIMEOUT_MS = 10_000;
const HOSTED_CHAT_TIMEOUT_MS = 18_000;
const LOCAL_CATALOG_TIMEOUT_MS = 5_000;
const LOCAL_CHAT_TIMEOUT_MS = 15_000;
const MAX_CATALOG_MODELS = 400;
const MAX_COMPLETION_TOKENS = 3000;

function studentError(message, code, status = 503) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

export function isStudentHostedTransportError(error) {
  return error?.code === 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE';
}

function officialEndpoint(value) {
  return typeof value === 'string' && value.replace(/\/+$/, '') === STUDENT_OPENAI_BASE_URL;
}

function explicitString(value) {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function localBaseUrl(value) {
  if (!explicitString(value)) return null;
  let url;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  if (
    (url.protocol !== 'http:' && url.protocol !== 'https:')
    || url.username
    || url.password
    || url.search
    || url.hash
    || !isPrivateHost(url.hostname)
  ) {
    return null;
  }
  return url.toString().replace(/\/+$/, '');
}

function isPrivateHost(hostname) {
  const host = String(hostname).toLowerCase().replace(/^\[|\]$/g, '');
  if (host === 'localhost') return true;
  if (isIP(host) === 4) {
    const [first, second] = host.split('.').map(Number);
    return first === 127
      || first === 10
      || (first === 192 && second === 168)
      || (first === 172 && second >= 16 && second <= 31)
      || (first === 169 && second === 254);
  }
  // IPv6 unique-local and link-local ranges are private networks too.
  return isIP(host) === 6 && (/^(?:fc|fd)/.test(host) || /^fe[89ab]/.test(host));
}

function boundedSignal(signal, timeoutMs) {
  const timeout = AbortSignal.timeout(timeoutMs);
  if (!signal) return timeout;
  if (typeof AbortSignal.any === 'function') return AbortSignal.any([signal, timeout]);
  const controller = new AbortController();
  const abort = () => controller.abort();
  signal.addEventListener('abort', abort, { once: true });
  timeout.addEventListener('abort', abort, { once: true });
  return controller.signal;
}

function publicStatus({ ready, verified = false, reason, code, model = null, active = null, path = null } = {}) {
  const hosted = path !== 'local';
  return {
    ready: Boolean(ready),
    verified: Boolean(verified),
    provider: hosted ? 'openai' : 'openai-compatible',
    // Do not expose an internal topology in public status. The model path is
    // enough for an operator and is safe to persist with a learner turn.
    endpoint: hosted ? STUDENT_OPENAI_BASE_URL : null,
    model,
    path,
    requestedModel: {
      label: STUDENT_MODEL_REQUEST_LABEL,
      configuredId: model,
      catalogVerified: Boolean(verified),
    },
    active,
    ...(ready ? {} : { reason, code }),
  };
}

function sharedPublicConfiguration(configured) {
  const model = explicitString(configured?.model);
  return {
    source: configured?.source || null,
    endpoint: officialEndpoint(configured?.baseUrl) ? STUDENT_OPENAI_BASE_URL : null,
    model,
  };
}

async function hostedConfiguration() {
  const requestedStudentModel = explicitString(process.env.STUDENT_MODEL_ID);
  // A direct student selection is independent of the operator-managed
  // generation setting, so it must remain usable when that settings store is
  // unavailable (including a local-only runtime).
  if (requestedStudentModel) {
    const apiKey = explicitString(process.env.OPENAI_API_KEY);
    const active = { source: 'student-env', endpoint: STUDENT_OPENAI_BASE_URL, model: requestedStudentModel };
    if (!apiKey) {
      return {
        ready: false, configured: true, code: 'STUDENT_MODEL_UNCONFIGURED',
        reason: 'Student chat requires OPENAI_API_KEY with STUDENT_MODEL_ID.', model: requestedStudentModel, active,
      };
    }
    return {
      ready: true, configured: true, apiKey, model: requestedStudentModel, active, path: 'hosted',
      baseUrl: STUDENT_OPENAI_BASE_URL,
    };
  }
  try {
    await primeModelSettings();
    const configured = textProvider();
    const active = sharedPublicConfiguration(configured);
    if (!officialEndpoint(configured?.baseUrl)) {
      return {
        ready: false, configured: false, code: 'STUDENT_MODEL_UNCONFIGURED',
        reason: 'Student chat requires STUDENT_MODEL_ID or an official OpenAI shared setting.',
        model: active.model, active,
      };
    }
    if (!active.model) {
      return {
        ready: false, configured: true, code: 'STUDENT_MODEL_UNCONFIGURED',
        reason: 'Student chat requires an explicitly configured model id.', model: null, active,
      };
    }
    const apiKey = textProviderCredential();
    if (!configured.ready || !apiKey) {
      return {
        ready: false, configured: true, code: 'STUDENT_MODEL_UNCONFIGURED',
        reason: 'Student chat requires an available OpenAI credential.', model: active.model, active,
      };
    }
    return {
      ready: true, configured: true, apiKey, model: active.model, active, path: 'hosted',
      baseUrl: STUDENT_OPENAI_BASE_URL,
    };
  } catch {
    return {
      ready: false, configured: true, code: 'STUDENT_MODEL_UNCONFIGURED',
      reason: 'Student chat configuration is unavailable.', model: null, active: null,
    };
  }
}

async function localConfiguration() {
  const rawBaseUrl = explicitString(process.env.STUDENT_LOCAL_BASE_URL);
  const model = explicitString(process.env.STUDENT_LOCAL_MODEL_ID);
  const apiKey = explicitString(process.env.STUDENT_LOCAL_API_KEY);
  const explicit = ['STUDENT_LOCAL_BASE_URL', 'STUDENT_LOCAL_MODEL_ID', 'STUDENT_LOCAL_API_KEY']
    .some((key) => process.env[key] !== undefined);
  if (!explicit) {
    // The original offline generation selection is permitted only when it is
    // already a private, exact-model OpenAI-compatible configuration.
    try {
      await primeModelSettings();
      const shared = textProvider();
      const baseUrl = localBaseUrl(shared?.baseUrl);
      const sharedModel = explicitString(shared?.model);
      if (baseUrl && sharedModel && shared?.ready) {
        return {
          ready: true, configured: true, apiKey: textProviderCredential() || null, model: sharedModel,
          active: { source: 'shared-local-provider', endpoint: null, model: sharedModel },
          path: 'local', baseUrl,
        };
      }
    } catch {
      // No local selection can be proved without a valid provider snapshot.
    }
    return {
      ready: false, configured: false, code: 'STUDENT_LOCAL_MODEL_UNCONFIGURED',
      reason: 'No local student model is configured.', model: null, active: null, path: 'local',
    };
  }
  const baseUrl = localBaseUrl(rawBaseUrl);
  if (!baseUrl || !model) {
    return {
      ready: false, configured: true, code: 'STUDENT_LOCAL_MODEL_UNCONFIGURED',
      reason: 'Local student chat requires a private STUDENT_LOCAL_BASE_URL and STUDENT_LOCAL_MODEL_ID.',
      model, active: { source: 'student-local-env', endpoint: null, model }, path: 'local',
    };
  }
  return {
    ready: true, configured: true, apiKey, model,
    active: { source: 'student-local-env', endpoint: null, model },
    path: 'local', baseUrl,
  };
}

async function selectedConfiguration(path = 'auto') {
  if (path === 'local') return localConfiguration();
  const hosted = await hostedConfiguration();
  if (path === 'hosted') return hosted;
  // Local is primary only when hosted student chat was not configured at all.
  // A hosted selection with a missing/revoked key must fail explicitly rather
  // than silently downgrading to a different model.
  if (hosted.ready || hosted.configured) return hosted;
  const local = await localConfiguration();
  // Preserve the established "student model unconfigured" result when neither
  // path is configured; local-specific errors are useful only after an
  // operator has attempted to configure the local path.
  return local.configured ? local : hosted;
}

export async function studentModelPreferredPath() {
  const selected = await selectedConfiguration();
  return selected.path === 'local' ? 'local' : 'hosted';
}

function unavailableFor(configuration, detail) {
  if (configuration.path === 'local') {
    return studentError(detail, 'STUDENT_LOCAL_MODEL_UNAVAILABLE', 502);
  }
  return studentError(detail, 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE', 502);
}

async function catalogueHasModel(configuration, signal) {
  let response;
  try {
    response = await fetch(`${configuration.baseUrl}/models`, {
      signal: boundedSignal(
        signal,
        configuration.path === 'local' ? LOCAL_CATALOG_TIMEOUT_MS : HOSTED_CATALOG_TIMEOUT_MS,
      ),
      redirect: configuration.path === 'local' ? 'error' : 'follow',
      headers: configuration.apiKey ? { authorization: `Bearer ${configuration.apiKey}` } : {},
    });
  } catch {
    if (signal?.aborted) {
      throw studentError('The student model request was cancelled.', 'STUDENT_MODEL_REQUEST_ABORTED', 503);
    }
    throw unavailableFor(configuration, 'The student model catalogue could not be reached.');
  }
  if (!response.ok) {
    throw studentError(
      'The student model catalogue is unavailable.',
      configuration.path === 'local' ? 'STUDENT_LOCAL_MODEL_CATALOG_UNAVAILABLE' : 'STUDENT_MODEL_CATALOG_UNAVAILABLE',
      502,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw studentError(
      'The student model catalogue returned an unreadable response.',
      configuration.path === 'local' ? 'STUDENT_LOCAL_MODEL_CATALOG_UNAVAILABLE' : 'STUDENT_MODEL_CATALOG_UNAVAILABLE',
      502,
    );
  }
  const entries = Array.isArray(payload?.data) ? payload.data : (Array.isArray(payload) ? payload : []);
  const count = Math.min(entries.length, MAX_CATALOG_MODELS);
  for (let index = 0; index < count; index += 1) {
    const id = typeof entries[index] === 'string' ? entries[index] : entries[index]?.id;
    if (typeof id === 'string' && id.trim() === configuration.model) return true;
  }
  return false;
}

async function checkedStudentModel({ signal, path = 'auto' } = {}) {
  const configuration = await selectedConfiguration(path);
  if (!configuration.ready) return configuration;
  const available = await catalogueHasModel(configuration, signal);
  if (!available) {
    return {
      ready: false,
      code: configuration.path === 'local' ? 'STUDENT_LOCAL_MODEL_UNAVAILABLE' : 'STUDENT_MODEL_UNAVAILABLE',
      reason: configuration.path === 'local'
        ? 'The required local student model is not available.'
        : 'The required student model is not available from OpenAI.',
      model: configuration.model, active: configuration.active, path: configuration.path,
    };
  }
  return { ...configuration, ready: true, verified: true };
}

export async function studentModelStatus({ signal } = {}) {
  try {
    return publicStatus(await checkedStudentModel({ signal }));
  } catch (error) {
    return publicStatus({
      ready: false, code: error?.code || 'STUDENT_MODEL_UNAVAILABLE',
      reason: error?.code === 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE'
        ? 'The OpenAI model catalogue could not be reached.'
        : 'The student model catalogue is unavailable.',
      path: null,
    });
  }
}

function responseContent(message) {
  if (typeof message?.content === 'string') return message.content.trim();
  if (!Array.isArray(message?.content)) return '';
  return message.content
    .map((part) => (typeof part === 'string' ? part : (typeof part?.text === 'string' ? part.text : '')))
    .join('')
    .trim();
}

function requestInput(system, prompt) {
  if (typeof system !== 'string' || typeof prompt !== 'string') {
    throw studentError(
      'Student chat requires string system and prompt messages.',
      'STUDENT_MODEL_BAD_REQUEST',
      400,
    );
  }
}

async function askStudentModel(system, prompt, verified, signal) {
  requestInput(system, prompt);
  const configuration = await selectedConfiguration(verified.path);
  if (!configuration.ready) throw studentError(configuration.reason, configuration.code);
  if (configuration.model !== verified.model || configuration.baseUrl !== verified.baseUrl) {
    throw studentError(
      'Student chat configuration changed; recreate chat after catalogue verification.',
      'STUDENT_MODEL_UNCONFIGURED',
    );
  }
  let response;
  try {
    response = await fetch(`${configuration.baseUrl}/chat/completions`, {
      method: 'POST',
      signal: boundedSignal(
        signal,
        configuration.path === 'local' ? LOCAL_CHAT_TIMEOUT_MS : HOSTED_CHAT_TIMEOUT_MS,
      ),
      redirect: configuration.path === 'local' ? 'error' : 'follow',
      headers: {
        'content-type': 'application/json',
        ...(configuration.apiKey ? { authorization: `Bearer ${configuration.apiKey}` } : {}),
      },
      body: JSON.stringify({
        model: verified.model,
        ...(configuration.path === 'local'
          ? { max_tokens: MAX_COMPLETION_TOKENS }
          : { max_completion_tokens: MAX_COMPLETION_TOKENS }),
        messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
        response_format: { type: 'json_object' },
      }),
    });
  } catch {
    if (signal?.aborted) {
      throw studentError('The student model request was cancelled.', 'STUDENT_MODEL_REQUEST_ABORTED', 503);
    }
    throw unavailableFor(configuration, 'The student model could not be reached.');
  }
  if (!response.ok && configuration.path === 'local' && response.status === 400) {
    let detail = '';
    try {
      detail = await response.text();
    } catch {
      // An unreadable error body is still a normal local request failure.
    }
    if (/(unsupported|unrecognized|unknown|not supported|invalid)[^.]{0,40}max_tokens|max_tokens[^.]{0,40}(is not supported|unsupported|not recognized)/i.test(detail)) {
      try {
        response = await fetch(`${configuration.baseUrl}/chat/completions`, {
          method: 'POST',
          signal: boundedSignal(signal, LOCAL_CHAT_TIMEOUT_MS),
          redirect: 'error',
          headers: {
            'content-type': 'application/json',
            ...(configuration.apiKey ? { authorization: `Bearer ${configuration.apiKey}` } : {}),
          },
          body: JSON.stringify({
            model: verified.model,
            max_completion_tokens: MAX_COMPLETION_TOKENS,
            messages: [{ role: 'system', content: system }, { role: 'user', content: prompt }],
            response_format: { type: 'json_object' },
          }),
        });
      } catch {
        if (signal?.aborted) throw studentError('The student model request was cancelled.', 'STUDENT_MODEL_REQUEST_ABORTED', 503);
        throw unavailableFor(configuration, 'The student model could not be reached.');
      }
    }
  }
  if (!response.ok) {
    throw studentError(
      `The student model request failed (HTTP ${response.status}).`,
      configuration.path === 'local' ? 'STUDENT_LOCAL_MODEL_REQUEST_FAILED' : 'STUDENT_MODEL_PROVIDER_FAILURE',
      502,
    );
  }
  let payload;
  try {
    payload = await response.json();
  } catch {
    throw studentError(
      'The student model returned an unreadable response.',
      configuration.path === 'local' ? 'STUDENT_LOCAL_MODEL_BAD_RESPONSE' : 'STUDENT_MODEL_BAD_RESPONSE',
      502,
    );
  }
  if (typeof payload?.choices?.[0]?.message?.refusal === 'string' && !responseContent(payload.choices[0].message)) {
    throw studentError('The student model refused this request.', 'STUDENT_MODEL_REFUSAL', 422);
  }
  const text = responseContent(payload?.choices?.[0]?.message);
  if (!text) {
    throw studentError(
      'The student model returned no JSON object.',
      configuration.path === 'local' ? 'STUDENT_LOCAL_MODEL_BAD_RESPONSE' : 'STUDENT_MODEL_BAD_RESPONSE',
      502,
    );
  }
  try {
    const value = JSON.parse(text);
    if (!value || typeof value !== 'object' || Array.isArray(value)) throw new TypeError('not an object');
    return value;
  } catch {
    throw studentError(
      'The student model returned an invalid JSON object.',
      configuration.path === 'local' ? 'STUDENT_LOCAL_MODEL_BAD_RESPONSE' : 'STUDENT_MODEL_BAD_RESPONSE',
      502,
    );
  }
}

/**
 * Create a Sourcerer/Understudy-compatible JSON callback. `path: 'auto'`
 * preserves hosted GPT 6 Astra as primary; it selects local only for a truly
 * local-only installation. Grounding uses `path: 'local'` for its one bounded
 * whole-turn retry after a hosted transport failure.
 */
export async function createStudentChat({ signal, path = 'auto' } = {}) {
  const checked = await checkedStudentModel({ signal, path });
  if (!checked.ready) throw studentError(checked.reason, checked.code);
  const chat = async (system, prompt) => askStudentModel(system, prompt, checked, signal);
  Object.defineProperty(chat, 'studentModelPath', { value: checked.path, enumerable: false });
  return chat;
}