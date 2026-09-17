/*
 * Runtime doctrine (Anchor) endpoint configuration.
 *
 * What these guard, in order of how much it would cost to get wrong:
 *   1. A stored address wins over DOCTRINE_BASE_URL, and which source won is
 *      reported -- otherwise "I pointed it at the Orin and nothing changed" is
 *      undiagnosable.
 *   2. Clearing the setting falls back to the environment rather than to
 *      unconfigured.
 *   3. An unreachable settings store NEVER throws and never takes down
 *      grounding the environment can already serve.
 *   4. The unconfigured message is unchanged, because /api/doctrine maps it to
 *      NO_DOCTRINE_SERVICE -> 503 and the panel renders it verbatim.
 *   5. THE STATUS LIGHT NEVER REPORTS HEALTHY WITHOUT HAVING OBSERVED IT.
 *      The panel once showed green for two days against a dead endpoint,
 *      because green meant "a URL is set". Every health assertion below exists
 *      to stop that returning: a failed probe is `unreachable`, a partly
 *      working engine is `degraded`, and `healthy` requires the whole set.
 *
 * The database is a small in-memory fake, as in model-settings.test.mjs: the
 * store only needs findUnique, create and updateMany.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, mock, test } from 'node:test';

/* ------------------------------ db test double ---------------------------- */

const rows = new Map();
let failReads = false;

const learningRecord = {
  async findUnique({ where }) {
    if (failReads) throw Object.assign(new Error('db down'), { code: 'P1001' });
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

const doctrine = await import('../lib/doctrine.js');
const settingsModule = await import('../lib/doctrine-settings.js');
const detect = await import('../lib/doctrine-detect.js');

const {
  disableDoctrineSettings,
  invalidateDoctrineSettings,
  normaliseDoctrineBaseUrl,
  primeDoctrineSettings,
  publicDoctrineSettings,
  saveDoctrineSettings,
} = settingsModule;

const ORIGINAL_ENV = process.env.DOCTRINE_BASE_URL;

beforeEach(() => {
  rows.clear();
  failReads = false;
  invalidateDoctrineSettings();
  doctrine.setStoredDoctrineBaseUrl(null);
  delete process.env.DOCTRINE_BASE_URL;
});

afterEach(() => {
  if (ORIGINAL_ENV === undefined) delete process.env.DOCTRINE_BASE_URL;
  else process.env.DOCTRINE_BASE_URL = ORIGINAL_ENV;
});

/* ------------------------------- validation ------------------------------- */

test('normaliseDoctrineBaseUrl accepts the real addresses and strips trailing slashes', () => {
  assert.equal(normaliseDoctrineBaseUrl('http://192.168.55.1:8000'), 'http://192.168.55.1:8000');
  assert.equal(normaliseDoctrineBaseUrl('http://192.168.55.1:8000/'), 'http://192.168.55.1:8000');
  assert.equal(normaliseDoctrineBaseUrl('  http://localhost:8000//  '), 'http://localhost:8000');
  assert.equal(normaliseDoctrineBaseUrl('https://anchor.example/api/'), 'https://anchor.example/api');
});

test('normaliseDoctrineBaseUrl rejects what cannot be an Anchor address', () => {
  for (const bad of [
    '',
    '   ',
    'not a url',
    '192.168.55.1:8000',                    // no scheme
    'ftp://192.168.55.1:8000',              // wrong scheme
    'http://user:pw@192.168.55.1:8000',     // credentials
    'http://192.168.55.1:8000?x=1',         // query
    'http://192.168.55.1:8000#frag',        // fragment
  ]) {
    assert.throws(() => normaliseDoctrineBaseUrl(bad), { code: 'BAD_REQUEST' }, `accepted: ${bad}`);
  }
});

/* ------------------------------- precedence ------------------------------- */

test('unconfigured reports the unchanged message and no source', async () => {
  await primeDoctrineSettings();
  const status = doctrine.doctrineProvider();
  assert.equal(status.ready, false);
  assert.equal(status.source, null);
  // The unconfigured reason must offer the RUNTIME path first: apphosting.yaml
  // deliberately leaves DOCTRINE_BASE_URL unset, so pointing only at the env var
  // would tell an operator to redeploy for something Settings changes live.
  assert.match(status.reason, /^No doctrine engine configured\./);
  assert.match(status.reason, /Settings -> Doctrine engine/);
  assert.match(status.reason, /DOCTRINE_BASE_URL/);
  assert.match(status.reason, /citations are unavailable\.$/);
});

test('the environment is used when no setting is stored', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://env-anchor:8000/';
  await primeDoctrineSettings();
  const status = doctrine.doctrineProvider();
  assert.deepEqual(
    { ready: status.ready, source: status.source, baseUrl: status.baseUrl },
    { ready: true, source: 'env', baseUrl: 'http://env-anchor:8000' },
  );
});

test('a stored address wins over the environment, and the source says so', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://env-anchor:8000';
  await saveDoctrineSettings({ baseUrl: 'http://192.168.55.1:8000', updatedBy: 'instructor-1' });

  const status = doctrine.doctrineProvider();
  assert.equal(status.ready, true);
  assert.equal(status.source, 'setting');
  assert.equal(status.baseUrl, 'http://192.168.55.1:8000');

  const view = publicDoctrineSettings(await primeDoctrineSettings(), status);
  assert.equal(view.configured, true);
  assert.equal(view.baseUrl, 'http://192.168.55.1:8000');
  assert.equal(view.envBaseUrl, 'http://env-anchor:8000');
  assert.equal(view.active.source, 'setting');
  assert.equal(view.updatedBy, 'instructor-1');
});

