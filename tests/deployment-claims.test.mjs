/**
 * Guard against deployment claims that measurement has already disproven.
 *
 * This repo's recurring failure mode is not broken code, it is claim drift: a
 * number or a capability gets written down, the thing it described changes, and
 * the stale sentence stays in a doc a judge or an operator then reads. Each
 * assertion below corresponds to a specific claim that was measured FALSE and
 * removed, so a regression here means someone reintroduced a statement that can
 * be disproven in one click.
 *
 * Deliberately narrow. It does NOT ban the word "offline" -- Anchor genuinely
 * runs offline and that claim should be made proudly and often. It bans only the
 * specific disproven forms, so that work on an offline auth path (which would
 * make some of these true again) is not fought by this test. If a claim here
 * becomes true, delete its case and say in the commit what measurement changed.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';

const ROOT = path.resolve(import.meta.dirname, '..');

/* Directories that are build output, vendored code, or not shipped prose. */
const SKIP_DIRS = new Set([
  'node_modules', '.git', '.next', 'dist', 'build', 'coverage', '.turbo',
]);

/** Every text file we consider "something a human reads and believes". */
async function collect(dir, out = []) {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    if (entry.name.startsWith('.') && entry.name !== '.env.example') continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (SKIP_DIRS.has(entry.name)) continue;
      await collect(full, out);
      continue;
    }
    if (!/\.(md|js|mjs|jsx|ts|tsx|html|ya?ml|sh)$/.test(entry.name)) continue;
    // This file quotes every banned string on purpose.
    if (path.resolve(full) === path.resolve(import.meta.filename)) continue;
    const info = await stat(full);
    if (info.size > 2 * 1024 * 1024) continue;
    out.push(full);
  }
  return out;
}

const FILES = await collect(ROOT);

/**
 * Assert no shipped file contains `needle`.
 *
 * `allow` lists substrings that make an occurrence legitimate -- almost always
 * a line that NAMES the bad claim in order to forbid or correct it, which is
 * exactly what the fix commits did.
 */
