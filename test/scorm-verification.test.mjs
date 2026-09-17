import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { assertIsolatedDatabase, parseOptions } from '../scripts/scorm/verify.mjs';

// Two of the cases below drive the private-socket gate in scripts/scorm/verify.mjs,
// which requires `statSync(dir).mode & 0o077 === 0` -- a mode-0700 directory. That is
// a POSIX permission-bit assertion. Rather than trust a platform allowlist, probe the
// filesystem once: create a directory, chmod it 0700, and see whether the group and
// other bits actually came off.
function posixModeBitsAreHonoured() {
  const probe = mkdtempSync(join(tmpdir(), 'scorm-mode-probe-'));
  try {
    chmodSync(probe, 0o700);
    return (statSync(probe).mode & 0o077) === 0;
  } catch {
    return false;
  } finally {
    rmSync(probe, { recursive: true, force: true });
  }
}

// `false` means "do not skip". A string means "skip, and here is why".
const offPosixSkip = posixModeBitsAreHonoured()
  ? false
  : `SKIPPED OFF-POSIX (platform ${process.platform}): these cases assert the mode-0700 `
    + 'private-socket gate in scripts/scorm/verify.mjs (statSync(dir).mode & 0o077 === 0). '
    + 'This filesystem does not honour POSIX permission bits -- chmod(0o700) leaves the group '
    + 'and other bits set -- so the gate can never be satisfied here and the assertion would '
    + 'fail for a reason that has nothing to do with the code. On Linux, which is what CI and '
    + 'the offline/Orin deployment run, these are NOT skipped: the permission check executes '
    + 'for real and is the point of the test. A green run on Windows therefore proves less than '
    + 'a green run on Linux for exactly these two cases.';

function privateSocket() {
  const root = mkdtempSync(join(tmpdir(), 'scorm-verifier-test-'));
  const socketDirectory = join(root, 'socket');
  mkdirSync(socketDirectory, { mode: 0o700 });
  chmodSync(socketDirectory, 0o700);
  writeFileSync(join(socketDirectory, '.scorm-socket-marker'), 'schoolcircle-scorm-private\n');
  return { root, socketDirectory };
}

test('SCORM verifier requires its own confirmed private cluster target', { skip: offPosixSkip }, () => {
  const { root, socketDirectory } = privateSocket();
  const isolatedUrl =
    `postgresql://scorm_test@localhost/schoolcircle_scorm_test` +
    `?host=${encodeURIComponent(socketDirectory)}&connection_limit=2`;
  try {
    assert.throws(
      () => assertIsolatedDatabase(undefined, {
        databaseName: 'schoolcircle_scorm_test',
        socketDirectory,
        env: {},
      }),
      /private PostgreSQL Unix-socket URL/,
    );
    assert.throws(
      () => assertIsolatedDatabase(isolatedUrl, {
        databaseName: 'schoolcircle_scorm_test',
        socketDirectory,
        env: { CLOUD_SQL_CONNECTION_NAME: 'project:region:instance' },
      }),
      /managed connector/,
    );
    assert.throws(
      () => assertIsolatedDatabase(isolatedUrl, {
        databaseName: 'schoolcircle_scorm_test',
        socketDirectory,
        env: { DATABASE_URL: 'postgresql://localhost/production' },
      }),
      /different existing database URL/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('SCORM verifier accepts only a matching private socket target', { skip: offPosixSkip }, () => {
  const { root, socketDirectory } = privateSocket();
  const isolatedUrl =
    `postgresql://scorm_test@localhost/schoolcircle_scorm_test` +
    `?host=${encodeURIComponent(socketDirectory)}&connection_limit=2`;
  try {
    assert.deepEqual(
      assertIsolatedDatabase(isolatedUrl, {
        databaseName: 'schoolcircle_scorm_test',
        socketDirectory,
        env: {},
      }),
      { databaseName: 'schoolcircle_scorm_test', socketDirectory },
    );
    assert.throws(
      () => assertIsolatedDatabase(
        'postgresql://scorm_test@localhost/schoolcircle_scorm_test',
        { databaseName: 'schoolcircle_scorm_test', socketDirectory, env: {} },
      ),
      /host or TCP query override/,
    );
    assert.throws(
      () => assertIsolatedDatabase(
        `postgresql://scorm_test@localhost/schoolcircle_scorm_test` +
          `?host=${encodeURIComponent(`${socketDirectory}-other`)}&connection_limit=2`,
        { databaseName: 'schoolcircle_scorm_test', socketDirectory, env: {} },
      ),
      /private Unix socket directory/,
    );
    assert.throws(
      () => assertIsolatedDatabase(isolatedUrl, {
        databaseName: 'schoolcircle_scorm_test',
        socketDirectory: `${socketDirectory}-other`,
        env: {},
      }),
      /private Unix socket directory/,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('CLI options require the verifier-owned private database runner', () => {
  assert.throws(
    () => parseOptions(['--database-url=postgresql://localhost/production']),
    /External database arguments/,
  );
  assert.deepEqual(parseOptions([]), { privateDatabase: true });
});