test('clearing the setting falls back to the environment, not to unconfigured', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://env-anchor:8000';
  await saveDoctrineSettings({ baseUrl: 'http://192.168.55.1:8000', updatedBy: 'instructor-1' });
  assert.equal(doctrine.doctrineProvider().source, 'setting');

  await disableDoctrineSettings({ updatedBy: 'instructor-1' });
  await primeDoctrineSettings();

  const status = doctrine.doctrineProvider();
  assert.equal(status.ready, true);
  assert.equal(status.source, 'env');
  assert.equal(status.baseUrl, 'http://env-anchor:8000');
});

test('clearing with no environment returns to the unconfigured message', async () => {
  await saveDoctrineSettings({ baseUrl: 'http://192.168.55.1:8000', updatedBy: 'instructor-1' });
  await disableDoctrineSettings({ updatedBy: 'instructor-1' });
  await primeDoctrineSettings();
  const status = doctrine.doctrineProvider();
  assert.equal(status.ready, false);
  assert.match(status.reason, /^No doctrine engine configured/);
});

/* ------------------------------- resilience ------------------------------- */

test('an unreachable settings store never throws and keeps serving the environment', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://env-anchor:8000';
  failReads = true;

  await assert.doesNotReject(primeDoctrineSettings());
  const status = doctrine.doctrineProvider();
  assert.equal(status.ready, true);
  assert.equal(status.source, 'env');
  assert.equal(status.baseUrl, 'http://env-anchor:8000');
});

test('a store that fails after a save keeps the address already in force', async () => {
  await saveDoctrineSettings({ baseUrl: 'http://192.168.55.1:8000', updatedBy: 'instructor-1' });
  invalidateDoctrineSettings();
  failReads = true;

  await assert.doesNotReject(primeDoctrineSettings());
  // The adapter holds the last-known address rather than dropping to
  // unconfigured for the duration of an outage.
  assert.equal(doctrine.doctrineProvider().baseUrl, 'http://192.168.55.1:8000');
});

/* ------------------------------ concurrency ------------------------------- */

