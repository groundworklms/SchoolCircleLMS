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
// Verified against a real OpenAI catalogue (132 entries): without `instruct`,
// `codex` and `live` this list offers models that either reject
// /chat/completions outright (the -instruct completions models) or are the
// wrong tool for writing a lesson (code and realtime models).
const NOT_CHAT = /(embed|moderation|whisper|tts|audio|speech|image|dall-?e|vision-preview|realtime|transcribe|search|rerank|guard|codex|instruct|-live|^live)/i;
const CHAT_HINT = /^(gpt|o[1-9]|chatgpt|claude|gemini|llama|mistral|mixtral|qwen|deepseek|phi|gemma|command|yi|glm)/i;

/*
 * Instructors are not expected to choose between 42 near-identical model ids.
 * Offer a handful from the newest family the account actually has, and keep the
 * rest behind a disclosure.
 *
 * The family is derived from the ids the endpoint reported, never hardcoded: a
 * version this code knew about would go stale the moment the account gains a
 * newer one.
 */
const TIERS = [
  { suffix: '', tier: 'flagship' },
  { suffix: '-mini', tier: 'mini' },
  { suffix: '-nano', tier: 'nano' },
  { suffix: '-pro', tier: 'pro' },
];

function familyVersion(id) {
  const match = /^gpt-(\d+(?:\.\d+)?)/i.exec(id);
  return match ? Number.parseFloat(match[1]) : null;
}

/**
 * Up to four ids worth putting in front of an instructor: the flagship, mini,
 * nano and pro variants of the newest GPT family present. Falls back to the
 * first few available ids when the naming is unfamiliar, so the picker is
 * never empty.
 */
function recommendedIds(ids) {
  const families = new Map();
  for (const id of ids) {
    const version = familyVersion(id);
    if (version === null) continue;
    if (!families.has(version)) families.set(version, []);
    families.get(version).push(id);
  }
  const newestFirst = [...families.keys()].sort((a, b) => b - a);

  // One entry per tier, taken from the newest family that actually offers that
  // tier. The newest family alone is often a single id, which would leave the
  // instructor a "choice" of one; filling each tier separately gives a real
  // set -- a default, a cheaper one, and a most-capable one -- without ever
  // recommending an old model as the flagship.
  const picked = new Map();
  for (const version of newestFirst) {
    const family = families.get(version);
    const base = `gpt-${version}`;
    for (const { suffix, tier } of TIERS) {
      if (picked.has(tier)) continue;
      const wanted = `${base}${suffix}`;
      if (family.includes(wanted)) picked.set(tier, wanted);
    }
    // A family with a named variant and no bare alias (e.g. gpt-6-astra) still
    // supplies the flagship, so a new naming scheme does not push the newest
    // model out of the list.
    if (!picked.has('flagship')) {
      const named = family.find((id) => !TIERS.some(({ suffix }) => suffix && id.endsWith(suffix)));
      if (named) picked.set('flagship', named);
    }
    if (picked.size >= 4) break;
  }

  if (picked.size) {
    return TIERS
      .filter(({ tier }) => picked.has(tier))
      .map(({ tier }) => ({ id: picked.get(tier), tier }));
  }
  return ids.slice(0, 4).map((id) => ({ id, tier: 'other' }));
}



/** A snapshot like `gpt-4o-2024-05-13` duplicates its own base alias. */
function isDatedSnapshot(id) {
  return /-(?:19|20)\d{2}-\d{2}-\d{2}$/.test(id) || /-\d{4}$/.test(id);
}

function friendlyLabel(id) {
  // Lookaheads rather than \b: a literal backspace byte once crept in here in
  // place of the escape and silently disabled every rule below the first.
  return id
    .replace(/^gpt-/i, 'GPT-')
    .replace(/-turbo(?=$|-)/i, ' Turbo')
    .replace(/-mini(?=$|-)/i, ' mini')
    .replace(/-nano(?=$|-)/i, ' nano')
    .replace(/-pro(?=$|-)/i, ' Pro')
    .replace(/-preview(?=$|-)/i, ' (preview)')
    .replace(/-latest(?=$|-)/i, ' (latest)')
    .replace(/-chat(?=$| )/i, ' chat');
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
  const recommended = chatOnly ? recommendedIds(capped) : [];
  return {
    baseUrl: endpoint,
    models: capped.map((id) => ({ id, label: friendlyLabel(id) })),
    recommended: recommended.map(({ id, tier }) => ({ id, label: friendlyLabel(id), tier })),
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
        // Not 1: a reasoning-capable model spends its budget before emitting
        // anything and the request fails with "max_tokens ... was reached".
        // 16 is enough to finish a one-word reply; verified against a live
        // GPT-5-family model, where 1 returns HTTP 400 and 16 returns 200.
        [limitKey]: 16,
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
