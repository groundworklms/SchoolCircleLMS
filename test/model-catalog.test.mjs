/*
 * Model catalogue.
 *
 * The picker is the whole simple path for an instructor, so what it shows has
 * to be right: chat models only, no dated duplicates, and never an empty list
 * just because an endpoint names things unexpectedly. The upstream key and the
 * upstream error body must not come back either.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

mock.module('../lib/db.js', {
  namedExports: {
    db: { learningRecord: { async findUnique() { return null; } } },
    async updateLearningRecordIfVersion() { return true; },
  },
});

const { listModels, testConnection } = await import('../lib/model-catalog.js');
const { primeModelSettings, invalidateModelSettings } = await import('../lib/model-settings.js');

const ENV_KEYS = ['MODEL_BASE_URL', 'MODEL_ID', 'MODEL_API_KEY', 'OPENAI_API_KEY', 'OPENROUTER_API_KEY'];
let savedEnv = {};
let calls = [];
const realFetch = globalThis.fetch;

function respond(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
    async text() { return JSON.stringify(body); },
  };
}

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  process.env.MODEL_BASE_URL = 'https://api.openai.com/v1';
  process.env.MODEL_ID = 'configured-model';
  process.env.OPENAI_API_KEY = 'sk-catalog-test-4242';
  invalidateModelSettings();
  await primeModelSettings();
  calls = [];
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [k, v] of Object.entries(savedEnv)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  invalidateModelSettings();
});

function stubFetch(handler) {
  globalThis.fetch = async (url, init) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
}

test('the catalogue keeps chat models and drops the rest', async () => {
  stubFetch(() => respond({
    data: [
      { id: 'gpt-4o' },
      { id: 'gpt-4o-mini' },
      { id: 'gpt-4o-2024-05-13' },       // dated duplicate of gpt-4o
      { id: 'text-embedding-3-large' },  // not chat
      { id: 'whisper-1' },               // not chat
      { id: 'dall-e-3' },                // not chat
      { id: 'omni-moderation-latest' },  // not chat
      { id: 'tts-1' },                   // not chat
      { id: 'o3-mini' },
    ],
  }));

  const result = await listModels();
  const ids = result.models.map((m) => m.id);
  assert.deepEqual(ids, ['gpt-4o', 'gpt-4o-mini', 'o3-mini']);
  assert.equal(result.total, 9, 'the unfiltered count is still reported');
  assert.equal(result.filtered, true);

  // Labels are friendlier than raw slugs but still identify the model.
  const labels = result.models.map((m) => m.label);
  assert.ok(labels.includes('GPT-4o'));
  assert.ok(labels.some((l) => l.includes('mini')));
});

test('an unfamiliar naming scheme falls back to the full list instead of an empty picker', async () => {
  stubFetch(() => respond({
    data: [{ id: 'house-model-alpha' }, { id: 'house-model-beta' }],
  }));
  const result = await listModels();
  assert.deepEqual(result.models.map((m) => m.id), ['house-model-alpha', 'house-model-beta']);
});

test('an endpoint serving only dated ids still returns them', async () => {
  stubFetch(() => respond({ data: [{ id: 'gpt-4o-2024-05-13' }, { id: 'gpt-4o-2024-08-06' }] }));
  const result = await listModels();
  assert.equal(result.models.length, 2, 'the snapshot trim must not empty the list');
});

test('the request carries the resolved credential and the response never returns it', async () => {
  stubFetch(() => respond({ data: [{ id: 'gpt-4o' }] }));
  const result = await listModels();
  assert.equal(calls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-catalog-test-4242');
  assert.ok(!JSON.stringify(result).includes('sk-catalog-test-4242'));
});

test('an upstream rejection is summarised, never echoed', async () => {
  stubFetch(() => respond(
    { error: { message: 'Incorrect API key provided: sk-cata***4242. Request id req_abc' } },
    { status: 401 },
  ));
  await assert.rejects(
    () => listModels(),
    (error) => {
      assert.equal(error.code, 'MODEL_UNAVAILABLE');
      assert.match(error.message, /rejected the API key/);
      // The upstream body can echo key fragments and request ids.
      assert.ok(!/sk-cata|req_abc/.test(error.message), 'upstream body must not be echoed');
      return true;
    },
  );
});

test('a wrong base URL is reported as a base URL problem', async () => {
  stubFetch(() => respond({ error: 'not found' }, { status: 404 }));
  await assert.rejects(() => listModels(), (error) => /\/v1/.test(error.message));
});

test('an unreachable endpoint is a reachability error, not a crash', async () => {
  stubFetch(() => { throw new Error('getaddrinfo ENOTFOUND'); });
  await assert.rejects(
    () => listModels(),
    (error) => error.code === 'MODEL_UNAVAILABLE' && /could not be reached/.test(error.message),
  );
});

test('the connection test tries both token-limit parameter spellings', async () => {
  let seen = [];
  stubFetch((url, init) => {
    const body = JSON.parse(init.body);
    seen.push(Object.keys(body).find((k) => k.startsWith('max_')));
    // Mimic a server that only accepts the older spelling.
    if (Object.hasOwn(body, 'max_completion_tokens')) {
      return respond({ error: 'Unsupported parameter: max_completion_tokens' }, { status: 400 });
    }
    return respond({ model: 'gpt-4o', usage: { total_tokens: 3 } });
  });

  const result = await testConnection({ modelId: 'gpt-4o' });
  assert.equal(result.ok, true);
  assert.equal(result.model, 'gpt-4o');
  assert.equal(result.usedTokens, 3);
  assert.deepEqual(seen, ['max_completion_tokens', 'max_tokens'], 'both spellings were tried');
});

test('the connection test reports the first failure when neither spelling works', async () => {
  stubFetch(() => respond({ error: 'nope' }, { status: 401 }));
  await assert.rejects(
    () => testConnection({ modelId: 'gpt-4o' }),
    (error) => error.code === 'MODEL_UNAVAILABLE' && /rejected the API key/.test(error.message),
  );
});

test('the connection test refuses to run without a model', async () => {
  delete process.env.MODEL_ID;
  invalidateModelSettings();
  await primeModelSettings();
  stubFetch(() => respond({}));
  await assert.rejects(
    () => testConnection({}),
    (error) => error.code === 'BAD_REQUEST' && /No model is selected/.test(error.message),
  );
  assert.equal(calls.length, 0, 'nothing was sent upstream');
});

test('the catalogue is readable before any model is chosen', async () => {
  // The intended deployment shape: endpoint and key from configuration, model
  // left to an instructor. Listing models must work in that state, or picking
  // a model would require a model to already be picked.
  delete process.env.MODEL_ID;
  invalidateModelSettings();
  await primeModelSettings();

  const status = (await import('../lib/providers.js')).textProvider();
  assert.equal(status.ready, false, 'not ready without a model');
  assert.equal(status.baseUrl, 'https://api.openai.com/v1', 'but the endpoint is still reported');
  assert.equal(status.credential, 'environment');

  stubFetch(() => respond({ data: [{ id: 'gpt-4o' }, { id: 'gpt-4o-mini' }] }));
  const result = await listModels();
  assert.deepEqual(result.models.map((m) => m.id), ['gpt-4o', 'gpt-4o-mini']);
  assert.equal(calls[0].url, 'https://api.openai.com/v1/models');
  assert.equal(calls[0].init.headers.authorization, 'Bearer sk-catalog-test-4242');
});

test('with no endpoint at all the catalogue reports no provider, not a bad URL', async () => {
  delete process.env.MODEL_BASE_URL;
  delete process.env.MODEL_ID;
  invalidateModelSettings();
  await primeModelSettings();
  stubFetch(() => respond({ data: [] }));
  await assert.rejects(
    () => listModels(),
    (error) => error.code === 'NO_PROVIDER',
  );
  assert.equal(calls.length, 0, 'nothing was sent upstream');
});

/* --------------------------- curation for laymen -------------------------- */

