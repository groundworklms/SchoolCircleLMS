/**
 * Prisma client singleton.
 *
 * Next.js dev reloads modules on every save; a fresh PrismaClient per reload exhausts the
 * Postgres connection pool within a minute ("too many clients"). Caching it on globalThis
 * survives HMR, and in production a single instance is created once.
 *
 * Two ways to reach Postgres, selected by env -- the schema and every query are identical:
 *
 *   - Plain `DATABASE_URL` (default): local docker-compose, the offline Jetson, any TCP
 *     Postgres. This is the edge/offline path.
 *   - `CLOUD_SQL_CONNECTION_NAME=project:region:instance` (cloud): Firebase App Hosting has
 *     no VPC/private-IP or Cloud SQL socket out of the box, so we go through the Cloud SQL
 *     Node connector -- IAM-authorised, TLS to the instance's public IP, no authorized
 *     networks, no proxy sidecar. `DATABASE_URL` still supplies user/password/database
 *     (its host is ignored); the connector authenticates with Application Default
 *     Credentials (the App Hosting service account, or `gcloud auth ... --update-adc` locally).
 */
import { PrismaClient } from '@prisma/client';
import { projectCourseRows, withPreservedItemStatus } from './learning/project-course.js';
import { selectedDeliveryId } from './learning/delivery.js';

const globalForPrisma = globalThis;

/**
 * A lazy Prisma driver-adapter factory for Cloud SQL. `connector.getOptions()` is async, but
 * Prisma only calls `connect()` on first use, so `db` stays a synchronous export and no
 * route has to await client construction. Packages are imported here, not at module top,
 * so the offline build never loads google-auth.
 */
function cloudSqlAdapter(instanceConnectionName) {
  const url = new URL(process.env.DATABASE_URL);
  return {
    provider: 'postgres',
    adapterName: '@prisma/adapter-pg',
    async connect() {
      const [{ Connector }, { PrismaPg }] = await Promise.all([
        import('@google-cloud/cloud-sql-connector'),
        import('@prisma/adapter-pg'),
      ]);
      const connector = new Connector();
      const opts = await connector.getOptions({
        instanceConnectionName,
        ipType: process.env.CLOUD_SQL_IP_TYPE || 'PUBLIC',
      });
      const factory = new PrismaPg(
        {
          ...opts,
          user: decodeURIComponent(url.username),
          password: decodeURIComponent(url.password),
          database: decodeURIComponent(url.pathname.replace(/^\/+/, '')),
          max: Number(url.searchParams.get('connection_limit')) || 5,
        },
        { schema: url.searchParams.get('schema') || 'public' },
      );
      const adapter = await factory.connect();
      // The connector keeps cert-refresh timers running; stop them with the pool so a
      // script that calls db.$disconnect() can exit.
      const dispose = adapter.dispose.bind(adapter);
      adapter.dispose = async () => {
        await dispose();
        connector.close();
      };
      return adapter;
    },
  };
}

function createClient() {
  const log = process.env.NODE_ENV === 'development' ? ['warn', 'error'] : ['error'];
  const instance = process.env.CLOUD_SQL_CONNECTION_NAME;
  return instance ? new PrismaClient({ log, adapter: cloudSqlAdapter(instance) }) : new PrismaClient({ log });
}

function evidenceReleaseMatches(value, course, releaseId) {
  if (!releaseId) return true;
  return value.releaseId === releaseId || (!value.releaseId && course?.id === releaseId);
}

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = db;
}

/**
 * The instructor's class view -- AGGREGATE by construction. It groups Attempt by section and
 * never selects learnerId, so it cannot return one Marine's answers. The privacy boundary is
 * this query shape, not a UI promise; keep it that way (no learner filter here).
 */
export async function classGaps() {
  // miss rate per section: 1 - (correct / attempts), grouped, no learner identity.
  const rows = await db.$queryRaw`
    SELECT s.title AS section,
           COUNT(a.*)::int AS attempts,
           (1.0 - (SUM(CASE WHEN a.correct THEN 1 ELSE 0 END)::float / NULLIF(COUNT(a.*), 0))) AS "missRate"
    FROM "Attempt" a
    JOIN "Item" i ON i.id = a."itemId"
    JOIN "Section" s ON s.id = i."sectionId"
    GROUP BY s.title
    ORDER BY "missRate" DESC NULLS LAST`;
  return rows;
}

/**
 * JSON integration records are intentionally additive and generic.  They let the
 * adapters persist source pages, draft artifacts, transcripts, and mastery state
 * while the first-class LMS relations remain stable.  Callers must pass the
 * authenticated owner id obtained by auth.js; this module never accepts identity
 * from request headers or payloads.
 */
