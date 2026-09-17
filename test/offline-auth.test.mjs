/*
 * The offline operator auth seam.
 *
 * The thing worth being paranoid about here is not whether offline sign-in
 * works -- it is whether it can be reached on the hosted deployment, where
 * Firebase is the only intended way in. So the first and largest group of tests
 * below is about the seam being ABSENT: with AUTH_MODE unset, a perfectly
 * well-formed offline token is worth nothing, the session route does not exist,
 * and `authReadiness()` returns the same object it always did, key for key.
 *
 * The database is a small in-memory double. These assertions are about which
 * credential is accepted and which `User` row it maps to; a real Postgres would
 * make them slower without making them stronger.
 *
 * The double is passed in through the `userClient` test seam rather than with
 * `mock.module`, which needs Node >= 22.3 and --experimental-test-module-mocks
 * and so would silently never execute on the Node 20 that CI pins. This file
 * must run under `node --test` with NO FLAGS. The last test in the file proves
 * the seam has not swallowed the production default.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

import * as authModule from '../lib/auth.js';
import { verifyFirebaseIdToken } from '../lib/firebase-auth.js';
import * as offlineAuth from '../lib/offline-auth.js';
import { hashPassphrase } from '../lib/settings-crypto.js';
import * as route from '../app/api/auth/offline/session/route.js';

/* ------------------------------- test doubles ----------------------------- */

const users = new Map();
let upserts = [];
// Set to a message to make the next upsert throw, so the identity boundary's
// database-outage behaviour can be exercised through the real resolveIdentity.
let dbFailure = null;

function snapshot(row) {
  return row ? JSON.parse(JSON.stringify(row)) : null;
}

const userClient = {
  async upsert({ where, create, update, select }) {
    if (dbFailure) throw new Error(dbFailure);
    upserts.push({ where, create, update, select });
    const existing = [...users.values()].find((row) => row.externalId === where.externalId);
    if (existing) {
      Object.assign(existing, update || {});
      return snapshot(existing);
    }
    const row = {
      id: `user-${users.size + 1}`,
      name: create.name,
      rank: null,
      branch: null,
      payGrade: null,
      profileCompletedAt: null,
      role: create.role || 'LEARNER',
      externalId: create.externalId,
    };
    users.set(row.id, row);
    return snapshot(row);
  },
};

/*
 * The in-memory double, threaded through the production `userClient` seam.
 * Everything else in each call -- token verification, the enabled gate, the
 * externalId namespacing, the role rule, the error contract -- is the real
 * production code path.
 */
const resolveOfflineUser = (token, client = userClient, verifier) =>
  authModule.resolveOfflineUser(token, client, verifier);
const resolveIdentity = (request) => authModule.resolveIdentity(request, userClient);
const requireIdentity = (request) => authModule.requireIdentity(request, userClient);
const requireAnyRole = (request, roles) => authModule.requireAnyRole(request, roles, userClient);

const { authReadiness } = authModule;
const {
  authenticateOfflineOperator,
  isOfflineSessionToken,
  offlineAuthEnabled,
  offlineAuthReadiness,
  offlineExternalId,
  offlineLoginThrottle,
  offlineModeRequested,
  offlineOperators,
  recordOfflineLoginFailure,
  resetOfflineLoginThrottle,
  signOfflineSession,
  verifyOfflineSessionToken,
} = offlineAuth;

/* --------------------------------- helpers -------------------------------- */

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

const SECRET = 'offline-test-secret-that-is-long-enough-32+';
const OTHER_SECRET = 'a-completely-different-offline-secret-value';
const PASSPHRASE = 'correct horse battery staple';

// scrypt is deliberately slow; hash once for the whole file.
const OPERATOR_HASH = hashPassphrase(PASSPHRASE);
const roster = (extra = {}) => JSON.stringify([
  { subject: 'sgt-okafor', name: 'SSgt Okafor', role: 'INSTRUCTOR', passphrase: OPERATOR_HASH, ...extra },
]);