test('a stale expectedVersion is refused rather than silently overwriting', async () => {
  const first = await saveDoctrineSettings({
    baseUrl: 'http://192.168.55.1:8000',
    updatedBy: 'instructor-1',
  });
  await assert.rejects(
    saveDoctrineSettings({
      baseUrl: 'http://localhost:8000',
      updatedBy: 'instructor-2',
      expectedVersion: first.version - 1,
    }),
    { code: 'CONFLICT' },
  );
  assert.equal(doctrine.doctrineProvider().baseUrl, 'http://192.168.55.1:8000');
});

/* ------------------------------- detection -------------------------------- */

test('candidates are ordered USB first, tunnel second, configured last, de-duplicated', () => {
  assert.deepEqual(detect.doctrineCandidates('https://anchor.example'), [
    'http://192.168.55.1:8000',
    'http://localhost:8000',
    'https://anchor.example',
  ]);
  // Already-configured USB address must not be probed twice.
  assert.deepEqual(detect.doctrineCandidates('http://192.168.55.1:8000/'), [
    'http://192.168.55.1:8000',
    'http://localhost:8000',
  ]);
  assert.deepEqual(detect.doctrineCandidates(''), [
    'http://192.168.55.1:8000',
    'http://localhost:8000',
  ]);
});

test('a probe reports an unreachable endpoint as data, never as a throw', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => { throw new Error('ECONNREFUSED'); };
  try {
    const result = await detect.probeDoctrineEndpoint('http://192.168.55.1:8000', {
      timeoutMs: 50,
    });
    assert.equal(result.reachable, false);
    assert.equal(result.baseUrl, 'http://192.168.55.1:8000');
    assert.match(result.error, /ECONNREFUSED/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a healthy endpoint reports its corpus so the right board is recognisable', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    const body = String(url).endsWith('/api/health')
      ? { ok: true, models: { generator: true } }
      : { documents: [{ pub_id: 'TC 3-22.9', chunks: 627 }], total_chunks: 4230 };
    return new Response(JSON.stringify(body), { status: 200 });
  };
  try {
    const { results, found } = await detect.detectDoctrineEndpoints('');
    assert.equal(found, 'http://192.168.55.1:8000');
    const usb = results.find((entry) => entry.baseUrl === 'http://192.168.55.1:8000');
    assert.equal(usb.reachable, true);
    assert.equal(usb.health.ok, true);
    assert.equal(usb.corpus.totalChunks, 4230);
    assert.deepEqual(usb.corpus.publications, [{ pubId: 'TC 3-22.9', chunks: 627 }]);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

test('a 200 carrying HTML is a miss, not a working engine', async () => {
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async () => new Response('<html>captive portal</html>', { status: 200 });
  try {
    const result = await detect.probeDoctrineEndpoint('http://localhost:8000', { timeoutMs: 100 });
    assert.equal(result.reachable, false);
    assert.match(result.error, /non-JSON/);
  } finally {
    globalThis.fetch = originalFetch;
  }
});

/* ---------------------------- the status light ---------------------------- */

/**
 * A stand-in Anchor. Defaults are the board as it actually answers today --
 * `{ok, api, models:{generator,embeddings,reranker}, uptime_s}` on
 * /api/health, a document list on /api/corpus, and 405 on the three POST-only
 * routes -- so each test below overrides exactly the one thing it is about.
 */
function fakeAnchor({ health, corpus, status = {}, missing = [] } = {}) {
  return async (url) => {
    const path = new URL(String(url)).pathname;
    if (missing.includes(path)) return new Response('{"detail":"Not Found"}', { status: 404 });
    if (Number.isInteger(status[path])) return new Response('{}', { status: status[path] });
    if (path === '/api/health') {
      return Response.json(health ?? {
        ok: true,
        api: true,
        models: { generator: true, embeddings: true, reranker: true },
        uptime_s: 29236.2,
      });
    }
    if (path === '/api/corpus') {
      return Response.json(corpus ?? {
        documents: [{ pub_id: 'TC 3-22.9', chunks: 627 }, { pub_id: 'MCDP 1', chunks: 241 }],
        total_chunks: 868,
      });
    }
    // POST-only: a GET is 405, which is how presence is detected.
    return new Response('{"detail":"Method Not Allowed"}', { status: 405 });
  };
}

async function withFetch(impl, run) {
  const original = globalThis.fetch;
  globalThis.fetch = impl;
  try {
    return await run();
  } finally {
    globalThis.fetch = original;
  }
}

/** The address in force, probed. */
async function healthOf(options) {
  return detect.checkDoctrineHealth(doctrine.doctrineProvider(), { timeoutMs: 200, ...options });
}

test('an unconfigured engine is its own state, and probes nothing', async () => {
  await primeDoctrineSettings();
  await withFetch(
    () => { throw new Error('an unconfigured panel must not reach the network'); },
    async () => {
      const health = await healthOf();
      assert.equal(health.state, 'unconfigured');
      assert.equal(health.baseUrl, null);
      assert.match(health.detail, /^No doctrine engine configured/);
    },
  );
});

test('a dead endpoint is unreachable and NEVER healthy', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://192.168.55.1:8000';
  await primeDoctrineSettings();
  await withFetch(async () => { throw new Error('ECONNREFUSED'); }, async () => {
    const health = await healthOf();
    // The regression this panel exists for: two days of green over a corpse.
    // Assert the absence explicitly, not merely the presence of red.
    assert.notEqual(health.state, 'healthy');
    assert.equal(health.state, 'unreachable');
    assert.equal(health.headline, 'Not answering');
    assert.equal(health.baseUrl, 'http://192.168.55.1:8000');
    assert.match(health.problems.join(' '), /ECONNREFUSED/);
  });
});

test('a hung endpoint times out as unreachable rather than hanging the panel', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://192.168.55.1:8000';
  await primeDoctrineSettings();
  await withFetch(
    (url, init) => new Promise((_resolve, reject) => {
      init?.signal?.addEventListener('abort', () => {
        reject(Object.assign(new Error('aborted'), { name: 'AbortError' }));
      });
    }),
    async () => {
      const health = await healthOf({ timeoutMs: 40 });
      assert.equal(health.state, 'unreachable');
      assert.match(health.problems.join(' '), /No response within 40ms/);
    },
  );
});

test('a captive portal answering 200 with HTML is unreachable, not connected', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://192.168.55.1:8000';
  await primeDoctrineSettings();
  await withFetch(async () => new Response('<html>sign in</html>', { status: 200 }), async () => {
    const health = await healthOf();
    assert.equal(health.state, 'unreachable');
    assert.match(health.problems.join(' '), /non-JSON/);
  });
});