test('code, instruct and realtime models are excluded as unusable for lessons', async () => {
  stubFetch(() => respond({
    data: [
      { id: 'gpt-5.4' }, { id: 'gpt-5.4-mini' },
      { id: 'gpt-5-codex' }, { id: 'gpt-5.1-codex-max' },  // code models
      { id: 'gpt-3.5-turbo-instruct' },                     // not a chat model at all
      { id: 'gpt-live-1' },                                  // realtime
    ],
  }));
  const ids = (await listModels()).models.map((m) => m.id);
  assert.deepEqual(ids, ['gpt-5.4', 'gpt-5.4-mini']);
});

test('the shortlist offers one model per tier, newest first, never the oldest', async () => {
  // Shaped like a real catalogue: the newest family has a single named variant
  // and no mini/nano of its own.
  stubFetch(() => respond({
    data: [
      { id: 'gpt-3.5-turbo' },
      { id: 'gpt-4o' }, { id: 'gpt-4o-mini' },
      { id: 'gpt-5.4' }, { id: 'gpt-5.4-mini' }, { id: 'gpt-5.4-nano' },
      { id: 'gpt-5.5-pro' },
      { id: 'gpt-6-astra' },
    ],
  }));
  const { recommended } = await listModels();
  assert.deepEqual(
    recommended.map((m) => `${m.tier}:${m.id}`),
    ['flagship:gpt-6-astra', 'mini:gpt-5.4-mini', 'nano:gpt-5.4-nano', 'pro:gpt-5.5-pro'],
  );
  // The oldest model must never be presented as the headline choice.
  assert.ok(!recommended.some((m) => m.id.startsWith('gpt-3.5')));
});