export async function createLearningRecord({ ownerId, type, status = 'PENDING', payload }) {
  if (!ownerId || !type || payload === undefined) {
    throw new TypeError('ownerId, type, and payload are required');
  }
  return db.learningRecord.create({
    data: { ownerId, type, status, payload },
  });
}

export async function getLearningRecord(id) {
  if (!id || typeof id !== 'string') return null;
  return db.learningRecord.findUnique({ where: { id } });
}

/**
 * Records by id, in one query.
 *
 * Exists so a list view can resolve a per-row reference without a query per
 * row: `listCourses` was doing one findUnique per owned course to look up its
 * pending revision, which with a 3-connection pool serialises into a visibly
 * slow library screen as soon as an instructor owns more than a couple of
 * drafts.
 */
export async function getLearningRecordsByIds(ids) {
  const wanted = [...new Set((Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim()))];
  if (!wanted.length) return new Map();
  const records = await db.learningRecord.findMany({ where: { id: { in: wanted } } });
  return new Map(records.map((record) => [record.id, record]));
}

export async function listLearningRecords({ ownerId, type, status, take } = {}) {
  if (take !== undefined && (!Number.isInteger(take) || take < 1 || take > 10_000)) {
    throw new TypeError('record take must be an integer between 1 and 10000');
  }
  return db.learningRecord.findMany({
    where: {
      ...(ownerId ? { ownerId } : {}),
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
    ...(take === undefined ? {} : { take }),
  });
}

/**
 * Remove a record and, optionally, rows that only exist to serve it.
 *
 * Deliberately narrow: it deletes LearningRecord rows and nothing typed. A
 * typed Course cascades to Section -> Item -> Attempt/Schedule, so deleting one
 * silently destroys learner evidence -- the same reason materialiseCourse
 * refuses to overwrite an existing Course. Callers that want a course gone must
 * prove there is no evidence first (see canHardDeleteCourse) and pass the
 * typed ids explicitly.
 */
export async function deleteLearningRecords(ids, { courseIds = [] } = {}) {
  const recordIds = [...new Set((Array.isArray(ids) ? ids : [])
    .filter((id) => typeof id === 'string' && id.trim())
    .map((id) => id.trim()))];
  if (!recordIds.length && !courseIds.length) return { records: 0, courses: 0 };
  return db.$transaction(async (tx) => {
    let courses = 0;
    for (const courseId of [...new Set(courseIds)]) {
      const deleted = await tx.course.deleteMany({ where: { id: courseId } });
      courses += deleted.count;
    }
    const records = recordIds.length
      ? (await tx.learningRecord.deleteMany({ where: { id: { in: recordIds } } })).count
      : 0;
    return { records, courses };
  });
}

/**
 * Learner evidence a Course delete would cascade away.
 *
 * Attempt and Schedule both hang off Item -> Section -> Course with
 * onDelete: Cascade, so removing the Course row removes them silently. Those
 * are what this counts.
 *
 * Mastery is deliberately NOT counted: it keys on a free-text `section` string
 * with no relation to Section, so it is neither cascaded nor findable by
 * course. Its rows survive a course delete as orphans -- reported separately so
 * a caller can warn rather than pretend the delete was clean.
 */
export async function courseEvidenceCount(courseId) {
  if (!courseId || typeof courseId !== 'string') return { attempts: 0, schedules: 0, total: 0 };
  const where = { item: { section: { courseId } } };
  const [attempts, schedules] = await Promise.all([
    db.attempt.count({ where }),
    db.schedule.count({ where }),
  ]);
  return { attempts, schedules, total: attempts + schedules };
}

export async function updateLearningRecord(id, data) {
  if (!id || typeof id !== 'string') throw new TypeError('record id is required');
  return db.learningRecord.update({ where: { id }, data });
}

/**
 * Compare-and-set for stateful learner records. A turn may spend time in the
 * model while another request advances the same session; only the request
 * holding the version read at the start may commit its new state.
 */
export async function updateLearningRecordIfVersion(id, version, data) {
  if (!id || typeof id !== 'string') throw new TypeError('record id is required');
  if (!Number.isInteger(version) || version < 0) {
    throw new TypeError('record version must be a non-negative integer');
  }
  const result = await db.learningRecord.updateMany({
    where: { id, version },
    data: { ...data, version: { increment: 1 } },
  });
  return result.count === 1;
}

/**
 * Create a pending course revision and publish its root pointer in one
 * transaction. The revision id is generated by the database, so a failed root
 * compare-and-set rolls the newly-created revision back rather than leaving an
 * orphan for a later request to discover. The previous pending revision (when
 * present) is superseded in the same transaction.
 */
export async function createCourseRevisionAtomically({
  courseId,
  ownerId,
  expectedVersion,
  expectedStatus,
  revisionPayload,
  revisionHistoryEntry,
}) {
  if (!courseId || typeof courseId !== 'string') throw new TypeError('course id is required');
  if (!ownerId || typeof ownerId !== 'string') throw new TypeError('course owner is required');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new TypeError('expected course version is required');
  }
  if (typeof expectedStatus !== 'string' || !expectedStatus.trim()) {
    throw new TypeError('expected course status is required');
  }
  if (!revisionPayload || typeof revisionPayload !== 'object') {
    throw new TypeError('revision payload is required');
  }
  if (!revisionHistoryEntry || typeof revisionHistoryEntry !== 'object') {
    throw new TypeError('revision history entry is required');
  }

  const transactionConflict = () => {
    const error = new Error('course revision compare-and-set failed');
    error.code = 'COURSE_REVISION_TRANSACTION_CONFLICT';
    return error;
  };
  const clone = (value) => (value === undefined ? value : structuredClone(value));

  try {
    return await db.$transaction(async (tx) => {
      const current = await tx.learningRecord.findUnique({ where: { id: courseId } });
      if (
        !current ||
        current.type !== 'COURSE_DRAFT' ||
        current.ownerId !== ownerId ||
        current.version !== expectedVersion ||
        current.status !== expectedStatus
      ) {
        return { committed: false };
      }

      const currentPayload =
        current.payload && typeof current.payload === 'object' ? current.payload : {};
      const previousRevisionId =
        typeof currentPayload.pendingRevisionId === 'string' && currentPayload.pendingRevisionId.trim()
          ? currentPayload.pendingRevisionId
          : null;
      let previousRevision = null;
      if (previousRevisionId) {
        previousRevision = await tx.learningRecord.findUnique({
          where: { id: previousRevisionId },
        });
        if (
          !previousRevision ||
          previousRevision.type !== 'COURSE_REVISION' ||
          previousRevision.ownerId !== ownerId ||
          previousRevision.status !== 'PENDING' ||
          previousRevision.payload?.courseId !== courseId ||
          previousRevision.payload?.reviewedVersion !== expectedVersion
        ) {
          return { committed: false };
        }
      }

      const revision = await tx.learningRecord.create({
        data: {
          ownerId,
          type: 'COURSE_REVISION',
          status: 'PENDING',
          payload: revisionPayload,
        },
      });
      const history = Array.isArray(currentPayload.revisionHistory)
        ? clone(currentPayload.revisionHistory)
        : [];
      if (previousRevisionId) {
        for (const entry of history) {
          if (entry?.id === previousRevisionId && entry.status === 'PENDING') {
            entry.status = 'SUPERSEDED';
          }
        }
      }
      const summary = {
        ...clone(revisionHistoryEntry),
        id: revision.id,
        status: revision.status,
        ...(revision.createdAt ? { createdAt: new Date(revision.createdAt).toISOString() } : {}),
        ...(revision.updatedAt ? { updatedAt: new Date(revision.updatedAt).toISOString() } : {}),
      };
      history.push(summary);
      const changed = await tx.learningRecord.updateMany({
        where: {
          id: courseId,
          ownerId,
          type: 'COURSE_DRAFT',
          status: expectedStatus,
          version: expectedVersion,
        },
        data: {
          payload: {
            ...clone(currentPayload),
            pendingRevisionId: revision.id,
            revisionHistory: history,
          },
          version: { increment: 1 },
        },
      });
      if (changed.count !== 1) throw transactionConflict();

      if (previousRevision) {
        const superseded = await tx.learningRecord.updateMany({
          where: {
            id: previousRevision.id,
            ownerId,
            type: 'COURSE_REVISION',
            status: 'PENDING',
          },
          data: { status: 'SUPERSEDED' },
        });
        if (superseded.count !== 1) throw transactionConflict();
      }
      return {
        committed: true,
        revision,
        revisionHistory: history,
        version: expectedVersion + 1,
      };
    });
  } catch (error) {
    if (error?.code === 'COURSE_REVISION_TRANSACTION_CONFLICT') {
      return { committed: false };
    }
    throw error;
  }
}