const OFFLINE_ON = {
  AUTH_MODE: 'offline',
  OFFLINE_AUTH_SECRET: SECRET,
  OFFLINE_AUTH_REALM: 'testbench',
  OFFLINE_AUTH_OPERATORS: roster(),
};

const OFFLINE_OFF = {
  AUTH_MODE: undefined,
  OFFLINE_AUTH_SECRET: undefined,
  OFFLINE_AUTH_REALM: undefined,
  OFFLINE_AUTH_OPERATORS: undefined,
};

const request = (headers = {}) =>
  new Request('http://localhost/api/learning/sources', { headers });

/** A token that IS valid, minted while offline mode is on. */
function mintValidToken(env = OFFLINE_ON) {
  return withEnv(env, () => signOfflineSession('sgt-okafor').token);
}

beforeEach(() => {
  users.clear();
  upserts = [];
  dbFailure = null;
  resetOfflineLoginThrottle();
});

/* ================= 1. THE SEAM IS ABSENT WHEN THE FLAG IS OFF ============= */

test('with AUTH_MODE unset the offline seam does not exist', async () => {
  // Mint a genuinely valid token first, with the flag on...
  const validToken = mintValidToken();
  assert.ok(isOfflineSessionToken(validToken));

  // ...then prove it is worth nothing with the flag off.
  await withEnv({ ...OFFLINE_OFF, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'schoolcircle-ae29a' }, async () => {
    assert.equal(offlineModeRequested(), false);
    assert.equal(offlineAuthEnabled(), false);
    assert.equal(signOfflineSession('sgt-okafor'), null);
    assert.equal(verifyOfflineSessionToken(validToken), null);
    assert.equal(authenticateOfflineOperator('sgt-okafor', PASSPHRASE), null);

    // The identity mapper refuses before it can touch Prisma.
    assert.equal(await resolveOfflineUser(validToken), null);
    assert.equal(upserts.length, 0);

    // And the request-level resolver treats it as an anonymous request: the
    // token is routed to the Firebase verifier, which rejects it on shape.
    assert.equal(await resolveIdentity(request({ authorization: `Bearer ${validToken}` })), null);
    assert.equal(upserts.length, 0);
    await assert.rejects(requireIdentity(request({ authorization: `Bearer ${validToken}` })), {
      code: 'AUTH_REQUIRED',
    });
  });
});

test('with AUTH_MODE unset the session route answers 404 for every method', async () => {
  await withEnv(OFFLINE_OFF, async () => {
    const get = await route.GET();
    assert.equal(get.status, 404);
    assert.deepEqual(await get.json(), { error: 'Not found', code: 'NOT_FOUND' });

    // Deliberately NO injected user client: this is the route exactly as Next
    // invokes it, with the real Prisma default behind it. It must 404 before
    // anything reaches a database.
    const post = await route.POST(new Request('http://localhost/api/auth/offline/session', {
      method: 'POST',
      body: JSON.stringify({ subject: 'sgt-okafor', passphrase: PASSPHRASE }),
    }));
    assert.equal(post.status, 404);
    // Identical body to the GET: nothing distinguishes "turned off" from
    // "no such route" to someone probing the hosted deployment.
    assert.deepEqual(await post.json(), { error: 'Not found', code: 'NOT_FOUND' });
    assert.equal(upserts.length, 0);
  });
});

test('authReadiness is unchanged, key for key, when AUTH_MODE is unset', async () => {
  await withEnv({ ...OFFLINE_OFF, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'schoolcircle-ae29a' }, () => {
    assert.deepEqual(authReadiness(), {
      ready: true,
      provider: 'firebase',
      acceptsHeaderRoles: false,
      firebase: { configured: true },
    });
    assert.equal(Object.hasOwn(authReadiness(), 'offline'), false);
  });

  await withEnv(
    { ...OFFLINE_OFF, NEXT_PUBLIC_FIREBASE_PROJECT_ID: undefined, FIREBASE_PROJECT_ID: undefined },
    () => {
      const readiness = authReadiness();
      assert.equal(readiness.ready, false);
      assert.equal(readiness.provider, 'firebase');
      assert.equal(readiness.acceptsHeaderRoles, false);
      assert.deepEqual(readiness.firebase, { configured: false });
      assert.match(readiness.reason, /Firebase Authentication is not configured/);
      assert.equal(Object.hasOwn(readiness, 'offline'), false);
      assert.deepEqual(Object.keys(readiness).sort(), [
        'acceptsHeaderRoles', 'firebase', 'provider', 'ready', 'reason',
      ]);
    },
  );
});

