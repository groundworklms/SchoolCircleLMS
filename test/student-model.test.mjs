/*
 * Student-only hosted OpenAI adapter.
 *
 * The settings database is stubbed only so these tests exercise the existing
 * provider/settings/catalog path without a real deployment. All credentials
 * below are synthetic and assertions ensure none enter a returned status/error.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

mock.module('../lib/db.js', {
  namedExports: {
    db: { learningRecord: { async findUnique() { return null; } } },
    async updateLearningRecordIfVersion() { return true; },
  },
});

const {
  STUDENT_OPENAI_BASE_URL,
  STUDENT_MODEL_REQUEST_LABEL,
  createStudentChat,
  studentModelStatus,
} = await import('../lib/student-model.js');
const { invalidateModelSettings, primeModelSettings } = await import('../lib/model-settings.js');

const ENV_KEYS = [
  'MODEL_BASE_URL',
  'MODEL_ID',
  'MODEL_API_KEY',
  'OPENAI_API_KEY',
  'OPENROUTER_API_KEY',
  'STUDENT_MODEL_ID',
  'STUDENT_LOCAL_BASE_URL',
  'STUDENT_LOCAL_MODEL_ID',
  'STUDENT_LOCAL_API_KEY',
];
const TEST_KEY = 'sk-student-test-secret-4242';
const TEST_STUDENT_MODEL = 'provider-confirmed-student-model';
const realFetch = globalThis.fetch;
let savedEnv = {};
let calls = [];

function response(body, { status = 200 } = {}) {
  return {
    ok: status >= 200 && status < 300,
    status,
    async json() { return body; },
  };
}

async function setSharedConfiguration({
  baseUrl = STUDENT_OPENAI_BASE_URL,
  model = TEST_STUDENT_MODEL,
  key = TEST_KEY,
} = {}) {
  process.env.MODEL_BASE_URL = baseUrl;
  process.env.MODEL_ID = model;
  process.env.OPENAI_API_KEY = key;
  delete process.env.STUDENT_MODEL_ID;
  invalidateModelSettings();
  await primeModelSettings();
}

async function setStudentConfiguration({
  model = TEST_STUDENT_MODEL,
  key = TEST_KEY,
} = {}) {
  delete process.env.MODEL_BASE_URL;
  delete process.env.MODEL_ID;
  process.env.STUDENT_MODEL_ID = model;
  process.env.OPENAI_API_KEY = key;
  invalidateModelSettings();
  await primeModelSettings();
}

function stubFetch(handler) {
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });
    return handler(String(url), init);
  };
}

beforeEach(async () => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  calls = [];
  invalidateModelSettings();
  await primeModelSettings();
});

afterEach(() => {
  globalThis.fetch = realFetch;
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  invalidateModelSettings();
});

test('missing student configuration is unready and never calls OpenAI', async () => {
  stubFetch(() => { throw new Error('must not fetch'); });

  const status = await studentModelStatus();
  assert.equal(status.ready, false);
  assert.equal(status.verified, false);
  assert.equal(status.code, 'STUDENT_MODEL_UNCONFIGURED');
  assert.equal(calls.length, 0);
  await assert.rejects(
    () => createStudentChat(),
    (error) => error.code === 'STUDENT_MODEL_UNCONFIGURED',
  );
  assert.equal(calls.length, 0);
});

test('the student adapter refuses a shared non-OpenAI provider without a fallback', async () => {
  await setSharedConfiguration({ baseUrl: 'https://openrouter.ai/api/v1' });
  stubFetch(() => { throw new Error('must not fetch'); });
  assert.equal((await studentModelStatus()).code, 'STUDENT_MODEL_UNCONFIGURED');
  assert.equal(calls.length, 0);

  // An explicit student selection still uses only the official endpoint, not
  // the shared OpenRouter configuration.
  await setStudentConfiguration();
  stubFetch((url) => response({ data: [{ id: TEST_STUDENT_MODEL }] }));
  const status = await studentModelStatus();
  assert.equal(status.ready, true);
  assert.equal(status.active.source, 'student-env');
  assert.equal(calls[0].url, `${STUDENT_OPENAI_BASE_URL}/models`);
});

test('catalogue unavailability is sanitized and blocks chat creation', async () => {
  await setStudentConfiguration();
  stubFetch(() => response(
    { error: { message: `upstream leaked ${TEST_KEY} request req_sensitive` } },
    { status: 401 },
  ));

  const status = await studentModelStatus();
  assert.equal(status.ready, false);
  assert.equal(status.code, 'STUDENT_MODEL_CATALOG_UNAVAILABLE');
  assert.match(status.reason, /catalogue is unavailable/);
  assert.ok(!JSON.stringify(status).includes(TEST_KEY));
  await assert.rejects(
    () => createStudentChat(),
    (error) => error.code === 'STUDENT_MODEL_CATALOG_UNAVAILABLE'
      && !error.message.includes(TEST_KEY)
      && !error.message.includes('req_sensitive'),
  );
  assert.equal(calls.length, 2, 'each readiness attempt makes only the catalogue request');
  assert.ok(calls.every((call) => call.url === `${STUDENT_OPENAI_BASE_URL}/models`));
});

test('an official catalogue missing the explicit student model blocks chat creation', async () => {
  await setStudentConfiguration();
  stubFetch(() => response({ data: [{ id: 'gpt-5.4-mini' }] }));

  const status = await studentModelStatus();
  assert.equal(status.ready, false);
  assert.equal(status.code, 'STUDENT_MODEL_UNAVAILABLE');
  await assert.rejects(
    () => createStudentChat(),
    (error) => error.code === 'STUDENT_MODEL_UNAVAILABLE',
  );
  assert.equal(calls.length, 2);
});

test('uses the exact hosted OpenAI request contract and returns the callback object', async () => {
  await setStudentConfiguration();
  // A separate shared provider credential must never be forwarded to official
  // OpenAI for direct student configuration.
  process.env.MODEL_BASE_URL = 'https://unrelated-provider.example/v1';
  process.env.MODEL_ID = 'unrelated-provider-model';
  process.env.MODEL_API_KEY = 'sk-unrelated-provider-secret';
  stubFetch((url, init) => {
    if (url.endsWith('/models')) return response({ data: [{ id: TEST_STUDENT_MODEL }] });
    return response({
      choices: [{ message: { content: '{"refused":false,"answer":"Grounded [1]","used":[1]}' } }],
    });
  });

  const overallDeadline = new AbortController();
  const chat = await createStudentChat({ signal: overallDeadline.signal });
  const result = await chat('You are a source-grounded tutor.', 'What does passage one say?');
  assert.deepEqual(result, { refused: false, answer: 'Grounded [1]', used: [1] });
  assert.equal(calls.length, 2);

  const [catalogue, completion] = calls;
  assert.equal(catalogue.url, `${STUDENT_OPENAI_BASE_URL}/models`);
  assert.equal(catalogue.init.headers.authorization, `Bearer ${TEST_KEY}`);
  assert.notEqual(
    catalogue.init.signal,
    overallDeadline.signal,
    'catalogue signal combines the overall deadline with its 10s bound',
  );
  assert.equal(completion.url, `${STUDENT_OPENAI_BASE_URL}/chat/completions`);
  assert.equal(completion.init.method, 'POST');
  assert.equal(completion.init.headers.authorization, `Bearer ${TEST_KEY}`);
  assert.notEqual(
    completion.init.signal,
    overallDeadline.signal,
    'chat signal combines the overall deadline with its 20s bound',
  );
  const body = JSON.parse(completion.init.body);
  assert.deepEqual(body, {
    model: TEST_STUDENT_MODEL,
    max_completion_tokens: 3000,
    messages: [
      { role: 'system', content: 'You are a source-grounded tutor.' },
      { role: 'user', content: 'What does passage one say?' },
    ],
    response_format: { type: 'json_object' },
  });
});

test('provider failures and invalid output are sanitized after catalog verification', async () => {
  await setStudentConfiguration();
  stubFetch((url) => {
    if (url.endsWith('/models')) return response({ data: [{ id: TEST_STUDENT_MODEL }] });
    return response({ error: { message: `provider body ${TEST_KEY} req_private` } }, { status: 429 });
  });

  const chat = await createStudentChat();
  await assert.rejects(
    () => chat('system', 'prompt'),
    (error) => error.code === 'STUDENT_MODEL_PROVIDER_FAILURE'
      && error.status === 502
      && !error.message.includes(TEST_KEY)
      && !error.message.includes('req_private'),
  );

  stubFetch((url) => {
    if (url.endsWith('/models')) return response({ data: [{ id: TEST_STUDENT_MODEL }] });
    return response({ choices: [{ message: { content: '[]' } }] });
  });
  const invalidChat = await createStudentChat();
  await assert.rejects(
    () => invalidChat('system', 'prompt'),
    (error) => error.code === 'STUDENT_MODEL_BAD_RESPONSE'
      && /invalid JSON object/.test(error.message),
  );
});

test('falls back only to an explicit official shared model and reports public active config', async () => {
  await setSharedConfiguration({ model: 'shared-provider-model' });
  stubFetch((url) => {
    if (url.endsWith('/models')) return response({ data: [{ id: 'shared-provider-model' }] });
    throw new Error('unexpected completion');
  });

  const status = await studentModelStatus();
  assert.equal(status.ready, true);
  assert.equal(status.verified, true);
  assert.equal(status.model, 'shared-provider-model');
  assert.equal(status.active.source, 'env');
  assert.equal(status.active.endpoint, STUDENT_OPENAI_BASE_URL);
  assert.equal(status.requestedModel.label, STUDENT_MODEL_REQUEST_LABEL);
  assert.equal(status.requestedModel.configuredId, 'shared-provider-model');
  assert.equal(status.requestedModel.catalogVerified, true);
  assert.ok(!JSON.stringify(status).includes(TEST_KEY));
});

test('a complete local-only installation uses its exact catalog model without OpenAI', async () => {
  process.env.STUDENT_LOCAL_BASE_URL = 'http://192.168.55.1:8080/v1';
  process.env.STUDENT_LOCAL_MODEL_ID = 'served-local-id';
  // A hosted key must never become a local credential.
  process.env.OPENAI_API_KEY = TEST_KEY;
  stubFetch((url, init) => {
    assert.ok(url.startsWith('http://192.168.55.1:8080/v1/'));
    assert.equal(init.headers.authorization, undefined);
    if (url.endsWith('/models')) return response({ data: [{ id: 'served-local-id' }] });
    const body = JSON.parse(init.body);
    assert.equal(body.max_tokens, 3000);
    assert.equal('max_completion_tokens' in body, false);
    return response({
      choices: [{ message: { content: '{"refused":false,"answer":"Local [1]","used":[1]}' } }],
    });
  });

  const status = await studentModelStatus();
  assert.equal(status.ready, true);
  assert.equal(status.path, 'local');
  assert.equal(status.endpoint, null);
  const chat = await createStudentChat();
  await chat('system', 'prompt');
  assert.ok(calls.every((call) => call.url.startsWith('http://192.168.55.1:8080/v1/')));
});

test('reuses an already selected private generation provider only without STUDENT_LOCAL overrides', async () => {
  process.env.MODEL_BASE_URL = 'http://127.0.0.1:8080/v1';
  process.env.MODEL_ID = 'shared-local-id';
  process.env.MODEL_API_KEY = 'shared-local-secret';
  stubFetch((url, init) => {
    assert.ok(url.startsWith('http://127.0.0.1:8080/v1/'));
    assert.equal(init.headers.authorization, 'Bearer shared-local-secret');
    return response({ data: [{ id: 'shared-local-id' }] });
  });
  const chat = await createStudentChat();
  assert.equal(chat.studentModelPath, 'local');

  // Even an incomplete explicit local override must fail closed instead of
  // inheriting this unrelated shared configuration.
  process.env.STUDENT_LOCAL_MODEL_ID = 'incomplete-override';
  await assert.rejects(
    () => createStudentChat({ path: 'local' }),
    (error) => error.code === 'STUDENT_LOCAL_MODEL_UNCONFIGURED',
  );
});

test('local llama-compatible transport starts with max_tokens and only swaps the token field on targeted rejection', async () => {
  process.env.STUDENT_LOCAL_BASE_URL = 'http://127.0.0.1:8080/v1';
  process.env.STUDENT_LOCAL_MODEL_ID = 'served-local-id';
  let completionCalls = 0;
  stubFetch((url, init) => {
    if (url.endsWith('/models')) return response({ data: [{ id: 'served-local-id' }] });
    completionCalls += 1;
    const body = JSON.parse(init.body);
    if (completionCalls === 1) {
      assert.equal(body.max_tokens, 3000);
      return {
        ok: false,
        status: 400,
        async text() { return 'max_tokens is not supported'; },
      };
    }
    assert.equal(body.max_completion_tokens, 3000);
    assert.equal('max_tokens' in body, false);
    return response({
      choices: [{ message: { content: '{"refused":false,"answer":"Local [1]","used":[1]}' } }],
    });
  });
  const chat = await createStudentChat({ path: 'local' });
  const result = await chat('system', 'prompt');
  assert.equal(result.answer, 'Local [1]');
  assert.equal(completionCalls, 2);
});

test('local endpoint validation and credentials are isolated from hosted OpenAI', async () => {
  await setStudentConfiguration();
  process.env.STUDENT_LOCAL_BASE_URL = 'https://user:pass@public.example/v1?token=bad';
  process.env.STUDENT_LOCAL_MODEL_ID = 'served-local-id';
  process.env.STUDENT_LOCAL_API_KEY = 'local-secret';
  stubFetch(() => assert.fail('invalid local endpoint must not receive any request'));
  await assert.rejects(
    () => createStudentChat({ path: 'local' }),
    (error) => error.code === 'STUDENT_LOCAL_MODEL_UNCONFIGURED',
  );

  process.env.STUDENT_LOCAL_BASE_URL = 'http://127.0.0.1:8080/v1';
  stubFetch((url, init) => {
    assert.ok(url.startsWith('http://127.0.0.1:8080/v1/'));
    assert.equal(init.headers.authorization, 'Bearer local-secret');
    return response({ data: [{ id: 'served-local-id' }] });
  });
  await createStudentChat({ path: 'local' });
  assert.equal(calls.length, 1);
});

test('refusals, HTTP auth/rate failures, and malformed output never become transport fallback errors', async () => {
  await setStudentConfiguration();
  const cases = [
    {
      body: { error: { message: 'rate limited' } },
      status: 429,
      code: 'STUDENT_MODEL_PROVIDER_FAILURE',
    },
    {
      body: { choices: [{ message: { refusal: 'policy', content: '' } }] },
      status: 200,
      code: 'STUDENT_MODEL_REFUSAL',
    },
    {
      body: { choices: [{ message: { content: 'not-json' } }] },
      status: 200,
      code: 'STUDENT_MODEL_BAD_RESPONSE',
    },
  ];
  for (const sample of cases) {
    stubFetch((url) => url.endsWith('/models')
      ? response({ data: [{ id: TEST_STUDENT_MODEL }] })
      : response(sample.body, { status: sample.status }));
    const chat = await createStudentChat();
    await assert.rejects(
      () => chat('system', 'prompt'),
      (error) => error.code === sample.code && error.code !== 'STUDENT_MODEL_TRANSPORT_UNAVAILABLE',
    );
  }
});

test('an unreachable configured local server fails explicitly', async () => {
  process.env.STUDENT_LOCAL_BASE_URL = 'http://127.0.0.1:8080/v1';
  process.env.STUDENT_LOCAL_MODEL_ID = 'served-local-id';
  stubFetch(() => { throw new TypeError('connection refused'); });
  await assert.rejects(
    () => createStudentChat({ path: 'local' }),
    (error) => error.code === 'STUDENT_LOCAL_MODEL_UNAVAILABLE',
  );
});