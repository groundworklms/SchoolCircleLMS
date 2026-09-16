/**
 * Learning-evidence handlers: Cadence study plans, Sextant analytics, Hotwash
 * AARs, Waypoint profiles, Cartridge SCORM export, and the Understudy fidelity
 * benchmark (docs/learning-evidence-api.md).
 *
 * `createEvidenceHandlers({ store, model })` returns plain functions that take
 * the verified identity and parsed request pieces; the route files in
 * app/api/learning wire them up. Persistence goes through the `store` seam
 * (lib/db.js `createLearningEvidenceStore` in production, in-memory in tests)
 * and the model is injected explicitly -- no environment key or package
 * default is ever read here. Every id in a request is a COURSE id; learner
 * identity always comes from the verified identity, never the client.
 */
import {
  COHORT_MIN,
  EvidenceError,
  buildAar,
  buildAnalytics,
  buildApprovedScorm,
  buildCohortProfile,
  buildProfile,
  buildStudyPlan,
  evaluateFidelity,
} from '../arsenal-evidence.js';
import { hasRole } from '../auth.js';
import { createLearningEvidenceStore } from '../db.js';
import { askJSON, askText, providerStatus } from '../model.js';

function requiredQuery(query, name) {
  const value = query?.[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new EvidenceError(`${name} is required`, 'INVALID_REQUEST', 400);
  }
  return value.trim();
}

function requiredBodyString(body, name) {
  const value = body?.[name];
  if (typeof value !== 'string' || !value.trim()) {
    throw new EvidenceError(`${name} is required`, 'INVALID_REQUEST', 400);
  }
  return value.trim();
}

function cohortRows(value, key) {
  if (Array.isArray(value)) {
    const learnerIds = new Set(
      value
        .map((row) => row?.learnerId)
        .filter((id) => id != null && String(id).trim())
        .map((id) => String(id)),
    );
    return {
      rows: value,
      learnerIds,
      distinctLearnerCount: learnerIds.size,
    };
  }
  const rows = Array.isArray(value?.[key]) ? value[key] : [];
  const learnerIds = new Set(
    rows
      .map((row) => row?.learnerId)
      .filter((id) => id != null && String(id).trim())
      .map((id) => String(id)),
  );
  if (Array.isArray(value?.learnerIds)) {
    for (const id of value.learnerIds) {
      if (id != null && String(id).trim()) learnerIds.add(String(id));
    }
  }
  return {
    rows,
    learnerIds,
    distinctLearnerCount: learnerIds.size || (Number.isInteger(value?.distinctLearnerCount)
      ? value.distinctLearnerCount
      : Number.isInteger(value?.learnerCount) ? value.learnerCount : undefined),
  };
}

function unionDistinctLearnerCount(...results) {
  const learnerIds = new Set();
  let hasUnknownMembership = false;
  for (const result of results) {
    for (const learnerId of result.learnerIds) learnerIds.add(learnerId);
    if (!result.learnerIds.size && Number.isInteger(result.distinctLearnerCount)) {
      // Count-only populations cannot be unioned safely: the same learner may
      // occur in both responses. Ignore the unknown population rather than
      // adding counts and potentially lifting the privacy threshold.
      hasUnknownMembership = true;
    }
  }
  return hasUnknownMembership ? undefined : learnerIds.size;
}

function requireInstructor(identity) {
  if (!hasRole(identity?.role, 'INSTRUCTOR')) {
    throw new EvidenceError('Instructor access is required', 'FORBIDDEN', 403);
  }
}

/**
 * The configured SchoolCircle model, in the `({ system, user, schema, json }) => data`
 * shape the evidence adapters accept. JSON is the default for structured agents;
 * `json: false` is the explicit prose contract used by Hotwash. Undefined when
 * no provider is configured, which makes Understudy explicitly unavailable and
 * Hotwash heuristic-only.
 */
export function configuredEvidenceModel() {
  if (!providerStatus().ready) return undefined;
  return async ({ system, user, schema, json = true }) => {
    if (json === false) {
      const result = await askText({
        system,
        prompt: user,
      });
      return result.data;
    }
    const result = await askJSON({
      system,
      prompt: user,
      schema: schema || { type: 'object', additionalProperties: true },
    });
    return result.data;
  };
}

