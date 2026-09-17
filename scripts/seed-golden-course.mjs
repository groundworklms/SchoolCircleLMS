/**
 * Seed the banked golden course (scripts/golden-course.mjs) into a local
 * development database.
 *
 * WHY THIS EXISTS. Grounded chat only opens inside a persisted course with
 * approved sources — `courseForTutor` in lib/learning/core.js resolves the
 * COURSE_DRAFT record, requires a non-empty `sourceIds`, and requires every one
 * of those sources to be an APPROVED SOURCE record with addressable passages.
 * The demo courses in app/prototype/data.js are screen fixtures with no record
 * behind them, so they cannot satisfy that and must not be made to. This script
 * does not touch the gate; it creates a course that legitimately passes it.
 *
 * WHAT IT DOES NOT DO. It does not pre-approve anything a human should approve.
 * Items materialise PENDING, exactly as they do for a generated course, because
 * per-item ratification is the guardrail — and the thing we want to demo.
 *
 * HOW IT STAYS HONEST. Everything after the two record inserts is the
 * production code path: `ingestSource` builds the source payload, `approveSource`
 * applies the real approval preconditions, `validateCourseDraft` checks that
 * every section citation resolves to a persisted passage and that the lesson and
 * questions clear the grounding floor, and `approveCourse` runs the same
 * validation again before materialising the delivery rows. The only deviation is
 * that the two LearningRecord ids are fixed rather than cuids, so a re-run
 * updates the same rows instead of banking a second copy.
 *
 * SAFETY. Same convention as `npm run db:deploy` and prisma/seed.js —
 * SCHOOLCIRCLE_DB_ENV plus a DATABASE_TARGET_CONFIRM that must name the parsed
 * database — with two additions that matter here. The database has to be
 * reachable on loopback, and CLOUD_SQL_CONNECTION_NAME has to be unset: the
 * Cloud SQL connector ignores the URL's host, so a `_dev` database name alone
 * would not tell you the writes were staying on this machine.
 *
 * Run it against a local, already migrated database:
 *
 *   SCHOOLCIRCLE_DB_ENV=development ALLOW_GOLDEN_COURSE_SEED=true \
 *   NODE_ENV=development DATABASE_TARGET_CONFIRM=schoolcircle_dev \
 *   DATABASE_URL=postgresql://…@127.0.0.1:5432/schoolcircle_dev \
 *   npm run db:seed:golden
 *
 * Add GOLDEN_COURSE_OWNER_EXTERNAL_ID=<firebase uid> to hand the course to an
 * instructor who has already signed in, so it appears in their library.
 */
import nextEnv from '@next/env';
import { fileURLToPath } from 'node:url';

import {
  GOLDEN_COURSE_RECORD_ID,
  GOLDEN_SOURCE_RECORD_ID,
  buildGoldenCourseDraft,
  goldenSourceInput,
} from './golden-course.mjs';

/** The seed's own instructor, used when no existing account is named. */
export const GOLDEN_OWNER_ID = 'schoolcircle-golden-instructor';
export const GOLDEN_OWNER_NAME = 'Golden Course Instructor';

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]', '::1']);

export class GoldenSeedPolicyError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GoldenSeedPolicyError';
  }
}

export class GoldenSeedRefusalError extends Error {
  constructor(message) {
    super(message);
    this.name = 'GoldenSeedRefusalError';
  }
}

/**
 * Validate every gate before a Prisma client exists.
 *
 * The URL is parsed only to inspect its host and database path. No URL,
 * username, password, or query string reaches an error message, because these
 * refusals are the ones most likely to end up pasted into a chat log.
 */
