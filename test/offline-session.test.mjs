/*
 * The browser half of the offline seam.
 *
 * Two properties matter here. First, that the public build flag is COSMETIC:
 * a browser that sets NEXT_PUBLIC_AUTH_MODE by itself gains nothing, because
 * every real decision is the server's. Second, that the stored session is
 * presented as a stable object -- the profile coordinator compares users by
 * reference to decide which response may publish, so a new object per render
 * would look like a new account per render and wipe the profile in a loop.
 *
 * NEXT_PUBLIC_AUTH_MODE is read at call time via process.env here rather than
 * inlined, which is what lets these run without a Next build.
 */
import assert from 'node:assert/strict';
import { afterEach, beforeEach, test } from 'node:test';

process.env.NEXT_PUBLIC_AUTH_MODE = 'offline';

const {
  OFFLINE_SESSION_KEY,
  clearOfflineSession,
  normalizeOfflineSession,
  offlineAuthUiEnabled,
  offlineBearerToken,
  offlineUserFromSession,
  readOfflineSession,
  requestOfflineSession,
  resetOfflineUserCache,
  storeOfflineSession,
} = await import('../lib/offline-session.js');

function memoryStorage(initial = {}) {
  const map = new Map(Object.entries(initial));
  return {
    map,
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    setItem: (key, value) => map.set(key, String(value)),
    removeItem: (key) => map.delete(key),
  };
}

const NOW = 1_700_000_000_000;
const liveSession = (extra = {}) => ({
  token: 'scoffline.v1.cGF5bG9hZA.c2ln',
  expiresAt: new Date(NOW + 3_600_000).toISOString(),
  user: { id: 'user-1', name: 'SSgt Okafor', role: 'INSTRUCTOR', externalId: 'offline:local:sgt-okafor' },
  ...extra,
});

beforeEach(() => {
  process.env.NEXT_PUBLIC_AUTH_MODE = 'offline';
  resetOfflineUserCache();
});

afterEach(() => {
  process.env.NEXT_PUBLIC_AUTH_MODE = 'offline';
});

test('the public flag only decides whether the form is offered', () => {
  for (const [value, expected] of [
    ['offline', true], ['OFFLINE', true], [' offline ', true],
    ['', false], ['offline-ish', false], ['firebase', false], [undefined, false],
  ]) {
    if (value === undefined) delete process.env.NEXT_PUBLIC_AUTH_MODE;
    else process.env.NEXT_PUBLIC_AUTH_MODE = value;
    assert.equal(offlineAuthUiEnabled(), expected, String(value));
  }
});

test('a session is not read back at all when the bundle is not an offline build', () => {
  const storage = memoryStorage({ [OFFLINE_SESSION_KEY]: JSON.stringify(liveSession()) });
  delete process.env.NEXT_PUBLIC_AUTH_MODE;
  assert.equal(readOfflineSession(storage, { now: NOW }), null);
  assert.equal(offlineBearerToken(storage, { now: NOW }), null);
  // The stored value is left alone rather than destroyed by a non-offline build.
  assert.ok(storage.map.has(OFFLINE_SESSION_KEY));
});

test('an expired or malformed session is absent and is discarded', () => {
  const cases = [
    null,
    {},
    { token: '' },
    { token: 'abc' }, // no expiry
    { token: 'abc', expiresAt: 'not-a-date', user: { id: 'u' } },
    { token: 'abc', expiresAt: new Date(NOW - 1000).toISOString(), user: { id: 'u' } }, // expired
    { token: 'abc', expiresAt: new Date(NOW + 1000).toISOString() }, // no user
    { token: 'abc', expiresAt: new Date(NOW + 1000).toISOString(), user: { name: 'x' } }, // no user id
  ];
  for (const value of cases) {
    assert.equal(normalizeOfflineSession(value, { now: NOW }), null, JSON.stringify(value));
  }
  assert.ok(normalizeOfflineSession(liveSession(), { now: NOW }));

  // A stale entry in storage is removed, not re-read on every render.
  const storage = memoryStorage({
    [OFFLINE_SESSION_KEY]: JSON.stringify(liveSession({ expiresAt: new Date(NOW - 1).toISOString() })),
  });
  assert.equal(readOfflineSession(storage, { now: NOW }), null);
  assert.equal(storage.map.has(OFFLINE_SESSION_KEY), false);

  // Unparseable JSON is the same story.
  const corrupt = memoryStorage({ [OFFLINE_SESSION_KEY]: '{not json' });
  assert.equal(readOfflineSession(corrupt, { now: NOW }), null);
  assert.equal(corrupt.map.has(OFFLINE_SESSION_KEY), false);
});