/**
 * Legacy one-shot materialisation seam. New approvals use
 * approveCourseAtomically below so every replacement gets a new immutable
 * delivery id. This helper intentionally refuses an existing Course rather
 * than deleting its sections/items and cascading its Attempts/Schedules.
 */
/**
 * Read back any human decision already recorded against the item ids about to
 * be written, so a rewrite cannot quietly un-ratify reviewed content.
 */
async function recordedItemStatuses(tx, sections) {
  const ids = (Array.isArray(sections) ? sections : [])
    .flatMap((section) => (Array.isArray(section?.items) ? section.items : []))
    .map((item) => item?.id)
    .filter((id) => typeof id === 'string' && id);
  if (ids.length === 0) return new Map();
  const rows = await tx.item.findMany({ where: { id: { in: ids } }, select: { id: true, status: true } });
  return new Map(rows.map((row) => [row.id, row.status]));
}

export async function materialiseCourse({ course, sections }) {
  if (!course?.id || typeof course.id !== 'string') throw new TypeError('course.id is required');
  return db.$transaction(async (tx) => {
    const existing = await tx.course.findUnique({ where: { id: course.id } });
    if (existing) {
      throw new Error('Course delivery already exists; approve a replacement release atomically.');
    }
    await tx.course.create({
      data: { id: course.id, title: course.title, sourceId: course.sourceId },
    });
    const ratified = await recordedItemStatuses(tx, sections);
    sections = withPreservedItemStatus(sections, ratified);
    for (const section of sections) {
      await tx.section.create({
        data: {
          id: section.id,
          courseId: course.id,
          title: section.title,
          order: section.order,
          items: {
            create: section.items.map((item) => ({
              id: item.id,
              kind: item.kind,
              stem: item.stem,
              options: item.options ?? undefined,
              answer: item.answer ?? undefined,
              rationale: item.rationale ?? undefined,
              citation: item.citation ?? undefined,
              status: item.status,
            })),
          },
        },
      });
    }
    return { courseId: course.id, sections: sections.length, items: sections.reduce((n, s) => n + s.items.length, 0) };
  });
}