export function assertGoldenSeedEnvironment(env = process.env) {
  const dbEnvironment = env.SCHOOLCIRCLE_DB_ENV;
  if (!['development', 'demo', 'test'].includes(dbEnvironment)) {
    throw new GoldenSeedPolicyError(
      'Golden course seed refused: SCHOOLCIRCLE_DB_ENV must be development, demo, or test.',
    );
  }

  if (env.ALLOW_GOLDEN_COURSE_SEED !== 'true') {
    throw new GoldenSeedPolicyError(
      'Golden course seed refused: ALLOW_GOLDEN_COURSE_SEED=true is required.',
    );
  }

  if (
    typeof env.NODE_ENV !== 'string' ||
    env.NODE_ENV.trim().length === 0 ||
    env.NODE_ENV.trim().toLowerCase() === 'production'
  ) {
    throw new GoldenSeedPolicyError(
      'Golden course seed refused: NODE_ENV must be set to a non-production value.',
    );
  }

  // lib/db.js routes every query through the Cloud SQL connector when this is
  // set, and the connector takes the instance from here and the database from
  // the URL path -- the host below would then be describing a connection that
  // is not the one being made.
  if (typeof env.CLOUD_SQL_CONNECTION_NAME === 'string' && env.CLOUD_SQL_CONNECTION_NAME.trim()) {
    throw new GoldenSeedPolicyError(
      'Golden course seed refused: CLOUD_SQL_CONNECTION_NAME is set, so this would write to Cloud SQL.',
    );
  }

  if (typeof env.DATABASE_URL !== 'string' || env.DATABASE_URL.length === 0) {
    throw new GoldenSeedPolicyError(
      'Golden course seed refused: DATABASE_URL is required and was not inspected.',
    );
  }

  let databaseName;
  let host;
  try {
    const url = new URL(env.DATABASE_URL);
    if (!['postgres:', 'postgresql:'].includes(url.protocol)) throw new Error('unsupported protocol');
    host = url.hostname;
    databaseName = decodeURIComponent(url.pathname).replace(/^\/+/, '').replace(/\/+$/, '');
  } catch {
    throw new GoldenSeedPolicyError(
      'Golden course seed refused: DATABASE_URL is not a supported PostgreSQL URL.',
    );
  }

  if (!LOOPBACK_HOSTS.has(host)) {
    throw new GoldenSeedPolicyError(
      'Golden course seed refused: the database must be reachable on loopback.',
    );
  }

  if (!databaseName || !/_(?:dev|demo|test)$/i.test(databaseName)) {
    throw new GoldenSeedPolicyError(
      'Golden course seed refused: the database name must end in _dev, _demo, or _test.',
    );
  }

  if (typeof env.DATABASE_TARGET_CONFIRM !== 'string' || env.DATABASE_TARGET_CONFIRM.length === 0) {
    throw new GoldenSeedPolicyError(
      'Golden course seed refused: DATABASE_TARGET_CONFIRM is required.',
    );
  }

  if (env.DATABASE_TARGET_CONFIRM !== databaseName) {
    throw new GoldenSeedPolicyError(
      'Golden course seed refused: DATABASE_TARGET_CONFIRM must match the parsed database name.',
    );
  }

  return Object.freeze({ dbEnvironment, nodeEnvironment: env.NODE_ENV, databaseName });
}

/**
 * The instructor the banked course belongs to.
 *
 * Point GOLDEN_COURSE_OWNER_EXTERNAL_ID at a signed-in account's Firebase uid
 * and the course lands in that instructor's library, ready to ratify from the
 * review screen. With nothing named, the seed owns a clearly labelled account
 * of its own; the course is still visible to every learner once approved,
 * because visibility follows APPROVED status, not the roster.
 */
async function resolveOwner(db, hasRole, env) {
  const externalId = env.GOLDEN_COURSE_OWNER_EXTERNAL_ID;
  const ownerId = env.GOLDEN_COURSE_OWNER_ID;
  let owner = null;
  if (typeof externalId === 'string' && externalId.trim()) {
    owner = await db.user.findUnique({ where: { externalId: externalId.trim() } });
    if (!owner) {
      throw new GoldenSeedRefusalError(
        'Golden course seed refused: GOLDEN_COURSE_OWNER_EXTERNAL_ID matches no account. Sign in once first.',
      );
    }
  } else if (typeof ownerId === 'string' && ownerId.trim()) {
    owner = await db.user.findUnique({ where: { id: ownerId.trim() } });
    if (!owner) {
      throw new GoldenSeedRefusalError(
        'Golden course seed refused: GOLDEN_COURSE_OWNER_ID matches no account.',
      );
    }
  } else {
    owner = await db.user.upsert({
      where: { id: GOLDEN_OWNER_ID },
      create: { id: GOLDEN_OWNER_ID, name: GOLDEN_OWNER_NAME, role: 'INSTRUCTOR' },
      update: {},
    });
  }
  if (!hasRole(owner.role, 'INSTRUCTOR')) {
    throw new GoldenSeedRefusalError(
      'Golden course seed refused: the named owner is not an instructor, so it could not ratify the items.',
    );
  }
  return owner;
}

