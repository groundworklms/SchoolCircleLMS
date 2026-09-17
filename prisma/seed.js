/**
 * Guarded development/demo seed for SchoolCircle.
 *
 * This fixture is intentionally labelled as demo-only.  The approved item status makes the
 * read-only UI useful in a demo, but is not a claim that the content has been verified for
 * production use.  This script will not connect to a database until every opt-in and database
 * name check below has passed.
 */
import { Prisma, PrismaClient } from '@prisma/client';
import { fileURLToPath } from 'node:url';

export const DEMO_PREFIX = 'schoolcircle-demo-';
export const ADVISORY_LOCK_KEY = `${DEMO_PREFIX}seed-v1`;
export const DEMO_ITEM_STATUS = 'APPROVED';
export const DEMO_CREATED_AT = new Date('2025-01-01T00:00:00.000Z');

export const DEMO_IDS = Object.freeze({
  users: Object.freeze({
    instructor: `${DEMO_PREFIX}user-instructor`,
    learner: `${DEMO_PREFIX}user-learner`,
  }),
  course: `${DEMO_PREFIX}course-rifle-marksmanship`,
  sections: Object.freeze({
    functionalElements: `${DEMO_PREFIX}section-functional-elements`,
    stabilityAndNaturalPointOfAim: `${DEMO_PREFIX}section-stability-natural-point-of-aim`,
    aiming: `${DEMO_PREFIX}section-aiming-sight-alignment-picture`,
    triggerControl: `${DEMO_PREFIX}section-trigger-control-follow-through`,
  }),
  items: Object.freeze({
    sightAlignmentLesson: `${DEMO_PREFIX}item-sight-alignment`,
    triggerControlLesson: `${DEMO_PREFIX}item-trigger-control`,
    shotProcessQuestion: `${DEMO_PREFIX}item-shot-process`,
  }),
});

/**
 * These are the only IDs this script owns.  In particular, a prefix by itself is not enough:
 * an unknown row bearing the prefix is refused rather than silently adopted.
 */
export const OWNED_DEMO_IDS = Object.freeze({
  User: Object.freeze(new Set(Object.values(DEMO_IDS.users))),
  Course: Object.freeze(new Set([DEMO_IDS.course])),
  Section: Object.freeze(new Set(Object.values(DEMO_IDS.sections))),
  Item: Object.freeze(new Set(Object.values(DEMO_IDS.items))),
  Attempt: Object.freeze(new Set()),
  Mastery: Object.freeze(new Set()),
  Schedule: Object.freeze(new Set()),
});

export const DOMAIN_MODELS = Object.freeze([
  Object.freeze({ name: 'User', delegate: 'user' }),
  Object.freeze({ name: 'Course', delegate: 'course' }),
  Object.freeze({ name: 'Section', delegate: 'section' }),
  Object.freeze({ name: 'Item', delegate: 'item' }),
  Object.freeze({ name: 'Attempt', delegate: 'attempt' }),
  Object.freeze({ name: 'Mastery', delegate: 'mastery' }),
  Object.freeze({ name: 'Schedule', delegate: 'schedule' }),
]);

// Keep the original course fixture content, while making its demo-only status visible in the
// course name.  These claims/citations are fixture content, not a production verification.
//
// No item here carries a `support` score, and none may be added.  `Item.support` is the
// HHEM entailment measurement taken at approval (lib/learning/verify-support.js) against the
// passage the item is cited to.  This fixture is typed out by hand and runs offline: nothing
// has measured it, so there is nothing to record.  The three hardcoded values that used to sit
// here -- 0.96, 0.95 and 0.93 -- were invented, and they read on a demo screen exactly like
// verifier output, which is the one thing a confidence number must never do.  The seeded items
// now show "not verified", which is true of them.
const SECTIONS = Object.freeze([
  Object.freeze({
    id: DEMO_IDS.sections.functionalElements,
    title: 'Ch 5 · Functional Elements',
    order: 5,
  }),
  Object.freeze({
    id: DEMO_IDS.sections.stabilityAndNaturalPointOfAim,
    title: 'Ch 6 · Stability & Natural Point of Aim',
    order: 6,
  }),
  Object.freeze({
    id: DEMO_IDS.sections.aiming,
    title: 'Ch 7 · Aiming — Sight Alignment & Picture',
    order: 7,
  }),
  Object.freeze({
    id: DEMO_IDS.sections.triggerControl,
    title: 'Ch 8 · Trigger Control & Follow-Through',
    order: 8,
  }),
]);