/**
 * Atomically approve a reviewed Coursewright snapshot.
 *
 * Initial approval uses the LearningRecord id as its delivery Course id for
 * backwards compatibility. A revision of an already approved course gets a
 * new immutable delivery id instead. Existing Course/Section/Item rows are
 * never deleted or updated, so Attempts and Schedules continue to point at
 * the release they were earned against while the new release is materialised
 * beside it. The authoring record's deliveryCourseId points at the replacement
 * for consumers that need the current release.
 *
 * The LearningRecord compare-and-set and the replacement materialisation are
 * in one Prisma transaction. A stale approval rolls back before any typed row
 * can be made visible.
 */
export async function approveCourseAtomically({
  courseId,
  expectedVersion,
  ownerId,
  candidatePayload,
  sourceId,
  sections,
  revisionId = null,
  revisionHistory = [],
}) {
  if (!courseId || typeof courseId !== 'string') throw new TypeError('course id is required');
  if (!Number.isInteger(expectedVersion) || expectedVersion < 0) {
    throw new TypeError('expected course version is required');
  }
  if (!ownerId || typeof ownerId !== 'string') throw new TypeError('course owner is required');
  if (!candidatePayload || typeof candidatePayload !== 'object') {
    throw new TypeError('candidate payload is required');
  }
  if (!Array.isArray(sections)) throw new TypeError('materialised sections are required');

  return db.$transaction(async (tx) => {
    const current = await tx.learningRecord.findUnique({ where: { id: courseId } });
    if (
      !current ||
      current.type !== 'COURSE_DRAFT' ||
      current.ownerId !== ownerId ||
      current.version !== expectedVersion
    ) {
      return { committed: false };
    }

    const priorPayload =
      current.payload && typeof current.payload === 'object' ? current.payload : {};
    if (revisionId && priorPayload.pendingRevisionId !== revisionId) {
      return { committed: false };
    }
    if (revisionId) {
      const pending = await tx.learningRecord.findUnique({ where: { id: revisionId } });
      if (
        !pending ||
        pending.type !== 'COURSE_REVISION' ||
        pending.ownerId !== ownerId ||
        pending.status !== 'PENDING' ||
        pending.payload?.reviewedVersion !== expectedVersion
      ) {
        return { committed: false };
      }
    }
    const hadRelease =
      current.status === 'APPROVED' ||
      (typeof priorPayload.deliveryCourseId === 'string' && priorPayload.deliveryCourseId.trim());
    const deliveryCourseId = hadRelease
      ? `${courseId}:release:${revisionId || expectedVersion + 1}`
      : courseId;
    const nextPayload = {
      ...priorPayload,
      ...candidatePayload,
      deliveryCourseId,
      revisionHistory,
    };
    delete nextPayload.pendingRevisionId;

    // CAS before creating typed rows. If another approval wins, this
    // transaction returns false and all following work is skipped.
    const changed = await tx.learningRecord.updateMany({
      where: { id: courseId, ownerId, version: expectedVersion },
      data: {
        status: 'APPROVED',
        payload: nextPayload,
        version: { increment: 1 },
      },
    });
    if (changed.count !== 1) return { committed: false };

    const projected = projectCourseRows(deliveryCourseId, candidatePayload, { sourceId }).sections;
    const materialised = {
      course: {
        id: deliveryCourseId,
        title: candidatePayload.title || candidatePayload.course?.title || 'Untitled course',
        sourceId: sourceId || 'unknown',
      },
      // Items arrive PENDING from the generator; a status a human already
      // recorded for the same id outranks that proposal.
      sections: withPreservedItemStatus(projected, await recordedItemStatuses(tx, projected)),
    };
    await tx.course.create({
      data: {
        id: materialised.course.id,
        title: materialised.course.title,
        sourceId: materialised.course.sourceId,
      },
    });
    for (const section of materialised.sections) {
      await tx.section.create({
        data: {
          id: section.id,
          courseId: materialised.course.id,
          title: section.title,
          order: section.order,
          items: {
            create: section.items.map((item) => ({
              id: item.id,
              kind: item.kind,
              stem: item.stem,
              options: item.options ?? undefined,
              answer: item.answer ?? undefined,
              rationale: item.rationale ?? undefined,
              citation: item.citation ?? undefined,
              status: item.status,
            })),
          },
        },
      });
    }

    if (revisionId) {
      const revision = await tx.learningRecord.findUnique({ where: { id: revisionId } });
      await tx.learningRecord.update({
        where: { id: revisionId },
        data: {
          status: 'APPROVED',
          payload: {
            ...(revision?.payload && typeof revision.payload === 'object' ? revision.payload : {}),
            approvedVersion: expectedVersion + 1,
          },
        },
      });
    }
    return {
      committed: true,
      version: expectedVersion + 1,
      deliveryCourseId,
      materialised: {
        courseId: deliveryCourseId,
        sections: materialised.sections.length,
        items: materialised.sections.reduce((total, section) => total + section.items.length, 0),
      },
    };
  });
}