/** A record this seed owns, or null. Anything else under the id is refused. */
async function ownedRecord(db, id, type) {
  const record = await db.learningRecord.findUnique({ where: { id } });
  if (!record) return null;
  if (record.type !== type) {
    throw new GoldenSeedRefusalError(
      `Golden course seed refused: ${id} already exists and is not a ${type} record.`,
    );
  }
  return record;
}

function assertOwnedBy(record, owner, what) {
  if (record.ownerId !== owner.id) {
    throw new GoldenSeedRefusalError(
      `Golden course seed refused: the banked ${what} belongs to a different account. Remove it or seed as its owner.`,
    );
  }
}

/**
 * Create or reuse the approved TC 3-22.9 source.
 *
 * The record is written PENDING and then approved through the real
 * `approveSource`, so the same preconditions apply as to an uploaded PDF: there
 * must be source text, and there must be addressable page text for a citation
 * to land on.
 */
async function ensureSource(db, api, identity, owner) {
  const existing = await ownedRecord(db, GOLDEN_SOURCE_RECORD_ID, 'SOURCE');
  if (existing) {
    assertOwnedBy(existing, owner, 'source');
    if (existing.status === 'APPROVED') return { record: existing, created: false };
    await api.approveSource(identity, { params: { id: GOLDEN_SOURCE_RECORD_ID } });
    return { record: await db.learningRecord.findUnique({ where: { id: GOLDEN_SOURCE_RECORD_ID } }), created: false };
  }
  const payload = await api.ingestSource(goldenSourceInput());
  await db.learningRecord.create({
    // A fixed id rather than a cuid: it is what makes a re-run update this
    // source instead of banking a second copy of the same pages.
    data: { id: GOLDEN_SOURCE_RECORD_ID, ownerId: owner.id, type: 'SOURCE', status: 'PENDING', payload },
  });
  await api.approveSource(identity, { params: { id: GOLDEN_SOURCE_RECORD_ID } });
  return { record: await db.learningRecord.findUnique({ where: { id: GOLDEN_SOURCE_RECORD_ID } }), created: true };
}

/**
 * Create or reuse the course draft, then release it through `approveCourse`.
 *
 * Approval is what materialises Course / Section / Item, and it writes every
 * item PENDING. An already-approved banked course is left alone: re-approving
 * would cut a second release and leave the first one's ratifications behind.
 */
async function ensureCourse(db, api, identity, owner, draft) {
  const existing = await ownedRecord(db, GOLDEN_COURSE_RECORD_ID, 'COURSE_DRAFT');
  if (existing) assertOwnedBy(existing, owner, 'course');
  if (existing?.status === 'APPROVED') {
    return { record: existing, approved: false };
  }
  // The payload draftCourseRecord writes: the normalised Coursewright document,
  // plus the source selection and objectives beside it. An unapproved record
  // left by an earlier run is rewritten rather than reused, so the content that
  // was just validated is the content that gets approved.
  const payload = {
    ...api.normaliseCourseIds(draft),
    sourceIds: draft.sourceIds,
    objectives: draft.objectives,
    title: draft.title,
  };
  const record = await db.learningRecord.upsert({
    where: { id: GOLDEN_COURSE_RECORD_ID },
    create: { id: GOLDEN_COURSE_RECORD_ID, ownerId: owner.id, type: 'COURSE_DRAFT', status: 'PENDING', payload },
    update: { payload },
  });
  await api.approveCourse(identity, {
    params: { id: GOLDEN_COURSE_RECORD_ID },
    body: { version: Number.isInteger(record.version) ? record.version : 0 },
  });
  return { record: await db.learningRecord.findUnique({ where: { id: GOLDEN_COURSE_RECORD_ID } }), approved: true };
}

/** Flatten what listDeliveryCourseItems returns -- sections, each with items. */
function reviewSummary(sections) {
  const items = sections.flatMap((section) => section.items);
  const status = { PENDING: 0, APPROVED: 0, REJECTED: 0 };
  for (const item of items) status[item.status] = (status[item.status] || 0) + 1;
  return { sections: sections.length, items: items.length, status };
}

