import assert from 'node:assert/strict';

import { PrismaClient } from '@prisma/client';
import { assertDemoSeedEnvironment, seedDemo } from '../prisma/seed.js';

/**
 * Run against a caller-supplied, already migrated, isolated PostgreSQL database.
 *
 * The URL is deliberately an argument rather than a fallback to process.env.DATABASE_URL.  This
 * keeps `node --test tests/database-seed*.mjs` and accidental local invocations away from the
 * workspace database.  This runner performs no migration and seeds twice to exercise
 * idempotence.  The caller is responsible for creating/resetting the dedicated target.
 */
export async function runDatabaseSeedIntegration({ databaseUrl } = {}) {
  if (typeof databaseUrl !== 'string' || databaseUrl.length === 0) {
    throw new Error(
      'Integration runner requires an explicit isolated PostgreSQL URL argument.',
    );
  }

  const env = {
    SCHOOLCIRCLE_DB_ENV: 'test',
    ALLOW_DEMO_SEED: 'true',
    NODE_ENV: 'test',
    DATABASE_URL: databaseUrl,
    DATABASE_TARGET_CONFIRM: decodeURIComponent(new URL(databaseUrl).pathname)
      .replace(/^\/+/, '')
      .replace(/\/+$/, ''),
  };
  assertDemoSeedEnvironment(env);

  // The explicit datasource override means this runner never reads a workspace DATABASE_URL.
  const db = new PrismaClient({
    datasources: { db: { url: databaseUrl } },
  });

  try {
    const first = await seedDemo(db, { env });
    const second = await seedDemo(db, { env });
    assert.deepEqual(second, first);
    return {
      first,
      second,
      idempotent: true,
    };
  } finally {
    await Promise.resolve(db.$disconnect()).catch(() => {});
  }
}