import assert from 'node:assert/strict';
import {
  chmodSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { launchPackage } from './runtime-harness.mjs';

const SUPPORTED_VERSIONS = ['1.2', '2004'];
const OUTPUT_PREFIX = 'scorm-runtime-';
const TEST_FIREBASE_PROJECT = 'schoolcircle-scorm-test';
const PRIVATE_DATABASE_NAME = 'schoolcircle_scorm_test';
const PRIVATE_DATABASE_USER = 'schoolcircle_test';
const PROJECT_ROOT = fileURLToPath(new URL('../..', import.meta.url));

const USAGE = `
Usage:
  node scripts/scorm/verify.mjs

The command creates and migrates a private Unix-socket PostgreSQL cluster under
/tmp, runs the verification, then stops and removes that cluster.
`.trim();

export function parseOptions(argv = process.argv.slice(2)) {
  if (argv.includes('--help')) return { help: true };
  const unsupported = argv.find((argument) => (
    argument === '--database-url' ||
    argument.startsWith('--database-url=') ||
    argument === '--database-name' ||
    argument.startsWith('--database-name=')
  ));
  if (unsupported) {
    throw new Error('External database arguments are not supported; the verifier owns its private cluster.');
  }
  return { privateDatabase: true };
}

/**
 * Require the verifier-owned PostgreSQL target before importing the Prisma singleton.
 *
 * A database name is not an isolation boundary by itself. The URL must point to the exact
 * verifier-owned Unix socket directory. Its only host query is generated internally for Prisma's
 * Unix-socket connection and must match that directory exactly; arbitrary host/TCP overrides are
 * rejected. The socket directory is mode 0700 and the cluster never listens on TCP.
 */
export function assertIsolatedDatabase(databaseUrl, {
  databaseName,
  socketDirectory,
  env = process.env,
} = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    throw new Error('SCORM verification requires its private PostgreSQL Unix-socket URL.');
  }
  if (env.NODE_ENV === 'production') {
    throw new Error('SCORM verification is disabled in production environments.');
  }
  if (env.CLOUD_SQL_CONNECTION_NAME || env.CLOUD_SQL_IP_TYPE) {
    throw new Error('SCORM verification refuses managed connector configuration.');
  }

  let parsed;
  try {
    parsed = new URL(databaseUrl);
  } catch {
    throw new Error('SCORM_TEST_DATABASE_URL must be a valid PostgreSQL URL.');
  }
  if (!['postgres:', 'postgresql:'].includes(parsed.protocol)) {
    throw new Error('The private database URL must use the PostgreSQL protocol.');
  }
  if (parsed.hash) {
    throw new Error('The private database URL must not contain a fragment override.');
  }
  if (!socketDirectory || parsed.port || parsed.password || parsed.hostname !== 'localhost') {
    throw new Error('The private database URL must identify a Unix socket without TCP or a password.');
  }
  const queryKeys = [...parsed.searchParams.keys()].sort();
  if (queryKeys.join(',') !== 'connection_limit,host') {
    throw new Error('The private database URL has an unexpected host or TCP query override.');
  }
  if (
    parsed.searchParams.get('host') !== socketDirectory ||
    parsed.searchParams.get('connection_limit') !== '2'
  ) {
    throw new Error('The database URL must target the verifier-owned private Unix socket directory.');
  }
  const socketPath = socketDirectory;
  let socketDirectoryStats;
  try {
    socketDirectoryStats = statSync(socketPath);
  } catch {
    throw new Error('The private Unix socket directory does not exist.');
  }
  if (!socketDirectoryStats.isDirectory() || (socketDirectoryStats.mode & 0o077) !== 0) {
    throw new Error('The private Unix socket directory must be a mode-0700 directory.');
  }
  let socketStats;
  try {
    socketStats = readFileSync(`${socketPath}/.scorm-socket-marker`, 'utf8');
  } catch {
    throw new Error('The private Unix socket directory is not verifier-owned.');
  }
  if (socketStats !== 'schoolcircle-scorm-private\n') {
    throw new Error('The private Unix socket directory marker is invalid.');
  }
  const targetName = decodeURIComponent(parsed.pathname).replace(/^\/+|\/+$/g, '');
  if (!targetName || !/(?:scorm|test|isolated)/i.test(targetName)) {
    throw new Error('SCORM database name must identify an isolated test database.');
  }
  if (databaseName !== targetName) {
    throw new Error('The database confirmation must exactly match the private database URL name.');
  }
  if (env.DATABASE_URL && env.DATABASE_URL !== databaseUrl) {
    throw new Error(
      'SCORM verification will not replace a different existing database URL.',
    );
  }
  if (env.PGHOST && env.PGHOST !== socketDirectory) {
    throw new Error('SCORM verification refuses a different inherited PGHOST.');
  }
  return { databaseName: targetName, socketDirectory };
}

