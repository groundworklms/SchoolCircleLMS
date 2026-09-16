import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Doctrine is now only a backwards-compatible route alias. Its auth and
// response rules belong to learningRoute/core; mock that chain so this route
// test cannot accidentally revive an unauthenticated global Anchor call.
const tutor = mock.fn(async (_identity, { body }) => ({
  json: {
    id: 'turn-1',
    courseId: body.courseId,
    answer: body.question,
    refused: false,
    citations: [],
    stages: [{ stage: 'answer', ok: true }],
  },
}));
const learningRoute = mock.fn((options, handler) => async (request) => {
  const body = await request.json();
  return Response.json(
    (await handler({
      identity: { id: 'learner-1', role: 'LEARNER' },
      body,
      params: {},
      query: {},
      request,
    })).json,
  );
});
mock.module('../lib/learning/http.js', { namedExports: { learningRoute } });
mock.module('../lib/learning/core.js', { namedExports: { tutor } });
const auth = { currentUser: null };
mock.module('../lib/firebase.js', { namedExports: { auth } });

const { POST } = await import('../app/api/doctrine/route.js');
const { authenticatedFetch } = await import('../lib/auth-fetch.js');

function request(authorization, body = {
  question: 'What is sight alignment?',
  courseId: 'course-1',
}) {
  return new Request('http://example.test/api/doctrine', {
    method: 'POST',
    headers: authorization ? { authorization } : {},
    body: JSON.stringify(body),
  });
}

test('doctrine aliases the authenticated course tutor, including its course scope', async () => {
  const response = await POST(request('Bearer verified-test-token'));
  assert.equal(response.status, 200);
  assert.equal((await response.json()).answer, 'What is sight alignment?');
  assert.deepEqual(learningRoute.mock.calls[0].arguments[0], {
    roles: ['LEARNER', 'INSTRUCTOR'],
    maxBodyBytes: 16 * 1024,
  });
  assert.equal(tutor.mock.callCount(), 1);
  assert.equal(tutor.mock.calls[0].arguments[1].body.courseId, 'course-1');
  assert.equal(tutor.mock.calls[0].arguments[1].body.sourceIds, undefined);
  assert.equal(typeof POST, 'function');
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