test('a stored session round-trips and yields its bearer token', () => {
  const storage = memoryStorage();
  const stored = storeOfflineSession(liveSession(), storage, { now: NOW });
  assert.equal(stored.token, liveSession().token);

  const read = readOfflineSession(storage, { now: NOW });
  assert.equal(read.token, liveSession().token);
  assert.equal(read.user.role, 'INSTRUCTOR');
  assert.equal(offlineBearerToken(storage, { now: NOW }), liveSession().token);

  clearOfflineSession(storage);
  assert.equal(readOfflineSession(storage, { now: NOW }), null);

  // An unusable session is never written.
  assert.equal(storeOfflineSession({ token: '' }, storage, { now: NOW }), null);
  assert.equal(storage.map.size, 0);
});

test('the offline user object is stable per token and flagged offline', async () => {
  const session = liveSession();
  const first = offlineUserFromSession(session);
  const second = offlineUserFromSession({ ...session });

  // Same token -> the very same object, which is what the profile coordinator
  // requires: it compares by reference.
  assert.equal(first, second);
  assert.equal(first.offline, true);
  assert.equal(first.uid, 'offline:local:sgt-okafor');
  assert.equal(first.displayName, 'SSgt Okafor');
  assert.equal(first.emailVerified, false);
  assert.equal(await first.getIdToken(), session.token);

  // A different token is a different account.
  const other = offlineUserFromSession({ ...session, token: 'scoffline.v1.b3RoZXI.c2ln' });
  assert.notEqual(other, first);

  // Signing out drops the cached object, so the next sign-in is a new account
  // as far as the coordinator is concerned.
  resetOfflineUserCache();
  assert.notEqual(offlineUserFromSession(session), first);

  assert.equal(offlineUserFromSession(null), null);
  assert.equal(offlineUserFromSession({}), null);
});

test('requestOfflineSession reports a disabled deployment as disabled', async () => {
  const notFound = async () => new Response(
    JSON.stringify({ error: 'Not found', code: 'NOT_FOUND' }),
    { status: 404, headers: { 'Content-Type': 'application/json' } },
  );
  await assert.rejects(
    requestOfflineSession('sgt-okafor', 'pass', notFound),
    (error) => {
      assert.match(error.message, /not enabled on this deployment/);
      assert.equal(error.status, 404);
      return true;
    },
  );
});

test('requestOfflineSession surfaces the server message and posts nothing extra', async () => {
  let seen = null;
  const capture = async (url, init) => {
    seen = { url, init };
    return new Response(
      JSON.stringify({ error: 'That operator id and passphrase were not accepted.', code: 'AUTH_REQUIRED' }),
      { status: 401, headers: { 'Content-Type': 'application/json' } },
    );
  };
  await assert.rejects(
    requestOfflineSession('sgt-okafor', 'wrong', capture),
    (error) => {
      assert.match(error.message, /not accepted/);
      assert.equal(error.status, 401);
      assert.equal(error.code, 'AUTH_REQUIRED');
      return true;
    },
  );
  assert.equal(seen.url, '/api/auth/offline/session');
  assert.equal(seen.init.method, 'POST');
  // Exactly the two fields the route reads -- no role, no id, nothing assertable.
  assert.deepEqual(Object.keys(JSON.parse(seen.init.body)).sort(), ['passphrase', 'subject']);
});

test('requestOfflineSession refuses an unusable success body', async () => {
  const ok = (body) => async () => new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
  for (const body of [{}, { token: 'abc' }, { token: 'abc', expiresAt: new Date(Date.now() - 1).toISOString(), user: { id: 'u' } }]) {
    await assert.rejects(requestOfflineSession('s', 'p', ok(body)), /unusable offline session/);
  }
  const good = await requestOfflineSession('s', 'p', ok(liveSession({
    expiresAt: new Date(Date.now() + 3_600_000).toISOString(),
  })));
  assert.equal(good.user.id, 'user-1');
});
