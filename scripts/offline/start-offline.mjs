#!/usr/bin/env node
/**
 * Launch SchoolCircle offline, on the laptop, against the Orin (Anchor).
 *
 *   node scripts/offline/start-offline.mjs [envfile] [--start] [--skip-checks]
 *
 * What it DOES (all safe, no heavy build):
 *   1. Loads env vars from an env file (default `.env.offline` at the repo root)
 *      into the child process only — it does not write .env.local or mutate the shell.
 *   2. Validates the offline invariants (AUTH_MODE=offline, a >=32-char secret,
 *      a doctrine URL, a non-empty operator roster) WITHOUT printing any secret.
 *   3. Preflights the two things a pulled-cable demo needs local: the Orin's
 *      /api/health and the local Postgres TCP port.
 *   4. Spawns `npm run dev` (next dev — compiles on demand, NO production build).
 *      With --start it runs `npm start` (next start) instead, but ONLY if a prior
 *      `.next` build exists; it never runs `next build` itself (that OOMs on the
 *      constrained box — the human builds separately: see docs/offline-runbook.md).
 *
 * Exit codes: 0 launched; 2 failed validation/preflight; 1 usage/runner error.
 */
import { readFileSync, existsSync } from 'node:fs';
import { spawn } from 'node:child_process';
import { createConnection } from 'node:net';
import { fileURLToPath } from 'node:url';
import { dirname, resolve, join } from 'node:path';
import { get as httpGet } from 'node:http';

const HERE = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(HERE, '..', '..');

const args = process.argv.slice(2);
const flags = new Set(args.filter((a) => a.startsWith('--')));
const positional = args.filter((a) => !a.startsWith('--'));
const envFile = resolve(ROOT, positional[0] || '.env.offline');
const wantStart = flags.has('--start');
const skipChecks = flags.has('--skip-checks');

function die(code, msg) {
  process.stderr.write(`\n[start-offline] ${msg}\n`);
  process.exit(code);
}
function ok(msg) {
  process.stdout.write(`[start-offline] ${msg}\n`);
}

