import test from 'node:test';
import assert from 'node:assert/strict';

import {
  DEMO_PREFIX,
  DEMO_SEED_FIXTURE,
  DemoSeedPolicyError,
  DemoSeedRefusalError,
  assertDemoSeedEnvironment,
  main,
  seedDemo,
} from '../prisma/seed.js';

const TARGET_URL = 'postgresql://demo_user:not-a-real-password@127.0.0.1:5432/schoolcircle_test';

function validEnvironment(overrides = {}) {
  return {
    SCHOOLCIRCLE_DB_ENV: 'test',
    ALLOW_DEMO_SEED: 'true',
    NODE_ENV: 'test',
    DATABASE_URL: TARGET_URL,
    DATABASE_TARGET_CONFIRM: 'schoolcircle_test',
    ...overrides,
  };
}

test('accepts only an explicitly enabled non-production test target', () => {
  assert.deepEqual(
    assertDemoSeedEnvironment(validEnvironment()),
    {
      dbEnvironment: 'test',
      nodeEnvironment: 'test',
      databaseName: 'schoolcircle_test',
    },
  );
});

test('rejects each missing or unsafe seed gate without exposing connection details', () => {
  const cases = [
    ['SCHOOLCIRCLE_DB_ENV', { SCHOOLCIRCLE_DB_ENV: 'production' }],
    ['ALLOW_DEMO_SEED', { ALLOW_DEMO_SEED: 'false' }],
    ['NODE_ENV', { NODE_ENV: 'production' }],
    ['DATABASE_URL', { DATABASE_URL: 'postgresql://user:secret@db/schoolcircle' }],
    ['database URL format', { DATABASE_URL: 'not-a-database-url' }],
  ];

  for (const [label, overrides] of cases) {
    assert.throws(
      () => assertDemoSeedEnvironment(validEnvironment(overrides)),
      (error) => {
        assert.equal(error instanceof DemoSeedPolicyError, true, label);
        assert.equal(error.message.includes('secret'), false, label);
        assert.equal(error.message.includes('postgresql://'), false, label);
        return true;
      },
      label,
    );
  }
});

test('validates the database suffix instead of trusting the environment label', () => {
  for (const suffix of ['_dev', '_demo', '_test']) {
    assert.doesNotThrow(() => assertDemoSeedEnvironment(
      validEnvironment({
        DATABASE_URL: `postgresql://localhost/schoolcircle${suffix}`,
        DATABASE_TARGET_CONFIRM: `schoolcircle${suffix}`,
      }),
    ));
  }

  assert.throws(
    () => assertDemoSeedEnvironment(
      validEnvironment({ DATABASE_URL: 'postgresql://localhost/schoolcircle_development' }),
    ),
    DemoSeedPolicyError,
  );
});

test('requires an exact database target confirmation after parsing the URL', () => {
  assert.throws(
    () => assertDemoSeedEnvironment(
      validEnvironment({ DATABASE_TARGET_CONFIRM: undefined }),
    ),
    (error) => {
      assert.equal(error instanceof DemoSeedPolicyError, true);
      assert.match(error.message, /DATABASE_TARGET_CONFIRM is required/);
      return true;
    },
  );

  assert.throws(
    () => assertDemoSeedEnvironment(
      validEnvironment({ DATABASE_TARGET_CONFIRM: 'schoolcircle_dev' }),
    ),
    (error) => {
      assert.equal(error instanceof DemoSeedPolicyError, true);
      assert.match(error.message, /must match the parsed database name/);
      return true;
    },
  );
});

test('main validates before constructing a Prisma client', async () => {
  let constructed = false;
  await assert.rejects(
    main({
      env: validEnvironment({ SCHOOLCIRCLE_DB_ENV: 'production' }),
      createClient: () => {
        constructed = true;
        throw new Error('client must not be constructed');
      },
    }),
    DemoSeedPolicyError,
  );
  assert.equal(constructed, false);
});

test('fixture identities are stable, generic, and owned by the demo prefix', () => {
  const ids = [
    ...DEMO_SEED_FIXTURE.users.map((user) => user.id),
    DEMO_SEED_FIXTURE.course.id,
    ...DEMO_SEED_FIXTURE.sections.map((section) => section.id),
    ...DEMO_SEED_FIXTURE.items.map((item) => item.id),
  ];

  assert.equal(ids.every((id) => id.startsWith(DEMO_PREFIX)), true);
  assert.deepEqual(
    DEMO_SEED_FIXTURE.users.map((user) => [user.name, user.externalId]),
    [
      ['Demo Instructor', null],
      ['Demo Learner', null],
    ],
  );
  assert.match(DEMO_SEED_FIXTURE.course.title, /DEMO ONLY/);
  assert.match(DEMO_SEED_FIXTURE.course.title, /NOT PRODUCTION-VERIFIED/);
  assert.equal(
    DEMO_SEED_FIXTURE.items.every((item) => item.status === 'APPROVED'),
    true,
  );
});

function emptyTransactionClient(rows = {}) {
  const upserts = [];
  const table = (name) => ({
    findMany: async () => rows[name] ?? [],
    upsert: async (args) => {
      upserts.push({ name, args });
      return args.create;
    },
  });
  const tx = {
    $queryRaw: async () => [{ locked: true }],
    user: table('user'),
    course: table('course'),
    section: table('section'),
    item: table('item'),
    attempt: table('attempt'),
    mastery: table('mastery'),
    schedule: table('schedule'),
  };
  return {
    upserts,
    $transaction: async (callback) => callback(tx),
  };
}

test('seed uses one transaction, advisory lock, ID upserts, and no updates', async () => {
  const db = emptyTransactionClient();
  const result = await seedDemo(db, { env: validEnvironment() });

  assert.equal(result.courseId, DEMO_SEED_FIXTURE.course.id);
  assert.equal(db.upserts.length, 2 + 1 + 4 + 3);
  assert.equal(
    db.upserts.every(({ args }) => Object.keys(args.update).length === 0),
    true,
  );
});

test('seed refuses before writes when any domain table contains a non-demo row', async () => {
  const db = emptyTransactionClient({ item: [{ id: 'real-item' }] });

  await assert.rejects(
    seedDemo(db, { env: validEnvironment() }),
    (error) => {
      assert.equal(error instanceof DemoSeedRefusalError, true);
      assert.match(error.message, /Item contains 1 non-demo row/);
      return true;
    },
  );
});