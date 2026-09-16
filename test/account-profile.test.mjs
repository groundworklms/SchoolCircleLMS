import assert from 'node:assert/strict';
import test from 'node:test';

import {
  accountProfileHandlers,
  validateAccountProfile,
} from '../lib/account-profile.js';
import {
  getBearerToken,
  resolveFirebaseUser,
} from '../lib/auth.js';
import { firebaseExternalId } from '../lib/firebase-auth.js';

const profile = (id, name, role = 'LEARNER') => ({
  id,
  name,
  rank: null,
  profileCompletedAt: null,
  role,
  externalId: `firebase:test-project:${id}`,
});

function request(token, { method = 'GET', body } = {}) {
  const headers = token ? { authorization: token } : {};
  return new Request('http://example.test/api/account/profile', {
    method,
    headers: body === undefined
      ? headers
      : { ...headers, 'content-type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

function makeProfileHandlers({ identities = {}, users } = {}) {
  return accountProfileHandlers({
    identityFor: async (incoming) => {
      const token = getBearerToken(incoming);
      return token ? identities[token] || null : null;
    },
    users,
  });
}

async function withFirebaseProject(callback) {
  const previous = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'test-project';
  try {
    return await callback();
  } finally {
    if (previous === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    else process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = previous;
  }
}

test('profile handlers reject missing and invalid bearer tokens without touching storage', async () => {
  let updates = 0;
  const { GET, PATCH } = makeProfileHandlers({
    identities: { 'valid-token': profile('user-a', 'A') },
    users: {
      update: async () => {
        updates += 1;
        throw new Error('must not save');
      },
    },
  });

  for (const incoming of [
    request(),
    request('Basic not-a-bearer'),
    request('Bearer invalid-token'),
    request('Bearer'),
    request('Bearer token with spaces'),
  ]) {
    const response = await GET(incoming);
    assert.equal(response.status, 401);
    assert.deepEqual(await response.json(), { error: 'Authentication required' });
  }
  const patch = await PATCH(request('Bearer invalid-token', {
    method: 'PATCH',
    body: { name: 'Should not save' },
  }));
  assert.equal(patch.status, 401);
  assert.equal(updates, 0);
});

test('profile handlers use the verified owner and reject id, externalId, and role fields', async () => {
  const calls = [];
  const { PATCH } = makeProfileHandlers({
    identities: {
      'user-a-token': profile('user-a', 'User A'),
      'user-b-token': profile('user-b', 'User B'),
    },
    users: {
      update: async (query) => {
        calls.push(query);
        return {
          ...profile(query.where.id, query.where.id === 'user-a' ? 'Updated A' : 'Updated B'),
          rank: 'Cpl',
          profileCompletedAt: new Date('2026-01-02T03:04:05.000Z'),
        };
      },
    },
  });

  // A caller authenticated as user A cannot select user B, even if the body
  // contains all of the usual account identifiers.
  const ownershipAttempt = await PATCH(request('Bearer user-a-token', {
    method: 'PATCH',
    body: {
      id: 'user-b',
      externalId: 'firebase:test-project:user-b',
      role: 'INSTRUCTOR',
      name: 'Cross-account write',
      rank: 'Cpl',
    },
  }));
  assert.equal(ownershipAttempt.status, 400);
  assert.equal(calls.length, 0);

  const valid = await PATCH(request('Bearer user-a-token', {
    method: 'PATCH',
    body: { name: 'Updated A', rank: 'Cpl' },
  }));
  assert.equal(valid.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.id, 'user-a');
  assert.deepEqual(calls[0].data, {
    name: 'Updated A',
    rank: 'Cpl',
    profileCompletedAt: calls[0].data.profileCompletedAt,
  });
  assert.equal((await valid.json()).user.id, 'user-a');

  const secondUser = await PATCH(request('Bearer user-b-token', {
    method: 'PATCH',
    body: { name: 'Updated B', rank: 'Sgt' },
  }));
  assert.equal(secondUser.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].where.id, 'user-b');
  assert.equal((await secondUser.json()).user.id, 'user-b');
});

test('profile validation has a small explicit allowlist and bounded text inputs', () => {
  assert.deepEqual(validateAccountProfile({ name: '  User A  ', rank: ' Cpl ' }), {
    name: 'User A',
    rank: 'Cpl',
  });
  assert.equal(validateAccountProfile({ name: 'n'.repeat(80), rank: 'r'.repeat(40) }).name.length, 80);
  assert.equal(validateAccountProfile({ name: 'n'.repeat(80), rank: 'r'.repeat(40) }).rank.length, 40);

  const invalidBodies = [
    null,
    [],
    {},
    { name: 'n'.repeat(81) },
    { name: 'valid', rank: 'r'.repeat(41) },
    { name: 'valid\u0000name' },
    { name: 'valid', rank: '\u001f' },
    { name: 'valid', id: 'user-b' },
    { name: 'valid', externalId: 'firebase:test-project:user-b' },
    { name: 'valid', role: 'INSTRUCTOR' },
  ];
  for (const body of invalidBodies) {
    assert.throws(() => validateAccountProfile(body), { status: 400 });
  }
});

test('validation and storage failures return errors and never report a false save', async () => {
  let updates = 0;
  const { PATCH: invalidPatch } = makeProfileHandlers({
    identities: { token: profile('user-a', 'User A') },
    users: {
      update: async () => {
        updates += 1;
        return profile('user-a', 'Unexpected');
      },
    },
  });
  const invalid = await invalidPatch(request('Bearer token', {
    method: 'PATCH',
    body: { name: 'valid', role: 'INSTRUCTOR' },
  }));
  assert.equal(invalid.status, 400);
  assert.equal(updates, 0);

  const { PATCH: failingPatch } = makeProfileHandlers({
    identities: { token: profile('user-a', 'User A') },
    users: {
      update: async () => {
        updates += 1;
        throw new Error('database unavailable');
      },
    },
  });
  const unavailable = await failingPatch(request('Bearer token', {
    method: 'PATCH',
    body: { name: 'valid' },
  }));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: 'Account service unavailable. Please retry.',
  });
  assert.equal(updates, 1);
});

test('Firebase resolver uses an injected verifier, preserves stored names, and keeps database role authoritative', async () => {
  await withFirebaseProject(async () => {
    let query;
    const persisted = {
      id: 'user-instructor',
      name: 'Preferred Account Name',
      rank: 'Maj',
      profileCompletedAt: new Date('2026-01-02T03:04:05.000Z'),
      role: 'INSTRUCTOR',
      externalId: firebaseExternalId('uid-1', 'test-project'),
    };
    const resolved = await resolveFirebaseUser(
      'synthetic-id-token',
      {
        upsert: async (value) => {
          query = value;
          return persisted;
        },
      },
      // This is an explicit test seam: no Firebase SDK or live cloud is used.
      async (token) => {
        assert.equal(token, 'synthetic-id-token');
        return {
          uid: 'uid-1',
          name: 'Firebase Name Must Not Overwrite',
          role: 'LEARNER',
          email: 'user@example.test',
        };
      },
    );

    assert.equal(resolved.name, 'Preferred Account Name');
    assert.equal(resolved.role, 'INSTRUCTOR');
    assert.equal(query.where.externalId, 'firebase:test-project:uid-1');
    assert.deepEqual(query.update, {});
    assert.equal(query.create.name, 'Firebase Name Must Not Overwrite');
    assert.equal(query.create.role, undefined);
  });
});

test('Firebase resolver does not create a user when the injected verifier returns no identity', async () => {
  let upserted = false;
  const result = await resolveFirebaseUser(
    'synthetic-invalid-token',
    {
      upsert: async () => {
        upserted = true;
        return null;
      },
    },
    async () => null,
  );
  assert.equal(result, null);
  assert.equal(upserted, false);
});
