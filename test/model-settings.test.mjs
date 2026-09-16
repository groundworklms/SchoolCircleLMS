/*
 * Runtime provider configuration.
 *
 * What these guard, in order of how much it would cost to get wrong:
 *   1. The API key never reaches a client and is never stored in the clear.
 *   2. A write requires the operator passphrase and fails closed without one.
 *   3. Stored settings win over the environment, and which source won is
 *      reported.
 *   4. A hosted endpoint without a usable key reports unready instead of
 *      looking configured and failing on first use.
 *
 * The database is a small in-memory fake: the store only needs findUnique,
 * create and updateMany, and using a real Postgres here would make the secret
 * and authorization assertions slower without making them stronger.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

/* ------------------------------ db test double ---------------------------- */

const rows = new Map();

function resetDb() {
  rows.clear();
}

const learningRecord = {
  async findUnique({ where }) {
    const row = rows.get(where.id);
    return row ? { ...row } : null;
  },
  async create({ data }) {
    const row = {
      version: 0,
      status: 'PENDING',
      ...data,
      createdAt: new Date('2026-09-16T00:00:00Z'),
      updatedAt: new Date('2026-09-16T00:00:00Z'),
    };
    rows.set(row.id, row);
    return { ...row };
  },
  async updateMany({ where, data }) {
    const row = rows.get(where.id);
    if (!row) return { count: 0 };
    if (where.version !== undefined && row.version !== where.version) return { count: 0 };
    const { version, ...rest } = data;
    Object.assign(row, rest);
    if (version?.increment) row.version += version.increment;
    row.updatedAt = new Date('2026-09-16T00:01:00Z');
    return { count: 1 };
  },
};

// The route sits behind requireAnyRole, so a signed-in instructor is stubbed
// in to reach the passphrase gate that these tests are actually about.
mock.module('../lib/auth.js', {
  namedExports: {
    async requireAnyRole() {
      return { id: 'instructor-1', role: 'INSTRUCTOR' };
    },
    async requireIdentity() {
      return { id: 'instructor-1', role: 'INSTRUCTOR' };
    },
    hasRole: () => true,
    authReadiness: () => ({ ready: true, provider: 'firebase' }),
  },
});

mock.module('../lib/db.js', {
  namedExports: {
    db: { learningRecord },
    async updateLearningRecordIfVersion(id, version, data) {
      const result = await learningRecord.updateMany({
        where: { id, version },
        data: { ...data, version: { increment: 1 } },
      });
      return result.count === 1;
    },
  },
});

const settings = await import('../lib/model-settings.js');
const providers = await import('../lib/providers.js');
const crypto = await import('../lib/settings-crypto.js');
const routeModule = await import('../app/api/learning/model-settings/route.js');

const {
  disableModelSettings,
  invalidateModelSettings,
  primeModelSettings,
  publicModelSettings,
  saveModelSettings,
  storedApiKey,
} = settings;

/* --------------------------------- fixtures -------------------------------- */

// A 32-byte key, not a credential: it encrypts only this test's fake secrets.
const TEST_ENCRYPTION_KEY = Buffer.alloc(32, 7).toString('base64');
const OPERATOR = 'test-operator-passphrase';
const INSTRUCTOR = { id: 'instructor-1', role: 'INSTRUCTOR' };

const ENV_KEYS = [
  'SETTINGS_ENCRYPTION_KEY',
  'MODEL_SETTINGS_KEY',
  'MODEL_BASE_URL',
  'MODEL_ID',
  'MODEL_API_KEY',
  'OPENROUTER_API_KEY',
];
let savedEnv = {};

beforeEach(() => {
  resetDb();
  invalidateModelSettings();
  savedEnv = Object.fromEntries(ENV_KEYS.map((key) => [key, process.env[key]]));
  for (const key of ENV_KEYS) delete process.env[key];
  process.env.SETTINGS_ENCRYPTION_KEY = TEST_ENCRYPTION_KEY;
  process.env.MODEL_SETTINGS_KEY = OPERATOR;
});

