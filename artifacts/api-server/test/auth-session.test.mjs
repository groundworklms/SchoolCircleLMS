import assert from 'node:assert/strict';
import test from 'node:test';

import {
  resolveSessionUser,
} from '../src/lib/auth-boundary.js';
import {
  createSessionToken,
  SESSION_TTL,
  verifySessionToken,
} from '../src/lib/session.js';
import {
  corsOrigin,
  isTrustedCorsOrigin,
  requestOrigin,
  sameOriginRequest,
} from '../src/lib/oidc.js';

const TEST_SECRET = 'unit-test-session-secret';

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
    if (result && typeof result.then === 'function') {
      return result.finally(restore);
    }
    restore();
    return result;
  } catch (error) {
    restore();
    throw error;
  }
}

test('session signature rejects tampering and does not carry a client role', () => {
  withEnv({ SESSION_SECRET: TEST_SECRET }, () => {
    const token = createSessionToken({
      userId: 'user-1',
      subject: 'oidc-sub-1',
      profile: { role: 'INSTRUCTOR', email: 'learner@example.test' },
    });

    const verified = verifySessionToken(token);
    assert.equal(verified.userId, 'user-1');
    assert.equal(verified.subject, 'oidc-sub-1');
    assert.equal(verified.profile.role, undefined);
    assert.equal(Object.hasOwn(verified, 'role'), false);

    const last = token.at(-1);
    const replacement = last === 'A' ? 'B' : 'A';
    assert.equal(verifySessionToken(`${token.slice(0, -1)}${replacement}`), null);
  });
});

test('expired sessions fail closed', () => {
  withEnv({ SESSION_SECRET: TEST_SECRET }, () => {
    const realNow = Date.now;
    try {
      Date.now = () => 1_000_000;
      const token = createSessionToken({ userId: 'user-1', subject: 'oidc-sub-1' });
      Date.now = () => 1_000_000 + SESSION_TTL + 1;
      assert.equal(verifySessionToken(token), null);
    } finally {
      Date.now = realNow;
    }
  });
});

test('session resolution takes role from Prisma, not session profile', async () => {
  withEnv({ SESSION_SECRET: TEST_SECRET }, async () => {
    const session = verifySessionToken(
      createSessionToken({
        userId: 'user-1',
        subject: 'oidc-sub-1',
        profile: { role: 'INSTRUCTOR' },
      }),
    );
    const calls = [];
    const user = await resolveSessionUser(session, {
      findUnique: async (query) => {
        calls.push(query);
        return {
          id: 'user-1',
          name: 'Learner',
          role: 'LEARNER',
          externalId: 'oidc-sub-1',
        };
      },
    });

    assert.equal(user.role, 'LEARNER');
    assert.equal(calls[0].where.id, 'user-1');
    assert.equal(calls[0].select.role, true);
  });
});

test('trusted callback origin rejects an untrusted forwarded host', () => {
  withEnv(
    {
      NODE_ENV: 'production',
      AUTH_ALLOWED_HOSTS: 'schoolcircle.example.test',
    },
    () => {
      assert.equal(
        requestOrigin({
          headers: {
            host: 'schoolcircle.example.test',
            'x-forwarded-proto': 'https',
          },
        }),
        'https://schoolcircle.example.test',
      );
      assert.throws(
        () =>
          requestOrigin({
            headers: {
              host: 'schoolcircle.example.test',
              'x-forwarded-host': 'attacker.example.test',
              'x-forwarded-proto': 'https',
            },
          }),
        /not trusted/,
      );
      assert.throws(
        () =>
          requestOrigin({
            headers: {
              host: 'schoolcircle.example.test',
              'x-forwarded-proto': 'http',
            },
          }),
        /Insecure callback/,
      );
    },
  );
});

test('cookie-authenticated mutations require same-origin proof', () => {
  withEnv(
    {
      NODE_ENV: 'production',
      AUTH_ALLOWED_HOSTS: 'schoolcircle.example.test',
    },
    () => {
      const sameOrigin = {
        method: 'POST',
        headers: {
          host: 'schoolcircle.example.test',
          origin: 'https://schoolcircle.example.test',
        },
      };
      const crossOrigin = {
        method: 'POST',
        headers: {
          host: 'schoolcircle.example.test',
          origin: 'https://attacker.example.test',
        },
      };
      assert.equal(sameOriginRequest(sameOrigin), true);
      assert.equal(sameOriginRequest(crossOrigin), false);
      assert.equal(
        sameOriginRequest({
          method: 'POST',
          headers: { host: 'schoolcircle.example.test' },
        }),
        false,
      );
    },
  );
});

test('credentialed CORS reflects only an explicit trusted origin', () => {
  withEnv(
    {
      NODE_ENV: 'production',
      AUTH_ALLOWED_ORIGINS: 'https://schoolcircle.example.test',
      REPLIT_DOMAINS: undefined,
      REPLIT_DEV_DOMAIN: undefined,
    },
    () => {
      assert.equal(isTrustedCorsOrigin('https://schoolcircle.example.test'), true);
      assert.equal(isTrustedCorsOrigin('https://attacker.example.test'), false);
      assert.equal(isTrustedCorsOrigin('null'), false);

      let allowed;
      corsOrigin('https://schoolcircle.example.test', (_error, value) => {
        allowed = value;
      });
      assert.equal(allowed, 'https://schoolcircle.example.test');

      corsOrigin('https://attacker.example.test', (_error, value) => {
        allowed = value;
      });
      assert.equal(allowed, false);

      corsOrigin(undefined, (_error, value) => {
        allowed = value;
      });
      assert.equal(allowed, false);
    },
  );
});