/**
 * Model adapter.
 *
 * Every model call in the app goes through here. Feature code never imports a
 * vendor SDK directly, so swapping the backing model -- including to whatever
 * on-prem compute is available at the event -- is a change to this file only.
 *
 * Provider, selected by environment:
 *   MODEL_BASE_URL + MODEL_ID -> any OpenAI-compatible endpoint (a served
 *                      open-weight LLM: the on-device gen model, vLLM, Ollama, TGI, ...)
 *   https://openrouter.ai/api/v1 + MODEL_ID + OPENROUTER_API_KEY
 *                   -> explicitly authorized development/testing path only
 *   Settings -> Generation model
 *                   -> an operator-chosen endpoint stored in the database,
 *                      which wins over the variables above (lib/model-settings.js)
 *   unset           -> unconfigured; callers must surface an explicit 503
 *
 * The product is offline and grounded by default. A key alone never selects a
 * cloud provider; OpenRouter is used only when its exact base URL is selected.
 */

import {
  activeEffortProfile,
  openRouterReasoningModel,
  textProvider,
  textProviderCredential,
} from './providers.js';
import { effortFor } from './reasoning-effort.js';

export const providerStatus = textProvider;

/**
 * How hard the model is asked to think for one kind of call, under whichever
 * effort profile is in force. See lib/reasoning-effort.js for the tiers and
 * why there is one profile rather than three separate dials.
 *
 * Synchronous, like textProvider() and for the same reason: the settings
 * snapshot is primed once per request, and this sits on the path of every
 * generation. A missing or unreadable profile resolves to the default rather
 * than failing the call.
 */
export function reasoningEffort(tier) {
  return effortFor(activeEffortProfile(), tier);
}

let lastResponseMeta = null;

/**
 * Return sanitized metadata for the most recent successful model response. This is intentionally
 * limited to transport/usage fields so diagnostics can inspect a live contract without exposing
 * prompts, completions, headers, or credentials.
 */
export function getLastModelResponseMeta() {
  return lastResponseMeta
    ? {
      ...lastResponseMeta,
      usage: lastResponseMeta.usage ? { ...lastResponseMeta.usage } : undefined,
    }
    : null;
}

/**
 * Generate JSON matching `schema`.
 * `cacheable` is long, stable context (the POI) placed first so it can be cached
 * across the many calls made against one course.
 */
export async function generateJSON({
  system, cacheable, prompt, schema, maxTokens = 8000, effort = reasoningEffort('authoring'),
}) {
  const status = providerStatus();
  if (!status.ready) {
    const err = new Error(status.reason);
    err.code = 'NO_PROVIDER';
    throw err;
  }
  return openAICompatJSON({ status, system, cacheable, prompt, schema, maxTokens, effort });
}

/**
 * Generate prose for narrative capabilities. Unlike generateJSON, this deliberately omits
 * response_format so OpenRouter/Gemini can return ordinary instructor-facing text.
 */
export async function generateText({
  system, cacheable, prompt, maxTokens = 8000, effort = reasoningEffort('authoring'),
}) {
  const status = providerStatus();
  if (!status.ready) {
    const err = new Error(status.reason);
    err.code = 'NO_PROVIDER';
    throw err;
  }
  return openAICompatText({ status, system, cacheable, prompt, maxTokens, effort });
}

/**
 * Generic JSON ask seam used by the Coursewright/Rubricon/Sourcerer/Whetstone
 * adapters (lib/arsenal-core.js). It shares the same configured provider and
 * has no mock or cloud fallback.
 */
export async function askJSON({ system, prompt, schema, maxTokens = 4000, effort = reasoningEffort('helper') }) {
  const status = providerStatus();
  if (!status.ready) {
    const err = new Error(status.reason);
    err.code = 'NO_PROVIDER';
    throw err;
  }
  return openAICompatJSON({ status, system, prompt, schema, maxTokens, effort });
}

/**
 * Generic prose ask seam used by evidence adapters whose contract is narrative text rather than
 * JSON. In particular, Hotwash's instructor AAR is intentionally prose and must not inherit the
 * JSON response format used by the structured learning agents.
 */
