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
  rank: 'Specialist',
  branch: 'ARMY',
  payGrade: 'E-4',
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

test('profile handlers use the verified owner, refuse self-service instructor elevation, and reject id and externalId fields', async () => {
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
          rank: 'Corporal',
          branch: 'ARMY',
          payGrade: 'E-4',
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
      rank: 'Corporal',
      branch: 'ARMY',
      payGrade: 'E-4',
    },
  }));
  assert.equal(ownershipAttempt.status, 400);
  assert.equal(calls.length, 0);

  // user-a is a LEARNER. The profile fields save, but the submitted INSTRUCTOR
  // role is clamped back to LEARNER: the endpoint never grants the instructor
  // capability to an account that does not already hold it.
  const valid = await PATCH(request('Bearer user-a-token', {
    method: 'PATCH',
    body: {
      name: 'Updated A',
      rank: 'Corporal',
      role: 'INSTRUCTOR',
      branch: 'ARMY',
      payGrade: 'E-4',
    },
  }));
  assert.equal(valid.status, 200);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].where.id, 'user-a');
  assert.deepEqual(calls[0].data, {
    name: 'Updated A',
    rank: 'Corporal',
    role: 'LEARNER',
    branch: 'ARMY',
    payGrade: 'E-4',
    profileCompletedAt: calls[0].data.profileCompletedAt,
  });
  const validBody = await valid.json();
  assert.equal(validBody.user.id, 'user-a');
  assert.equal(validBody.user.role, 'LEARNER');

  const secondUser = await PATCH(request('Bearer user-b-token', {
    method: 'PATCH',
    body: {
      name: 'Updated B',
      rank: null,
      role: 'LEARNER',
      branch: 'CIVILIAN',
      payGrade: null,
    },
  }));
  assert.equal(secondUser.status, 200);
  assert.equal(calls.length, 2);
  assert.equal(calls[1].where.id, 'user-b');
  assert.equal((await secondUser.json()).user.id, 'user-b');
});

test('profile validation has a small explicit allowlist and bounded text inputs', () => {
  assert.deepEqual(validateAccountProfile({
    name: '  User A  ',
    rank: ' Corporal ',
    role: 'LEARNER',
    branch: 'ARMY',
    payGrade: 'E-4',
  }), {
    name: 'User A',
    rank: 'Corporal',
    role: 'LEARNER',
    branch: 'ARMY',
    payGrade: 'E-4',
  });
  assert.equal(validateAccountProfile({
    name: 'n'.repeat(80), rank: 'Private', role: 'LEARNER', branch: 'ARMY', payGrade: 'E-1',
  }).name.length, 80);
  assert.equal(validateAccountProfile({
    name: 'n'.repeat(80), rank: null, role: 'LEARNER',
    branch: 'CIVILIAN', payGrade: null,
  }).name.length, 80);

  const invalidBodies = [
    null,
    [],
    {},
    { name: 'n'.repeat(81) },
    {
      name: 'valid', rank: 'r'.repeat(41), role: 'LEARNER', branch: 'CIVILIAN', payGrade: null,
    },
    {
      name: 'valid\u0000name', rank: null, role: 'LEARNER', branch: 'CIVILIAN', payGrade: null,
    },
    {
      name: 'valid', rank: null, role: 'LEARNER', branch: 'CIVILIAN', payGrade: '\u001f',
    },
    { name: 'valid', id: 'user-b' },
    { name: 'valid', externalId: 'firebase:test-project:user-b' },
    { name: 'valid', rank: null, role: 'ADMIN', branch: 'CIVILIAN', payGrade: null },
    {
      name: 'valid', rank: 'Specialist', role: 'LEARNER', branch: 'NAVY', payGrade: 'E-4',
    },
    {
      name: 'valid', rank: 'Specialist', role: 'LEARNER', branch: 'CIVILIAN', payGrade: null,
    },
    {
      name: 'valid', rank: null, role: 'LEARNER', branch: 'ARMY', payGrade: null,
    },
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
    body: {
      name: 'valid',
      rank: null,
      role: 'INSTRUCTOR',
      branch: 'CIVILIAN',
      payGrade: null,
      id: 'another-user',
    },
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
    body: {
      name: 'valid',
      rank: null,
      role: 'LEARNER',
      branch: 'CIVILIAN',
      payGrade: null,
    },
  }));
  assert.equal(unavailable.status, 503);
  assert.deepEqual(await unavailable.json(), {
    error: 'Account service unavailable. Please retry.',
  });
  assert.equal(updates, 1);
});