export function createEvidenceHandlers({ store, model } = {}) {
  if (!store || typeof store !== 'object') throw new TypeError('createEvidenceHandlers: store is required');

  async function storeCall(name, args) {
    if (typeof store[name] !== 'function') {
      throw new EvidenceError(
        `Persistence seam store.${name} is not configured`,
        'STORE_SEAM_MISSING',
        501,
      );
    }
    return store[name](args);
  }

  async function cohortAnalytics(instructorId, courseId) {
    const attemptResult = cohortRows(
      await storeCall('listCohortAttempts', { instructorId, courseId }),
      'attempts',
    );
    const sessionResult = cohortRows(
      await storeCall('listCohortMasteryReports', { instructorId, courseId }),
      'sessions',
    );
    return {
      scope: 'cohort',
      ...buildAnalytics({
        attempts: attemptResult.rows,
        sessions: sessionResult.rows,
        minCohort: COHORT_MIN,
        cohort: true,
        distinctLearnerCount: unionDistinctLearnerCount(attemptResult, sessionResult),
      }),
    };
  }

  return {
    /* ---------------- study plan (Cadence) ---------------- */

    async getStudyPlan(identity, { query }) {
      const courseId = requiredQuery(query, 'courseId');
      const record = await storeCall('getStudyPlan', { learnerId: identity.id, courseId });
      if (!record) throw new EvidenceError('No saved study plan', 'STUDY_PLAN_NOT_FOUND', 404);
      const format = query.format || 'json';
      if (format === 'ics') {
        if (typeof record.ics !== 'string') {
          throw new EvidenceError('Saved study plan has no ICS export', 'ICS_NOT_FOUND', 404);
        }
        return { body: record.ics, headers: { 'content-type': 'text/calendar; charset=utf-8' } };
      }
      if (format === 'reminders') return { json: { reminders: record.reminders ?? [] } };
      if (format !== 'json') {
        throw new EvidenceError('format must be json, ics, or reminders', 'INVALID_REQUEST', 400);
      }
      return { json: record };
    },

    async createStudyPlan(identity, { body }) {
      const learnerId = identity.id;
      const courseId = requiredBodyString(body, 'courseId');
      const source = await storeCall('getStudyPlanInput', { learnerId, courseId });
      if (!source || !Array.isArray(source.syllabus)) {
        throw new EvidenceError('Persistence did not return a course syllabus', 'SYLLABUS_NOT_FOUND', 404);
      }
      const asOf = body?.asOf || source.asOf;
      if (!asOf) throw new EvidenceError('asOf is required', 'INVALID_REQUEST', 400);
      const availability = body?.availability ?? source.availability ?? 60;
      const built = buildStudyPlan({
        syllabus: source.syllabus,
        availability,
        asOf,
        status: body?.status ?? source.status,
        ics: body?.ics ?? {},
      });
      await storeCall('saveStudyPlan', {
        learnerId,
        courseId,
        input: { asOf, availability },
        ...built,
      });
      return { status: 201, json: { ...built, persisted: true } };
    },

    /* ---------------- analytics (Sextant) ---------------- */

    async getAnalytics(identity, { query }) {
      const courseId = query.courseId;
      const scope = query.scope || 'learner';
      if (scope !== 'learner' && scope !== 'cohort') {
        throw new EvidenceError('scope must be learner or cohort', 'INVALID_REQUEST', 400);
      }
      if (scope === 'cohort') {
        requireInstructor(identity);
        return { json: await cohortAnalytics(identity.id, courseId) };
      }
      const learnerId = identity.id;
      const attempts = await storeCall('listLearnerAttempts', { learnerId, courseId });
      const sessions = await storeCall('listLearnerMasteryReports', { learnerId, courseId });
      return {
        json: {
          scope,
          ...buildAnalytics({
            attempts: attempts ?? [],
            sessions: sessions ?? [],
            minCohort: COHORT_MIN,
          }),
        },
      };
    },

    // Explicit cohort URL for clients that prefer a path-level instructor guard.
    async getCohortAnalytics(identity, { query }) {
      requireInstructor(identity);
      return { json: await cohortAnalytics(identity.id, requiredQuery(query, 'courseId')) };
    },

    /* ---------------- AAR (Hotwash) ---------------- */

    async getAar(identity, { query }) {
      requireInstructor(identity);
      const courseId = requiredQuery(query, 'courseId');
      const saved = await storeCall('getAar', { instructorId: identity.id, courseId });
      if (!saved) throw new EvidenceError('No saved AAR', 'AAR_NOT_FOUND', 404);
      return { json: saved };
    },

    async createAar(identity, { body }) {
      requireInstructor(identity);
      const instructorId = identity.id;
      const courseId = requiredBodyString(body, 'courseId');
      const input = await storeCall('getAarInput', { instructorId, courseId });
      if (!input || !Array.isArray(input.critiques)) {
        throw new EvidenceError('No persisted critiques are available', 'CRITIQUES_NOT_FOUND', 404);
      }
      const built = await buildAar({
        critiques: input.critiques,
        course: input.courseTitle ?? input.course?.title,
        model,
      });
      await storeCall('saveAar', { instructorId, courseId, ...built });
      return { status: 201, json: { ...built, persisted: true } };
    },

    /* ---------------- profile (Waypoint) ---------------- */

    async getProfile(identity) {
      const saved = await storeCall('getLearnerProfile', { learnerId: identity.id });
      if (!saved) throw new EvidenceError('No saved learner profile', 'PROFILE_NOT_FOUND', 404);
      return { json: saved };
    },

    async saveProfile(identity, { body }) {
      const responses = body?.responses;
      if (!responses || typeof responses !== 'object' || Array.isArray(responses)) {
        throw new EvidenceError('responses must be an object', 'INVALID_REQUEST', 400);
      }
      // Name comes from the verified identity, so a learner cannot rename another profile.
      const built = buildProfile({ responses, name: identity.name ?? null });
      await storeCall('saveLearnerProfile', { learnerId: identity.id, responses, ...built });
      return { status: 201, json: { ...built, persisted: true } };
    },

    async getCohortProfile(identity, { query }) {
      requireInstructor(identity);
      const profileResult = cohortRows(
        await storeCall('listCohortProfiles', { instructorId: identity.id, courseId: query.courseId }),
        'entries',
      );
      return {
        json: {
          scope: 'cohort',
          ...buildCohortProfile({
            entries: profileResult.rows,
            distinctLearnerCount: profileResult.distinctLearnerCount,
            minCohort: COHORT_MIN,
          }),
        },
      };
    },

    /* ---------------- SCORM export (Cartridge) ---------------- */

    async exportScorm(identity, { query }) {
      requireInstructor(identity);
      const instructorId = identity.id;
      const courseId = requiredQuery(query, 'courseId');
      const version = query.version || '1.2';
      if (version !== '1.2' && version !== '2004') {
        throw new EvidenceError('version must be 1.2 or 2004', 'INVALID_REQUEST', 400);
      }
      const course = await storeCall('getApprovedCourse', { instructorId, courseId });
      const built = await buildApprovedScorm({ course, version });
      if (typeof store.recordExport === 'function') {
        await store.recordExport({ instructorId, courseId, version, validation: built.validation });
      }
      const filename =
        String(built.course.title || 'course')
          .replace(/[^A-Za-z0-9._-]+/g, '-')
          .replace(/^-+|-+$/g, '')
          .slice(0, 64) || 'course';
      return {
        body: built.zip,
        headers: {
          'content-type': 'application/zip',
          'content-disposition': `attachment; filename="${filename}.zip"`,
          'x-scorm-version': built.validation.version || version,
        },
      };
    },

    /* ---------------- fidelity (Understudy) ---------------- */

    async getFidelity(identity, { query }) {
      requireInstructor(identity);
      const courseId = requiredQuery(query, 'courseId');
      const saved = await storeCall('getFidelityEvaluation', { instructorId: identity.id, courseId });
      if (!saved) throw new EvidenceError('No saved fidelity evaluation', 'FIDELITY_NOT_FOUND', 404);
      return { json: saved };
    },

    async runFidelity(identity, { body }) {
      requireInstructor(identity);
      const instructorId = identity.id;
      const courseId = requiredBodyString(body, 'courseId');
      const input = await storeCall('getFidelityInput', { instructorId, courseId });
      if (!input || !Array.isArray(input.cases) || !input.persona) {
        throw new EvidenceError(
          'No persisted fidelity benchmark cases are available',
          'FIDELITY_INPUT_NOT_FOUND',
          404,
        );
      }
      const result = await evaluateFidelity({ ...input, model });
      if (result.status === 'unavailable') {
        return { status: 503, json: { ...result, persisted: false } };
      }
      await storeCall('saveFidelityEvaluation', { instructorId, courseId, ...result });
      return { status: 201, json: { ...result, persisted: true } };
    },
  };
}

let productionHandlers = null;

/** Handlers bound to Prisma persistence and the configured model (built once per process). */
export function evidenceHandlers() {
  if (!productionHandlers) {
    productionHandlers = createEvidenceHandlers({
      store: createLearningEvidenceStore(),
      model: configuredEvidenceModel(),
    });
  }
  return productionHandlers;
}