function errorCode(error) {
  return error?.code || (error instanceof TypeError ? 'BAD_REQUEST' : 'ERROR');
}

function sanitizedFailure(error) {
  return {
    name: error?.name || 'Error',
    message: error instanceof assert.AssertionError
      ? error.message
      : 'Verification failed; no connection, identity, or database diagnostics retained.',
  };
}

function rejectionResult({ version, caseName, identity, status, code, expected }) {
  return {
    version,
    case: caseName,
    identity,
    status,
    code,
    expectedStatus: expected.status,
    expectedCode: expected.code,
    defect: status !== expected.status || code !== expected.code,
  };
}

function privateEnvironment(databaseUrl) {
  const childEnv = {
    ...process.env,
    DATABASE_URL: databaseUrl,
    DATABASE_TARGET_CONFIRM: PRIVATE_DATABASE_NAME,
    SCHOOLCIRCLE_DB_ENV: 'test',
    NODE_ENV: 'test',
  };
  for (const name of [
    'CLOUD_SQL_CONNECTION_NAME',
    'CLOUD_SQL_IP_TYPE',
    'PGHOST',
    'PGPORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
  ]) delete childEnv[name];
  return childEnv;
}

function runNative(binary, args, env = process.env) {
  const result = spawnSync(binary, args, {
    cwd: PROJECT_ROOT,
    env,
    encoding: 'utf8',
    stdio: 'ignore',
    timeout: 120_000,
  });
  if (result.error || result.status !== 0) {
    throw new Error(`Private PostgreSQL command failed: ${binary}`);
  }
}

function applyPrivateMigrations(socketDirectory) {
  const migrationsRoot = join(PROJECT_ROOT, 'prisma', 'migrations');
  const migrations = readdirSync(migrationsRoot, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => join(migrationsRoot, entry.name, 'migration.sql'))
    .filter((file) => {
      try {
        statSync(file);
        return true;
      } catch {
        return false;
      }
    })
    .sort();
  if (!migrations.length) throw new Error('No committed PostgreSQL migrations were found.');
  for (const migration of migrations) {
    runNative('psql', [
      '-h', socketDirectory,
      '-U', PRIVATE_DATABASE_USER,
      '-d', PRIVATE_DATABASE_NAME,
      '-v', 'ON_ERROR_STOP=1',
      '-f', migration,
    ], privateEnvironment(
      `postgresql://${PRIVATE_DATABASE_USER}@localhost/${PRIVATE_DATABASE_NAME}` +
      `?host=${encodeURIComponent(socketDirectory)}&connection_limit=2`,
    ));
  }
}

/**
 * Start a throwaway local cluster that cannot reach a host database.
 *
 * The server is local-socket-only, uses trust solely for this throwaway socket, rejects host
 * authentication, and is removed by stop() in the caller's finally block. Committed migrations
 * run over the generated private socket.
 */
function createPrivatePostgres() {
  const root = mkdtempSync(join(tmpdir(), 'schoolcircle-scorm-pg-'));
  const data = join(root, 'data');
  const socketDirectory = join(root, 'socket');
  mkdirSync(socketDirectory, { mode: 0o700 });
  chmodSync(socketDirectory, 0o700);
  writeFileSync(
    join(socketDirectory, '.scorm-socket-marker'),
    'schoolcircle-scorm-private\n',
    { mode: 0o600 },
  );
  const databaseUrl =
    `postgresql://${PRIVATE_DATABASE_USER}@localhost/${PRIVATE_DATABASE_NAME}` +
    `?host=${encodeURIComponent(socketDirectory)}&connection_limit=2`;
  let started = false;
  try {
    runNative('initdb', [
      '-D', data,
      '-U', PRIVATE_DATABASE_USER,
      '--auth-local=trust',
      '--auth-host=reject',
      '--no-locale',
      '-E', 'UTF8',
    ]);
    runNative('pg_ctl', [
      '-D', data,
      '-l', join(root, 'server.log'),
      '-o', `-k ${socketDirectory} -c listen_addresses=''`,
      '-w',
      'start',
    ]);
    started = true;
    runNative('createdb', [
      '-h', socketDirectory,
      '-U', PRIVATE_DATABASE_USER,
      PRIVATE_DATABASE_NAME,
    ]);
    applyPrivateMigrations(socketDirectory);
    return {
      root,
      databaseUrl,
      databaseName: PRIVATE_DATABASE_NAME,
      socketDirectory,
      stop() {
        if (started) {
          spawnSync('pg_ctl', [
            '-D', data,
            '-m', 'immediate',
            '-w',
            'stop',
          ], { cwd: PROJECT_ROOT, stdio: 'ignore', timeout: 120_000 });
          started = false;
        }
        rmSync(root, { recursive: true, force: true });
      },
    };
  } catch (error) {
    if (started) {
      spawnSync('pg_ctl', [
        '-D', data,
        '-m', 'immediate',
        '-w',
        'stop',
      ], { cwd: PROJECT_ROOT, stdio: 'ignore', timeout: 120_000 });
    }
    rmSync(root, { recursive: true, force: true });
    throw error;
  }
}