test('a half-configured offline deployment accepts nothing', async () => {
  const validToken = mintValidToken();
  const halves = [
    // Mode asked for, no signing secret.
    { AUTH_MODE: 'offline', OFFLINE_AUTH_SECRET: undefined, OFFLINE_AUTH_REALM: 'testbench' },
    // Secret too short to be a secret.
    { AUTH_MODE: 'offline', OFFLINE_AUTH_SECRET: 'too-short', OFFLINE_AUTH_REALM: 'testbench' },
    // Secret present, mode never asked for.
    { AUTH_MODE: undefined, OFFLINE_AUTH_SECRET: SECRET, OFFLINE_AUTH_REALM: 'testbench' },
    // A mode that is not exactly "offline".
    { AUTH_MODE: 'offline-ish', OFFLINE_AUTH_SECRET: SECRET, OFFLINE_AUTH_REALM: 'testbench' },
    // An unusable realm label.
    { AUTH_MODE: 'offline', OFFLINE_AUTH_SECRET: SECRET, OFFLINE_AUTH_REALM: 'bad:realm' },
  ];
  for (const half of halves) {
    await withEnv({ ...half, OFFLINE_AUTH_OPERATORS: roster() }, async () => {
      assert.equal(offlineAuthEnabled(), false, JSON.stringify(half));
      assert.equal(verifyOfflineSessionToken(validToken), null);
      assert.equal(await resolveOfflineUser(validToken), null);
      assert.equal((await route.GET()).status, 404);
      assert.ok(offlineAuthReadiness().reason);
    });
  }
  assert.equal(upserts.length, 0);
});

/* =================== 2. SIGNING AND LOCAL VERIFICATION ==================== */

test('a session round-trips with no network call and reports its window', async () => {
  await withEnv(OFFLINE_ON, () => {
    const now = 1_700_000_000_000;
    const minted = signOfflineSession('sgt-okafor', { now, hours: 12 });
    assert.equal(minted.subject, 'sgt-okafor');
    assert.equal(minted.realm, 'testbench');
    assert.equal(minted.expiresAt - minted.issuedAt, 12 * 3600 * 1000);

    const session = verifyOfflineSessionToken(minted.token, { now });
    assert.equal(session.subject, 'sgt-okafor');
    assert.equal(session.realm, 'testbench');
    assert.equal(session.expiresAt, minted.expiresAt);
  });
});

test('an offline token can never be mistaken for a Firebase ID token', async () => {
  await withEnv({ ...OFFLINE_ON, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'schoolcircle-ae29a' }, async () => {
    const token = signOfflineSession('sgt-okafor').token;
    // Four segments; a Firebase ID token always has three.
    assert.equal(token.split('.').length, 4);
    assert.equal(await verifyFirebaseIdToken(token), null);

    // ...and a three-segment Firebase-shaped token is never routed to the
    // offline verifier, so offline mode cannot launder a Firebase token.
    assert.equal(isOfflineSessionToken('aaaa.bbbb.cccc'), false);
    assert.equal(verifyOfflineSessionToken('aaaa.bbbb.cccc'), null);
  });
});