test('healthy means answered, every model loaded, a corpus, and the routes present', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://192.168.55.1:8000';
  await primeDoctrineSettings();
  await withFetch(fakeAnchor(), async () => {
    const health = await healthOf();
    assert.equal(health.state, 'healthy');
    assert.equal(health.headline, 'Answering');
    assert.deepEqual(health.problems, []);
    assert.equal(health.source, 'env');
    // Enough to tell a loaded board from a freshly reflashed one.
    assert.equal(health.corpus.totalChunks, 868);
    assert.equal(health.corpus.publications.length, 2);
    assert.equal(health.uptimeS, 29236.2);
    // The two recent routes the tutor and the support scores depend on.
    assert.deepEqual(health.endpoints, { ask: true, verify: true, ground: true });
  });
});

test('a model that is not loaded is degraded, and the model is named', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://192.168.55.1:8000';
  await primeDoctrineSettings();
  await withFetch(
    fakeAnchor({
      health: { ok: true, api: true, models: { generator: true, embeddings: true, reranker: false } },
    }),
    async () => {
      const health = await healthOf();
      assert.equal(health.state, 'degraded');
      assert.match(health.problems.join(' '), /reranker model is not loaded/);
    },
  );
});

test('an engine that answers but says it is not ok is degraded, not healthy', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://192.168.55.1:8000';
  await primeDoctrineSettings();
  await withFetch(fakeAnchor({ health: { ok: false, api: false, models: {} } }), async () => {
    const health = await healthOf();
    assert.equal(health.state, 'degraded');
    assert.match(health.problems.join(' '), /did not report itself healthy/);
    assert.match(health.problems.join(' '), /API layer is down/);
  });
});