afterEach(() => {
  for (const [key, value] of Object.entries(savedEnv)) {
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  invalidateModelSettings();
});

function request(method, { body, key } = {}) {
  return new Request('http://example.test/api/learning/model-settings', {
    method,
    headers: {
      'content-type': 'application/json',
      ...(key ? { 'x-model-settings-key': key } : {}),
    },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

/* ---------------------------------- tests ---------------------------------- */

test('a stored key is sealed at rest and never appears in the operator view', async () => {
  await saveModelSettings({
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'google/gemini-3.1-pro-preview',
    apiKey: 'sk-or-v1-secret-value-1234',
    updatedBy: INSTRUCTOR.id,
  });

  const stored = rows.get('system-model-settings');
  const serialized = JSON.stringify(stored);
  assert.ok(!serialized.includes('sk-or-v1-secret-value-1234'), 'plaintext key must not be stored');
  assert.equal(stored.payload.apiKey.alg, 'A256GCM');
  assert.ok(stored.payload.apiKey.ct && stored.payload.apiKey.iv && stored.payload.apiKey.tag);

  // Readable in server memory, so generation can actually authenticate.
  await primeModelSettings();
  assert.equal(storedApiKey(), 'sk-or-v1-secret-value-1234');

  const view = publicModelSettings(await primeModelSettings(), providers.textProvider());
  const viewJson = JSON.stringify(view);
  assert.ok(!viewJson.includes('sk-or-v1-secret-value-1234'), 'key must not reach a client');
  assert.equal(view.hasApiKey, true);
  assert.equal(view.apiKeyHint, '****1234');
});

test('the provider status handed to clients carries no credential', async () => {
  await saveModelSettings({
    baseUrl: 'https://openrouter.ai/api/v1',
    modelId: 'google/gemini-3.1-pro-preview',
    apiKey: 'sk-or-v1-leak-check-9876',
    updatedBy: INSTRUCTOR.id,
  });
  await primeModelSettings();

  const status = providers.textProvider();
  assert.equal(status.ready, true);
  assert.equal(status.source, 'settings');
  assert.ok(!JSON.stringify(status).includes('sk-or-v1-leak-check-9876'));
  assert.ok(!('apiKey' in status));
  // The transport still gets it, through the separate seam.
  assert.equal(providers.textProviderCredential(), 'sk-or-v1-leak-check-9876');
});

test('stored settings win over the environment and the active source is reported', async () => {
  process.env.MODEL_BASE_URL = 'http://127.0.0.1:8001/v1';
  process.env.MODEL_ID = 'env-model';

  await primeModelSettings();
  assert.equal(providers.textProvider().source, 'env');
  assert.equal(providers.textProvider().model, 'env-model');

  await saveModelSettings({
    baseUrl: 'http://10.0.0.5:8001/v1',
    modelId: 'settings-model',
    updatedBy: INSTRUCTOR.id,
  });
  await primeModelSettings();
  const active = providers.textProvider();
  assert.equal(active.source, 'settings');
  assert.equal(active.model, 'settings-model');
  assert.equal(active.baseUrl, 'http://10.0.0.5:8001/v1');

  // Disabling falls back to the environment rather than going unconfigured.
  await disableModelSettings({ updatedBy: INSTRUCTOR.id });
  await primeModelSettings();
  assert.equal(providers.textProvider().source, 'env');
  assert.equal(providers.textProvider().model, 'env-model');
});

test('a self-hosted endpoint needs no key but a hosted one reports unready without a usable key', async () => {
  await saveModelSettings({
    baseUrl: 'http://127.0.0.1:8001/v1',
    modelId: 'local-model',
    updatedBy: INSTRUCTOR.id,
  });
  await primeModelSettings();
  assert.equal(providers.textProvider().ready, true, 'offline endpoint is ready with no key');

  await saveModelSettings({
    baseUrl: 'https://api.example.com/v1',
    modelId: 'hosted-model',
    apiKey: 'sk-hosted-key-4321',
    updatedBy: INSTRUCTOR.id,
  });
  await primeModelSettings();
  assert.equal(providers.textProvider().ready, true);

  // Rotating SETTINGS_ENCRYPTION_KEY makes the stored envelope unreadable. That
  // must surface as an explicit unready reason, not a request that silently
  // authenticates with nothing.
  process.env.SETTINGS_ENCRYPTION_KEY = Buffer.alloc(32, 9).toString('base64');
  invalidateModelSettings();
  await primeModelSettings();
  const status = providers.textProvider();
  assert.equal(status.ready, false);
  assert.match(status.reason, /SETTINGS_ENCRYPTION_KEY/);
  assert.equal(providers.textProviderCredential(), '');
});

test('an API key is refused rather than stored in the clear when sealing is unavailable', async () => {
  delete process.env.SETTINGS_ENCRYPTION_KEY;
  await assert.rejects(
    () => saveModelSettings({
      baseUrl: 'https://api.example.com/v1',
      modelId: 'hosted-model',
      apiKey: 'sk-should-never-persist',
      updatedBy: INSTRUCTOR.id,
    }),
    (error) => error.code === 'SECRET_STORAGE_UNAVAILABLE',
  );
  assert.equal(rows.size, 0, 'nothing is written when the key cannot be sealed');

  // An endpoint that needs no key still saves with no encryption key present.
  await saveModelSettings({
    baseUrl: 'http://127.0.0.1:8001/v1',
    modelId: 'local-model',
    updatedBy: INSTRUCTOR.id,
  });
  assert.equal(rows.size, 1);
});

test('endpoints are validated and credentials are refused inside the URL', async () => {
  const rejected = [
    ['', /endpoint URL is required/],
    ['not-a-url', /must be a full URL/],
    ['ftp://host/v1', /http or https/],
    ['https://user:pw@host/v1', /API key field/],
    ['https://host/v1?key=abc', /query string/],
  ];
  for (const [baseUrl, expected] of rejected) {
    await assert.rejects(
      () => saveModelSettings({ baseUrl, modelId: 'm', updatedBy: INSTRUCTOR.id }),
      (error) => error.code === 'BAD_REQUEST' && expected.test(error.message),
      `expected ${baseUrl || '(empty)'} to be refused`,
    );
  }
  await assert.rejects(
    () => saveModelSettings({ baseUrl: 'https://host/v1', modelId: '  ', updatedBy: INSTRUCTOR.id }),
    (error) => /model id is required/.test(error.message),
  );
  assert.equal(rows.size, 0);

  // A trailing slash is normalised away, because callers append /chat/completions.
  await saveModelSettings({ baseUrl: 'https://host/v1/', modelId: 'm', updatedBy: INSTRUCTOR.id });
  assert.equal(rows.get('system-model-settings').payload.baseUrl, 'https://host/v1');
});

test('saving keeps an existing key when the request omits one, and clears it on null', async () => {
  await saveModelSettings({
    baseUrl: 'https://api.example.com/v1',
    modelId: 'hosted-model',
    apiKey: 'sk-original-key-1111',
    updatedBy: INSTRUCTOR.id,
  });

  // The UI never sees the key, so re-saving the endpoint must not wipe it.
  await saveModelSettings({
    baseUrl: 'https://api.example.com/v2',
    modelId: 'hosted-model-2',
    updatedBy: INSTRUCTOR.id,
  });
  await primeModelSettings();
  assert.equal(storedApiKey(), 'sk-original-key-1111');
  assert.equal(providers.textProvider().baseUrl, 'https://api.example.com/v2');

  await saveModelSettings({
    baseUrl: 'https://api.example.com/v2',
    modelId: 'hosted-model-2',
    apiKey: null,
    updatedBy: INSTRUCTOR.id,
  });
  await primeModelSettings();
  assert.equal(storedApiKey(), '');
  assert.equal(providers.textProvider().ready, false, 'hosted endpoint with no key is not ready');
});

test('disabling drops the stored credential rather than parking a live key', async () => {
  await saveModelSettings({
    baseUrl: 'https://api.example.com/v1',
    modelId: 'hosted-model',
    apiKey: 'sk-must-not-survive-7777',
    updatedBy: INSTRUCTOR.id,
  });
  await disableModelSettings({ updatedBy: INSTRUCTOR.id });

  const stored = rows.get('system-model-settings');
  assert.equal(stored.status, 'DISABLED');
  assert.ok(!('apiKey' in stored.payload), 'the envelope is removed, not just ignored');
  assert.ok(!JSON.stringify(stored).includes('sk-must-not-survive-7777'));
});

test('a save against a stale version is refused instead of overwriting', async () => {
  await saveModelSettings({
    baseUrl: 'https://api.example.com/v1',
    modelId: 'first',
    updatedBy: INSTRUCTOR.id,
  });
  const row = rows.get('system-model-settings');
  const staleVersion = row.version;

  // Another operator saves, moving the version on.
  await saveModelSettings({
    baseUrl: 'https://api.example.com/v2',
    modelId: 'second',
    updatedBy: 'instructor-2',
    expectedVersion: staleVersion,
  });

  // The first operator's panel still holds the version it read before that.
  await assert.rejects(
    () => saveModelSettings({
      baseUrl: 'https://api.example.com/v9',
      modelId: 'third',
      updatedBy: INSTRUCTOR.id,
      expectedVersion: staleVersion,
    }),
    (error) => error.code === 'CONFLICT' && error.status === 409,
  );
  assert.equal(row.payload.modelId, 'second', 'the losing write changes nothing');

  // Omitting the version is last-write-wins, for a first save or a script.
  await saveModelSettings({
    baseUrl: 'https://api.example.com/v9',
    modelId: 'third',
    updatedBy: INSTRUCTOR.id,
  });
  assert.equal(rows.get('system-model-settings').payload.modelId, 'third');
});

/* --------------------------- route authorization --------------------------- */

test('writes require the operator passphrase and fail closed without one', async () => {
  const context = { params: Promise.resolve({}) };
  const body = { baseUrl: 'https://api.example.com/v1', modelId: 'hosted' };

  // Wrong passphrase.
  let response = await routeModule.PUT(request('PUT', { body, key: 'wrong' }), context);
  assert.equal(response.status, 403);
  assert.equal((await response.json()).code, 'BAD_OPERATOR_KEY');
  assert.equal(rows.size, 0, 'a refused write touches nothing');

  // Missing passphrase header.
  response = await routeModule.PUT(request('PUT', { body }), context);
  assert.equal(response.status, 403);
  assert.equal(rows.size, 0);

  // No passphrase configured on the deployment at all: refuse, do not open up.
  delete process.env.MODEL_SETTINGS_KEY;
  response = await routeModule.PUT(request('PUT', { body, key: 'anything' }), context);
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'SETTINGS_NOT_WRITABLE');
  assert.equal(rows.size, 0);
});

test('the operator view reports why it is not writable and not sealable', async () => {
  delete process.env.MODEL_SETTINGS_KEY;
  delete process.env.SETTINGS_ENCRYPTION_KEY;
  const view = publicModelSettings(await primeModelSettings(), providers.textProvider());
  assert.equal(view.writable, false);
  assert.match(view.writableReason, /MODEL_SETTINGS_KEY/);
  assert.equal(view.secretStorageReady, false);
  assert.match(view.secretStorageReason, /openssl rand/);
  assert.equal(view.configured, false);
});

test('the passphrase comparison is length-safe and rejects near misses', () => {
  assert.equal(crypto.secretEquals(OPERATOR, OPERATOR), true);
  assert.equal(crypto.secretEquals(`${OPERATOR}x`, OPERATOR), false);
  assert.equal(crypto.secretEquals(OPERATOR.slice(0, -1), OPERATOR), false);
  assert.equal(crypto.secretEquals('', OPERATOR), false);
  assert.equal(crypto.secretEquals(undefined, OPERATOR), false);
});

test('a tampered envelope opens as no credential instead of throwing', async () => {
  const sealed = crypto.sealSecret('sk-tamper-target-5555');
  assert.equal(crypto.openSecret(sealed), 'sk-tamper-target-5555');
  assert.equal(crypto.openSecret({ ...sealed, ct: Buffer.from('other').toString('base64') }), null);
  assert.equal(crypto.openSecret({ ...sealed, tag: Buffer.alloc(16, 1).toString('base64') }), null);
  assert.equal(crypto.openSecret(null), null);
  assert.equal(crypto.openSecret({ apiKey: 'plaintext' }), null);
});