test('a session is not forgeable without the local secret', async () => {
  const token = mintValidToken();
  const [prefix, version, payload, signature] = token.split('.');

  await withEnv(OFFLINE_ON, () => {
    // Baseline: the untouched token verifies.
    assert.ok(verifyOfflineSessionToken(token));

    // Re-signed payload claiming a different subject, using a DIFFERENT secret.
    const forged = withEnv({ ...OFFLINE_ON, OFFLINE_AUTH_SECRET: OTHER_SECRET }, () =>
      signOfflineSession('sgt-okafor').token);
    assert.equal(verifyOfflineSessionToken(forged), null);

    // Payload swapped for one that names another subject, signature kept.
    const otherPayload = Buffer.from(
      JSON.stringify({ v: 1, sub: 'impostor', realm: 'testbench', iat: 1, exp: 4_000_000_000, jti: 'x' }),
      'utf8',
    ).toString('base64url');
    assert.equal(verifyOfflineSessionToken(`${prefix}.${version}.${otherPayload}.${signature}`), null);

    // Signature flipped.
    const flipped = `${signature.slice(0, -1)}${signature.at(-1) === 'A' ? 'B' : 'A'}`;
    assert.equal(verifyOfflineSessionToken(`${prefix}.${version}.${payload}.${flipped}`), null);

    // Unsigned "alg: none" style token.
    assert.equal(verifyOfflineSessionToken(`${prefix}.${version}.${payload}.`), null);
    assert.equal(verifyOfflineSessionToken(`${prefix}.${version}.${payload}`), null);

    // Wrong prefix / version.
    assert.equal(verifyOfflineSessionToken(`scoffline.v2.${payload}.${signature}`), null);
    assert.equal(verifyOfflineSessionToken(`jwt.v1.${payload}.${signature}`), null);

    // Junk.
    for (const junk of [null, undefined, '', 'x', 'a.b.c.d', `${prefix}.${version}...`]) {
      assert.equal(verifyOfflineSessionToken(junk), null);
    }
  });
});

test('expiry, clock skew and realm are all checked locally', async () => {
  await withEnv(OFFLINE_ON, () => {
    const now = 1_700_000_000_000;
    const minted = signOfflineSession('sgt-okafor', { now, hours: 1 });

    // Inside the window.
    assert.ok(verifyOfflineSessionToken(minted.token, { now: now + 59 * 60 * 1000 }));
    // Past it. This is the whole point: unlike a Firebase ID token, the session
    // survives as long as its own signed window and needs nothing to refresh it.
    assert.equal(verifyOfflineSessionToken(minted.token, { now: now + 61 * 60 * 1000 }), null);
    // Stamped in the future beyond the tolerated skew.
    assert.equal(verifyOfflineSessionToken(minted.token, { now: now - 10 * 60 * 1000 }), null);

    // A token minted for another realm is rejected even though the same secret
    // signed it, so one secret can serve distinct deployments.
    const elsewhere = withEnv({ ...OFFLINE_ON, OFFLINE_AUTH_REALM: 'other-box' }, () =>
      signOfflineSession('sgt-okafor', { now }).token);
    assert.equal(verifyOfflineSessionToken(elsewhere, { now }), null);
  });
});

test('session length is clamped to a sane window', async () => {
  for (const [configured, expectedHours] of [['0.1', 1], ['9999', 168], ['24', 24], ['nonsense', 12]]) {
    await withEnv({ ...OFFLINE_ON, OFFLINE_AUTH_SESSION_HOURS: configured }, () => {
      assert.equal(offlineAuth.offlineSessionHours(), expectedHours);
    });
  }
});

/* ================= 3. MAPPING TO A REAL PRISMA USER ROW ================== */

test('the offline subject is namespaced like a Firebase one, needing no new column', async () => {
  await withEnv(OFFLINE_ON, async () => {
    assert.equal(offlineExternalId('sgt-okafor'), 'offline:testbench:sgt-okafor');

    const identity = await resolveOfflineUser(signOfflineSession('sgt-okafor').token);
    assert.equal(identity.externalId, 'offline:testbench:sgt-okafor');
    assert.equal(identity.offline, true);
    assert.ok(identity.id);

    // Only columns that already exist on User are written.
    assert.deepEqual(
      Object.keys(upserts[0].create).sort(),
      ['externalId', 'name', 'role'],
    );
  });
});

test('a subject can never spell another subject`s external id', async () => {
  await withEnv(OFFLINE_ON, () => {
    // A colon would let a subject forge the namespace separator.
    for (const bad of ['a:b', 'offline:testbench:root', '', ' ', '../x', 'a/b', 'a b', null, 'ü']) {
      assert.equal(offlineExternalId(bad), null, String(bad));
      assert.equal(signOfflineSession(bad), null, String(bad));
    }
    assert.equal(offlineExternalId('sgt-okafor', 'bad:realm'), null);
  });
});

