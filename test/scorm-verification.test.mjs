import assert from 'node:assert/strict';
import { chmodSync, mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import test from 'node:test';
import { assertIsolatedDatabase, parseOptions } from '../scripts/scorm/verify.mjs';

function privateSocket() {
  const root = mkdtempSync(join(tmpdir(), 'scorm-verifier-test-'));
  const socketDirectory = join(root, 'socket');
  mkdirSync(socketDirectory, { mode: 0o700 });
  chmodSync(socketDirectory, 0o700);
  writeFileSync(join(socketDirectory, '.scorm-socket-marker'), 'schoolcircle-scorm-private\n');
  return { root, socketDirectory };
}

test('SCORM verifier requires its own confirmed private cluster target', () => {
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

test('SCORM verifier accepts only a matching private socket target', () => {
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