async function banned({ needle, why, allow = [] }) {
  // Markdown sprinkles backticks, asterisks and quotes through prose, so an
  // allow-phrase like `not schoolcircle-dev` would miss the real line
  // "not `schoolcircle-dev` on 5433". Compare against a line with that
  // punctuation stripped and the case folded, so one allow-phrase covers every
  // way someone might emphasise it.
  const normalise = (s) => s.replace(/[`*_"'()]/g, '').toLowerCase();
  const hits = [];
  for (const file of FILES) {
    const text = await readFile(file, 'utf8');
    if (!text.includes(needle)) continue;
    for (const [i, line] of text.split(/\r?\n/).entries()) {
      if (!line.includes(needle)) continue;
      const flat = normalise(line);
      if (allow.some((ok) => flat.includes(normalise(ok)))) continue;
      hits.push(`${path.relative(ROOT, file)}:${i + 1}: ${line.trim().slice(0, 160)}`);
    }
  }
  assert.equal(hits.length, 0, `${why}\n\n${hits.join('\n')}\n`);
}

test('the dead Cloudflare quick-tunnel hostname is gone and stays gone', async () => {
  // Measured returning 502. A quick tunnel renames on every restart, so no
  // quick-tunnel hostname belongs in version control at all.
  await banned({
    needle: 'trycloudflare.com',
    why: 'A Cloudflare quick-tunnel hostname is back in the repo. These rot by design '
      + '(new hostname every restart) and the last pinned one was measured dead (502). '
      + 'Set the address at runtime in Settings -> Doctrine engine, or use a NAMED tunnel.',
  });
});

test('apphosting.yaml does not pin a doctrine address', async () => {
  const text = await readFile(path.join(ROOT, 'apphosting.yaml'), 'utf8');
  const assigned = text
    .split(/\r?\n/)
    .filter((line) => /^\s*-\s*variable:\s*DOCTRINE_BASE_URL\s*$/.test(line));
  assert.equal(
    assigned.length,
    0,
    'apphosting.yaml declares DOCTRINE_BASE_URL again. A baked-in address is worse than none: '
    + 'unset resolves to `unconfigured` (neutral grey, with instructions), a stale value '
    + 'resolves to ready and paints red, and "Use deployment default" would restore the stale '
    + 'one over an operator\'s working address. If a STABLE named-tunnel hostname now exists, '
    + 'this test is the right place to record that decision.',
  );
});

test('the corpus is not described with the superseded counts', async () => {
  // GET /api/corpus returns total_chunks 4731 and 14 documents.
  await banned({
    needle: '4,230',
    why: 'The corpus is 4,731 chunks across 14 publications (GET /api/corpus). 4,230 was a '
      + 'previous index and a judge can disprove it in one request.',
    allow: ['earlier revision', 'used to say', 'previously', 'superseded', 'NOT 4,230'],
  });
  await banned({
    needle: '13 publications',
    why: 'The corpus holds 14 publications. The index\'s own index_meta.corpus_documents '
      + 'counter still reads 13, but its `documents` array lists 14 and is authoritative.',
    allow: ['earlier revision', 'used to say', 'previously', 'superseded', 'index_meta'],
  });
});

test('no document promises a Postgres-FTS fallback', async () => {
  // There is no `fts` path in lib/ or app/, and no Chunk table in the schema to
  // run one over -- the learning loop persists to LearningRecord rows.
  await banned({
    needle: 'source = fts',
    why: 'A Postgres-FTS fallback is promised again. The application cannot produce '
      + '`source = fts`: there is no fts code path and no Chunk table. Telling an operator '
      + 'to watch for it sends them looking for a state that cannot occur.',
    allow: [
      'NO Postgres-FTS', 'cannot produce', 'does not exist', 'no FTS',
      'Anchor fell back to lexical', // Anchor's own internal retrieval, a different thing
    ],
  });
});

test('runbooks do not point at ops scripts that do not exist', async () => {
  for (const missing of ['ops/OFFLINE.md', 'ops/get-key.sh']) {
    await banned({
      needle: missing,
      why: `${missing} does not exist (ops/ holds orin-check.sh and tunnel.sh). `
        + 'A dead runbook link in a demo-day file is a claim that fails on the spot. '
        + 'If the file has since been created, delete this case.',
      allow: [
        'does not exist', 'never existed', 'no longer', 'phantom',
        `no ${missing}`, `not ${missing}`, 'holds only',
      ],
    });
  }
});

test('the dev Postgres container is named and ported correctly', async () => {
  // docker-compose.yml: container_name schoolcircle-db, "127.0.0.1:5432:5432".
  await banned({
    needle: 'schoolcircle-dev',
    why: 'The dev Postgres container is `schoolcircle-db` on host port 5432 '
      + '(docker-compose.yml). `docker start schoolcircle-dev` fails immediately, and it '
      + 'was the first line of the demo-day preflight.',
    allow: [
      'not schoolcircle-dev', 'schoolcircle-dev-database-url', 'never schoolcircle-dev',
    ],
  });
});

test('SQLite is not described as a connection-string swap', async () => {
  // prisma/schema.prisma keeps provider = "postgresql" for cloud AND edge;
  // docs/CLOUD_POSTGRES.md says outright that SQLite is not a URL-only swap.
  for (const needle of ['connection-string swap', 'connection string swap']) {
    await banned({
      needle,
      why: 'SQLite is described as a connection-string swap again. The schema keeps '
        + 'provider = "postgresql" for both cloud and edge; the edge build is local '
        + 'PostgreSQL with a different DATABASE_URL. docs/CLOUD_POSTGRES.md is explicit.',
      allow: ['not a connection-string', 'not a connection string', 'more than a connection'],
    });
  }
});