test('the Prisma role wins over the roster for an account that already exists', async () => {
  await withEnv(OFFLINE_ON, async () => {
    // First sign-in creates the row and the roster seeds INSTRUCTOR on it.
    const first = await resolveOfflineUser(signOfflineSession('sgt-okafor').token);
    assert.equal(first.role, 'INSTRUCTOR');
    assert.equal(upserts[0].create.role, 'INSTRUCTOR');
    // Nothing is ever written on update, so a persisted choice survives.
    assert.deepEqual(upserts[0].update, {});

    // An operator demoted in the database stays demoted, whatever the roster
    // says. This is the property that stops deployment config being an
    // escalation path.
    [...users.values()][0].role = 'LEARNER';
    const second = await resolveOfflineUser(signOfflineSession('sgt-okafor').token);
    assert.equal(second.role, 'LEARNER');
    assert.deepEqual(upserts[1].update, {});
  });
});

test('the token carries no role and no name to smuggle', async () => {
  await withEnv(OFFLINE_ON, () => {
    const token = signOfflineSession('sgt-okafor').token;
    const claims = JSON.parse(Buffer.from(token.split('.')[2], 'base64url').toString('utf8'));
    assert.deepEqual(Object.keys(claims).sort(), ['exp', 'iat', 'jti', 'realm', 'sub', 'v']);
    assert.equal(Object.hasOwn(claims, 'role'), false);
    assert.equal(Object.hasOwn(claims, 'name'), false);
  });
});

test('an offline operator without a roster entry gets no seeded role', async () => {
  await withEnv(OFFLINE_ON, async () => {
    // A token for a subject that has since been removed from the roster still
    // verifies (it was signed by this box) but seeds nothing privileged.
    const token = signOfflineSession('ghost-operator').token;
    const identity = await resolveOfflineUser(token);
    assert.equal(identity.role, 'LEARNER');
    assert.equal(Object.hasOwn(upserts[0].create, 'role'), false);
    assert.match(identity.name, /ghost-operator/);
  });
});

test('an offline identity satisfies requireAnyRole and carries no unverified email', async () => {
  await withEnv(OFFLINE_ON, async () => {
    const token = signOfflineSession('sgt-okafor').token;
    const identity = await resolveIdentity(request({ authorization: `Bearer ${token}` }));
    assert.equal(identity.role, 'INSTRUCTOR');

    const guarded = await requireAnyRole(
      request({ authorization: `Bearer ${token}` }),
      ['INSTRUCTOR'],
    );
    assert.equal(guarded.id, identity.id);
    // A learner-only route still refuses an instructor, unchanged.
    await assert.rejects(
      requireAnyRole(request({ authorization: `Bearer ${token}` }), ['LEARNER']),
      { code: 'FORBIDDEN' },
    );

    // Nothing verified an offline operator's address, so it is never claimed.
    assert.equal(identity.emailVerified, false);
  });
});

test('an offline email in the roster is carried but never marked verified', async () => {
  await withEnv(
    { ...OFFLINE_ON, OFFLINE_AUTH_OPERATORS: roster({ email: 'okafor@example.test' }) },
    async () => {
      const identity = await resolveOfflineUser(signOfflineSession('sgt-okafor').token);
      assert.equal(identity.email, 'okafor@example.test');
      assert.equal(identity.emailVerified, false);
    },
  );
});

