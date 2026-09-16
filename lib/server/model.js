/**
 * Model adapter.
 *
 * Every model call in the app goes through here. Feature code never imports a
 * vendor SDK directly, so swapping the backing model -- including to whatever
 * on-prem compute is available at the event -- is a change to this file only.
 *
 * Provider, selected by environment:
 *   MODEL_BASE_URL  -> any OpenAI-compatible endpoint (a served open-weight LLM:
 *                      the on-device gen model, vLLM, Ollama, TGI, ...)
 *   unset           -> unconfigured; callers must surface an explicit 503
 *
 * The product is offline and grounded: generation runs against self-hosted
 * compute. The same adapter reaches a hosted OpenAI-compatible endpoint for
 * development when MODEL_BASE_URL / MODEL_API_KEY are pointed at one; no
 * provider is ever selected by a key alone.
 */

import { textProvider } from './providers.js';

export const providerStatus = textProvider;

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
  return openAICompatJSON({ system, cacheable, prompt, schema, maxTokens });
}

/**
 * Generic JSON ask seam used by the upstream Coursewright/Rubricon/Sourcerer/
 * Whetstone adapters. It shares the same configured provider and has no mock
 * or cloud fallback.
 */
export async function askJSON({ system, prompt, schema, maxTokens = 4000 }) {
  const status = providerStatus();
  if (!status.ready) {
    const err = new Error(status.reason);
    err.code = 'NO_PROVIDER';
    throw err;
  }
  return openAICompatJSON({ system, prompt, schema, maxTokens });
}

/* ---------------- OpenAI-compatible (self-hosted) ---------------- */

async function openAICompatJSON({ system, cacheable, prompt, schema, maxTokens }) {
  const base = process.env.MODEL_BASE_URL.replace(/\/$/, '');
  const apiKey = process.env.MODEL_API_KEY;
  const body = {
    model: process.env.MODEL_ID,
    max_tokens: maxTokens,
    messages: [
      { role: 'system', content: system },
      { role: 'user', content: [cacheable, prompt].filter(Boolean).join('\n\n') },
    ],
    // Companion libraries specify their JSON shape in the prompt and pass an
    // unconstrained object schema. Use JSON mode for that contract; providers
    // reject it as a structured schema without explicit properties.
    response_format: schema?.type === 'object' && !schema.properties
      ? { type: 'json_object' }
      : { type: 'json_schema', json_schema: { name: 'result', schema } },
  };
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
    throw error;
  }
  const json = await res.json();
  const text = json.choices?.[0]?.message?.content ?? '';
  try {
    return { data: JSON.parse(text), usage: json.usage, model: json.model };
  } catch (cause) {
    const error = new Error(`Model returned invalid JSON: ${cause.message}`);
    error.code = 'MODEL_BAD_RESPONSE';
    throw error;
  }
}