async function invokeNativeExport(handlers, identity, courseId, version) {
  try {
    const result = await handlers.exportScorm(identity, {
      query: { courseId, version },
    });
    return {
      status: result.status || 200,
      headers: result.headers || {},
      body: result.body,
    };
  } catch (error) {
    // This is the same status/code table used by the native Next route's learningRoute wrapper.
    const { errorStatus } = await import('../../lib/learning/http.js');
    return {
      status: errorStatus(error),
      code: errorCode(error),
      error,
    };
  }
}

/**
 * Run the native evidence handler against a caller-provided isolated PostgreSQL target.
 *
 * Authentication is represented by resolveFirebaseUser's existing verifier/user-client seam:
 * the verifier accepts only the three in-memory test tokens, while roles still come from the
 * Prisma User rows. No compatibility session, cookie, header role, or production Firebase
 * credential is manufactured here.
 */
async function runVerification({
  databaseUrl,
  databaseName,
  socketDirectory,
  outputRoot = '/tmp',
} = {}) {
  const target = assertIsolatedDatabase(databaseUrl, {
    databaseName,
    socketDirectory,
    env: process.env,
  });
  const prefix = `${OUTPUT_PREFIX}${randomUUID()}`;
  const output = `${outputRoot}/${prefix}`;
  await mkdir(output, { recursive: false });
  const report = {
    evidence: 'Native SchoolCircle evidence handler + Firebase identity seam + simulated SCORM RTE/DOM',
    externalLms: 'unverified; no authorized target LMS or MarineNet account was supplied',
    database: {
      isolation: 'verifier-owned mode-0700 Unix socket PostgreSQL cluster',
      name: target.databaseName,
      tcp: false,
    },
    exports: [],
    rejections: [],
    defects: [],
    cleanup: 'pending',
  };
  const userIds = [];
  let db;

  // Set these only after isolation has been proven and before any application module is imported.
  process.env.DATABASE_URL = databaseUrl;
  process.env.NODE_ENV = 'test';
  process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID = TEST_FIREBASE_PROJECT;

  try {
    const dbModule = await import('../../lib/db.js');
    db = dbModule.db;
    const { resolveFirebaseUser } = await import('../../lib/auth.js');
    const { firebaseExternalId } = await import('../../lib/firebase-auth.js');
    const { evidenceHandlers } = await import('../../lib/learning/evidence.js');
    const { learningRoute } = await import('../../lib/learning/http.js');

    const users = [];
    for (const [label, role] of [
      ['owner', 'INSTRUCTOR'],
      ['learner', 'LEARNER'],
      ['other-owner', 'INSTRUCTOR'],
    ]) {
      const uid = `${prefix}-${label}`;
      const row = await db.user.create({
        data: {
          name: `SCORM isolated ${label}`,
          role,
          externalId: firebaseExternalId(uid),
        },
      });
      users.push({ label, role, uid, row });
      userIds.push(row.id);
    }

    const tokenProfiles = new Map();
    for (const user of users) {
      const token = `${prefix}-firebase-token-${user.label}`;
      tokenProfiles.set(token, {
        uid: user.uid,
        name: user.row.name,
        email: `${user.label}@scorm.invalid`,
        // Deliberately contradictory claims prove the persisted role wins.
        role: user.role === 'INSTRUCTOR' ? 'LEARNER' : 'INSTRUCTOR',
      });
      user.token = token;
    }
    const testVerifier = async (token) => tokenProfiles.get(token) || null;
    const identityFor = async (user) =>
      resolveFirebaseUser(user.token, db.user, testVerifier);
    const identities = Object.fromEntries(
      await Promise.all(users.map(async (user) => [user.label, await identityFor(user)])),
    );
    assert.equal(identities.owner.role, 'INSTRUCTOR');
    assert.equal(identities.learner.role, 'LEARNER');
    assert.equal(identities['other-owner'].role, 'INSTRUCTOR');
    assert.notEqual(identities.learner.role, tokenProfiles.get(users[1].token).role);

    const examplePath = new URL('../example/course.json', import.meta.resolve('cartridge'));
    const source = await readFile(examplePath, 'utf8');
    const course = JSON.parse(source);
    assert.ok(Array.isArray(course.lessons) && course.lessons.length > 0);
    assert.ok(Array.isArray(course.quiz) && course.quiz.length > 0);
    assert.ok(course.quiz.every((question) => Array.isArray(question.options) && question.options.length > 1));
    report.fixture = {
      source: 'installed cartridge/example/course.json (read verbatim)',
      sha256: createHash('sha256').update(source).digest('hex'),
      lessonCount: course.lessons.length,
      questionCount: course.quiz.length,
      review: 'Only the installed upstream example is used; no lessons or answers are generated by this verifier.',
    };

    const variants = {
      approved: { status: 'APPROVED', payload: course },
      pending: { status: 'PENDING', payload: course },
      missing: {
        status: 'APPROVED',
        payload: { title: course.title, lessons: [], quiz: [] },
      },
      refused: {
        status: 'APPROVED',
        // This is a refusal marker, intentionally without replacement lesson content.
        payload: {
          title: course.title,
          sections: [{ title: 'Refused source content', status: 'REJECTED' }],
        },
      },
    };
    for (const [name, variant] of Object.entries(variants)) {
      await db.learningRecord.create({
        data: {
          id: `${prefix}-${name}`,
          ownerId: identities.owner.id,
          type: 'COURSE_DRAFT',
          ...variant,
        },
      });
    }

    // The anonymous check traverses the actual Next route. Authenticated checks use its native
    // evidence handler with identities obtained from the Firebase seam above.
    const handlers = evidenceHandlers();
    assert.ok(handlers, 'Native evidence handler seam must load');
    // This is the same native route factory used by app/api/learning/export/route.js, kept here
    // so the standalone verifier does not depend on Next's extensionless server import resolver.
    const nativeExportRoute = learningRoute(
      { roles: ['LEARNER', 'INSTRUCTOR'] },
      ({ identity, ...input }) => handlers.exportScorm(identity, input),
    );

    const expected = {
      anonymous: { status: 401, code: 'AUTH_REQUIRED' },
      learner: { status: 403, code: 'FORBIDDEN' },
      // Native baseline behavior: a null approved-course projection reaches
      // the TypeError-to-400 error table. This is still a deliberate rejection.
      'other-owner': { status: 400, code: 'BAD_REQUEST' },
      pending: { status: 400, code: 'BAD_REQUEST' },
      refused: { status: 409, code: 'COURSE_NOT_APPROVED' },
      missing: { status: 409, code: 'COURSE_CONTENT_MISSING' },
    };

    for (const version of SUPPORTED_VERSIONS) {
      const anonymous = await nativeExportRoute(new Request(
        `https://schoolcircle.example.test/api/learning/export?courseId=unused&version=${version}`,
      ));
      const anonymousBody = await anonymous.json();
      assert.equal(anonymous.status, expected.anonymous.status);
      assert.equal(anonymousBody.code, expected.anonymous.code);
      const anonymousResult = rejectionResult({
        version,
        caseName: 'approved',
        identity: 'anonymous',
        status: anonymous.status,
        code: anonymousBody.code,
        expected: expected.anonymous,
      });
      report.rejections.push(anonymousResult);
      if (anonymousResult.defect) report.defects.push(anonymousResult);

      const denied = [
        ['learner', identities.learner, 'approved'],
        ['other-owner', identities['other-owner'], 'approved'],
        ['owner', identities.owner, 'pending'],
        ['owner', identities.owner, 'refused'],
        ['owner', identities.owner, 'missing'],
      ];
      for (const [identityLabel, identity, caseName] of denied) {
        const result = await invokeNativeExport(
          handlers,
          identity,
          `${prefix}-${caseName}`,
          version,
        );
        const rejection = rejectionResult({
          version,
          caseName,
          identity: identityLabel,
          status: result.status,
          code: result.code,
          expected: expected[identityLabel === 'owner' ? caseName : identityLabel],
        });
        report.rejections.push(rejection);
        if (rejection.defect) report.defects.push(rejection);
        assert.equal(result.status, expected[
          identityLabel === 'owner' ? caseName : identityLabel
        ].status);
        assert.equal(result.code, expected[
          identityLabel === 'owner' ? caseName : identityLabel
        ].code);
      }

      const approved = await invokeNativeExport(
        handlers,
        identities.owner,
        `${prefix}-approved`,
        version,
      );
      assert.equal(approved.status, 200);
      assert.equal(approved.headers['content-type'], 'application/zip');
      assert.ok(String(approved.headers['x-scorm-version']).startsWith(version));
      const bytes = Buffer.from(approved.body);
      await writeFile(`${output}/scorm-${version}.zip`, bytes);
      const runs = [];
      for (const outcome of ['pass', 'fail']) {
        for (const discovery of ['parent', 'opener']) {
          runs.push(await launchPackage(bytes, version, { outcome, discovery }));
        }
      }
      report.exports.push({
        version,
        sha256: createHash('sha256').update(bytes).digest('hex'),
        runs,
      });
    }

    const audits = await db.learningRecord.findMany({
      where: { ownerId: identities.owner.id, type: 'SCORM_EXPORT' },
    });
    assert.deepEqual(
      audits.map((row) => row.payload.version).sort(),
      SUPPORTED_VERSIONS,
    );
    assert.ok(audits.every((row) => row.payload.courseId === `${prefix}-approved`));
    assert.equal(audits.length, 2);
    report.audit = 'Exactly two successful owner exports; no rejection created an export audit.';
  } catch (error) {
    report.failure = sanitizedFailure(error);
  } finally {
    try {
      if (db && userIds.length) {
        await db.learningRecord.deleteMany({ where: { ownerId: { in: userIds } } });
        await db.user.deleteMany({ where: { id: { in: userIds } } });
      }
      report.cleanup = 'passed';
    } catch {
      report.cleanup = 'failed';
    }
    if (db) await db.$disconnect().catch(() => {});
    await writeFile(`${output}/evidence.json`, JSON.stringify(report, null, 2));
  }

  const exitCode = report.cleanup !== 'passed' || report.failure
    ? 1
    : report.defects.length
      ? 2
      : 0;
  return { output, report, exitCode };
}