export async function askText({ system, prompt, maxTokens = 4000, effort = reasoningEffort('helper') }) {
  const status = providerStatus();
  if (!status.ready) {
    const err = new Error(status.reason);
    err.code = 'NO_PROVIDER';
    throw err;
  }
  return openAICompatText({ status, system, prompt, maxTokens, effort });
}

/* ---------------- OpenAI-compatible providers ---------------- */

function responseFormat(schema) {
  // The generic object seam intentionally has no properties. OpenRouter's
  // structured-output contract accepts JSON mode for that case; concrete
  // schemas use strict JSON Schema enforcement.
  if (schema?.type === 'object' && !schema.properties) {
    return { type: 'json_object' };
  }
  return {
    type: 'json_schema',
    json_schema: {
      name: 'result',
      strict: true,
      schema,
    },
  };
}

function contentText(content) {
  if (typeof content === 'string') return content.trim();
  if (!Array.isArray(content)) return '';
  return content
    .map((part) => {
      if (typeof part === 'string') return part;
      return typeof part?.text === 'string' ? part.text : '';
    })
    .join('')
    .trim();
}

function refusalText(message) {
  return typeof message?.refusal === 'string' ? message.refusal.trim() : '';
}

function numeric(value) {
  return Number.isFinite(value) ? value : undefined;
}

/**
 * Parse a model's JSON answer, tolerating the wrapping models add in JSON mode.
 *
 * A request with a concrete schema is held to it by the provider, but the
 * schema-less seam (response_format json_object) only asks for JSON, and some
 * models -- the Gemini line on OpenRouter in particular -- answer that with the
 * object inside a ```json fence, or with a sentence before it. Rejecting those
 * outright failed whole course plans over formatting, not content.
 *
 * This only ever unwraps: it tries the text as-is, then the body of a fenced
 * block, then the outermost {...} span. Whatever it returns still has to pass
 * JSON.parse and the object check below, and every caller validates the shape
 * after that, so nothing malformed gets through that did not before.
 */
export function parseModelJSON(text) {
  const attempts = [text];
  const fenced = /```(?:json|JSON)?\s*([\s\S]*?)```/.exec(text);
  if (fenced) attempts.push(fenced[1].trim());
  const first = text.indexOf('{');
  const last = text.lastIndexOf('}');
  if (first !== -1 && last > first) attempts.push(text.slice(first, last + 1));
  let firstError;
  for (const candidate of attempts) {
    try {
      return JSON.parse(candidate);
    } catch (error) {
      firstError ??= error;
    }
  }
  throw firstError;
}

/**
 * The model hit its token ceiling before finishing.
 *
 * Worth its own error rather than being left to surface as "invalid JSON",
 * because the cause and the fix are entirely different: the answer was fine
 * and got cut off, so the budget is what needs raising. Reasoning tokens come
 * out of that same ceiling, so a call that raises `effort` without raising
 * `maxTokens` can truncate a request that used to fit -- which is exactly the
 * confusing case this names.
 */
function assertNotTruncated(json, maxTokens) {
  if (json?.choices?.[0]?.finish_reason !== 'length') return;
  const reasoning = numeric(json?.usage?.completion_tokens_details?.reasoning_tokens);
  const error = new Error(
    `Model output was cut off at the ${maxTokens}-token limit`
    + (reasoning ? `, after spending ${reasoning} of it on reasoning` : '')
    + '. Raise maxTokens for this call, or lower its reasoning effort.',
  );
  error.code = 'MODEL_TRUNCATED';
  error.details = responseMetadata(json);
  throw error;
}

