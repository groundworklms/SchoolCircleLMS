import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// The SDK verifies signatures/issuer/audience/expiry; these tests exercise our
// request boundary without accounts, credentials, or a live doctrine service.
const calls = [];
const verifyIdToken = mock.fn(async (token) => {
  if (token !== 'verified-test-token') throw new Error('Invalid token');
  return { uid: 'test-user' };
});
mock.module('firebase-admin/app', {
  namedExports: {
    getApps: () => [],
    initializeApp: (options, name) => {
      calls.push({ options, name });
      return { options, name };
    },
  },
});
mock.module('firebase-admin/auth', {
  namedExports: { getAuth: () => ({ verifyIdToken }) },
});
const askDoctrine = mock.fn(async ({ question }) => ({ answer: question, citations: [] }));
mock.module('../lib/doctrine.js', {
  namedExports: {
    askDoctrine,
    doctrineProvider: () => ({ ready: true }),
    // The route primes the runtime endpoint before asking, and
    // lib/doctrine-settings.js imports this setter from the real module. A mock
    // that omits it fails the import rather than the assertion, so it has to
    // mirror the module's surface.
    setStoredDoctrineBaseUrl: () => {},
  },
});
// The endpoint is settable at runtime; this test is about the auth gate, so the
// settings read is stubbed to a no-op rather than reaching for a database.
mock.module('../lib/doctrine-settings.js', {
  namedExports: { primeDoctrineSettings: async () => null },
});
const auth = { currentUser: null };
mock.module('../lib/firebase.js', { namedExports: { auth } });

const { POST } = await import('../app/api/doctrine/route.js');
const { authenticatedFetch } = await import('../lib/auth-fetch.js');

function request(authorization, body = { question: 'What is sight alignment?' }) {
  return new Request('http://example.test/api/doctrine', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body: JSON.stringify(body),
  });
}

test('doctrine rejects anonymous/malformed/invalid sessions before calling Anchor', async () => {
  // A synthetic project ID is configuration, not a credential.
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'doctrine-auth-test';
  for (const header of [null, 'Basic abc', 'Bearer', 'Bearer a b', 'Bearer forged', 'Bearer expired']) {
    const response = await POST(request(header));
    assert.equal(response.status, 401);
    assert.equal((await response.json()).code, 'UNAUTHENTICATED');
  }
  assert.equal(askDoctrine.mock.callCount(), 0);
  assert.equal(verifyIdToken.mock.callCount(), 2);
});

test('missing auth configuration fails closed', async () => {
  delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  const response = await POST(request('Bearer verified-test-token'));
  assert.equal(response.status, 503);
  assert.equal((await response.json()).code, 'AUTH_NOT_CONFIGURED');
  assert.equal(askDoctrine.mock.callCount(), 0);
});

test('verified users reach the existing question and answer behavior', async () => {
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'doctrine-auth-test';
  const response = await POST(request('Bearer verified-test-token'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).answer, 'What is sight alignment?');
  assert.equal(askDoctrine.mock.callCount(), 1);
  assert.deepEqual(calls.at(-1), {
    options: { projectId: 'doctrine-auth-test' }, name: 'doctrine-auth',
  });
  assert.equal((await POST(request('Bearer verified-test-token', {}))).status, 400);
  assert.equal(askDoctrine.mock.callCount(), 1);
});

test('client sends a Firebase ID token and preserves request options', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('{}'));
  try {
    auth.currentUser = { getIdToken: async () => 'verified-test-token' };
    const controller = new AbortController();
    await authenticatedFetch('/api/doctrine', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: '{"question":"test"}', signal: controller.signal,
    });
    const [url, options] = fetchMock.mock.calls[0].arguments;
    assert.equal(url, '/api/doctrine');
    assert.equal(options.headers.get('Authorization'), 'Bearer verified-test-token');
    assert.equal(options.headers.get('Content-Type'), 'application/json');
    assert.equal(options.signal, controller.signal);
    assert.equal(options.method, 'POST');
  } finally {
    fetchMock.mock.restore();
    auth.currentUser = null;
  }
});

test('client never fetches without a session or after sign-out during token retrieval', async () => {
  const fetchMock = mock.method(globalThis, 'fetch', async () => new Response('{}'));
  try {
    auth.currentUser = null;
    await assert.rejects(authenticatedFetch('/api/doctrine'), /Sign in/);
    auth.currentUser = {
      getIdToken: async () => {
        auth.currentUser = null;
        return 'old-token';
      },
    };
    await assert.rejects(authenticatedFetch('/api/doctrine'), /session changed/);
    assert.equal(fetchMock.mock.callCount(), 0);
  } finally {
    fetchMock.mock.restore();
  }
});