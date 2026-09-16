// The Prisma CLI does not load Next's .env.local by itself. Load it here without
// overriding a URL supplied by the operator, then require a deliberate target.
import nextEnv from '@next/env';
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';

const require = createRequire(import.meta.url);
nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', {
  info() {}, error() {},
});

const command = process.argv[2];
const allowed = new Set(['develop', 'deploy', 'status', 'seed']);
function fail(message) {
  console.error(message);
  process.exit(1);
}
if (!allowed.has(command)) fail('Use develop, deploy, status, or seed.');
let target;
try {
  const url = new URL(process.env.DATABASE_URL);
  if (!['postgresql:', 'postgres:'].includes(url.protocol)) throw new Error();
  target = decodeURIComponent(url.pathname.slice(1));
  if (!target) throw new Error();
} catch {
  fail('A valid PostgreSQL DATABASE_URL is required; its value will not be logged.');
}
if (['develop', 'deploy', 'seed'].includes(command)) {
  if (process.env.DATABASE_TARGET_CONFIRM !== target) {
    fail('Set DATABASE_TARGET_CONFIRM to the intended database name before applying migrations.');
  }
  if (!['development', 'demo', 'test', 'production'].includes(process.env.SCHOOLCIRCLE_DB_ENV)) {
    fail('Set SCHOOLCIRCLE_DB_ENV explicitly before applying migrations.');
  }
}
if (command === 'develop' && (
  process.env.NODE_ENV === 'production' ||
  !['development', 'test'].includes(process.env.SCHOOLCIRCLE_DB_ENV) ||
  !/_(dev|test)$/.test(target)
)) fail('Interactive migration development is restricted to *_dev or *_test databases.');

const args = command === 'seed'
  ? ['prisma/seed.js']
  : [require.resolve('prisma/build/index.js'), 'migrate',
    command === 'develop' ? 'dev' : command, ...(command === 'develop' ? ['--skip-seed'] : [])];
// Buffer output instead of forwarding Prisma errors, which may contain the
// datasource URL or credential fields. Inspect detailed failures in a secure
// operator session, never a CI log.
const result = spawnSync(process.execPath, args, {
  env: process.env, encoding: 'utf8', stdio: ['inherit', 'pipe', 'pipe'],
});
if (result.status !== 0 || result.error) {
  fail(`Database ${command} failed. Check target, access, migration state, and seed guards in docs/CLOUD_POSTGRES.md. Detailed output suppressed to protect credentials.`);
}
console.log(`Database ${command} completed successfully.`);