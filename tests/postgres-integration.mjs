// Self-contained PostgreSQL test. No connection to a caller/workspace database.
// Requires native initdb/pg_ctl/createdb on PATH; no Docker or cloud credentials.
import assert from 'node:assert/strict';
import {
  cpSync,
  mkdtempSync,
  mkdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
import { firebaseExternalId } from '../lib/firebase-auth.js';
import { runDatabaseSeedIntegration } from './database-seed-integration.mjs';
import { seedDemo, DEMO_IDS } from '../prisma/seed.js';

const require = createRequire(import.meta.url);
const root = mkdtempSync(join(tmpdir(), 'schoolcircle-pg-'));
const data = join(root, 'data');
const socket = join(root, 'socket');
mkdirSync(socket, { mode: 0o700 });
const url = `postgresql://schoolcircle_test@localhost/schoolcircle_test?host=${encodeURIComponent(socket)}&connection_limit=2`;
const env = {
  ...process.env,
  DATABASE_URL: url,
  DATABASE_TARGET_CONFIRM: 'schoolcircle_test',
  SCHOOLCIRCLE_DB_ENV: 'test',
  ALLOW_DEMO_SEED: 'true',
  NODE_ENV: 'test',
};
function run(binary, args, expected = 0, override = {}) {
  const result = spawnSync(binary, args, {
    env: { ...env, ...override }, encoding: 'utf8', timeout: 60000,
  });
  // Don't emit child output or inherited environment values on failure.
  assert.equal(result.status, expected, `${binary} ${args[0]} unexpected exit status`);
  return result;
}
function client() {
  return new PrismaClient({ datasources: { db: { url } } });
}
function deployLegacyMigrations() {
  // Apply only the migrations that existed before account profiles. The schema
  // file is copied beside this temporary migration directory so Prisma cannot
  // accidentally discover the new account-profile migration early.
  const source = join(process.cwd(), 'prisma');
  const legacy = join(root, 'legacy-prisma');
  const migrations = join(legacy, 'migrations');
  mkdirSync(migrations, { recursive: true });
  writeFileSync(join(legacy, 'schema.prisma'), readFileSync(join(source, 'schema.prisma')));
  cpSync(join(source, 'migrations', 'migration_lock.toml'), join(migrations, 'migration_lock.toml'));
  for (const name of ['20250915185900_init', '20250915190000_learning_records']) {
    cpSync(join(source, 'migrations', name), join(migrations, name), { recursive: true });
  }
  run(process.execPath, [
    require.resolve('prisma/build/index.js'),
    'migrate',
    'deploy',
    '--schema',
    join(legacy, 'schema.prisma'),
  ]);
}
let started = false;
let db;
const previousFirebaseProjectId = process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
const previousDatabaseUrl = process.env.DATABASE_URL;
const previousCloudInstance = process.env.CLOUD_SQL_CONNECTION_NAME;
let stage = 'isolated PostgreSQL setup';
try {
  // The core handlers use lib/db's singleton. Point that singleton at this
  // private socket before importing the handlers; never use the caller's
  // workspace/cloud URL for this test.
  process.env.DATABASE_URL = url;
  delete process.env.CLOUD_SQL_CONNECTION_NAME;
  const [accountProfile, auth, core] = await Promise.all([
    import('../lib/account-profile.js'),
    import('../lib/auth.js'),
    import('../lib/learning/core.js'),
  ]);
  const { accountProfileHandlers } = accountProfile;
  const { hasRole, resolveFirebaseUser } = auth;
  const { getCourse, masteryTurn } = core;

  run('initdb', ['-D', data, '-U', 'schoolcircle_test', '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8']);
  run('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-o', `-k ${socket} -c listen_addresses=''`, '-w', 'start']);
  started = true;
  run('createdb', ['-h', socket, '-U', 'schoolcircle_test', 'schoolcircle_test']);
  run(process.execPath, ['scripts/database.mjs', 'deploy'], 1, { DATABASE_TARGET_CONFIRM: 'wrong_database' });
  deployLegacyMigrations();
  // This row is deliberately created against the old schema. The account
  // migration must add nullable fields without changing its name, role, or
  // external identity.
  const oldDb = client();
  await oldDb.$executeRaw`
    INSERT INTO "User" ("id", "name", "role", "externalId")
    VALUES (
      ${DEMO_IDS.users.instructor},
      ${'Pre-migration Instructor'},
      ${'INSTRUCTOR'}::"Role",
      ${'firebase:native-pg-test:legacy-instructor'}
    )`;
  await oldDb.$disconnect();
  run(process.execPath, ['scripts/database.mjs', 'deploy']);
  run(process.execPath, ['scripts/database.mjs', 'deploy']);
  run(process.execPath, ['scripts/database.mjs', 'status']);
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = 'native-pg-test';
  await runDatabaseSeedIntegration({ databaseUrl: url });
  run(process.execPath, ['scripts/database.mjs', 'seed'], 1, { DATABASE_TARGET_CONFIRM: '' });
  run(process.execPath, ['scripts/database.mjs', 'seed'], 1, { DATABASE_TARGET_CONFIRM: 'wrong_database' });
  run(process.execPath, ['scripts/database.mjs', 'seed']);
  run(process.execPath, ['scripts/database.mjs', 'seed'], 1, { NODE_ENV: 'production' });

  db = client();
  assert.equal(await db.user.count(), 2);
  assert.equal(await db.course.count(), 1);
  const learner = await db.user.findFirstOrThrow({ where: { role: 'LEARNER' } });
  const question = await db.item.findFirstOrThrow({ where: { kind: 'QUESTION' } });
  const attempt = await db.attempt.create({
    data: { itemId: question.id, learnerId: learner.id, confidence: 2, answer: 0, correct: true },
  });
  await db.$disconnect();
  db = client();
  assert.equal((await db.attempt.findUniqueOrThrow({ where: { id: attempt.id } })).correct, true);
  // Seeding must refuse even demo-associated activity instead of overwriting it.
  await assert.rejects(seedDemo(db, { env }), /refused/i);
  await db.attempt.delete({ where: { id: attempt.id } });
  await db.user.create({ data: { id: 'non-demo-user', name: 'Non-demo fixture', role: 'LEARNER' } });
  await assert.rejects(seedDemo(db, { env }), /refused/i);
  await db.user.delete({ where: { id: 'non-demo-user' } });
  // Re-running a seed must not override an instructor's rejection.
  await db.item.update({ where: { id: question.id }, data: { status: 'REJECTED' } });
  await seedDemo(db, { env });
  assert.equal((await db.item.findUniqueOrThrow({ where: { id: question.id } })).status, 'REJECTED');
  const courses = await db.course.findMany({
    include: { sections: { include: { items: { where: { status: 'APPROVED' } } } } },
  });
  assert.equal(courses[0].id, DEMO_IDS.course);
  assert.ok(courses[0].sections.flatMap(s => s.items).every(i => i.status === 'APPROVED'));

  // The injected verifier is intentional: this is a native PostgreSQL
  // persistence test, not a live Firebase/cloud-authentication test.
  const instructorBeforeProfile = await db.user.findUniqueOrThrow({
    where: { id: DEMO_IDS.users.instructor },
  });
  assert.equal(instructorBeforeProfile.name, 'Pre-migration Instructor');
  assert.equal(instructorBeforeProfile.role, 'INSTRUCTOR');
  assert.equal(instructorBeforeProfile.externalId, 'firebase:native-pg-test:legacy-instructor');
  assert.equal(instructorBeforeProfile.rank, null);
  assert.equal(instructorBeforeProfile.branch, null);
  assert.equal(instructorBeforeProfile.payGrade, null);
  assert.equal(instructorBeforeProfile.profileCompletedAt, null);

  const firebaseInstructor = await resolveFirebaseUser(
    'synthetic-existing-token',
    db.user,
    async () => ({
      uid: 'legacy-instructor',
      name: 'Firebase Provider Name Must Not Win',
      role: 'LEARNER',
      email: 'instructor@example.test',
    }),
  );
  assert.equal(firebaseInstructor.name, 'Pre-migration Instructor');
  assert.equal(firebaseInstructor.role, 'INSTRUCTOR');
  assert.equal(firebaseInstructor.externalId, firebaseExternalId('legacy-instructor', 'native-pg-test'));

  const { PATCH } = accountProfileHandlers({
    identityFor: async () => firebaseInstructor,
    users: db.user,
  });
  const profileResponse = await PATCH(new Request('http://example.test/api/account/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Preferred Instructor',
      role: 'BOTH',
      branch: 'ARMY',
      payGrade: 'O-4',
      rank: 'Major',
    }),
  }));
  assert.equal(profileResponse.status, 200);
  assert.equal((await profileResponse.json()).user.name, 'Preferred Instructor');

  // A fresh Prisma client is a separate session, not a cached object. Profile
  // fields and the authoritative combined role must survive the reconnect.
  await db.$disconnect();
  db = client();
  const persistedInstructor = await db.user.findUniqueOrThrow({
    where: { id: DEMO_IDS.users.instructor },
  });
  assert.equal(persistedInstructor.name, 'Preferred Instructor');
  assert.equal(persistedInstructor.rank, 'Major');
  assert.equal(persistedInstructor.branch, 'ARMY');
  assert.equal(persistedInstructor.payGrade, 'O-4');
  assert.ok(persistedInstructor.profileCompletedAt instanceof Date);
  assert.equal(persistedInstructor.role, 'BOTH');
  const firebaseInstructorAfterReconnect = await resolveFirebaseUser(
    'synthetic-existing-token',
    db.user,
    async () => ({
      uid: 'legacy-instructor',
      name: 'A Later Firebase Name',
      role: 'LEARNER',
    }),
  );
  assert.equal(firebaseInstructorAfterReconnect.name, 'Preferred Instructor');
  assert.equal(firebaseInstructorAfterReconnect.role, 'BOTH');
  assert.equal(firebaseInstructorAfterReconnect.branch, 'ARMY');
  assert.equal(firebaseInstructorAfterReconnect.payGrade, 'O-4');
  assert.equal(hasRole(firebaseInstructorAfterReconnect.role, 'LEARNER'), true);
  assert.equal(hasRole(firebaseInstructorAfterReconnect.role, 'INSTRUCTOR'), true);

  // BOTH is allowed to use learner mastery against an approved course owned by
  // somebody else. The course response remains learner-safe even though the
  // same identity can enter instructor-gated endpoints.
  stage = 'cross-owner BOTH course setup';
  const crossOwnerSource = await db.learningRecord.create({
    data: {
      ownerId: learner.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: 'Another instructor source',
        sourceId: 'native-cross-owner-source',
        text: 'Approved source text.',
        pages: [{ page: 1, text: 'Approved source text.' }],
        chunks: [{ page: 1, text: 'Approved source text.' }],
      },
    },
  });
  const crossOwnerCourse = await db.learningRecord.create({
    data: {
      ownerId: learner.id,
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: {
        title: 'Another instructor course',
        sourceIds: [crossOwnerSource.id],
        sections: [{
          title: 'Cross-owner lesson',
          lesson: 'Learner-safe lesson text.',
          pre: [{ stem: 'Question', answer: 0, rationale: 'Private rationale.' }],
        }],
      },
    },
  });
  stage = 'cross-owner BOTH redacted course handler';
  const bothCourseView = await getCourse(firebaseInstructorAfterReconnect, {
    params: { id: crossOwnerCourse.id },
  });
  // Same contract d6f265e pinned in test/learning-handlers.test.mjs, which this
  // stage was missed by: a cross-owner reader is a learner here, and the learner
  // projection does not redact the answer key out of a question it still ships --
  // learnerSectionStructure deletes lesson, pre, post, scenario and questions
  // outright. Course approval releases a shape; every sentence inside it stays a
  // PENDING Item until a human ratifies it. Asserting a field inside pre[0] both
  // passes for the wrong reason and then throws on the missing container, which
  // is what turned this suite red.
  assert.equal(bothCourseView.json.course.sections[0].lesson, undefined);
  assert.equal(bothCourseView.json.course.sections[0].pre, undefined);
  assert.equal(bothCourseView.json.course.sections[0].post, undefined);

  const crossOwnerSession = await db.learningRecord.create({
    data: {
      ownerId: firebaseInstructorAfterReconnect.id,
      type: 'MASTERY_SESSION',
      status: 'ACTIVE',
      payload: {
        courseId: crossOwnerCourse.id,
        sourceId: crossOwnerSource.id,
        objectives: 'Cross-owner mastery',
        source: 'Approved source text.',
        complete: true,
        rubric: [],
        criteria: [],
        transcript: [],
        results: [],
      },
    },
  });
  stage = 'cross-owner BOTH mastery handler';
  await assert.rejects(
    masteryTurn(
      firebaseInstructorAfterReconnect,
      { params: { id: crossOwnerSession.id }, body: { answer: '' } },
    ),
    (error) => {
      // Before the BOTH union fix approvedCourseFor rejected this as a
      // cross-owner instructor request. It may still require Whetstone, but
      // authorization must no longer be the failure.
      assert.notEqual(error.code, 'NOT_FOUND');
      return true;
    },
  );

  // A profile can explicitly remove instructor access. The next request resolves
  // the persisted role again rather than trusting a stale Firebase claim or
  // cached identity.
  stage = 'profile downgrade';
  const { PATCH: downgrade } = accountProfileHandlers({
    identityFor: async () => firebaseInstructorAfterReconnect,
    users: db.user,
  });
  const downgradeResponse = await downgrade(new Request('http://example.test/api/account/profile', {
    method: 'PATCH',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({
      name: 'Preferred Instructor',
      role: 'LEARNER',
      branch: 'CIVILIAN',
      payGrade: null,
      rank: null,
    }),
  }));
  assert.equal(downgradeResponse.status, 200);
  assert.equal((await downgradeResponse.json()).user.role, 'LEARNER');

  const beforeInvalid = await db.user.findUniqueOrThrow({
    where: { id: DEMO_IDS.users.instructor },
  });
  const invalidResponses = await Promise.all([
    downgrade(new Request('http://example.test/api/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Should Not Save',
        role: 'BOTH',
        branch: 'ARMY',
        payGrade: 'E-5',
        rank: 'Major',
      }),
    })),
    downgrade(new Request('http://example.test/api/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Should Not Save',
        role: 'BOTH',
        branch: 'CIVILIAN',
        payGrade: 'E-1',
        rank: null,
      }),
    })),
    downgrade(new Request('http://example.test/api/account/profile', {
      method: 'PATCH',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        name: 'Should Not Save',
        role: 'BOTH',
        branch: 'CIVILIAN',
        payGrade: null,
        rank: null,
        externalId: 'firebase:native-pg-test:other-user',
      }),
    })),
  ]);
  for (const response of invalidResponses) assert.equal(response.status, 400);
  const afterInvalid = await db.user.findUniqueOrThrow({
    where: { id: DEMO_IDS.users.instructor },
  });
  assert.equal(afterInvalid.name, beforeInvalid.name);
  assert.equal(afterInvalid.role, beforeInvalid.role);
  assert.equal(afterInvalid.branch, beforeInvalid.branch);
  assert.equal(afterInvalid.payGrade, beforeInvalid.payGrade);
  assert.equal(afterInvalid.rank, beforeInvalid.rank);
  assert.equal(afterInvalid.profileCompletedAt.getTime(), beforeInvalid.profileCompletedAt.getTime());

  await db.$disconnect();
  db = client();
  const firebaseInstructorAfterDowngrade = await resolveFirebaseUser(
    'synthetic-existing-token',
    db.user,
    async () => ({
      uid: 'legacy-instructor',
      name: 'A Stale Firebase Name',
      role: 'INSTRUCTOR',
    }),
  );
  assert.equal(firebaseInstructorAfterDowngrade.role, 'LEARNER');
  assert.equal(firebaseInstructorAfterDowngrade.branch, 'CIVILIAN');
  assert.equal(firebaseInstructorAfterDowngrade.payGrade, null);
  assert.equal(firebaseInstructorAfterDowngrade.rank, null);
  assert.equal(hasRole(firebaseInstructorAfterDowngrade.role, 'INSTRUCTOR'), false);
  assert.equal(hasRole(firebaseInstructorAfterDowngrade.role, 'LEARNER'), true);

  const newIdentity = await resolveFirebaseUser(
    'synthetic-new-token',
    db.user,
    async () => ({
      uid: 'new-native-user',
      name: 'New Firebase Identity',
      role: 'INSTRUCTOR',
    }),
  );
  assert.equal(newIdentity.name, 'New Firebase Identity');
  assert.equal(newIdentity.role, 'LEARNER');
  assert.equal(newIdentity.externalId, firebaseExternalId('new-native-user', 'native-pg-test'));
  assert.equal(newIdentity.branch, null);
  assert.equal(newIdentity.payGrade, null);
  assert.equal(newIdentity.rank, null);
  assert.equal(
    (await db.user.findUniqueOrThrow({ where: { id: newIdentity.id } })).name,
    'New Firebase Identity',
  );

  const drift = run(process.execPath, [
    require.resolve('prisma/build/index.js'), 'migrate', 'diff',
    '--from-schema-datasource', 'prisma/schema.prisma',
    '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code',
  ]);
  assert.equal(drift.status, 0);
  console.log('PASS: isolated PostgreSQL migrations, repeatable seeds, safety guards, reconnect persistence, approved-only query, and zero schema drift.');
} catch {
  console.error(`FAIL: isolated PostgreSQL integration at stage "${stage}". Detailed errors suppressed.`);
  process.exitCode = 1;
} finally {
  if (previousFirebaseProjectId === undefined) delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
  else process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = previousFirebaseProjectId;
  if (previousDatabaseUrl === undefined) delete process.env.DATABASE_URL;
  else process.env.DATABASE_URL = previousDatabaseUrl;
  if (previousCloudInstance === undefined) delete process.env.CLOUD_SQL_CONNECTION_NAME;
  else process.env.CLOUD_SQL_CONNECTION_NAME = previousCloudInstance;
  if (db) await db.$disconnect().catch(() => {});
  if (started) spawnSync('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
  rmSync(root, { recursive: true, force: true });
}