test('a database failure on the offline path is a 503 boundary error, never anonymous', async () => {
  await withEnv(OFFLINE_ON, async () => {
    const token = signOfflineSession('sgt-okafor').token;

    // The mapper propagates the failure...
    await assert.rejects(
      resolveOfflineUser(token, {
        upsert: async () => {
          throw new Error('connection refused');
        },
      }),
      /connection refused/,
    );

    // ...and resolveIdentity wraps it as the boundary error the API contract
    // expects, so a database outage can never read as a successful login OR as
    // a quietly anonymous request.
    dbFailure = 'connection refused';
    try {
      await assert.rejects(
        resolveIdentity(request({ authorization: `Bearer ${token}` })),
        (error) => {
          assert.equal(error.code, 'AUTH_UNAVAILABLE');
          assert.equal(error.status, 503);
          return true;
        },
      );
    } finally {
      dbFailure = null;
    }

    // An upsert that returns an unusable row is null, not a half-identity.
    assert.equal(await resolveOfflineUser(token, { upsert: async () => null }), null);
    assert.equal(
      await resolveOfflineUser(token, { upsert: async () => ({ id: 'x', externalId: 'offline:testbench:someone-else' }) }),
      null,
    );
  });
});

/* ======================= 4. THE OPERATOR ROSTER ========================== */

test('the roster is parsed strictly and drops anything unusable', async () => {
  const messy = JSON.stringify([
    { subject: 'good', passphrase: OPERATOR_HASH, role: 'BOTH' },
    // Plaintext passphrase: not a scrypt envelope, so not an operator.
    { subject: 'plaintext', passphrase: 'hunter2' },
    // No passphrase at all.
    { subject: 'nopass' },
    // Colon in the subject.
    { subject: 'a:b', passphrase: OPERATOR_HASH },
    // Duplicate subject: first wins.
    { subject: 'good', passphrase: OPERATOR_HASH, role: 'INSTRUCTOR' },
    // Role that is not a Prisma Role.
    { subject: 'weirdrole', passphrase: OPERATOR_HASH, role: 'ADMIN' },
    'not-an-object',
    null,
  ]);
  await withEnv({ ...OFFLINE_ON, OFFLINE_AUTH_OPERATORS: messy }, () => {
    const operators = offlineOperators();
    assert.deepEqual(operators.map((o) => o.subject), ['good', 'weirdrole']);
    assert.equal(operators[0].role, 'BOTH');
    // An unrecognised role is dropped rather than passed to Prisma.
    assert.equal(operators[1].role, null);
  });

  // Malformed JSON is an empty roster, not a crash.
  for (const raw of ['{', '{}', '"nope"', '[]', '']) {
    await withEnv({ ...OFFLINE_ON, OFFLINE_AUTH_OPERATORS: raw }, () => {
      assert.deepEqual(offlineOperators(), []);
    });
  }
});

test('operator authentication accepts only the right passphrase', async () => {
  await withEnv(OFFLINE_ON, () => {
    assert.equal(authenticateOfflineOperator('sgt-okafor', PASSPHRASE).subject, 'sgt-okafor');
    assert.equal(authenticateOfflineOperator('sgt-okafor', 'wrong passphrase'), null);
    assert.equal(authenticateOfflineOperator('sgt-okafor', PASSPHRASE.toUpperCase()), null);
    assert.equal(authenticateOfflineOperator('sgt-okafor', PASSPHRASE.slice(0, -1)), null);
    /* Surrounding whitespace is insignificant: `hashPassphrase` and
       `passphraseMatches` both trim, which is existing shared behaviour for the
       operator passphrase panel and is reused here deliberately rather than
       forked. Pinned so a future change to settings-crypto is noticed. */
    assert.equal(authenticateOfflineOperator('sgt-okafor', `  ${PASSPHRASE}  `).subject, 'sgt-okafor');
    assert.equal(authenticateOfflineOperator('nobody', PASSPHRASE), null);
    assert.equal(authenticateOfflineOperator('', PASSPHRASE), null);
    assert.equal(authenticateOfflineOperator('sgt-okafor', ''), null);
    assert.equal(authenticateOfflineOperator('sgt-okafor', null), null);
  });
});

/* ============================ 5. THE WAY IN ============================== */

const sessionPost = (body, deps = { userClient }) =>
  route.POST(
    new Request('http://localhost/api/auth/offline/session', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: typeof body === 'string' ? body : JSON.stringify(body),
    }),
    // Next.js passes (request, context); the third argument is the test seam.
    undefined,
    deps,
  );