/**
 * Bank the golden course. Returns a summary a human can read back against the
 * gate: the approved source, the approved course, and the PENDING items still
 * waiting on a ratifier.
 */
export async function seedGoldenCourse({ env = process.env } = {}) {
  assertGoldenSeedEnvironment(env);
  // Imported here, not at module top: lib/db.js builds its Prisma client on
  // import, and no client should exist until every gate above has passed.
  const [{ db, listDeliveryCourseItems }, { hasRole }, core, arsenal, revisions] = await Promise.all([
    import('../lib/db.js'),
    import('../lib/auth.js'),
    import('../lib/learning/core.js'),
    import('../lib/arsenal-core.js'),
    import('../lib/learning/course-revisions.js'),
  ]);
  // One surface for the production helpers this seed borrows: the route
  // handlers, the ingestion/validation adapters, and the id normaliser.
  const api = { ...arsenal, ...core, normaliseCourseIds: revisions.normaliseCourseIds };

  try {
    const owner = await resolveOwner(db, hasRole, env);
    const identity = { id: owner.id, role: owner.role };
    const source = await ensureSource(db, api, identity, owner);

    const draft = buildGoldenCourseDraft({ sourceRecordId: source.record.id });
    // The same check draftCourseRecord runs before a draft may be persisted.
    // Refusing here means an ungrounded banked course can never be written,
    // even if someone edits the content module and forgets what it is for.
    const validation = api.validateCourseDraft(api.normaliseCourseIds(draft), { sources: [source.record] });
    if (!validation.valid) {
      throw new GoldenSeedRefusalError(
        `Golden course seed refused: the banked draft is not grounded in its source (${validation.issues.join('; ')}).`,
      );
    }

    const course = await ensureCourse(db, api, identity, owner, draft);
    const deliveryCourseId = course.record.payload?.deliveryCourseId || course.record.id;
    const review = reviewSummary(await listDeliveryCourseItems(deliveryCourseId));

    return Object.freeze({
      ownerId: owner.id,
      sourceRecordId: source.record.id,
      sourceStatus: source.record.status,
      sourcePages: Array.isArray(source.record.payload?.pages) ? source.record.payload.pages.length : 0,
      sourceCreated: source.created,
      courseRecordId: course.record.id,
      courseStatus: course.record.status,
      courseVersion: course.record.version,
      courseApproved: course.approved,
      deliveryCourseId,
      sections: review.sections,
      items: review.items,
      itemStatus: review.status,
    });
  } finally {
    await Promise.resolve(db.$disconnect()).catch(() => {});
  }
}

function safeCliError(error) {
  if (error instanceof GoldenSeedPolicyError || error instanceof GoldenSeedRefusalError) {
    return error.message;
  }
  // Prisma failures can carry the datasource URL; report the shape, not the text.
  return 'Golden course seed failed. Check the target, migration state, and seed guards in docs/CLOUD_POSTGRES.md.';
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // Next loads .env.local for the app; a plain node script does not. Load it the
  // way scripts/database.mjs does, without overriding what the operator set --
  // and only when this file is the entry point, so importing it for a test
  // never pulls a workspace DATABASE_URL into the process.
  nextEnv.loadEnvConfig(process.cwd(), process.env.NODE_ENV !== 'production', {
    info() {}, error() {},
  });
  seedGoldenCourse()
    .then((result) => {
      console.log('Banked golden course seeded.');
      console.log(`  source   ${result.sourceRecordId} (${result.sourceStatus}, ${result.sourcePages} pages)`);
      console.log(`  course   ${result.courseRecordId} (${result.courseStatus}, v${result.courseVersion})`);
      console.log(`  delivery ${result.deliveryCourseId}`);
      console.log(`  items    ${result.items} across ${result.sections} sections — ${result.itemStatus.PENDING} pending, ${result.itemStatus.APPROVED} approved, ${result.itemStatus.REJECTED} rejected`);
      console.log('Items are PENDING on purpose. Ratify them from the instructor review screen.');
    })
    .catch((error) => {
      console.error(safeCliError(error));
      process.exitCode = 1;
    });
}