const ITEMS = Object.freeze([
  Object.freeze({
    id: DEMO_IDS.items.sightAlignmentLesson,
    sectionId: DEMO_IDS.sections.aiming,
    kind: 'LESSON',
    stem: 'Sight alignment is the relationship between the aiming device and the firer’s eye; sight picture is the placement of the aligned sights on the target.',
    citation: {
      citation: 'TC 3-22.9, Ch 7 “Desired Point of Impact”, para 1, p.7-5',
      pubId: 'TC 3-22.9',
      page: '7-5',
    },
    status: DEMO_ITEM_STATUS,
  }),
  Object.freeze({
    id: DEMO_IDS.items.triggerControlLesson,
    sectionId: DEMO_IDS.sections.triggerControl,
    kind: 'LESSON',
    stem: 'Trigger control is firing the weapon while maintaining proper aim and stabilization until the bullet leaves the muzzle.',
    citation: {
      citation: 'TC 3-22.9, Ch 8 “Trigger Control”, para 2, p.8-2',
      pubId: 'TC 3-22.9',
      page: '8-2',
    },
    status: DEMO_ITEM_STATUS,
  }),
  Object.freeze({
    id: DEMO_IDS.items.shotProcessQuestion,
    sectionId: DEMO_IDS.sections.aiming,
    kind: 'QUESTION',
    stem: 'How many phases make up the shot process?',
    options: [
      'Three — pre-shot, shot, post-shot',
      'Four',
      'Five',
      'Two',
    ],
    answer: 0,
    rationale: 'Aiming is conducted through pre-shot, shot, and post-shot — three phases.',
    citation: {
      citation: 'TC 3-22.9, Ch 6 “Aiming”, para 3',
      pubId: 'TC 3-22.9',
    },
    status: DEMO_ITEM_STATUS,
  }),
]);

/**
 * Public fixture description for policy tests and for callers that want to show what the seed
 * owns.  The write path below still constructs its own data objects so this export cannot be
 * mutated into a query or an arbitrary upsert.
 */
export const DEMO_SEED_FIXTURE = Object.freeze({
  users: Object.freeze([
    Object.freeze({
      id: DEMO_IDS.users.instructor,
      name: 'Demo Instructor',
      role: 'INSTRUCTOR',
      externalId: null,
    }),
    Object.freeze({
      id: DEMO_IDS.users.learner,
      name: 'Demo Learner',
      role: 'LEARNER',
      externalId: null,
    }),
  ]),
  course: Object.freeze({
    id: DEMO_IDS.course,
    title: 'DEMO ONLY — Rifle Marksmanship — TC 3-22.9 (NOT PRODUCTION-VERIFIED)',
    sourceId: 'TC 3-22.9',
  }),
  sections: SECTIONS,
  items: ITEMS,
});

export class DemoSeedPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DemoSeedPolicyError';
  }
}

export class DemoSeedRefusalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'DemoSeedRefusalError';
  }
}

/**
 * Validate all safety gates without constructing a Prisma client.
 *
 * The URL is parsed only to inspect its database path.  No URL, username, password, host, or
 * query string is included in any error text.
 */
export function assertDemoSeedEnvironment(env = process.env) {
  const dbEnvironment = env.SCHOOLCIRCLE_DB_ENV;
  if (!['development', 'demo', 'test'].includes(dbEnvironment)) {
    throw new DemoSeedPolicyError(
      'Demo seed refused: SCHOOLCIRCLE_DB_ENV must be development, demo, or test.',
    );
  }

  if (env.ALLOW_DEMO_SEED !== 'true') {
    throw new DemoSeedPolicyError(
      'Demo seed refused: ALLOW_DEMO_SEED=true is required.',
    );
  }

  if (
    typeof env.NODE_ENV !== 'string' ||
    env.NODE_ENV.trim().length === 0 ||
    env.NODE_ENV.trim().toLowerCase() === 'production'
  ) {
    throw new DemoSeedPolicyError(
      'Demo seed refused: NODE_ENV must be set to a non-production value.',
    );
  }

  if (typeof env.DATABASE_URL !== 'string' || env.DATABASE_URL.length === 0) {
    throw new DemoSeedPolicyError(
      'Demo seed refused: DATABASE_URL is required and was not inspected.',
    );
  }

  let databaseName;
  try {
    const databaseUrl = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(databaseUrl.protocol)) {
      throw new Error('unsupported protocol');
    }
    databaseName = decodeURIComponent(databaseUrl.pathname)
      .replace(/^\/+/, '')
      .replace(/\/+$/, '');
  } catch {
    throw new DemoSeedPolicyError(
      'Demo seed refused: DATABASE_URL is not a supported PostgreSQL URL.',
    );
  }

  if (!databaseName || !/_(?:dev|demo|test)$/i.test(databaseName)) {
    throw new DemoSeedPolicyError(
      'Demo seed refused: the database name must end in _dev, _demo, or _test.',
    );
  }

  if (
    typeof env.DATABASE_TARGET_CONFIRM !== 'string' ||
    env.DATABASE_TARGET_CONFIRM.length === 0
  ) {
    throw new DemoSeedPolicyError(
      'Demo seed refused: DATABASE_TARGET_CONFIRM is required.',
    );
  }

  if (env.DATABASE_TARGET_CONFIRM !== databaseName) {
    throw new DemoSeedPolicyError(
      'Demo seed refused: DATABASE_TARGET_CONFIRM must match the parsed database name.',
    );
  }

  return Object.freeze({
    dbEnvironment,
    nodeEnvironment: env.NODE_ENV,
    databaseName,
  });
}

