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
  OPENROUTER_MODEL_ID,
  textProvider,
  textProviderCredential,
} from './providers.js';

export const providerStatus = textProvider;

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
export async function generateJSON({ system, cacheable, prompt, schema, maxTokens = 8000 }) {
  const status = providerStatus();
  if (!status.ready) {
    const err = new Error(status.reason);
    err.code = 'NO_PROVIDER';
    throw err;
  }
  return openAICompatJSON({ status, system, cacheable, prompt, schema, maxTokens });
}

/**
 * Generate prose for narrative capabilities. Unlike generateJSON, this deliberately omits
 * response_format so OpenRouter/Gemini can return ordinary instructor-facing text.
 */
export async function generateText({ system, cacheable, prompt, maxTokens = 8000 }) {
  const status = providerStatus();
  if (!status.ready) {
    const err = new Error(status.reason);
    err.code = 'NO_PROVIDER';
    throw err;
  }
  return openAICompatText({ status, system, cacheable, prompt, maxTokens });
}

/**
 * Generic JSON ask seam used by the Coursewright/Rubricon/Sourcerer/Whetstone
 * adapters (lib/arsenal-core.js). It shares the same configured provider and
 * has no mock or cloud fallback.
 */
export async function askJSON({ system, prompt, schema, maxTokens = 4000 }) {
  const status = providerStatus();
  if (!status.ready) {
    const err = new Error(status.reason);
    err.code = 'NO_PROVIDER';
    throw err;
  }
  return openAICompatJSON({ status, system, prompt, schema, maxTokens });
}

/**
 * Generic prose ask seam used by evidence adapters whose contract is narrative text rather than
 * JSON. In particular, Hotwash's instructor AAR is intentionally prose and must not inherit the
 * JSON response format used by the structured learning agents.
 */
export async function askText({ system, prompt, maxTokens = 4000 }) {
  const status = providerStatus();
  if (!status.ready) {
    const err = new Error(status.reason);
    err.code = 'NO_PROVIDER';
    throw err;
  }
  return openAICompatText({ status, system, prompt, maxTokens });
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

function openRouterReasoning(status) {
  if (status.provider !== 'openrouter' || status.model !== OPENROUTER_MODEL_ID) return {};
  // Gemini 3.1 Pro has mandatory reasoning and supports low effort. Excluding the reasoning
  // trace keeps it out of message.content; the low effort level preserves visible output budget.
  return {
    reasoning: {
      effort: 'low',
      exclude: true,
    },
  };
}

async function openAICompatRequest({ status, body }) {
  const base = status.baseUrl.replace(/\/$/, '');
  // Resolved separately from `status` so the credential has no path into a
  // serialized provider status (see lib/providers.js).
  const apiKey = textProviderCredential();
  let res;
  try {
    res = await fetch(`${base}/chat/completions`, {
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
  if (!res.ok) {
    const error = new Error(
      `Model endpoint ${res.status}: ${(await res.text()).slice(0, 300)}`,
    );
    error.code = 'MODEL_UNAVAILABLE';
    error.details = { httpStatus: res.status };
    throw error;
  }
  const json = await res.json();
  lastResponseMeta = responseMetadata(json);
  return json;
}

async function openAICompatJSON({ status, system, cacheable, prompt, schema, maxTokens }) {
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
    ...openRouterReasoning(status),
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
  const text = contentText(message?.content);
  try {
    const data = JSON.parse(text);
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

async function openAICompatText({ status, system, cacheable, prompt, maxTokens }) {
  const body = {
    model: status.model,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: [cacheable, prompt].filter(Boolean).join('\n\n') },
    ],
    ...openRouterReasoning(status),
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
  if (!text) {
    const error = new Error('Model returned empty prose');
    error.code = 'MODEL_BAD_RESPONSE';
    error.details = responseMetadata(json);
    throw error;
  }
  return { data: text, usage: json.usage, model: json.model };
}