// --- 1. Parse the env file (simple KEY=VALUE, quotes stripped, # comments ignored). ---
if (!existsSync(envFile)) {
  die(1,
    `Env file not found: ${envFile}\n` +
    `Copy the template first:  cp .env.offline.example .env.offline  (then fill the secrets).`);
}
const parsed = {};
for (const rawLine of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
  const line = rawLine.trim();
  if (!line || line.startsWith('#')) continue;
  const eq = line.indexOf('=');
  if (eq === -1) continue;
  const key = line.slice(0, eq).trim();
  let rest = line.slice(eq + 1).trim();
  let val;
  const q = rest[0];
  if (q === '"' || q === "'") {
    // Quoted: take up to the matching closing quote; anything after (e.g. a # comment) is ignored.
    const close = rest.indexOf(q, 1);
    val = close === -1 ? rest.slice(1) : rest.slice(1, close);
  } else {
    // Unquoted: a " #" begins an inline comment.
    const hash = rest.search(/\s#/);
    val = (hash === -1 ? rest : rest.slice(0, hash)).trim();
  }
  parsed[key] = val;
}

// --- 2. Validate offline invariants (never echo a secret value). ---
const problems = [];
if ((parsed.AUTH_MODE || '').trim().toLowerCase() !== 'offline') {
  problems.push('AUTH_MODE must be exactly "offline".');
}
if (!parsed.OFFLINE_AUTH_SECRET || parsed.OFFLINE_AUTH_SECRET.length < 32) {
  problems.push('OFFLINE_AUTH_SECRET must be set and at least 32 characters (openssl rand -base64 48).');
}
if (!parsed.DOCTRINE_BASE_URL) {
  problems.push('DOCTRINE_BASE_URL must be set (e.g. http://192.168.55.1:8000).');
}
if (!parsed.DATABASE_URL) {
  problems.push('DATABASE_URL must be set (local Postgres, e.g. 127.0.0.1:5432).');
}
try {
  const roster = JSON.parse(parsed.OFFLINE_AUTH_OPERATORS || '[]');
  if (!Array.isArray(roster) || roster.length === 0) {
    problems.push('OFFLINE_AUTH_OPERATORS is empty — mint one with scripts/offline/operator-passphrase.mjs, or no one can sign in.');
  }
} catch {
  problems.push('OFFLINE_AUTH_OPERATORS is not valid JSON.');
}
if ((parsed.NEXT_PUBLIC_AUTH_MODE || '').trim().toLowerCase() !== 'offline') {
  problems.push('NEXT_PUBLIC_AUTH_MODE must be "offline" or the sign-in form will not render.');
}
if (problems.length) {
  die(2, `Config problems in ${envFile}:\n  - ${problems.join('\n  - ')}`);
}
ok(`env OK: AUTH_MODE=offline, secret set (${parsed.OFFLINE_AUTH_SECRET.length} chars), doctrine=${parsed.DOCTRINE_BASE_URL}`);

// --- 3. Preflight the two local dependencies. ---
function checkTcp(host, port, timeoutMs = 3000) {
  return new Promise((res) => {
    const sock = createConnection({ host, port });
    const done = (val) => { sock.destroy(); res(val); };
    sock.setTimeout(timeoutMs);
    sock.once('connect', () => done(true));
    sock.once('timeout', () => done(false));
    sock.once('error', () => done(false));
  });
}
function checkHealth(baseUrl, timeoutMs = 5000) {
  return new Promise((res) => {
    let u;
    try { u = new URL('/api/health', baseUrl); } catch { return res({ ok: false, why: 'bad URL' }); }
    const req = httpGet(u, (r) => {
      let body = '';
      r.on('data', (c) => (body += c));
      r.on('end', () => {
        try { res({ ok: JSON.parse(body).ok === true, why: `HTTP ${r.statusCode}` }); }
        catch { res({ ok: false, why: `HTTP ${r.statusCode}, non-JSON` }); }
      });
    });
    req.setTimeout(timeoutMs, () => { req.destroy(); res({ ok: false, why: 'timeout' }); });
    req.on('error', (e) => res({ ok: false, why: e.code || e.message }));
  });
}

if (!skipChecks) {
  const health = await checkHealth(parsed.DOCTRINE_BASE_URL);
  if (health.ok) ok(`Orin reachable: ${parsed.DOCTRINE_BASE_URL}/api/health -> ok`);
  else die(2, `Orin NOT healthy at ${parsed.DOCTRINE_BASE_URL}/api/health (${health.why}). ` +
    `Reseat the USB cable / check the board, or pass --skip-checks to launch anyway.`);

  let dbHost = '127.0.0.1', dbPort = 5432;
  try { const u = new URL(parsed.DATABASE_URL); dbHost = u.hostname || dbHost; dbPort = Number(u.port) || dbPort; } catch { /* keep defaults */ }
  const dbUp = await checkTcp(dbHost, dbPort);
  if (dbUp) ok(`Local Postgres reachable: ${dbHost}:${dbPort}`);
  else die(2, `Postgres NOT reachable at ${dbHost}:${dbPort}. Start it first:\n` +
    `  docker compose up -d && npm run db:deploy   (see docs/offline-runbook.md).\n` +
    `  Or pass --skip-checks to launch anyway.`);
} else {
  ok('preflight checks skipped (--skip-checks).');
}

// --- 4. Launch. Never builds. ---
let script = 'dev';
if (wantStart) {
  if (existsSync(join(ROOT, '.next', 'BUILD_ID'))) {
    script = 'start';
  } else {
    die(2, '--start needs a prior production build (.next/), which this script never runs. ' +
      'Build separately on a box with RAM headroom (npm run build with the offline env), then re-run with --start. ' +
      'Or omit --start to use next dev (no build).');
  }
}
ok(`launching: npm run ${script}  (Ctrl+C to stop)  — app on http://localhost:3111`);
const isWin = process.platform === 'win32';
const child = spawn(isWin ? 'npm.cmd' : 'npm', ['run', script], {
  cwd: ROOT,
  stdio: 'inherit',
  env: { ...process.env, ...parsed },
  shell: isWin,
});
child.on('exit', (code) => process.exit(code ?? 0));
child.on('error', (e) => die(1, `Failed to spawn npm: ${e.message}`));