test('the session route issues a usable session for a real operator', async () => {
  await withEnv(OFFLINE_ON, async () => {
    const response = await sessionPost({ subject: 'sgt-okafor', passphrase: PASSPHRASE });
    assert.equal(response.status, 200);
    assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
    const body = await response.json();

    // The token it hands out is one this deployment will actually accept.
    const session = verifyOfflineSessionToken(body.token);
    assert.equal(session.subject, 'sgt-okafor');
    assert.ok(Date.parse(body.expiresAt) > Date.now());

    // And it names the real Prisma row, role included, so the client can route.
    assert.equal(body.user.externalId, 'offline:testbench:sgt-okafor');
    assert.equal(body.user.role, 'INSTRUCTOR');
    assert.equal(body.user.offline, true);
    assert.ok(body.user.id);
    // The passphrase never comes back in any form.
    assert.equal(JSON.stringify(body).includes(PASSPHRASE), false);

    // The same token then works as a bearer credential on a learning route.
    const identity = await resolveIdentity(request({ authorization: `Bearer ${body.token}` }));
    assert.equal(identity.id, body.user.id);
    assert.equal(identity.role, 'INSTRUCTOR');
  });
});

test('the session route refuses a bad credential without saying which half', async () => {
  await withEnv(OFFLINE_ON, async () => {
    const wrongPass = await sessionPost({ subject: 'sgt-okafor', passphrase: 'nope' });
    const unknown = await sessionPost({ subject: 'stranger', passphrase: PASSPHRASE });
    assert.equal(wrongPass.status, 401);
    assert.equal(unknown.status, 401);
    assert.deepEqual(await wrongPass.json(), await unknown.json());
    assert.equal(users.size, 0);

    for (const bad of [{}, { subject: 'sgt-okafor' }, { passphrase: PASSPHRASE }, { subject: '  ' }]) {
      assert.equal((await sessionPost(bad)).status, 400);
    }
    assert.equal((await sessionPost('{not json')).status, 400);
  });
});

test('repeated guesses against one operator are throttled', async () => {
  await withEnv(OFFLINE_ON, async () => {
    for (let attempt = 0; attempt < 5; attempt += 1) {
      assert.equal((await sessionPost({ subject: 'sgt-okafor', passphrase: 'nope' })).status, 401);
    }
    const blocked = await sessionPost({ subject: 'sgt-okafor', passphrase: 'nope' });
    assert.equal(blocked.status, 429);
    assert.ok(Number(blocked.headers.get('Retry-After')) > 0);

    // Even the correct passphrase waits out the window, so the throttle cannot
    // be cleared by guessing until you get it right.
    assert.equal((await sessionPost({ subject: 'sgt-okafor', passphrase: PASSPHRASE })).status, 429);

    // A different operator is unaffected.
    assert.equal(offlineLoginThrottle('someone-else').allowed, true);

    // The window is a sliding one.
    const now = Date.now();
    resetOfflineLoginThrottle();
    for (let attempt = 0; attempt < 5; attempt += 1) recordOfflineLoginFailure('x', { now });
    assert.equal(offlineLoginThrottle('x', { now: now + 1000 }).allowed, false);
    assert.equal(offlineLoginThrottle('x', { now: now + 61_000 }).allowed, true);
  });
});

test('the readiness probe reports the mode without naming any operator', async () => {
  await withEnv(OFFLINE_ON, async () => {
    const response = await route.GET();
    assert.equal(response.status, 200);
    const body = await response.json();
    assert.deepEqual(body, { enabled: true, sessionHours: 12 });
    assert.equal(JSON.stringify(body).includes('sgt-okafor'), false);

    // authReadiness gains the offline block only on an opted-in deployment,
    // and it too names no operator.
    const readiness = authReadiness();
    assert.equal(readiness.offline.enabled, true);
    assert.equal(readiness.offline.realm, 'testbench');
    assert.equal(readiness.offline.operators, 1);
    assert.equal(readiness.acceptsHeaderRoles, false);
    assert.equal(JSON.stringify(readiness).includes('sgt-okafor'), false);
  });
});