test('an empty corpus is degraded -- answering is not the same as loaded', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://192.168.55.1:8000';
  await primeDoctrineSettings();
  await withFetch(fakeAnchor({ corpus: { documents: [], total_chunks: 0 } }), async () => {
    const health = await healthOf();
    assert.equal(health.state, 'degraded');
    assert.match(health.problems.join(' '), /corpus is empty/);
  });
});

test('an unreadable corpus is degraded, never a demotion to unreachable', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://192.168.55.1:8000';
  await primeDoctrineSettings();
  await withFetch(fakeAnchor({ status: { '/api/corpus': 500 } }), async () => {
    const health = await healthOf();
    assert.equal(health.state, 'degraded');
    assert.match(health.problems.join(' '), /corpus could not be read/);
  });
});

test('an Anchor without /api/verify or /api/ground is degraded and says which', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://192.168.55.1:8000';
  await primeDoctrineSettings();
  await withFetch(fakeAnchor({ missing: ['/api/verify', '/api/ground'] }), async () => {
    const health = await healthOf();
    assert.equal(health.state, 'degraded');
    assert.deepEqual(health.endpoints, { ask: true, verify: false, ground: false });
    assert.match(health.problems.join(' '), /\/api\/verify is missing/);
    assert.match(health.problems.join(' '), /measured support scores/);
    assert.match(health.problems.join(' '), /\/api\/ground is missing/);
  });
});

test('the address probed is the one in force, not the one in the environment', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://env-anchor:8000';
  await saveDoctrineSettings({ baseUrl: 'http://192.168.55.1:8000', updatedBy: 'instructor-1' });
  const asked = [];
  await withFetch(
    async (url, init) => { asked.push(String(url)); return fakeAnchor()(url, init); },
    async () => {
      const health = await healthOf();
      assert.equal(health.baseUrl, 'http://192.168.55.1:8000');
      assert.equal(health.source, 'setting');
      assert.equal(asked.some((url) => url.includes('env-anchor')), false);
    },
  );
});

test('every shape of probe failure is a value, never a throw, and never green', async () => {
  process.env.DOCTRINE_BASE_URL = 'http://192.168.55.1:8000';
  await primeDoctrineSettings();
  for (const impl of [
    async () => { throw new Error('ECONNREFUSED'); },
    async () => { throw Object.assign(new Error('nope'), { name: 'TypeError' }); },
    async () => new Response('not json', { status: 200 }),
    async () => new Response('{}', { status: 503 }),
  ]) {
    // eslint-disable-next-line no-await-in-loop
    await withFetch(impl, async () => {
      const health = await healthOf();
      assert.equal(health.state, 'unreachable');
    });
  }
});

test('the classifier cannot be talked into green by a probe that failed', () => {
  // Belt and braces on the classifier itself: an unreachable probe carrying an
  // otherwise flattering payload is still unreachable.
  const verdict = detect.summariseDoctrineHealth({
    baseUrl: 'http://192.168.55.1:8000',
    reachable: false,
    error: 'ECONNREFUSED',
    health: { ok: true, api: true, models: { generator: true } },
    corpus: { publications: [{ pubId: 'MCDP 1', chunks: 241 }], totalChunks: 241 },
    endpoints: { ask: true, verify: true, ground: true },
  });
  assert.equal(verdict.state, 'unreachable');
  assert.equal(detect.summariseDoctrineHealth(null).state, 'unconfigured');
});
