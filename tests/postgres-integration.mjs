// Self-contained PostgreSQL test. No connection to a caller/workspace database.
// Requires native initdb/pg_ctl/createdb on PATH; no Docker or cloud credentials.
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { PrismaClient } from '@prisma/client';
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
let started = false;
let db;
try {
  run('initdb', ['-D', data, '-U', 'schoolcircle_test', '--auth-local=trust', '--auth-host=reject', '--no-locale', '-E', 'UTF8']);
  run('pg_ctl', ['-D', data, '-l', join(root, 'server.log'), '-o', `-k ${socket} -c listen_addresses=''`, '-w', 'start']);
  started = true;
  run('createdb', ['-h', socket, '-U', 'schoolcircle_test', 'schoolcircle_test']);
  run(process.execPath, ['scripts/database.mjs', 'deploy'], 1, { DATABASE_TARGET_CONFIRM: 'wrong_database' });
  run(process.execPath, ['scripts/database.mjs', 'deploy']);
  run(process.execPath, ['scripts/database.mjs', 'deploy']);
  run(process.execPath, ['scripts/database.mjs', 'status']);
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
  const drift = run(process.execPath, [
    require.resolve('prisma/build/index.js'), 'migrate', 'diff',
    '--from-schema-datasource', 'prisma/schema.prisma',
    '--to-schema-datamodel', 'prisma/schema.prisma', '--exit-code',
  ]);
  assert.equal(drift.status, 0);
  console.log('PASS: isolated PostgreSQL migrations, repeatable seeds, safety guards, reconnect persistence, approved-only query, and zero schema drift.');
} catch {
  console.error('FAIL: isolated PostgreSQL integration. Check native PostgreSQL binaries and the failing assertion locally; detailed errors suppressed.');
  process.exitCode = 1;
} finally {
  if (db) await db.$disconnect().catch(() => {});
  if (started) spawnSync('pg_ctl', ['-D', data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
  rmSync(root, { recursive: true, force: true });
}