async function acquireAdvisoryTransactionLock(tx) {
  // The lock is transaction-scoped.  A second seed waits here until the first transaction has
  // committed or rolled back, so both cannot pass the ownership check concurrently.
  await tx.$queryRaw(
    Prisma.sql`SELECT
      (pg_advisory_xact_lock(hashtext(${ADVISORY_LOCK_KEY}::text)::bigint) IS NULL)
        AS "locked"`,
  );
}

async function inspectDomainRows(tx) {
  for (const model of DOMAIN_MODELS) {
    const rows = await tx[model.delegate].findMany({ select: { id: true } });
    const ownedIds = OWNED_DEMO_IDS[model.name];
    const unownedCount = rows.filter((row) => !ownedIds.has(row.id)).length;
    if (unownedCount > 0) {
      throw new DemoSeedRefusalError(
        `Demo seed refused: ${model.name} contains ${unownedCount} non-demo row(s).`,
      );
    }
  }
}

function userCreateData(user) {
  return {
    ...user,
    createdAt: DEMO_CREATED_AT,
  };
}

function itemCreateData(item) {
  return {
    ...item,
    status: DEMO_ITEM_STATUS,
    createdAt: DEMO_CREATED_AT,
  };
}

/**
 * Seed only the explicitly owned demo fixture.
 *
 * Every write is an ID-based upsert with an empty update object.  Existing demo rows are
 * therefore preserved exactly (including an instructor's review decision), and no name-based
 * lookup can attach to a real account or course.
 */
export async function seedDemo(db, { env = process.env } = {}) {
  assertDemoSeedEnvironment(env);
  if (!db || typeof db.$transaction !== 'function') {
    throw new DemoSeedPolicyError('Demo seed refused: a Prisma client is required.');
  }

  return db.$transaction(async (tx) => {
    await acquireAdvisoryTransactionLock(tx);
    await inspectDomainRows(tx);

    for (const user of DEMO_SEED_FIXTURE.users) {
      await tx.user.upsert({
        where: { id: user.id },
        create: userCreateData(user),
        update: {},
      });
    }

    await tx.course.upsert({
      where: { id: DEMO_SEED_FIXTURE.course.id },
      create: {
        ...DEMO_SEED_FIXTURE.course,
        createdAt: DEMO_CREATED_AT,
      },
      update: {},
    });

    for (const section of DEMO_SEED_FIXTURE.sections) {
      await tx.section.upsert({
        where: { id: section.id },
        create: {
          id: section.id,
          courseId: DEMO_SEED_FIXTURE.course.id,
          title: section.title,
          order: section.order,
        },
        update: {},
      });
    }

    for (const item of DEMO_SEED_FIXTURE.items) {
      await tx.item.upsert({
        where: { id: item.id },
        create: itemCreateData(item),
        update: {},
      });
    }

    return Object.freeze({
      courseId: DEMO_SEED_FIXTURE.course.id,
      userIds: DEMO_SEED_FIXTURE.users.map((user) => user.id),
      sectionIds: DEMO_SEED_FIXTURE.sections.map((section) => section.id),
      itemIds: DEMO_SEED_FIXTURE.items.map((item) => item.id),
    });
  }, {
    // ~25 sequential round-trips; Prisma's 5 s default expires over a laptop -> Cloud SQL
    // hop and surfaces as "Transaction not found". Idle contention is bounded by the lock.
    maxWait: 15_000,
    timeout: 120_000,
  });
}

/**
 * CLI entry point.  Environment validation intentionally occurs before PrismaClient construction.
 * Database failures are sanitized by the direct-execution handler below.
 */
export async function main({
  env = process.env,
  createClient = () => new PrismaClient(),
} = {}) {
  assertDemoSeedEnvironment(env);
  const db = createClient();
  try {
    return await seedDemo(db, { env });
  } finally {
    if (db && typeof db.$disconnect === 'function') {
      await Promise.resolve(db.$disconnect()).catch(() => {});
    }
  }
}

function safeCliError(error) {
  if (error instanceof DemoSeedPolicyError || error instanceof DemoSeedRefusalError) {
    return error.message;
  }
  return 'Demo seed failed. Database details were omitted.';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  main()
    .then(() => {
      console.log('Demo seed complete (guarded development/demo data only).');
    })
    .catch((error) => {
      console.error(safeCliError(error));
      process.exitCode = 1;
    });
}