async function runPrivateVerification({ outputRoot = '/tmp' } = {}) {
  const cluster = createPrivatePostgres();
  const environmentNames = [
    'DATABASE_URL',
    'DATABASE_TARGET_CONFIRM',
    'SCHOOLCIRCLE_DB_ENV',
    'NODE_ENV',
    'CLOUD_SQL_CONNECTION_NAME',
    'CLOUD_SQL_IP_TYPE',
    'PGHOST',
    'PGPORT',
    'PGDATABASE',
    'PGUSER',
    'PGPASSWORD',
  ];
  const previous = new Map(environmentNames.map((name) => [name, process.env[name]]));
  try {
    process.env.DATABASE_URL = cluster.databaseUrl;
    process.env.DATABASE_TARGET_CONFIRM = cluster.databaseName;
    process.env.SCHOOLCIRCLE_DB_ENV = 'test';
    process.env.NODE_ENV = 'test';
    for (const name of [
      'CLOUD_SQL_CONNECTION_NAME',
      'CLOUD_SQL_IP_TYPE',
      'PGHOST',
      'PGPORT',
      'PGDATABASE',
      'PGUSER',
      'PGPASSWORD',
    ]) delete process.env[name];
    return await runVerification({
      databaseUrl: cluster.databaseUrl,
      databaseName: cluster.databaseName,
      socketDirectory: cluster.socketDirectory,
      outputRoot,
    });
  } finally {
    for (const [name, value] of previous) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    cluster.stop();
  }
}

const isMain = process.argv[1] && pathToFileURL(process.argv[1]).href === import.meta.url;
if (isMain) {
  try {
    const options = parseOptions();
    if (options.help) {
      console.log(USAGE);
    } else {
      const result = await runPrivateVerification();
      console.log(JSON.stringify({
        output: result.output,
        exports: result.report.exports.length,
        rejectionCount: result.report.rejections.length,
        defects: result.report.defects,
        failure: result.report.failure,
        cleanup: result.report.cleanup,
        exitCode: result.exitCode,
      }, null, 2));
      process.exitCode = result.exitCode;
    }
  } catch (error) {
    console.error(error instanceof Error ? error.message : 'SCORM verification could not start.');
    console.error(USAGE);
    process.exitCode = 1;
  }
}