test('self-service profile edits persist but a learner can never elevate its own role', async () => {
  const stored = profile('user-a', 'User A', 'LEARNER');
  const updates = [];
  const { GET, PATCH } = makeProfileHandlers({
    identities: { token: stored },
    users: {
      update: async ({ data, where }) => {
        updates.push({ data, where });
        Object.assign(stored, data);
        return { ...stored };
      },
    },
  });

  // A self-serve POST asking for INSTRUCTOR saves the other profile fields but
  // is clamped back to LEARNER: this is the privilege-escalation hole, closed.
  const instructor = await PATCH(request('Bearer token', {
    method: 'PATCH',
    body: {
      name: 'User A',
      role: 'INSTRUCTOR',
      branch: 'MARINE_CORPS',
      payGrade: 'E-3',
      rank: 'Lance Corporal',
    },
  }));
  assert.equal(instructor.status, 200);
  assert.equal((await instructor.json()).user.role, 'LEARNER');
  assert.equal(updates[0].where.id, 'user-a');
  assert.equal(updates[0].data.role, 'LEARNER');
  // The non-authorization fields still persist normally.
  assert.equal(updates[0].data.branch, 'MARINE_CORPS');
  assert.equal(updates[0].data.payGrade, 'E-3');

  // BOTH is refused for the same reason: it carries the instructor capability.
  const both = await PATCH(request('Bearer token', {
    method: 'PATCH',
    body: {
      name: 'User A',
      role: 'BOTH',
      branch: 'MARINE_CORPS',
      payGrade: 'E-3',
      rank: 'Lance Corporal',
    },
  }));
  assert.equal(both.status, 200);
  assert.equal((await both.json()).user.role, 'LEARNER');
  assert.equal(updates[1].data.role, 'LEARNER');

  const reloaded = await GET(request('Bearer token'));
  assert.equal(reloaded.status, 200);
  const reloadedUser = (await reloaded.json()).user;
  assert.equal(reloadedUser.id, stored.id);
  assert.equal(reloadedUser.role, 'LEARNER');
  assert.equal(reloadedUser.branch, 'MARINE_CORPS');
  assert.equal(stored.role, 'LEARNER');
  assert.equal(updates.length, 2);
});

test('an account that already holds instructor keeps it and may adjust or step down', async () => {
  const stored = profile('instructor-a', 'Instructor A', 'INSTRUCTOR');
  const updates = [];
  const { PATCH } = makeProfileHandlers({
    identities: { token: stored },
    users: {
      update: async ({ data, where }) => {
        updates.push({ data, where });
        Object.assign(stored, data);
        return { ...stored };
      },
    },
  });

  // Already an instructor -> may add the learner capability (BOTH).
  const both = await PATCH(request('Bearer token', {
    method: 'PATCH',
    body: {
      name: 'Instructor A', role: 'BOTH', branch: 'ARMY', payGrade: 'E-4', rank: 'Specialist',
    },
  }));
  assert.equal(both.status, 200);
  assert.equal((await both.json()).user.role, 'BOTH');

  // And may step all the way down to LEARNER (reducing a role is always allowed).
  const learner = await PATCH(request('Bearer token', {
    method: 'PATCH',
    body: {
      name: 'Instructor A', role: 'LEARNER', branch: 'CIVILIAN', payGrade: null, rank: null,
    },
  }));
  assert.equal(learner.status, 200);
  assert.equal((await learner.json()).user.role, 'LEARNER');
  // Having stepped down, the same account can no longer self-restore instructor.
  const restore = await PATCH(request('Bearer token', {
    method: 'PATCH',
    body: {
      name: 'Instructor A', role: 'INSTRUCTOR', branch: 'ARMY', payGrade: 'E-4', rank: 'Specialist',
    },
  }));
  assert.equal(restore.status, 200);
  assert.equal((await restore.json()).user.role, 'LEARNER');
});

