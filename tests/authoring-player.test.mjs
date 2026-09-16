import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLibraryTransport,
  createSessionEpochGuard,
  createStableAttemptManager,
  requestAuthoring,
} from '../app/learn/library/client.js';

test('stable attempt ids are reused for an identical network retry', async () => {
  const calls = [];
  let fail = true;
  const send = (blockId, optionId, attemptId) => {
    calls.push({ blockId, optionId, attemptId });
    if (fail) {
      fail = false;
      return Promise.reject(new Error('temporary network failure'));
    }
    return Promise.resolve({ result: { blockId, optionId, correct: true } });
  };
  const answer = createStableAttemptManager(send, () => 'attempt-one');

  await assert.rejects(answer('block-one', 'option-a'));
  await answer('block-one', 'option-a');

  assert.equal(calls.length, 2);
  assert.deepEqual(calls[0], calls[1]);
});

test('changing an answer receives a fresh idempotency key', async () => {
  const calls = [];
  const answer = createStableAttemptManager(
    (blockId, optionId, attemptId) => {
      calls.push({ blockId, optionId, attemptId });
      return Promise.resolve({});
    },
    (() => {
      let next = 0;
      return () => `attempt-${++next}`;
    })(),
  );

  await answer('block-one', 'option-a');
  await answer('block-one', 'option-b');
  await answer('block-one', 'option-b');

  assert.equal(calls[0].attemptId, 'attempt-1');
  assert.equal(calls[1].attemptId, 'attempt-2');
  assert.equal(calls[2].attemptId, 'attempt-2');
  assert.notEqual(calls[0].attemptId, calls[1].attemptId);
});

test('session epoch rejects continuations from an old account/course/release', () => {
  const sessions = createSessionEpochGuard();
  sessions.update('learner-a/course-1/release-1');
  const pending = sessions.capture();
  sessions.update('learner-b/course-1/release-1');
  assert.equal(sessions.isCurrent(pending), false);

  const nextPending = sessions.capture();
  sessions.update('learner-b/course-2/release-7');
  assert.equal(sessions.isCurrent(nextPending), false);
  assert.equal(sessions.isCurrent(sessions.capture()), true);
});

test('request transport sends no-store JSON requests and exposes API errors', async () => {
  const seen = [];
  const user = { uid: 'firebase-user' };
  const request = async (url, options, expectedUser) => {
    seen.push({ url, options, expectedUser });
    return {
      ok: true,
      status: 200,
      async json() {
        return { courses: [] };
      },
    };
  };

  const transport = createLibraryTransport({ user, request });
  const result = await transport.library();
  assert.deepEqual(result, { courses: [] });
  assert.equal(seen[0].url, '/api/authoring/library');
  assert.equal(seen[0].options.cache, 'no-store');
  assert.equal(seen[0].expectedUser, user);

  await assert.rejects(
    requestAuthoring(
      '/course-1',
      {},
      user,
      async () => ({
        ok: false,
        status: 409,
        async json() {
          return { error: 'Release is no longer available', code: 'CONFLICT' };
        },
      }),
    ),
    (error) => error.status === 409 && error.code === 'CONFLICT' && error.error === 'Release is no longer available',
  );
});