/* ============ 6. THE FIREBASE PATH IS NOT WEAKENED BY ANY OF IT =========== */

test('offline mode does not change how a Firebase token is handled', async () => {
  await withEnv(
    { ...OFFLINE_ON, NEXT_PUBLIC_FIREBASE_PROJECT_ID: 'schoolcircle-ae29a' },
    async () => {
      // Both providers configured at once: readiness still prefers firebase as
      // the named provider and reports both.
      const readiness = authReadiness();
      assert.equal(readiness.provider, 'firebase');
      assert.equal(readiness.firebase.configured, true);
      assert.equal(readiness.offline.enabled, true);

      // A malformed Firebase token is still anonymous -- offline mode is not a
      // fallback that rescues it, and no Prisma row is created for it.
      assert.equal(await resolveIdentity(request({ authorization: 'Bearer not-a-jwt' })), null);
      assert.equal(await resolveIdentity(request({ authorization: 'Bearer a.b.c' })), null);
      assert.equal(users.size, 0);
      assert.equal(upserts.length, 0);

      // No bearer token at all is still anonymous.
      assert.equal(await resolveIdentity(request()), null);
      assert.equal(await resolveIdentity(request({ authorization: 'Basic abc' })), null);
    },
  );
});

/* ================ 7. THE TEST SEAM HAS NOT EATEN THE PRODUCT ============== */

/*
 * The failure mode of a dependency-injected rewrite is a suite that passes
 * because it only ever exercises its own fakes. Guard against exactly that: when
 * no user client is injected, the production default must be the REAL Prisma
 * client, which in this environment has no reachable database and fails at
 * initialization. If the default had silently become the in-memory double, these
 * calls would succeed instead -- so a green result here is the fake being
 * absent, not present.
 */
/*
 * NOTE ON OUTPUT: lib/db.js configures Prisma with log: ['error'], and the
 * Prisma engine writes that log straight to fd 2 from native code, so it cannot
 * be captured from JavaScript. This test therefore prints four
 *
 *     prisma:error  Invalid `prisma.user.upsert()` invocation:
 *     error: Environment variable not found: DATABASE_URL.
 *
 * banners on a completely healthy run. THEY ARE THE ASSERTION PASSING, not a
 * failure: each one is the real Prisma client refusing to work without a
 * database, which is precisely what proves the in-memory double is not wired in
 * as the default. Judge this test by its ✔ and the suite's exit code.
 */
test('omitting the injected client reaches the real Prisma client, not the double', async () => {
  await withEnv(OFFLINE_ON, async () => {
    const token = signOfflineSession('sgt-okafor').token;

    // resolveOfflineUser, production defaults.
    await assert.rejects(
      authModule.resolveOfflineUser(token),
      (error) => {
        assert.match(error.constructor.name, /^PrismaClient/);
        return true;
      },
      'resolveOfflineUser must default to the real db.user',
    );

    // resolveIdentity, production defaults: the real client failing is wrapped
    // as the boundary error, never an anonymous request.
    await assert.rejects(
      authModule.resolveIdentity(request({ authorization: `Bearer ${token}` })),
      { code: 'AUTH_UNAVAILABLE', status: 503 },
      'resolveIdentity must default to the real db.user',
    );

    // requireAnyRole, production defaults, called the way lib/learning/http.js
    // calls it (two arguments).
    await assert.rejects(
      authModule.requireAnyRole(request({ authorization: `Bearer ${token}` }), ['INSTRUCTOR']),
      { code: 'AUTH_UNAVAILABLE' },
      'requireAnyRole must default to the real db.user',
    );

    // The route, invoked the way Next invokes it, with a correct passphrase:
    // it gets as far as the database and fails there rather than minting a
    // session against a fake.
    const response = await sessionPost({ subject: 'sgt-okafor', passphrase: PASSPHRASE }, {});
    assert.equal(response.status, 503);
    assert.equal((await response.json()).code, 'AUTH_UNAVAILABLE');

    // And none of that touched the double.
    assert.equal(upserts.length, 0);
    assert.equal(users.size, 0);
  });
});
