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
    // Mirrors the real export: drops instructor capability, keeps the id.
    // The mock list is explicit, so an export lib/auth.js gains must be added
    // here or every importer in this suite fails to link.
    learnerScopedIdentity: (identity) =>
      identity && identity.role === 'INSTRUCTOR'
        ? { ...identity, role: 'LEARNER', learnerScoped: true }
        : identity,
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
  changeNeedsOperator,
  claimOperatorPassphrase,
  disableModelSettings,
  invalidateModelSettings,
  primeModelSettings,
  publicModelSettings,
  saveModelSettings,
  storedApiKey,
  operatorPassphraseNeedsClaim,
  verifyOperatorPassphrase,
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
  'OPENAI_API_KEY',
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

  // No passphrase configured at all is still a refusal -- it does not open up --
  // but it is reported as an actionable state so the panel can offer to claim
  // one instead of greying itself out.
  delete process.env.MODEL_SETTINGS_KEY;
  invalidateModelSettings();
  response = await routeModule.PUT(request('PUT', { body, key: 'anything' }), context);
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PASSPHRASE_NOT_SET');
  assert.equal(rows.size, 0, 'an unauthorized write still writes nothing');
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

/* ------------------------- passphrase bootstrapping ------------------------ */

test('a deployment with no secrets offers to claim a passphrase rather than locking out', async () => {
  delete process.env.MODEL_SETTINGS_KEY;
  await primeModelSettings();
  assert.equal(operatorPassphraseNeedsClaim(), true);

  const view = publicModelSettings(await primeModelSettings(), providers.textProvider());
  assert.equal(view.needsPassphraseClaim, true);
  assert.equal(view.writable, false);
  assert.equal(view.passphrasePinned, false);

  await claimOperatorPassphrase({ passphrase: 'a-good-operator-phrase', updatedBy: INSTRUCTOR.id });
  await primeModelSettings();

  assert.equal(operatorPassphraseNeedsClaim(), false);
  assert.equal(verifyOperatorPassphrase('a-good-operator-phrase'), true);
  assert.equal(verifyOperatorPassphrase('not-it'), false);

  const after = publicModelSettings(await primeModelSettings(), providers.textProvider());
  assert.equal(after.writable, true);
  assert.equal(after.needsPassphraseClaim, false);
});

test('a claimed passphrase is hashed, not stored or returned in any readable form', async () => {
  delete process.env.MODEL_SETTINGS_KEY;
  await claimOperatorPassphrase({ passphrase: 'phrase-to-not-leak', updatedBy: INSTRUCTOR.id });

  const stored = JSON.stringify(rows.get('system-model-settings'));
  assert.ok(!stored.includes('phrase-to-not-leak'), 'the passphrase must not be recoverable');
  assert.equal(rows.get('system-model-settings').payload.operatorPassphrase.alg, 'scrypt');

  const view = publicModelSettings(await primeModelSettings(), providers.textProvider());
  assert.ok(!JSON.stringify(view).includes('phrase-to-not-leak'));
  assert.ok(!JSON.stringify(view).includes('operatorPassphrase'));
});

test('claiming is refused once a passphrase exists by either route', async () => {
  delete process.env.MODEL_SETTINGS_KEY;
  await claimOperatorPassphrase({ passphrase: 'first-claim-phrase', updatedBy: INSTRUCTOR.id });
  await assert.rejects(
    () => claimOperatorPassphrase({ passphrase: 'second-claim-phrase', updatedBy: 'instructor-2' }),
    (error) => error.code === 'PASSPHRASE_ALREADY_SET',
  );
  // The original still works; a second claim cannot lock the operator out.
  await primeModelSettings();
  assert.equal(verifyOperatorPassphrase('first-claim-phrase'), true);

  // A deployment-pinned value refuses a claim outright.
  process.env.MODEL_SETTINGS_KEY = OPERATOR;
  invalidateModelSettings();
  await assert.rejects(
    () => claimOperatorPassphrase({ passphrase: 'third-claim-phrase', updatedBy: INSTRUCTOR.id }),
    (error) => error.code === 'PASSPHRASE_PINNED',
  );
});

test('a pinned MODEL_SETTINGS_KEY wins over a previously claimed one', async () => {
  delete process.env.MODEL_SETTINGS_KEY;
  await claimOperatorPassphrase({ passphrase: 'claimed-phrase-here', updatedBy: INSTRUCTOR.id });
  await primeModelSettings();
  assert.equal(verifyOperatorPassphrase('claimed-phrase-here'), true);

  process.env.MODEL_SETTINGS_KEY = OPERATOR;
  await primeModelSettings();
  assert.equal(verifyOperatorPassphrase(OPERATOR), true);
  assert.equal(verifyOperatorPassphrase('claimed-phrase-here'), false, 'the pin is authoritative');
});

