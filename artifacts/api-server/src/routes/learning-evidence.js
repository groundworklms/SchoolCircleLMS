import { Router } from 'express';
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
} from '../lib/arsenal-evidence.js';

/**
 * Construct the learning-evidence routes without importing auth or persistence.
 *
 * Required injected seams:
 *   requireUser / requireInstructor: Express middleware. They must attach `{ id, role, name }` (or
 *   an equivalent `userId`) to `req.user`.
 *   store: the persistence object documented in docs/learning-evidence-api.md.
 *   model: optional explicit model seam; no environment/default provider is read here.
 */
export function createEvidenceRouter({
  requireUser,
  requireInstructor,
  store,
  model,
} = {}) {
  if (typeof requireUser !== 'function') throw new TypeError('createEvidenceRouter: requireUser is required');
  if (typeof requireInstructor !== 'function') {
    throw new TypeError('createEvidenceRouter: requireInstructor is required');
  }
  if (!store || typeof store !== 'object') throw new TypeError('createEvidenceRouter: store is required');

  const router = Router();
  const userMiddleware = requireUser;
  const instructorMiddleware = requireInstructor;
  const instructorIfCohort = (req, res, next) => (
    req.query?.scope === 'cohort'
      ? instructorMiddleware(req, res, next)
      : next()
  );

  function userFrom(req) {
    return req.user ?? req.learningIdentity ?? req.auth?.user ?? null;
  }

  function userIdFrom(req) {
    const user = userFrom(req);
    return user?.id ?? user?.userId ?? user?.sub ?? null;
  }

  function requiredQuery(req, name) {
    const value = req.query?.[name];
    if (typeof value !== 'string' || !value.trim()) {
      throw new EvidenceError(`${name} is required`, 'INVALID_REQUEST', 400);
    }
    return value.trim();
  }

  function requiredBodyString(req, name) {
    const value = req.body?.[name];
    if (typeof value !== 'string' || !value.trim()) {
      throw new EvidenceError(`${name} is required`, 'INVALID_REQUEST', 400);
    }
    return value.trim();
  }

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
    let countWithoutIds = 0;
    for (const result of results) {
      for (const learnerId of result.learnerIds) learnerIds.add(learnerId);
      if (!result.learnerIds.size && Number.isInteger(result.distinctLearnerCount)) {
        countWithoutIds += result.distinctLearnerCount;
      }
    }
    return learnerIds.size + countWithoutIds;
  }

  function sendError(res, error) {
    const status = Number.isInteger(error?.status) ? error.status : 500;
    const code = error?.code || 'EVIDENCE_ERROR';
    const message = error?.message || String(error);
    if (!res.headersSent) res.status(status).json({ error: message, code });
  }

  function endpoint(handler) {
    return async (req, res) => {
      try {
        const userId = userIdFrom(req);
        if (!userId) throw new EvidenceError('Authenticated user is required', 'UNAUTHENTICATED', 401);
        await handler(req, res, userId, userFrom(req));
      } catch (error) {
        sendError(res, error);
      }
    };
  }

  function courseIdFromBodyOrQuery(req) {
    return req.body?.courseId || req.query?.courseId;
  }

  router.get('/learning/study-plan', userMiddleware, endpoint(async (req, res, learnerId) => {
    const courseId = requiredQuery(req, 'courseId');
    const record = await storeCall('getStudyPlan', { learnerId, courseId });
    if (!record) throw new EvidenceError('No saved study plan', 'STUDY_PLAN_NOT_FOUND', 404);
    const format = req.query?.format || 'json';
    if (format === 'ics') {
      if (typeof record.ics !== 'string') throw new EvidenceError('Saved study plan has no ICS export', 'ICS_NOT_FOUND', 404);
      res.type('text/calendar').send(record.ics);
      return;
    }
    if (format === 'reminders') {
      res.json({ reminders: record.reminders ?? [] });
      return;
    }
    if (format !== 'json') throw new EvidenceError('format must be json, ics, or reminders', 'INVALID_REQUEST', 400);
    res.json(record);
  }));

  router.post('/learning/study-plan', userMiddleware, endpoint(async (req, res, learnerId) => {
    const courseId = requiredBodyString(req, 'courseId');
    const source = await storeCall('getStudyPlanInput', { learnerId, courseId });
    if (!source || !Array.isArray(source.syllabus)) {
      throw new EvidenceError('Persistence did not return a course syllabus', 'SYLLABUS_NOT_FOUND', 404);
    }
    const asOf = req.body?.asOf || source.asOf;
    if (!asOf) throw new EvidenceError('asOf is required', 'INVALID_REQUEST', 400);
    const built = buildStudyPlan({
      syllabus: source.syllabus,
      availability: req.body?.availability ?? source.availability ?? 60,
      asOf,
      status: req.body?.status ?? source.status,
      ics: req.body?.ics ?? {},
    });
    await storeCall('saveStudyPlan', {
      learnerId,
      courseId,
      input: { asOf, availability: req.body?.availability ?? source.availability ?? 60 },
      ...built,
    });
    res.status(201).json({ ...built, persisted: true });
  }));

  router.get('/learning/analytics', userMiddleware, instructorIfCohort, endpoint(async (req, res, learnerId, user) => {
    const courseId = req.query?.courseId;
    const scope = req.query?.scope || 'learner';
    if (scope !== 'learner' && scope !== 'cohort') {
      throw new EvidenceError('scope must be learner or cohort', 'INVALID_REQUEST', 400);
    }
    if (scope === 'cohort') {
      // requireInstructor is also applied below as middleware for the dedicated URL. This check
      // prevents a learner from turning a missing role claim into a class view in deployments where
      // middleware only authenticates.
      if (String(user?.role || '').toUpperCase() !== 'INSTRUCTOR') {
        throw new EvidenceError('Instructor access is required', 'FORBIDDEN', 403);
      }
      const attemptResult = cohortRows(
        await storeCall('listCohortAttempts', { instructorId: learnerId, courseId }),
        'attempts',
      );
      const sessionResult = cohortRows(
        await storeCall('listCohortMasteryReports', { instructorId: learnerId, courseId }),
        'sessions',
      );
      res.json({
        scope,
        ...buildAnalytics({
          attempts: attemptResult.rows,
          sessions: sessionResult.rows,
          minCohort: COHORT_MIN,
          cohort: true,
          distinctLearnerCount: unionDistinctLearnerCount(attemptResult, sessionResult),
        }),
      });
      return;
    }
    const attempts = await storeCall('listLearnerAttempts', { learnerId, courseId });
    const sessions = await storeCall('listLearnerMasteryReports', { learnerId, courseId });
    res.json({
      scope,
      ...buildAnalytics({ attempts: attempts ?? [], sessions: sessions ?? [], minCohort: COHORT_MIN }),
    });
  }));

  // A path-level instructor guard is provided for clients that prefer an explicit cohort URL.
  router.get('/learning/analytics/cohort', userMiddleware, instructorMiddleware, endpoint(async (req, res, instructorId) => {
    const courseId = requiredQuery(req, 'courseId');
    const attemptResult = cohortRows(
      await storeCall('listCohortAttempts', { instructorId, courseId }),
      'attempts',
    );
    const sessionResult = cohortRows(
      await storeCall('listCohortMasteryReports', { instructorId, courseId }),
      'sessions',
    );
    res.json({
      scope: 'cohort',
      ...buildAnalytics({
        attempts: attemptResult.rows,
        sessions: sessionResult.rows,
        minCohort: COHORT_MIN,
        cohort: true,
        distinctLearnerCount: unionDistinctLearnerCount(attemptResult, sessionResult),
      }),
    });
  }));

  router.get('/learning/aar', userMiddleware, instructorMiddleware, endpoint(async (req, res, instructorId) => {
    const courseId = requiredQuery(req, 'courseId');
    const saved = await storeCall('getAar', { instructorId, courseId });
    if (!saved) throw new EvidenceError('No saved AAR', 'AAR_NOT_FOUND', 404);
    res.json(saved);
  }));

  router.post('/learning/aar', userMiddleware, instructorMiddleware, endpoint(async (req, res, instructorId) => {
    const courseId = requiredBodyString(req, 'courseId');
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
    res.status(201).json({ ...built, persisted: true });
  }));

  router.get('/learning/profile', userMiddleware, endpoint(async (req, res, learnerId) => {
    const saved = await storeCall('getLearnerProfile', { learnerId });
    if (!saved) throw new EvidenceError('No saved learner profile', 'PROFILE_NOT_FOUND', 404);
    res.json(saved);
  }));

  router.post('/learning/profile', userMiddleware, endpoint(async (req, res, learnerId, user) => {
    if (!req.body?.responses || typeof req.body.responses !== 'object' || Array.isArray(req.body.responses)) {
      throw new EvidenceError('responses must be an object', 'INVALID_REQUEST', 400);
    }
    const built = buildProfile({ responses: req.body.responses, name: user?.name ?? null });
    await storeCall('saveLearnerProfile', { learnerId, responses: req.body.responses, ...built });
    res.status(201).json({ ...built, persisted: true });
  }));

  router.get('/learning/profile/cohort', userMiddleware, instructorMiddleware, endpoint(async (req, res, instructorId) => {
    const courseId = req.query?.courseId;
    const profileResult = cohortRows(
      await storeCall('listCohortProfiles', { instructorId, courseId }),
      'entries',
    );
    res.json({
      scope: 'cohort',
      ...buildCohortProfile({
        entries: profileResult.rows,
        distinctLearnerCount: profileResult.distinctLearnerCount,
        minCohort: COHORT_MIN,
      }),
    });
  }));

  router.get('/learning/export', userMiddleware, instructorMiddleware, endpoint(async (req, res, instructorId) => {
    const courseId = requiredQuery(req, 'courseId');
    const version = req.query?.version || '1.2';
    if (version !== '1.2' && version !== '2004') {
      throw new EvidenceError('version must be 1.2 or 2004', 'INVALID_REQUEST', 400);
    }
    const course = await storeCall('getApprovedCourse', { instructorId, courseId });
    const built = await buildApprovedScorm({ course, version });
    if (typeof store.recordExport === 'function') {
      await store.recordExport({ instructorId, courseId, version, validation: built.validation });
    }
    const filename = String(built.course.title || 'course')
      .replace(/[^A-Za-z0-9._-]+/g, '-')
      .replace(/^-+|-+$/g, '')
      .slice(0, 64) || 'course';
    res
      .type('application/zip')
      .set('Content-Disposition', `attachment; filename="${filename}.zip"`)
      .set('X-SCORM-Version', built.validation.version || version)
      .send(built.zip);
  }));

  router.get('/learning/fidelity', userMiddleware, instructorMiddleware, endpoint(async (req, res, instructorId) => {
    const courseId = requiredQuery(req, 'courseId');
    const saved = await storeCall('getFidelityEvaluation', { instructorId, courseId });
    if (!saved) throw new EvidenceError('No saved fidelity evaluation', 'FIDELITY_NOT_FOUND', 404);
    res.json(saved);
  }));

  router.post('/learning/fidelity', userMiddleware, instructorMiddleware, endpoint(async (req, res, instructorId) => {
    const courseId = requiredBodyString(req, 'courseId');
    const input = await storeCall('getFidelityInput', { instructorId, courseId });
    if (!input || !Array.isArray(input.cases) || !input.persona) {
      throw new EvidenceError('No persisted fidelity benchmark cases are available', 'FIDELITY_INPUT_NOT_FOUND', 404);
    }
    const result = await evaluateFidelity({ ...input, model });
    if (result.status === 'unavailable') {
      res.status(503).json({ ...result, persisted: false });
      return;
    }
    await storeCall('saveFidelityEvaluation', { instructorId, courseId, ...result });
    res.status(201).json({ ...result, persisted: true });
  }));

  return router;
}

export default createEvidenceRouter;
