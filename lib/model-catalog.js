/**
 * Live model catalogue and connection check for the configured endpoint.
 *
 * Choosing a model by typing its id is guesswork -- a typo or a retired slug
 * only shows up as a failure on the first generation. So the panel asks the
 * endpoint what it serves (`GET {baseUrl}/models`, which every
 * OpenAI-compatible server implements) and offers those, and can prove the
 * credential works before an instructor relies on it.
 *
 * Both calls are made server-side with the resolved credential. Neither the key
 * nor the endpoint's raw error body reaches the client: an upstream 401 body can
 * echo request details, so only a status-derived summary is returned.
 */
import { textProvider, textProviderCredential } from './providers.js';

const TIMEOUT_MS = 15_000;
const MAX_MODELS = 400;

function catalogError(message, code, status = 502) {
  const error = new Error(message);
  error.code = code;
  error.status = status;
  return error;
}

/** Human summary for an upstream status, without echoing its body. */
function upstreamReason(status) {
  if (status === 401 || status === 403) {
    return 'The endpoint rejected the API key. Check the credential in Secret Manager '
      + '(MODEL_API_KEY or OPENAI_API_KEY) or the key entered in Settings.';
  }
  if (status === 404) {
    return 'The endpoint has no /models route. Check the base URL -- it usually ends in /v1.';
  }
  if (status === 429) return 'The endpoint is rate limiting this key right now.';
  if (status >= 500) return 'The endpoint reported a server error.';
  return `The endpoint refused the request (HTTP ${status}).`;
}

async function callEndpoint(path, { baseUrl, apiKey, init = {} }) {
  const base = String(baseUrl || '').replace(/\/+$/, '');
  if (!base) throw catalogError('No endpoint is configured.', 'NO_PROVIDER', 503);
  let response;
  try {
    response = await fetch(`${base}${path}`, {
      ...init,
      signal: AbortSignal.timeout(TIMEOUT_MS),
      headers: {
        ...(init.headers || {}),
        ...(apiKey ? { authorization: `Bearer ${apiKey}` } : {}),
      },
    });
  } catch (cause) {
    throw catalogError(
      cause?.name === 'TimeoutError'
        ? 'The endpoint did not respond within 15 seconds.'
        : `The endpoint could not be reached: ${cause?.message || 'connection failed'}`,
      'MODEL_UNAVAILABLE',
      502,
    );
  }
  if (!response.ok) {
    throw catalogError(upstreamReason(response.status), 'MODEL_UNAVAILABLE', 502);
  }
  return response.json();
}

/*
 * A catalogue includes far more than text generation -- embeddings, audio,
 * images, moderation, and dated snapshots of each. Instructors are not expected
 * to know which of those can write a lesson, so the list is filtered to chat
 * models and the noise is dropped.
 *
 * These are patterns over ids the endpoint itself reports, never a hardcoded
 * list of model names: a slug this code invented could stop existing, and the
 * point of asking the endpoint is to avoid guessing.
 */
const NOT_CHAT = /(embed|moderation|whisper|tts|audio|speech|image|dall-?e|vision-preview|realtime|transcribe|search|rerank|guard)/i;
const CHAT_HINT = /^(gpt|o[1-9]|chatgpt|claude|gemini|llama|mistral|mixtral|qwen|deepseek|phi|gemma|command|yi|glm)/i;

/** A snapshot like `gpt-4o-2024-05-13` duplicates its own base alias. */
function isDatedSnapshot(id) {
  return /-(?:19|20)\d{2}-\d{2}-\d{2}$/.test(id) || /-\d{4}$/.test(id);
}

function friendlyLabel(id) {
  return id
    .replace(/^gpt-/i, 'GPT-')
    .replace(/-turbo/i, ' Turbo')
    .replace(/-mini/i, ' mini')
    .replace(/-nano/i, ' nano')
    .replace(/-preview/i, ' (preview)')
    .replace(/-latest/i, ' (latest)');
}

/**
 * Model ids the configured endpoint serves.
 *
 * `baseUrl`/`apiKey` override the active configuration so the panel can list
 * models for an endpoint the operator is still typing, before saving it. An
 * overriding endpoint with no explicit key reuses the deployment credential,
 * which is the normal case when the key lives in Secret Manager.
 *
 * `chatOnly` (the default) filters to models that can plausibly write a lesson.
 * Callers that want the unfiltered catalogue can turn it off.
 */
export async function listModels({ baseUrl, apiKey, chatOnly = true } = {}) {
  const status = textProvider();
  const endpoint = baseUrl || status.baseUrl;
  const credential = apiKey || textProviderCredential();
  const json = await callEndpoint('/models', { baseUrl: endpoint, apiKey: credential });

  const raw = Array.isArray(json?.data) ? json.data : (Array.isArray(json) ? json : []);
  const seen = new Set();
  let ids = [];
  for (const entry of raw) {
    const id = typeof entry === 'string' ? entry : entry?.id;
    if (typeof id !== 'string' || !id.trim()) continue;
    const clean = id.trim();
    if (seen.has(clean)) continue;
    seen.add(clean);
    ids.push(clean);
  }

  const all = [...ids].sort((a, b) => a.localeCompare(b));
  if (chatOnly) {
    const filtered = ids.filter((id) => !NOT_CHAT.test(id) && CHAT_HINT.test(id));
    // Only apply the snapshot trim when a base alias actually survives, so an
    // endpoint that serves *only* dated ids does not come back empty.
    const bases = filtered.filter((id) => !isDatedSnapshot(id));
    ids = bases.length ? bases : filtered;
    // An unrecognised naming scheme should degrade to "everything the endpoint
    // said" rather than an empty picker.
    if (!ids.length) ids = all;
  } else {
    ids = all;
  }

  ids.sort((a, b) => a.localeCompare(b));
  const capped = ids.slice(0, MAX_MODELS);
  return {
    baseUrl: endpoint,
    models: capped.map((id) => ({ id, label: friendlyLabel(id) })),
    total: all.length,
    filtered: chatOnly,
    truncated: ids.length > capped.length,
  };
}

/**
 * Prove the configured model actually answers, with the smallest possible
 * request. This is the only place the product deliberately spends a token on
 * something that is not course content, and it is operator-initiated.
 */
export async function testConnection({ baseUrl, modelId, apiKey } = {}) {
  const status = textProvider();
  const endpoint = baseUrl || status.baseUrl;
  const model = modelId || status.model;
  if (!model) throw catalogError('No model is selected.', 'BAD_REQUEST', 400);
  const credential = apiKey || textProviderCredential();

  // Deliberately tiny: this checks reachability, auth and that the model id
  // resolves, not generation quality. The token-limit parameter is spelled
  // differently across servers (see lib/model.js), so try both rather than
  // failing a working endpoint over a parameter name.
  const attempt = (limitKey) => callEndpoint('/chat/completions', {
    baseUrl: endpoint,
    apiKey: credential,
    init: {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        model,
        messages: [{ role: 'user', content: 'ok' }],
        [limitKey]: 1,
      }),
    },
  });

  let json;
  try {
    json = await attempt('max_completion_tokens');
  } catch (first) {
    try {
      json = await attempt('max_tokens');
    } catch {
      throw first;
    }
  }

  return {
    ok: true,
    model: typeof json?.model === 'string' ? json.model : model,
    endpoint,
    usedTokens: Number.isFinite(json?.usage?.total_tokens) ? json.usage.total_tokens : null,
  };
}