function responseMetadata(json) {
  const choice = json?.choices?.[0];
  const message = choice?.message;
  const content = contentText(message?.content);
  const rawUsage = json?.usage;
  const usage = rawUsage && typeof rawUsage === 'object'
    ? {
      prompt_tokens: numeric(rawUsage.prompt_tokens),
      completion_tokens: numeric(rawUsage.completion_tokens),
      total_tokens: numeric(rawUsage.total_tokens),
      reasoning_tokens: numeric(rawUsage.completion_tokens_details?.reasoning_tokens),
    }
    : undefined;
  const metadata = {
    httpStatus: 200,
    model: typeof json?.model === 'string' ? json.model : undefined,
    finishReason: typeof choice?.finish_reason === 'string' ? choice.finish_reason : undefined,
    contentLength: content.length,
    refusal: refusalText(message) || undefined,
    usage,
  };
  if (metadata.usage) {
    metadata.usage = Object.fromEntries(
      Object.entries(metadata.usage).filter(([, value]) => value !== undefined),
    );
  }
  return Object.fromEntries(
    Object.entries(metadata).filter(([, value]) => value !== undefined),
  );
}

function openRouterReasoning(status, effort) {
  if (status.provider !== 'openrouter' || !openRouterReasoningModel(status.model)) return {};
  // A falsy effort omits the parameter, which means the PROVIDER'S default --
  // not "no thinking". For several families that default is more than low, so
  // this is deliberately not reachable from the effort profiles.
  if (!effort) return {};
  // `exclude` is not optional here whatever the effort: an included trace lands
  // in message.content, where it would break the JSON parse. OpenRouter
  // translates the effort level per family (thinkingLevel for Gemini, the
  // native levels for OpenAI and Anthropic), which is why this sends one name
  // rather than a per-vendor table.
  return {
    reasoning: {
      effort,
      exclude: true,
    },
  };
}

/*
 * The token-limit parameter is not uniform across OpenAI-compatible servers:
 * some accept only `max_tokens`, and newer hosted models accept only
 * `max_completion_tokens` and reject the other outright. Since the endpoint and
 * model are operator-chosen at runtime, we cannot know which applies, and
 * guessing wrong turns every generation into a 400.
 *
 * So: send `max_tokens`, and if the endpoint rejects specifically that
 * parameter, retry once with the other spelling. Self-correcting beats a
 * hard-coded table of which host wants which.
 */
// Must match "this parameter is not supported" and NOT "your limit was too
// low" -- OpenAI's too-low message is itself "Could not finish the message
// because max_tokens or model output limit was reached", which named the
// parameter and made an earlier version of this swap to a spelling the model
// genuinely rejects, turning one recoverable error into two.
const TOKEN_PARAM_REJECTED =
  /(unsupported|unrecognized|unknown|not supported|invalid)[^.]{0,40}(max_tokens|max_completion_tokens)|(max_tokens|max_completion_tokens)[^.]{0,40}(is not supported|unsupported|not recognized)/i;

function swapTokenParam(body) {
  if (Object.hasOwn(body, 'max_tokens')) {
    const { max_tokens: value, ...rest } = body;
    return { ...rest, max_completion_tokens: value };
  }
  if (Object.hasOwn(body, 'max_completion_tokens')) {
    const { max_completion_tokens: value, ...rest } = body;
    return { ...rest, max_tokens: value };
  }
  return null;
}

async function postChat({ base, apiKey, body }) {
  try {
    return await fetch(`${base}/chat/completions`, {
      method: 'POST',
      signal: AbortSignal.timeout(60000),
      headers: {
        'content-type': 'application/json',
        ...(apiKey
          ? { authorization: `Bearer ${apiKey}` }
          : {}),
      },
      body: JSON.stringify(body),
    });
  } catch (cause) {
    const error = new Error(`Model endpoint unreachable: ${cause.message}`);
    error.code = 'MODEL_UNAVAILABLE';
    throw error;
  }
}