test('a single-model family still yields a shortlist rather than nothing', async () => {
  stubFetch(() => respond({ data: [{ id: 'gpt-6-astra' }] }));
  const { recommended } = await listModels();
  assert.deepEqual(recommended.map((m) => m.id), ['gpt-6-astra']);
});

test('an unfamiliar naming scheme still produces a shortlist', async () => {
  stubFetch(() => respond({ data: [{ id: 'house-alpha' }, { id: 'house-beta' }] }));
  const { recommended, models } = await listModels();
  assert.equal(models.length, 2);
  assert.deepEqual(recommended.map((m) => m.id), ['house-alpha', 'house-beta']);
});

test('labels are prettified, and no rule is silently disabled', async () => {
  stubFetch(() => respond({
    data: [{ id: 'gpt-3.5-turbo' }, { id: 'gpt-4o-mini' }, { id: 'gpt-5-nano' },
           { id: 'gpt-5.5-pro' }, { id: 'gpt-5.2-chat-latest' }],
  }));
  const labels = Object.fromEntries((await listModels()).models.map((m) => [m.id, m.label]));
  // A literal backspace byte once replaced the  in these patterns, which
  // disabled every rule after the first while still reading correctly in a
  // terminal. Assert on the output, not the source.
  assert.equal(labels['gpt-3.5-turbo'], 'GPT-3.5 Turbo');
  assert.equal(labels['gpt-4o-mini'], 'GPT-4o mini');
  assert.equal(labels['gpt-5-nano'], 'GPT-5 nano');
  assert.equal(labels['gpt-5.5-pro'], 'GPT-5.5 Pro');
  assert.equal(labels['gpt-5.2-chat-latest'], 'GPT-5.2 chat (latest)');
});

test('the connection test asks for enough budget to finish', async () => {
  // A reasoning model spends its budget before emitting anything, so a limit
  // of 1 returns HTTP 400 "max_tokens ... was reached" against the real API.
  let limits = [];
  stubFetch((url, init) => {
    const body = JSON.parse(init.body);
    limits.push(body.max_completion_tokens ?? body.max_tokens);
    return respond({ model: 'gpt-5.4-mini', usage: { total_tokens: 21 } });
  });
  await testConnection({ modelId: 'gpt-5.4-mini' });
  assert.ok(limits[0] >= 16, `expected a workable budget, got ${limits[0]}`);
});
