import assert from 'node:assert/strict';
import test from 'node:test';

import {
  authReadiness,
  getBearerToken,
  hasRole,
  learnerScopedIdentity,
  requireAnyRole,
  requireIdentity,
  resolveFirebaseUser,
  resolveIdentity,
} from '../lib/auth.js';
import { firebaseExternalId, verifyFirebaseIdToken } from '../lib/firebase-auth.js';
import { errorStatus, learningRoute } from '../lib/learning/http.js';

function withEnv(values, callback) {
  const previous = new Map();
  for (const [key, value] of Object.entries(values)) {
    previous.set(key, process.env[key]);
    if (value === undefined) delete process.env[key];
    else process.env[key] = value;
  }
  const restore = () => {
    for (const [key, value] of previous) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  };
  try {
    const result = callback();
    if (result && typeof result.then === 'function') return result.finally(restore);
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

const request = (headers = {}) =>
  new Request('http://localhost/api/learning/sources', { headers });

test('bearer token is read only from a well-formed Authorization header', () => {
  assert.equal(getBearerToken(request()), null);
  assert.equal(getBearerToken(request({ authorization: 'Basic abc' })), null);
  assert.equal(getBearerToken(request({ authorization: 'Bearer abc.def.ghi' })), 'abc.def.ghi');
});

test('malformed Firebase bearer tokens fail closed before any Prisma upsert', async () => {
  await withEnv({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'schoolcircle-ae29a' }, async () => {
    let upserted = false;
    const result = await resolveFirebaseUser('not-a-jwt', {
      upsert: async () => {
        upserted = true;
        return null;
      },
    });
    assert.equal(result, null);
    assert.equal(upserted, false);
    assert.equal(await verifyFirebaseIdToken('not-a-jwt'), null);
    // The request-level resolver takes the same path: anonymous, no exception.
    assert.equal(await resolveIdentity(request({ authorization: 'Bearer not-a-jwt' })), null);
  });
});

test('Firebase identity is namespaced and the Prisma role wins over token claims', async () => {
  await withEnv({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'schoolcircle-ae29a' }, async () => {
    let query;
    const user = await resolveFirebaseUser(
      'verified-token',
      {
        upsert: async (value) => {
          query = value;
          return {
            id: 'user-firebase-1',
            name: value.create.name,
            role: 'LEARNER',
            externalId: value.create.externalId,
          };
        },
      },
      async () => ({
        uid: 'firebase-user-1',
        name: 'Learner',
        email: 'learner@example.test',
        role: 'INSTRUCTOR', // a claim a client could try to smuggle -- must be ignored
      }),
    );

    assert.equal(user.role, 'LEARNER');
    assert.equal(user.externalId, firebaseExternalId('firebase-user-1'));
    assert.equal(user.externalId, 'firebase:schoolcircle-ae29a:firebase-user-1');
    assert.equal(query.create.role, undefined);
    assert.equal(query.update.role, undefined);
    assert.equal(Object.hasOwn(user, 'uid'), false);
    assert.equal(user.email, 'learner@example.test');
    assert.equal(user.emailVerified, false);
  });
});

test('email ownership is carried only from a strict verified profile claim', async () => {
  await withEnv({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'schoolcircle-auth-test' }, async () => {
    for (const claim of [true, false, undefined, 'true']) {
      const identity = await resolveFirebaseUser('test-token', {
        upsert: async ({ create }) => ({
          id: 'verified-email-test',
          externalId: create.externalId,
          role: 'LEARNER',
          emailVerified: true, // Never trust a stored/profile-side override.
        }),
      }, async () => ({
        uid: 'email-claim-test',
        email: 'learner@example.test',
        emailVerified: claim,
      }));
      assert.equal(identity.emailVerified, claim === true);
    }
  });
});

test('no project id means nothing can be verified and readiness says so', async () => {
  await withEnv(
    { NEXT_PUBLIC_FIREBASE_PROJECT_ID: undefined, FIREBASE_PROJECT_ID: undefined },
    async () => {
      assert.equal(authReadiness().ready, false);
      assert.match(authReadiness().reason, /not configured/);
      assert.equal(firebaseExternalId('uid'), null);
      assert.equal(await resolveIdentity(request({ authorization: 'Bearer a.b.c' })), null);
    },
  );
});

test('requireIdentity / requireAnyRole reject anonymous callers with the API error contract', async () => {
  await withEnv({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: undefined }, async () => {
    await assert.rejects(requireIdentity(request()), (error) => {
      assert.equal(error.code, 'AUTH_REQUIRED');
      assert.equal(error.status, 401);
      assert.equal(error.auth.ready, false);
      return true;
    });
    await assert.rejects(requireAnyRole(request(), ['INSTRUCTOR']), { code: 'AUTH_REQUIRED' });
  });
});

test('BOTH is authorized for both learner and instructor capabilities', () => {
  assert.equal(hasRole('BOTH', 'LEARNER'), true);
  assert.equal(hasRole('BOTH', 'INSTRUCTOR'), true);
  assert.equal(hasRole('LEARNER', 'INSTRUCTOR'), false);
  assert.equal(hasRole('INSTRUCTOR', 'LEARNER'), false);
  assert.equal(hasRole('BOTH', 'ADMIN'), false);
});

test('the learner view only ever drops the instructor capability', () => {
  // "View as student" has to be answered the way a learner is answered, or the
  // one control that checks "nothing unreviewed reaches a student" lies about
  // it. This is how that is done, so it matters that it subtracts and nothing
  // else: the id is untouched, so the caller's own learner evidence still
  // resolves to them, and a learner passed through it is unchanged.
  const instructor = { id: 'u1', name: 'SSgt Okafor', role: 'INSTRUCTOR' };
  const scoped = learnerScopedIdentity(instructor);
  assert.equal(scoped.role, 'LEARNER');
  assert.equal(scoped.id, 'u1');
  assert.equal(scoped.name, 'SSgt Okafor');
  assert.equal(hasRole(scoped.role, 'INSTRUCTOR'), false);
  assert.equal(hasRole(scoped.role, 'LEARNER'), true);

  // BOTH is a capability union, so it loses the instructor half and keeps the
  // learner half rather than being left alone.
  assert.equal(learnerScopedIdentity({ id: 'u2', role: 'BOTH' }).role, 'LEARNER');

  // Nothing to take away, nothing taken.
  const learner = { id: 'u3', role: 'LEARNER' };
  assert.deepEqual(learnerScopedIdentity(learner), learner);
  assert.equal(learnerScopedIdentity(null), null);

  // It cannot be an escalation path: no input produces an instructor.
  for (const role of ['LEARNER', 'INSTRUCTOR', 'BOTH', 'ADMIN', '', undefined]) {
    assert.equal(hasRole(learnerScopedIdentity({ id: 'x', role })?.role, 'INSTRUCTOR'), false);
  }
});

test('learningRoute maps thrown errors to the shared status table', async () => {
  assert.equal(errorStatus(new TypeError('bad')), 400);
  assert.equal(errorStatus(Object.assign(new Error(), { code: 'NOT_FOUND' })), 404);
  assert.equal(errorStatus(Object.assign(new Error(), { code: 'CONFLICT' })), 409);
  assert.equal(errorStatus(Object.assign(new Error(), { code: 'RUBRIC_NOT_APPROVABLE' })), 409);
  assert.equal(errorStatus(Object.assign(new Error(), { code: 'NO_PROVIDER' })), 503);
  assert.equal(errorStatus(Object.assign(new Error(), { code: 'ARSENAL_UNAVAILABLE' })), 503);
  assert.equal(errorStatus(Object.assign(new Error(), { code: 'STUDENT_GROUNDING_SERVICE_ERROR' })), 503);
  assert.equal(errorStatus(Object.assign(new Error(), { code: 'STUDENT_GROUNDING_BAD_RESPONSE' })), 502);
  assert.equal(errorStatus(Object.assign(new Error(), { status: 422 })), 422);
  assert.equal(errorStatus(new Error('boom')), 500);

  await withEnv({ NEXT_PUBLIC_FIREBASE_PROJECT_ID: undefined }, async () => {
    // Authenticated route, anonymous caller -> 401 with readiness attached.
    const guarded = learningRoute({ roles: ['LEARNER', 'INSTRUCTOR'] }, () => ({ json: { ok: true } }));
    const denied = await guarded(request());
    assert.equal(denied.status, 401);
    const body = await denied.json();
    assert.equal(body.code, 'AUTH_REQUIRED');
    assert.equal(body.auth.ready, false);

    // Unauthenticated route runs and gets query/params/body parsed for it.
    const open = learningRoute({ body: 'none' }, ({ identity, query, params }) => ({
      json: { identity, query, params },
    }));
    const ok = await open(
      new Request('http://localhost/api/learning/status?courseId=c1'),
      { params: Promise.resolve({ id: 'x' }) },
    );
    assert.equal(ok.status, 200);
    assert.deepEqual(await ok.json(), { identity: null, query: { courseId: 'c1' }, params: { id: 'x' } });

    // Invalid JSON on a mutating route is a 400, not a crash.
    const post = learningRoute({}, () => ({ json: {} }));
    const bad = await post(
      new Request('http://localhost/api/learning/x', { method: 'POST', body: '{nope' }),
    );
    assert.equal(bad.status, 400);
    assert.equal((await bad.json()).code, 'BAD_REQUEST');

    // Tutor-like endpoints cap streaming JSON before parsing it. This is opt-in
    // so source uploads and unrelated learning requests retain their contracts.
    const capped = learningRoute({ maxBodyBytes: 20 }, () => ({ json: {} }));
    const oversized = await capped(
      new Request('http://localhost/api/learning/tutor', {
        method: 'POST',
        body: JSON.stringify({ question: 'x'.repeat(30) }),
      }),
    );
    assert.equal(oversized.status, 413);
    assert.equal((await oversized.json()).code, 'PAYLOAD_TOO_LARGE');
  });
});