async function openAICompatRequest({ status, body }) {
  const base = status.baseUrl.replace(/\/$/, '');
  // Resolved separately from `status` so the credential has no path into a
  // serialized provider status (see lib/providers.js).
  const apiKey = textProviderCredential();

  let res = await postChat({ base, apiKey, body });
  let detail = res.ok ? '' : (await res.text()).slice(0, 300);

  if (!res.ok && res.status === 400 && TOKEN_PARAM_REJECTED.test(detail)) {
    const retried = swapTokenParam(body);
    if (retried) {
      res = await postChat({ base, apiKey, body: retried });
      if (!res.ok) detail = (await res.text()).slice(0, 300);
    }
  }

  if (!res.ok) {
    /*
     * Name the request, not just the status.
     *
     * This used to read "Model endpoint 404:" and nothing else whenever the
     * provider answered with an empty body, which is exactly when a reader
     * needs the most help. A 404 from a chat endpoint is almost always one of
     * three things -- the model is not on this account, the base URL is not an
     * API root, or the route does not exist on that provider -- and which one
     * it is cannot be guessed without knowing what was asked of whom. So the
     * message carries the model and the URL, and says outright when the
     * provider sent no explanation, rather than leaving a bare colon that
     * looks like the message was truncated.
     */
    const where = `${base}/chat/completions`;
    const said = detail.trim()
      ? detail.trim()
      : 'the provider sent no explanation. A 404 here usually means the model is not available '
        + 'on this account, or the base URL is not the API root.';
    const error = new Error(
      `Model endpoint ${res.status} for model "${body?.model || 'unset'}" at ${where}: ${said}`,
    );
    error.code = 'MODEL_UNAVAILABLE';
    error.details = { httpStatus: res.status, model: body?.model || '', baseUrl: base };
    throw error;
  }
  const json = await res.json();
  lastResponseMeta = responseMetadata(json);
  return json;
}

async function openAICompatJSON({ status, system, cacheable, prompt, schema, maxTokens, effort }) {
  const body = {
    model: status.model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: [cacheable, prompt].filter(Boolean).join('\n\n') },
    ],
    response_format: status.provider === 'openrouter'
      ? responseFormat(schema)
      : { type: 'json_schema', json_schema: { name: 'result', schema } },
    ...openRouterReasoning(status, effort),
  };
  if (status.provider === 'openrouter') {
    // Do not let OpenRouter route this request to an endpoint that ignores the
    // structured-output contract. This is deliberately not a fallback policy.
    body.provider = { require_parameters: true };
  }
  const json = await openAICompatRequest({ status, body });
  const message = json.choices?.[0]?.message;
  const refusal = refusalText(message);
  if (refusal && !contentText(message?.content)) {
    const error = new Error(`Model refused request: ${refusal.slice(0, 300)}`);
    error.code = 'MODEL_REFUSAL';
    error.details = responseMetadata(json);
    throw error;
  }
  assertNotTruncated(json, maxTokens);
  const text = contentText(message?.content);
  try {
    const data = parseModelJSON(text);
    if (schema?.type === 'object' && (!data || typeof data !== 'object' || Array.isArray(data))) {
      throw new Error('expected a JSON object');
    }
    return { data, usage: json.usage, model: json.model };
  } catch (cause) {
    const error = new Error(`Model returned invalid JSON: ${cause.message}`);
    error.code = 'MODEL_BAD_RESPONSE';
    error.details = responseMetadata(json);
    throw error;
  }
}

async function openAICompatText({ status, system, cacheable, prompt, maxTokens, effort }) {
  const body = {
    model: status.model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: [cacheable, prompt].filter(Boolean).join('\n\n') },
    ],
    ...openRouterReasoning(status, effort),
  };
  const json = await openAICompatRequest({ status, body });
  const message = json.choices?.[0]?.message;
  const refusal = refusalText(message);
  if (refusal && !contentText(message?.content)) {
    const error = new Error(`Model refused request: ${refusal.slice(0, 300)}`);
    error.code = 'MODEL_REFUSAL';
    error.details = responseMetadata(json);
    throw error;
  }
  const text = contentText(message?.content);
  // Only when nothing came back. Unlike JSON, partial prose is still usable, so
  // a truncated-but-non-empty answer is returned as it always was; empty plus
  // `length` is the reasoning-ate-the-whole-budget case, which otherwise
  // surfaces as a bare "empty prose" with no hint of the cause.
  if (!text) assertNotTruncated(json, maxTokens);
  if (!text) {
    const error = new Error('Model returned empty prose');
    error.code = 'MODEL_BAD_RESPONSE';
    error.details = responseMetadata(json);
    throw error;
  }
  return { data: text, usage: json.usage, model: json.model };
}