/**
 * Every materialised item of one delivery course, in reading order, with the
 * review fields an instructor needs: status, the citation that grounds it and
 * the HHEM support score when one was recorded. Unlike the learner-facing
 * queries this deliberately does NOT filter by status — reviewing PENDING
 * content is the whole point.
 */
export async function listDeliveryCourseItems(deliveryCourseId) {
  if (typeof deliveryCourseId !== 'string' || !deliveryCourseId.trim()) {
    throw new TypeError('deliveryCourseId is required');
  }
  const sections = await db.section.findMany({
    where: { courseId: deliveryCourseId },
    orderBy: { order: 'asc' },
    include: {
      items: {
        orderBy: { createdAt: 'asc' },
        select: {
          id: true, kind: true, stem: true, options: true, answer: true,
          rationale: true, citation: true, support: true, status: true,
        },
      },
    },
  });
  return sections.map((section) => ({
    id: section.id,
    title: section.title,
    order: section.order,
    items: section.items,
  }));
}

/**
 * One materialised item, scoped to its delivery course. The compound where
 * clause is the authorisation boundary: an item id from another course is not
 * readable through a course the caller owns.
 */
export async function getDeliveryCourseItem(deliveryCourseId, itemId) {
  if (typeof deliveryCourseId !== 'string' || !deliveryCourseId.trim()) {
    throw new TypeError('deliveryCourseId is required');
  }
  if (typeof itemId !== 'string' || !itemId.trim()) throw new TypeError('itemId is required');
  return db.item.findFirst({
    where: { id: itemId, section: { courseId: deliveryCourseId } },
    select: {
      id: true, kind: true, stem: true, options: true, answer: true,
      rationale: true, citation: true, support: true, status: true,
    },
  });
}

/**
 * Apply an instructor's decision to one item, scoped to the delivery course it
 * belongs to. The compound where clause is the authorisation boundary: an item
 * id from another course cannot be written through a course the caller owns.
 */
export async function updateDeliveryCourseItem(deliveryCourseId, itemId, data) {
  if (typeof deliveryCourseId !== 'string' || !deliveryCourseId.trim()) {
    throw new TypeError('deliveryCourseId is required');
  }
  if (typeof itemId !== 'string' || !itemId.trim()) throw new TypeError('itemId is required');
  const changed = await db.item.updateMany({
    where: { id: itemId, section: { courseId: deliveryCourseId } },
    data,
  });
  if (changed.count !== 1) return null;
  return db.item.findUnique({
    where: { id: itemId },
    select: {
      id: true, kind: true, stem: true, options: true, answer: true,
      rationale: true, citation: true, support: true, status: true,
    },
  });
}

/**
 * Cohort reports use the course's approved shared plan as their join key.
 * Legacy sessions and sessions for another approved source remain persisted
 * and learner-visible, but cannot enter that shared-plan rollup.
 */
export function matchesApprovedMasteryPlan(session, coursePlan) {
  if (!coursePlan || typeof coursePlan !== 'object' || coursePlan.status !== 'APPROVED') {
    return true;
  }
  return (
    typeof coursePlan.revision === 'string' &&
    typeof coursePlan.sourceId === 'string' &&
    session?.masteryPlanRevision === coursePlan.revision &&
    session?.sourceId === coursePlan.sourceId
  );
}

/**
 * Persistence bridge for the evidence route factory.  It scopes every learner
 * operation by the id supplied by the verified auth boundary.  The evidence
 * adapter remains pure and can still be contract-tested with an in-memory
 * store; production mounting uses this Prisma implementation.
 */