test('a short passphrase is refused', async () => {
  delete process.env.MODEL_SETTINGS_KEY;
  await assert.rejects(
    () => claimOperatorPassphrase({ passphrase: 'short', updatedBy: INSTRUCTOR.id }),
    (error) => /at least 8 characters/.test(error.message),
  );
  await primeModelSettings();
  assert.equal(operatorPassphraseNeedsClaim(), true, 'nothing was claimed');
});

test('saving a provider or disabling it preserves the claimed passphrase', async () => {
  delete process.env.MODEL_SETTINGS_KEY;
  await claimOperatorPassphrase({ passphrase: 'survives-a-save-ok', updatedBy: INSTRUCTOR.id });

  // Both writes rebuild the payload, so either could silently unclaim the
  // deployment and lock the operator out of their own panel.
  await saveModelSettings({
    baseUrl: 'http://127.0.0.1:8001/v1',
    modelId: 'local-model',
    updatedBy: INSTRUCTOR.id,
  });
  await primeModelSettings();
  assert.equal(verifyOperatorPassphrase('survives-a-save-ok'), true, 'a provider save kept it');

  await disableModelSettings({ updatedBy: INSTRUCTOR.id });
  await primeModelSettings();
  assert.equal(verifyOperatorPassphrase('survives-a-save-ok'), true, 'disabling kept it');
});

test('the route claims a passphrase and then accepts it for a provider write', async () => {
  delete process.env.MODEL_SETTINGS_KEY;
  const context = { params: Promise.resolve({}) };

  // A write before anything is claimed is refused, but as an actionable state.
  let response = await routeModule.PUT(
    request('PUT', { body: { baseUrl: 'https://api.example.com/v1', modelId: 'm' } }),
    context,
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PASSPHRASE_NOT_SET');

  response = await routeModule.POST(
    request('POST', { body: { passphrase: 'route-claimed-phrase' } }),
    context,
  );
  assert.equal(response.status, 200);
  assert.equal((await response.json()).settings.writable, true);

  // The freshly claimed passphrase now authorizes a provider change.
  response = await routeModule.PUT(
    request('PUT', {
      body: { baseUrl: 'http://127.0.0.1:8001/v1', modelId: 'local-model' },
      key: 'route-claimed-phrase',
    }),
    context,
  );
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.settings.configured, true);
  assert.equal(body.settings.active.source, 'settings');

  // And a wrong one still does not.
  response = await routeModule.PUT(
    request('PUT', { body: { baseUrl: 'https://evil.example/v1', modelId: 'x' }, key: 'wrong' }),
    context,
  );
  assert.equal(response.status, 403);
});

test('an existing OPENAI_API_KEY secret is accepted without a duplicate MODEL_API_KEY', async () => {
  process.env.MODEL_BASE_URL = 'https://api.openai.com/v1';
  process.env.MODEL_ID = 'some-model';
  process.env.OPENAI_API_KEY = 'sk-existing-secret-2222';
  await primeModelSettings();

  assert.equal(providers.textProvider().ready, true);
  assert.equal(providers.textProvider().source, 'env');
  assert.equal(providers.textProviderCredential(), 'sk-existing-secret-2222');
  assert.ok(!JSON.stringify(providers.textProvider()).includes('sk-existing-secret-2222'));

  // An explicit MODEL_API_KEY still takes precedence over the fallback name.
  process.env.MODEL_API_KEY = 'sk-explicit-wins-3333';
  assert.equal(providers.textProviderCredential(), 'sk-explicit-wins-3333');

  // It is never sent to a non-OpenRouter-but-OpenRouter-URL mismatch either:
  // the OpenRouter path only ever reads OPENROUTER_API_KEY.
  process.env.MODEL_BASE_URL = 'https://openrouter.ai/api/v1';
  assert.equal(providers.textProviderCredential(), '');
});

test('OpenAI credentials cannot follow generic or lookalike endpoint selections', async () => {
  process.env.OPENAI_API_KEY = 'synthetic-openai-only';
  delete process.env.MODEL_API_KEY;
  await primeModelSettings();
  for (const base of [
    'http://127.0.0.1:8001/v1',
    'https://other-provider.example/v1',
    'https://api.openai.com.evil.example/v1',
    'https://api.openai.com/v1/other',
    'http://api.openai.com/v1',
  ]) {
    process.env.MODEL_BASE_URL = base;
    assert.equal(providers.textProviderCredential(), '', base);
  }
  process.env.MODEL_API_KEY = 'synthetic-dedicated-endpoint-key';
  assert.equal(providers.textProviderCredential(), 'synthetic-dedicated-endpoint-key');
  delete process.env.MODEL_API_KEY;
  process.env.MODEL_BASE_URL = 'https://api.openai.com/v1/';
  assert.equal(providers.textProviderCredential(), 'synthetic-openai-only');
});