test('an allowlisted email is the one sanctioned self-serve path to instructor', async () => {
  const previous = process.env.INSTRUCTOR_EMAILS;
  process.env.INSTRUCTOR_EMAILS = 'lead@example.test, presenter@example.test';
  try {
    const stored = { ...profile('presenter', 'Presenter', 'LEARNER'), email: 'presenter@example.test' };
    const outsider = { ...profile('outsider', 'Outsider', 'LEARNER'), email: 'nobody@example.test' };
    const updates = [];
    const users = {
      update: async ({ data, where }) => {
        updates.push({ where, data });
        return { ...(where.id === 'presenter' ? stored : outsider), ...data };
      },
    };
    const { PATCH } = makeProfileHandlers({
      identities: { 'presenter-token': stored, 'outsider-token': outsider },
      users,
    });

    const promoted = await PATCH(request('Bearer presenter-token', {
      method: 'PATCH',
      body: {
        name: 'Presenter', role: 'INSTRUCTOR', branch: 'ARMY', payGrade: 'E-4', rank: 'Specialist',
      },
    }));
    assert.equal(promoted.status, 200);
    assert.equal((await promoted.json()).user.role, 'INSTRUCTOR');

    // Same request from an email that is NOT on the list is still clamped.
    const blocked = await PATCH(request('Bearer outsider-token', {
      method: 'PATCH',
      body: {
        name: 'Outsider', role: 'INSTRUCTOR', branch: 'ARMY', payGrade: 'E-4', rank: 'Specialist',
      },
    }));
    assert.equal(blocked.status, 200);
    assert.equal((await blocked.json()).user.role, 'LEARNER');
  } finally {
    if (previous === undefined) delete process.env.INSTRUCTOR_EMAILS;
    else process.env.INSTRUCTOR_EMAILS = previous;
  }
});

test('invalid profile combinations are rejected before storage and do not mutate prior data', async () => {
  const stored = profile('user-a', 'User A');
  let updates = 0;
  const { PATCH } = makeProfileHandlers({
    identities: { token: stored },
    users: {
      update: async () => {
        updates += 1;
        return stored;
      },
    },
  });

  for (const body of [
    {
      name: 'User A',
      role: 'BOTH',
      branch: 'ARMY',
      payGrade: 'E-5',
      rank: 'Specialist',
    },
    {
      name: 'User A',
      role: 'BOTH',
      branch: 'CIVILIAN',
      payGrade: 'E-1',
      rank: null,
    },
    {
      name: 'User A',
      role: 'BOTH',
      branch: 'CIVILIAN',
      payGrade: null,
      rank: null,
      externalId: 'firebase:test-project:other-user',
    },
  ]) {
    const response = await PATCH(request('Bearer token', { method: 'PATCH', body }));
    assert.equal(response.status, 400);
  }
  assert.equal(updates, 0);
  assert.equal(stored.role, 'LEARNER');
});

test('Firebase resolver uses an injected verifier, preserves stored names, and keeps database role authoritative', async () => {
  await withFirebaseProject(async () => {
    let query;
    const persisted = {
      id: 'user-instructor',
      name: 'Preferred Account Name',
      rank: 'Maj',
      branch: 'ARMY',
      payGrade: 'O-4',
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