export function createLearningEvidenceStore() {
  const latest = async ({ ownerId, type, predicate } = {}) => {
    const rows = await listLearningRecords({ ownerId, type });
    return rows.find((row) => !predicate || predicate(row)) || null;
  };
  const payloadOf = (row) => (row?.payload && typeof row.payload === 'object' ? row.payload : {});
  const save = async (ownerId, type, payload, status = 'RECORDED') =>
    createLearningRecord({ ownerId, type, status, payload });
  const learnerOwnerIds = async (rows) => {
    const ownerIds = [...new Set(
      rows
        .map((row) => row?.ownerId)
        .filter((ownerId) => ownerId != null && String(ownerId).trim())
        .map(String),
    )];
    if (!ownerIds.length) return new Set();
    const learners = await db.user.findMany({
      // BOTH users have learner capability as well as instructor capability.
      where: { id: { in: ownerIds }, role: { in: ['LEARNER', 'BOTH'] } },
      select: { id: true },
    });
    return new Set(learners.map((user) => user.id));
  };
  const selectedReleaseFor = async (courseId, requestedReleaseId) => {
    if (!courseId) return { course: null, releaseId: requestedReleaseId };
    const course = await getLearningRecord(courseId);
    if (!course || course.type !== 'COURSE_DRAFT' || course.status !== 'APPROVED') {
      return { course: null, releaseId: null };
    }
    const selected = selectedDeliveryId(course, requestedReleaseId);
    return {
      course,
      releaseId: selected,
      valid: !requestedReleaseId || Boolean(selected),
    };
  };

  return {
    async getStudyPlan({ learnerId, courseId, releaseId }) {
      const selected = await selectedReleaseFor(courseId, releaseId);
      if (!selected.valid) return null;
      const row = await latest({
        ownerId: learnerId,
        type: 'STUDY_PLAN',
        predicate: (value) =>
          payloadOf(value).courseId === courseId &&
          evidenceReleaseMatches(payloadOf(value), selected.course, selected.releaseId),
      });
      return row ? payloadOf(row) : null;
    },
    // Plans must be built from a persisted syllabus. The current core course
    // draft has no due-date source, so do not invent one for Cadence.
    async getStudyPlanInput({ courseId, releaseId }) {
      const course = await getLearningRecord(courseId);
      if (!course || course.type !== 'COURSE_DRAFT' || course.status !== 'APPROVED') {
        return null;
      }
      const selectedRelease = selectedDeliveryId(course, releaseId);
      if (releaseId && !selectedRelease) return null;
      const payload = payloadOf(course);
      if (!Array.isArray(payload.syllabus) || payload.syllabus.length === 0) {
        return null;
      }
      return {
        syllabus: payload.syllabus,
        asOf: payload.asOf,
        availability: payload.availability,
        status: payload.studyStatus,
      };
    },
    async saveStudyPlan({ learnerId, courseId, releaseId, ...result }) {
      const selected = await selectedReleaseFor(courseId, releaseId);
      if (!selected.valid) return null;
      return save(learnerId, 'STUDY_PLAN', {
        courseId,
        ...(selected.releaseId ? { releaseId: selected.releaseId } : {}),
        ...result,
      });
    },

    async listLearnerAttempts({ learnerId, courseId, releaseId }) {
      const rows = await listLearningRecords({ ownerId: learnerId, type: 'MASTERY_ATTEMPT' });
      const selected = await selectedReleaseFor(courseId, releaseId);
      if (!selected.valid) return [];
      return rows
        .map((row) => ({ ...payloadOf(row), learnerId }))
        .filter(
          (value) =>
            (!courseId || value.courseId === courseId) &&
            evidenceReleaseMatches(value, selected.course, selected.releaseId) &&
            (value.phase === 'pre' || value.phase === 'post') &&
            typeof value.correct === 'boolean',
        );
    },
    async listLearnerMasteryReports({ learnerId, courseId, releaseId }) {
      const rows = await listLearningRecords({ ownerId: learnerId, type: 'MASTERY_SESSION' });
      const selected = await selectedReleaseFor(courseId, releaseId);
      if (!selected.valid) return [];
      return rows.map((row) => {
        const payload = payloadOf(row);
        return {
          ...payload,
          learnerId,
          criteria: payload.report?.criteria || payload.criteria || [],
        };
      })
        .filter(
          (value) =>
            (!courseId || value.courseId === courseId) &&
            evidenceReleaseMatches(value, selected.course, selected.releaseId),
        );
    },
    async listCohortAttempts({ instructorId, courseId, releaseId }) {
      const course = await getLearningRecord(courseId);
      if (
        !course ||
        course.type !== 'COURSE_DRAFT' ||
        course.status !== 'APPROVED' ||
        (instructorId && course.ownerId !== instructorId)
      ) {
        return [];
      }
      const selectedReleaseId = selectedDeliveryId(course, releaseId);
      if (releaseId && !selectedReleaseId) return [];
      const rows = await listLearningRecords({ type: 'MASTERY_ATTEMPT' });
      const learnerIds = await learnerOwnerIds(rows);
      return rows
        .map((row) => ({ ...payloadOf(row), learnerId: row.ownerId }))
        .filter(
          (value) =>
            value.courseId === courseId &&
            evidenceReleaseMatches(value, course, selectedReleaseId) &&
            learnerIds.has(value.learnerId) &&
            (value.phase === 'pre' || value.phase === 'post') &&
            typeof value.correct === 'boolean',
        );
    },
    async listCohortMasteryReports({ instructorId, courseId, releaseId }) {
      const course = await getLearningRecord(courseId);
      if (
        !course ||
        course.type !== 'COURSE_DRAFT' ||
        course.status !== 'APPROVED' ||
        (instructorId && course.ownerId !== instructorId)
      ) {
        return [];
      }
      // Once a course has an approved shared plan, cohort rollups may only
      // compare sessions that explicitly carry that exact revision and source.
      // Legacy rows remain stored and remain visible to their learner owners,
      // but must not be merged into the instructor's shared-plan report.
      const coursePlan = payloadOf(course).masteryPlan;
      const approvedPlan =
        coursePlan &&
        typeof coursePlan === 'object' &&
        coursePlan.status === 'APPROVED'
          ? coursePlan
          : null;
      const selectedReleaseId = selectedDeliveryId(course, releaseId);
      if (releaseId && !selectedReleaseId) return [];
      const rows = await listLearningRecords({ type: 'MASTERY_SESSION' });
      const learnerIds = await learnerOwnerIds(rows);
      return rows
        .map((row) => {
          const payload = payloadOf(row);
          return {
            ...payload,
            learnerId: row.ownerId,
            criteria: payload.report?.criteria || payload.criteria || [],
          };
        })
        .filter(
          (value) =>
            learnerIds.has(value.learnerId) &&
            value.courseId === courseId &&
            evidenceReleaseMatches(value, course, selectedReleaseId) &&
            matchesApprovedMasteryPlan(value, approvedPlan),
        );
    },

    async getAar({ instructorId, courseId, releaseId }) {
      const selected = await selectedReleaseFor(courseId, releaseId);
      if (!selected.valid) return null;
      const row = await latest({
        ownerId: instructorId,
        type: 'AAR',
        predicate: (value) =>
          payloadOf(value).courseId === courseId &&
          evidenceReleaseMatches(payloadOf(value), selected.course, selected.releaseId),
      });
      return row ? payloadOf(row) : null;
    },
    async getAarInput({ instructorId, courseId, releaseId }) {
      const selected = await selectedReleaseFor(courseId, releaseId);
      if (!selected.valid) return null;
      const row = await latest({
        ownerId: instructorId,
        type: 'CRITIQUE_SET',
        predicate: (value) =>
          payloadOf(value).courseId === courseId &&
          evidenceReleaseMatches(payloadOf(value), selected.course, selected.releaseId),
      });
      if (!row) return null;
      const payload = payloadOf(row);
      return {
        critiques: payload.critiques,
        courseTitle: payload.courseTitle,
        releaseId: selected.releaseId,
      };
    },
    async saveAar({ instructorId, courseId, releaseId, ...result }) {
      const selected = await selectedReleaseFor(courseId, releaseId);
      if (!selected.valid) return null;
      return save(instructorId, 'AAR', {
        courseId,
        ...(selected.releaseId ? { releaseId: selected.releaseId } : {}),
        ...result,
      });
    },

    async getLearnerProfile({ learnerId }) {
      const row = await latest({ ownerId: learnerId, type: 'PROFILE' });
      return row ? payloadOf(row) : null;
    },
    async saveLearnerProfile({ learnerId, responses, profile, recommendations }) {
      return save(learnerId, 'PROFILE', { responses, profile, recommendations });
    },
    async listCohortProfiles({ instructorId, courseId } = {}) {
      const course = await getLearningRecord(courseId);
      if (
        !course ||
        course.type !== 'COURSE_DRAFT' ||
        course.status !== 'APPROVED' ||
        (instructorId && course.ownerId !== instructorId)
      ) {
        return [];
      }
      const memberIds = new Set();
      const sessionRows = await listLearningRecords({ type: 'MASTERY_SESSION' });
      for (const row of sessionRows) {
        if (payloadOf(row).courseId === courseId) memberIds.add(row.ownerId);
      }
      const attemptRows = await listLearningRecords({ type: 'MASTERY_ATTEMPT' });
      for (const row of attemptRows) {
        if (payloadOf(row).courseId === courseId) memberIds.add(row.ownerId);
      }
      const learnerIds = await learnerOwnerIds([
        ...sessionRows.filter((row) => payloadOf(row).courseId === courseId),
        ...attemptRows.filter((row) => payloadOf(row).courseId === courseId),
      ]);
      const rows = await listLearningRecords({ type: 'PROFILE' });
      return rows
        .filter((row) => memberIds.has(row.ownerId) && learnerIds.has(row.ownerId))
        .map((row) => ({
          learnerId: row.ownerId,
          profile: payloadOf(row).profile,
        }))
        .filter((entry) => entry.profile);
    },

    async getApprovedCourse({ instructorId, courseId, releaseId }) {
      const row = await getLearningRecord(courseId);
      if (
        !row ||
        row.type !== 'COURSE_DRAFT' ||
        row.status !== 'APPROVED' ||
        (instructorId && row.ownerId !== instructorId)
      ) {
        return null;
      }
      const payload = payloadOf(row);
      const currentRelease =
        typeof payload.deliveryCourseId === 'string' && payload.deliveryCourseId.trim()
          ? payload.deliveryCourseId
          : row.id;
      const knownReleases = new Set([row.id, currentRelease]);
      if (Array.isArray(payload.revisionHistory)) {
        for (const entry of payload.revisionHistory) {
          if (typeof entry?.deliveryCourseId === 'string' && entry.deliveryCourseId.trim()) {
            knownReleases.add(entry.deliveryCourseId);
          }
        }
      }
      const selectedRelease = releaseId || currentRelease;
      if (!knownReleases.has(selectedRelease)) return null;
      const delivery = await db.course.findUnique({
        where: { id: selectedRelease },
        include: {
          sections: {
            orderBy: { order: 'asc' },
            include: {
              items: {
                where: { status: 'APPROVED' },
                orderBy: { createdAt: 'asc' },
              },
            },
          },
        },
      });
      if (delivery) {
        return {
          id: delivery.id,
          title: delivery.title,
          sourceId: delivery.sourceId,
          approved: true,
          sections: delivery.sections,
        };
      }
      if (selectedRelease !== currentRelease) return null;
      // Coursewright sections are lesson/pre/post artifacts, not Cartridge
      // items. Keep the source shape intact and let the evidence adapter's
      // explicit projection decide what can be exported.
      return { ...payload, id: selectedRelease, approved: true };
    },
    async recordExport({ instructorId, ...result }) {
      return save(instructorId, 'SCORM_EXPORT', result);
    },

    async getFidelityEvaluation({ instructorId, courseId, releaseId }) {
      const selected = await selectedReleaseFor(courseId, releaseId);
      if (!selected.valid) return null;
      const row = await latest({
        ownerId: instructorId,
        type: 'FIDELITY',
        predicate: (value) =>
          payloadOf(value).courseId === courseId &&
          evidenceReleaseMatches(payloadOf(value), selected.course, selected.releaseId),
      });
      return row ? payloadOf(row) : null;
    },
    async getFidelityInput({ instructorId, courseId, releaseId }) {
      const selected = await selectedReleaseFor(courseId, releaseId);
      if (!selected.valid) return null;
      const row = await latest({
        ownerId: instructorId,
        type: 'FIDELITY_CASES',
        predicate: (value) =>
          payloadOf(value).courseId === courseId &&
          evidenceReleaseMatches(payloadOf(value), selected.course, selected.releaseId),
      });
      if (!row) return null;
      const payload = payloadOf(row);
      const sourceIds = Array.isArray(payload.sourceIds) ? payload.sourceIds : [];
      const sources = await Promise.all(sourceIds.map((id) => getLearningRecord(id)));
      const doctrine = sources
        .filter((source) => source?.type === 'SOURCE' && source.status === 'APPROVED')
        .flatMap((source) => {
          const body = payloadOf(source);
          return Array.isArray(body.chunks) && body.chunks.length
            ? body.chunks.map((chunk) => ({
                text: chunk.text,
                source: `${source.id} p.${chunk.page || 1}`,
                sourceId: body.sourceId || null,
              }))
            : [];
        });
      if (!doctrine.length) return null;
      return {
        cases: payload.cases,
        persona: payload.persona,
        doctrine,
        k: payload.k,
        strict: payload.strict,
        groundingThreshold: payload.groundingThreshold,
        releaseId: selected.releaseId,
      };
    },
    async saveFidelityEvaluation({ instructorId, courseId, releaseId, ...result }) {
      const selected = await selectedReleaseFor(courseId, releaseId);
      if (!selected.valid) return null;
      return save(instructorId, 'FIDELITY', {
        courseId,
        ...(selected.releaseId ? { releaseId: selected.releaseId } : {}),
        ...result,
      });
    },
  };
}