/* ------------------- model choice vs. privileged changes ------------------- */

test('choosing a model on the endpoint in force is not a privileged change', async () => {
  process.env.MODEL_BASE_URL = 'https://api.openai.com/v1';

  // Model only, endpoint inherited: an ordinary instructor action.
  assert.equal(changeNeedsOperator({ modelId: 'some-model' }, null, process.env.MODEL_BASE_URL), false);
  // Re-sending the endpoint already in force is still not a change.
  assert.equal(
    changeNeedsOperator({ baseUrl: 'https://api.openai.com/v1' }, null, process.env.MODEL_BASE_URL),
    false,
  );
  // Trailing-slash differences are not a change either.
  assert.equal(
    changeNeedsOperator({ baseUrl: 'https://api.openai.com/v1/' }, null, process.env.MODEL_BASE_URL),
    false,
  );

  // A different destination is privileged -- this is the exfiltration path.
  assert.equal(
    changeNeedsOperator({ baseUrl: 'https://evil.example/v1' }, null, process.env.MODEL_BASE_URL),
    true,
  );
  // Supplying a credential is privileged regardless of endpoint.
  assert.equal(
    changeNeedsOperator({ apiKey: 'sk-something' }, null, process.env.MODEL_BASE_URL),
    true,
  );

  // Once settings hold an endpoint, that one is also "in force".
  const settings = { baseUrl: 'http://127.0.0.1:8001/v1' };
  assert.equal(changeNeedsOperator({ baseUrl: 'http://127.0.0.1:8001/v1' }, settings, ''), false);
  assert.equal(changeNeedsOperator({ baseUrl: 'http://127.0.0.1:9999/v1' }, settings, ''), true);
});

test('an instructor picks a model with no passphrase, but cannot redirect the endpoint', async () => {
  delete process.env.MODEL_SETTINGS_KEY;
  process.env.MODEL_BASE_URL = 'https://api.openai.com/v1';
  process.env.MODEL_ID = 'deployment-default';
  process.env.OPENAI_API_KEY = 'sk-deployment-key-8888';
  invalidateModelSettings();
  const context = { params: Promise.resolve({}) };

  // No passphrase header, no passphrase configured anywhere: still works,
  // because choosing a model cannot send course text anywhere new.
  let response = await routeModule.PUT(
    request('PUT', { body: { modelId: 'instructor-picked-model' } }),
    context,
  );
  let body = await response.json();
  assert.equal(response.status, 200, JSON.stringify(body));
  assert.equal(body.settings.modelId, 'instructor-picked-model');
  assert.equal(body.settings.baseUrl, 'https://api.openai.com/v1', 'endpoint was inherited');
  assert.equal(body.settings.active.source, 'settings');
  assert.equal(body.settings.active.credential, 'environment', 'uses the deployment key');

  // Redirecting the endpoint without the passphrase is refused.
  response = await routeModule.PUT(
    request('PUT', { body: { baseUrl: 'https://evil.example/v1', modelId: 'x' } }),
    context,
  );
  assert.equal(response.status, 409);
  assert.equal((await response.json()).code, 'PASSPHRASE_NOT_SET');
  await primeModelSettings();
  assert.equal(
    providers.textProvider().baseUrl,
    'https://api.openai.com/v1',
    'the refused redirect changed nothing',
  );
});

test('a settings-chosen model uses the deployment key without one being typed', async () => {
  process.env.MODEL_BASE_URL = 'https://api.openai.com/v1';
  process.env.OPENAI_API_KEY = 'sk-from-secret-manager-1234';
  await saveModelSettings({
    baseUrl: 'https://api.openai.com/v1',
    modelId: 'picked-model',
    updatedBy: INSTRUCTOR.id,
  });
  await primeModelSettings();

  const status = providers.textProvider();
  assert.equal(status.ready, true, 'no SETTINGS_ENCRYPTION_KEY needed for this setup');
  assert.equal(status.source, 'settings');
  assert.equal(status.model, 'picked-model');
  assert.equal(status.credential, 'environment');
  assert.equal(providers.textProviderCredential(), 'sk-from-secret-manager-1234');
  assert.ok(!JSON.stringify(status).includes('sk-from-secret-manager-1234'));
});
