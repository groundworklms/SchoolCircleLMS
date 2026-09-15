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

export async function listLearningRecords({ ownerId, type, status } = {}) {
  return db.learningRecord.findMany({
    where: {
      ...(ownerId ? { ownerId } : {}),
      ...(type ? { type } : {}),
      ...(status ? { status } : {}),
    },
    orderBy: { createdAt: 'desc' },
  });
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
      where: { id: { in: ownerIds }, role: 'LEARNER' },
      select: { id: true },
    });
    return new Set(learners.map((user) => user.id));
  };

  return {
    async getStudyPlan({ learnerId, courseId }) {
      const row = await latest({
        ownerId: learnerId,
        type: 'STUDY_PLAN',
        predicate: (value) => payloadOf(value).courseId === courseId,
      });
      return row ? payloadOf(row) : null;
    },
    // Plans must be built from a persisted syllabus. The current core course
    // draft has no due-date source, so do not invent one for Cadence.
    async getStudyPlanInput({ courseId }) {
      const course = await getLearningRecord(courseId);
      if (!course || course.type !== 'COURSE_DRAFT' || course.status !== 'APPROVED') {
        return null;
      }
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
    async saveStudyPlan({ learnerId, courseId, ...result }) {
      return save(learnerId, 'STUDY_PLAN', { courseId, ...result });
    },

    async listLearnerAttempts({ learnerId, courseId }) {
      const rows = await listLearningRecords({ ownerId: learnerId, type: 'MASTERY_ATTEMPT' });
      return rows
        .map((row) => ({ ...payloadOf(row), learnerId }))
        .filter(
          (value) =>
            (!courseId || value.courseId === courseId) &&
            (value.phase === 'pre' || value.phase === 'post') &&
            typeof value.correct === 'boolean',
        );
    },
    async listLearnerMasteryReports({ learnerId, courseId }) {
      const rows = await listLearningRecords({ ownerId: learnerId, type: 'MASTERY_SESSION' });
      return rows.map((row) => {
        const payload = payloadOf(row);
        return {
          ...payload,
          learnerId,
          criteria: payload.report?.criteria || payload.criteria || [],
        };
      })
        .filter((value) => !courseId || value.courseId === courseId);
    },
    async listCohortAttempts({ instructorId, courseId }) {
      const course = await getLearningRecord(courseId);
      if (
        !course ||
        course.type !== 'COURSE_DRAFT' ||
        course.status !== 'APPROVED' ||
        (instructorId && course.ownerId !== instructorId)
      ) {
        return [];
      }
      const rows = await listLearningRecords({ type: 'MASTERY_ATTEMPT' });
      const learnerIds = await learnerOwnerIds(rows);
      return rows
        .map((row) => ({ ...payloadOf(row), learnerId: row.ownerId }))
        .filter(
          (value) =>
            value.courseId === courseId &&
            learnerIds.has(value.learnerId) &&
            (value.phase === 'pre' || value.phase === 'post') &&
            typeof value.correct === 'boolean',
        );
    },
    async listCohortMasteryReports({ instructorId, courseId }) {
      const course = await getLearningRecord(courseId);
      if (
        !course ||
        course.type !== 'COURSE_DRAFT' ||
        course.status !== 'APPROVED' ||
        (instructorId && course.ownerId !== instructorId)
      ) {
        return [];
      }
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
        .filter((value) => learnerIds.has(value.learnerId) && value.courseId === courseId);
    },

    async getAar({ instructorId, courseId }) {
      const row = await latest({
        ownerId: instructorId,
        type: 'AAR',
        predicate: (value) => payloadOf(value).courseId === courseId,
      });
      return row ? payloadOf(row) : null;
    },
    async getAarInput({ instructorId, courseId }) {
      const row = await latest({
        ownerId: instructorId,
        type: 'CRITIQUE_SET',
        predicate: (value) => payloadOf(value).courseId === courseId,
      });
      if (!row) return null;
      const payload = payloadOf(row);
      return { critiques: payload.critiques, courseTitle: payload.courseTitle };
    },
    async saveAar({ instructorId, courseId, ...result }) {
      return save(instructorId, 'AAR', { courseId, ...result });
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

    async getApprovedCourse({ instructorId, courseId }) {
      const row = await getLearningRecord(courseId);
      if (
        !row ||
        row.type !== 'COURSE_DRAFT' ||
        row.status !== 'APPROVED' ||
        (instructorId && row.ownerId !== instructorId)
      ) {
        return null;
      }
      const course = payloadOf(row);
      // Coursewright sections are lesson/pre/post artifacts, not Cartridge
      // items. Keep the source shape intact and let the evidence adapter's
      // explicit projection decide what can be exported.
      return { ...course, id: row.id, approved: true };
    },
    async recordExport({ instructorId, ...result }) {
      return save(instructorId, 'SCORM_EXPORT', result);
    },

    async getFidelityEvaluation({ instructorId, courseId }) {
      const row = await latest({
        ownerId: instructorId,
        type: 'FIDELITY',
        predicate: (value) => payloadOf(value).courseId === courseId,
      });
      return row ? payloadOf(row) : null;
    },
    async getFidelityInput({ instructorId, courseId }) {
      const row = await latest({
        ownerId: instructorId,
        type: 'FIDELITY_CASES',
        predicate: (value) => payloadOf(value).courseId === courseId,
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
      };
    },
    async saveFidelityEvaluation({ instructorId, courseId, ...result }) {
      return save(instructorId, 'FIDELITY', { courseId, ...result });
    },
  };
}
