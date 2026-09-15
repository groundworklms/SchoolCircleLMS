import { randomUUID } from 'node:crypto';
import { writeFile } from 'node:fs/promises';

const REQUEST_TIMEOUT_MS = 120_000;
const SOURCE_TEXT =
  'This fictional training device has a safety latch and a green indicator. ' +
  'Before operation, inspect the safety latch and confirm the indicator is green. ' +
  'The safety latch inspection confirms that the latch is secured before operation. ' +
  'The green indicator confirms that the fictional training device is ready for operation. ' +
  'A common error is starting operation without inspecting the safety latch. ' +
  'Correct this error by inspecting the safety latch and checking the green indicator before operation. ' +
  'Record the safety check in the training log so the completed inspection can be reviewed. ' +
  'The coaching cue is: inspect the safety latch, confirm the green indicator, and record the safety check.';
const REDACTED_COURSE_KEYS = new Set([
  'answer',
  'answerIndex',
  'rationale',
  'keyedAnswer',
  'indicators',
]);
const LIVE_OPT_IN = '--live';

class ProofError extends Error {
  constructor(code, stage) {
    super(code);
    this.name = 'ProofError';
    this.code = code;
    this.stage = stage;
  }
}

class LiveApiError extends Error {
  constructor(code, status, stage) {
    super(code);
    this.name = 'LiveApiError';
    this.code = code;
    this.status = status;
    this.stage = stage;
  }
}

function refuse(message) {
  console.error(`Refused: ${message}`);
  process.exitCode = 1;
}

function liveOriginFromEnvironment() {
  const domain = process.env.REPLIT_DEV_DOMAIN;
  if (typeof domain !== 'string' || !domain.trim()) return null;
  const value = domain.trim();
  // Keep this deliberately stricter than URL parsing: a published .replit.app
  // host, an arbitrary host, and a path-bearing value must never receive this
  // script's requests.
  if (!/^[a-z0-9.-]+\.replit\.dev(?::\d+)?$/i.test(value)) return null;
  return `https://${value}`;
}

function proofAssert(condition, code, stage) {
  if (!condition) throw new ProofError(code, stage);
}

function responseCode(body) {
  return typeof body?.code === 'string' && body.code.length <= 80 ? body.code : null;
}

function hasAnyKey(value, keys, seen = new Set()) {
  if (!value || typeof value !== 'object' || seen.has(value)) return false;
  seen.add(value);
  if (Array.isArray(value)) return value.some((item) => hasAnyKey(item, keys, seen));
  return Object.entries(value).some(
    ([key, item]) => keys.has(key) || hasAnyKey(item, keys, seen),
  );
}

function isObject(value) {
  return Boolean(value) && typeof value === 'object' && !Array.isArray(value);
}

function normalizedError(error, fallbackStage) {
  if (error instanceof LiveApiError) {
    return {
      stage: error.stage || fallbackStage,
      code: error.code || 'API_ERROR',
      ...(Number.isInteger(error.status) ? { status: error.status } : {}),
    };
  }
  if (error instanceof ProofError) {
    return { stage: error.stage || fallbackStage, code: error.code || 'PROOF_FAILED' };
  }
  if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
    return { stage: fallbackStage, code: 'REQUEST_TIMEOUT' };
  }
  return { stage: fallbackStage, code: 'LIVE_PROOF_ERROR' };
}

async function requestJson(origin, method, path, token, body, stage) {
  const headers = {};
  if (token) headers.authorization = `Bearer ${token}`;
  if (body !== undefined) headers['content-type'] = 'application/json';

  let response;
  try {
    response = await fetch(`${origin}/api${path}`, {
      method,
      headers,
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    if (error?.name === 'AbortError' || error?.name === 'TimeoutError') {
      throw new LiveApiError('REQUEST_TIMEOUT', null, stage);
    }
    throw new LiveApiError('NETWORK_ERROR', null, stage);
  }

  let parsed;
  try {
    parsed = await response.json();
  } catch {
    throw new LiveApiError('API_INVALID_JSON', response.status, stage);
  }
  return { status: response.status, body: parsed };
}

function expectStatus(result, expected, stage) {
  const statuses = Array.isArray(expected) ? expected : [expected];
  if (!statuses.includes(result.status)) {
    throw new LiveApiError(responseCode(result.body) || 'UNEXPECTED_STATUS', result.status, stage);
  }
}

function recordMilestone(report, name) {
  report.milestones.push({ name, status: 'passed' });
  console.log(`milestone ${name}: passed`);
}

async function runLiveProof(origin, report) {
  const fixtureUserIds = [];
  const counters = {
    draftGenerations: 0,
    rubricGenerations: 0,
    tutorRequests: 0,
    practiceTurns: 0,
  };
  let dbModule;
  let sessionModule;
  let cleanupFailure = null;
  let currentStage = 'readiness';

  try {
    currentStage = 'readiness';
    const readiness = await requestJson(origin, 'GET', '/learning/status', null, undefined, currentStage);
    expectStatus(readiness, 200, currentStage);
    const modelStatus = readiness.body?.arsenal?.model;
    report.model = {
      provider: typeof modelStatus?.provider === 'string' ? modelStatus.provider : null,
      name: typeof modelStatus?.model === 'string' ? modelStatus.model : null,
      ready: Boolean(modelStatus?.ready),
    };
    proofAssert(readiness.body?.persistence?.learningRecord === true, 'PERSISTENCE_NOT_READY', currentStage);
    proofAssert(modelStatus?.ready === true, 'MODEL_NOT_READY', currentStage);
    proofAssert(
      readiness.body?.arsenal?.rubriconConfigured === true,
      'RUBRICON_NOT_READY',
      currentStage,
    );
    proofAssert(
      readiness.body?.arsenal?.whetstoneConfigured === true,
      'WHETSTONE_NOT_READY',
      currentStage,
    );
    recordMilestone(report, 'readiness');

    dbModule = await import('../lib/server/db.js');
    sessionModule = await import('../lib/server/session.js');
    const { db } = dbModule;
    const suffix = `${process.pid}-${Date.now()}-${randomUUID()}`;
    const fixturePrefix = `LIVE TEST ${suffix}`;

    currentStage = 'fixture-users';
    const instructor = await db.user.create({
      data: {
        name: `${fixturePrefix} instructor`,
        role: 'INSTRUCTOR',
        externalId: `${fixturePrefix}:instructor:${randomUUID()}`,
      },
    });
    fixtureUserIds.push(instructor.id);
    const learner = await db.user.create({
      data: {
        name: `${fixturePrefix} learner`,
        role: 'LEARNER',
        externalId: `${fixturePrefix}:learner:${randomUUID()}`,
      },
    });
    fixtureUserIds.push(learner.id);
    proofAssert(fixtureUserIds.length === 2, 'FIXTURE_USER_COUNT', currentStage);
    const instructorToken = sessionModule.createSessionToken({
      userId: instructor.id,
      subject: instructor.externalId,
    });
    const learnerToken = sessionModule.createSessionToken({
      userId: learner.id,
      subject: learner.externalId,
    });
    recordMilestone(report, 'fixture-users');

    currentStage = 'source-create';
    const sourceResponse = await requestJson(
      origin,
      'POST',
      '/learning/sources',
      instructorToken,
      {
        title: `${fixturePrefix} safety latch source`,
        sourceId: `live-test-safety-latch-${suffix}`,
        text: SOURCE_TEXT,
        pages: [{ page: 1, text: SOURCE_TEXT }],
      },
      currentStage,
    );
    expectStatus(sourceResponse, 201, currentStage);
    proofAssert(sourceResponse.body?.status === 'PENDING', 'SOURCE_NOT_PENDING', currentStage);
    proofAssert(typeof sourceResponse.body?.id === 'string', 'SOURCE_ID_MISSING', currentStage);
    const sourceId = sourceResponse.body.id;
    const sourceRecord = await db.learningRecord.findUnique({ where: { id: sourceId } });
    proofAssert(
      sourceRecord?.ownerId === instructor.id &&
        sourceRecord?.type === 'SOURCE' &&
        sourceRecord?.status === 'PENDING',
      'SOURCE_NOT_PERSISTED',
      currentStage,
    );
    proofAssert(
      sourceRecord?.payload?.pages?.[0]?.page === 1 &&
        Array.isArray(sourceRecord?.payload?.chunks) &&
        sourceRecord.payload.chunks.length > 0,
      'SOURCE_PAGE_NOT_PERSISTED',
      currentStage,
    );
    recordMilestone(report, 'source-created');

    currentStage = 'source-approve';
    const sourceApproval = await requestJson(
      origin,
      'POST',
      `/learning/sources/${encodeURIComponent(sourceId)}/approve`,
      instructorToken,
      {},
      currentStage,
    );
    expectStatus(sourceApproval, 200, currentStage);
    proofAssert(sourceApproval.body?.status === 'APPROVED', 'SOURCE_NOT_APPROVED', currentStage);
    recordMilestone(report, 'source-approved');

    currentStage = 'course-draft';
    counters.draftGenerations += 1;
    proofAssert(counters.draftGenerations <= 1, 'DRAFT_GENERATION_BUDGET', currentStage);
    const draftResponse = await requestJson(
      origin,
      'POST',
      '/learning/courses/draft',
      instructorToken,
      {
        title: `${fixturePrefix} safety latch course`,
        objectives: ['Explain the safety latch inspection before operation'],
        sourceIds: [sourceId],
        diagrams: false,
      },
      currentStage,
    );
    expectStatus(draftResponse, 201, currentStage);
    proofAssert(draftResponse.body?.status === 'PENDING', 'COURSE_NOT_PENDING', currentStage);
    proofAssert(typeof draftResponse.body?.id === 'string', 'COURSE_ID_MISSING', currentStage);
    const courseId = draftResponse.body.id;
    const draftRecord = await db.learningRecord.findUnique({ where: { id: courseId } });
    proofAssert(
      draftRecord?.ownerId === instructor.id &&
        draftRecord?.type === 'COURSE_DRAFT' &&
        draftRecord?.status === 'PENDING' &&
        Array.isArray(draftRecord?.payload?.sourceIds) &&
        draftRecord.payload.sourceIds.length === 1 &&
        draftRecord.payload.sourceIds[0] === sourceId,
      'COURSE_NOT_PERSISTED',
      currentStage,
    );
    recordMilestone(report, 'course-draft-created');

    currentStage = 'course-draft-review';
    const instructorDraft = await requestJson(
      origin,
      'GET',
      `/learning/courses/${encodeURIComponent(courseId)}`,
      instructorToken,
      undefined,
      currentStage,
    );
    expectStatus(instructorDraft, 200, currentStage);
    proofAssert(instructorDraft.body?.status === 'PENDING', 'DRAFT_REVIEW_STATUS', currentStage);
    const instructorCourse = instructorDraft.body?.course;
    const draftSections = Array.isArray(instructorCourse?.sections)
      ? instructorCourse.sections
      : [];
    proofAssert(draftSections.length > 0, 'DRAFT_HAS_NO_SECTIONS', currentStage);
    proofAssert(
      draftSections.some(
        (section) =>
          typeof section?.lesson === 'string' &&
          section.lesson.trim() &&
          typeof (section.cite ?? section.citation) === 'string' &&
          String(section.cite ?? section.citation).trim(),
      ),
      'DRAFT_LESSON_CITATION_MISSING',
      currentStage,
    );
    proofAssert(
      !draftSections.every((section) => section?.refused === true),
      'DRAFT_ALL_REFUSED',
      currentStage,
    );
    const instructorHasAnswerKey = hasAnyKey(instructorCourse, REDACTED_COURSE_KEYS);
    proofAssert(instructorHasAnswerKey, 'DRAFT_HAS_NO_REVIEW_KEYS', currentStage);
    recordMilestone(report, 'course-draft-reviewed');

    currentStage = 'course-pending-access';
    const pendingLearnerCourse = await requestJson(
      origin,
      'GET',
      `/learning/courses/${encodeURIComponent(courseId)}`,
      learnerToken,
      undefined,
      currentStage,
    );
    expectStatus(pendingLearnerCourse, 404, currentStage);
    recordMilestone(report, 'pending-course-hidden');

    currentStage = 'course-approve';
    const courseApproval = await requestJson(
      origin,
      'POST',
      `/learning/courses/${encodeURIComponent(courseId)}/approve`,
      instructorToken,
      {},
      currentStage,
    );
    expectStatus(courseApproval, 200, currentStage);
    proofAssert(courseApproval.body?.status === 'APPROVED', 'COURSE_NOT_APPROVED', currentStage);
    recordMilestone(report, 'course-approved');

    currentStage = 'course-learner-redaction';
    const learnerCourseResponse = await requestJson(
      origin,
      'GET',
      `/learning/courses/${encodeURIComponent(courseId)}`,
      learnerToken,
      undefined,
      currentStage,
    );
    expectStatus(learnerCourseResponse, 200, currentStage);
    proofAssert(learnerCourseResponse.body?.status === 'APPROVED', 'LEARNER_COURSE_STATUS', currentStage);
    proofAssert(
      learnerCourseResponse.body?.course?.sourceIds?.[0] === sourceId,
      'LEARNER_COURSE_SOURCE_MISSING',
      currentStage,
    );
    proofAssert(
      hasAnyKey(learnerCourseResponse.body?.course, REDACTED_COURSE_KEYS) === false,
      'LEARNER_ANSWER_KEY_LEAK',
      currentStage,
    );
    recordMilestone(report, 'learner-course-redacted');

    currentStage = 'rubric-generate';
    counters.rubricGenerations += 1;
    proofAssert(counters.rubricGenerations <= 1, 'RUBRIC_GENERATION_BUDGET', currentStage);
    const rubricResponse = await requestJson(
      origin,
      'POST',
      '/learning/rubrics/generate',
      instructorToken,
      {
        sourceId,
        task: {
          code: `LIVE-${suffix}`,
          title: 'Safety latch inspection',
          standard: SOURCE_TEXT,
          conditions: SOURCE_TEXT,
        },
      },
      currentStage,
    );
    expectStatus(rubricResponse, 201, currentStage);
    proofAssert(rubricResponse.body?.status === 'PENDING', 'RUBRIC_NOT_PENDING', currentStage);
    proofAssert(typeof rubricResponse.body?.id === 'string', 'RUBRIC_ID_MISSING', currentStage);
    proofAssert(rubricResponse.body?.validation?.valid === true, 'RUBRIC_INVALID', currentStage);
    proofAssert(rubricResponse.body?.traceability?.grounded === true, 'RUBRIC_UNGROUNDED', currentStage);
    proofAssert(
      !Array.isArray(rubricResponse.body?.traceability?.ungrounded) ||
        rubricResponse.body.traceability.ungrounded.length === 0,
      'RUBRIC_UNGROUNDED_DIMENSION',
      currentStage,
    );
    proofAssert(rubricResponse.body?.rubric?.flagged !== true, 'RUBRIC_FLAGGED', currentStage);
    const rubricId = rubricResponse.body.id;
    recordMilestone(report, 'rubric-generated-grounded');

    currentStage = 'rubric-approve';
    const rubricApproval = await requestJson(
      origin,
      'POST',
      `/learning/rubrics/${encodeURIComponent(rubricId)}/approve`,
      instructorToken,
      {},
      currentStage,
    );
    expectStatus(rubricApproval, 200, currentStage);
    proofAssert(rubricApproval.body?.status === 'APPROVED', 'RUBRIC_NOT_APPROVED', currentStage);
    const rubricRecord = await db.learningRecord.findUnique({ where: { id: rubricId } });
    proofAssert(
      rubricRecord?.ownerId === instructor.id &&
        rubricRecord?.type === 'RUBRIC' &&
        rubricRecord?.status === 'APPROVED',
      'RUBRIC_APPROVAL_NOT_PERSISTED',
      currentStage,
    );
    recordMilestone(report, 'rubric-approved');

    currentStage = 'tutor-grounded';
    counters.tutorRequests += 1;
    proofAssert(counters.tutorRequests <= 2, 'TUTOR_REQUEST_BUDGET', currentStage);
    const groundedTutor = await requestJson(
      origin,
      'POST',
      '/learning/tutor',
      learnerToken,
      {
        sourceIds: [sourceId],
        question: 'What must the learner inspect before operation?',
      },
      currentStage,
    );
    expectStatus(groundedTutor, 200, currentStage);
    proofAssert(groundedTutor.body?.refused === false, 'GROUNDED_TUTOR_REFUSED', currentStage);
    proofAssert(
      Array.isArray(groundedTutor.body?.citations) && groundedTutor.body.citations.length > 0,
      'GROUNDED_TUTOR_NO_CITATION',
      currentStage,
    );
    const citedSource = groundedTutor.body.citations[0]?.source;
    proofAssert(
      typeof citedSource === 'string' && citedSource.startsWith(`${sourceId} p.`),
      'GROUNDED_TUTOR_BAD_CITATION',
      currentStage,
    );
    const citedSourceId = citedSource.slice(0, citedSource.indexOf(' p.'));
    const citedSourceResponse = await requestJson(
      origin,
      'GET',
      `/learning/sources/${encodeURIComponent(citedSourceId)}`,
      learnerToken,
      undefined,
      currentStage,
    );
    expectStatus(citedSourceResponse, 200, currentStage);
    proofAssert(
      citedSourceResponse.body?.status === 'APPROVED' &&
        Array.isArray(citedSourceResponse.body?.pages) &&
        citedSourceResponse.body.pages.some((page) => page?.page === 1),
      'CITATION_SOURCE_NOT_RESOLVABLE',
      currentStage,
    );
    recordMilestone(report, 'tutor-grounded-citation-resolved');

    currentStage = 'tutor-unsupported';
    counters.tutorRequests += 1;
    proofAssert(counters.tutorRequests <= 2, 'TUTOR_REQUEST_BUDGET', currentStage);
    const unsupportedTutor = await requestJson(
      origin,
      'POST',
      '/learning/tutor',
      learnerToken,
      {
        sourceIds: [sourceId],
        question: 'What is the moon phase today?',
      },
      currentStage,
    );
    const tutorRefused =
      unsupportedTutor.status === 200 &&
      unsupportedTutor.body?.refused === true &&
      Array.isArray(unsupportedTutor.body?.citations) &&
      unsupportedTutor.body.citations.length === 0;
    proofAssert(tutorRefused, 'UNSUPPORTED_TUTOR_NOT_REFUSED', currentStage);
    recordMilestone(report, 'tutor-unsupported-refused-no-citations');

    currentStage = 'practice-start';
    const practiceStart = await requestJson(
      origin,
      'POST',
      '/learning/mastery/sessions',
      learnerToken,
      {
        sourceId,
        courseId,
        objectives: 'Explain the safety latch inspection before operation',
        maxTurns: 2,
      },
      currentStage,
    );
    expectStatus(practiceStart, 201, currentStage);
    proofAssert(practiceStart.body?.status === 'ACTIVE', 'PRACTICE_NOT_ACTIVE', currentStage);
    proofAssert(typeof practiceStart.body?.id === 'string', 'PRACTICE_ID_MISSING', currentStage);
    proofAssert(
      typeof practiceStart.body?.currentQuestion === 'string' &&
        practiceStart.body.currentQuestion.trim(),
      'PRACTICE_QUESTION_MISSING',
      currentStage,
    );
    const sessionId = practiceStart.body.id;
    const persistedStart = await db.learningRecord.findUnique({ where: { id: sessionId } });
    proofAssert(
      persistedStart?.ownerId === learner.id &&
        persistedStart?.type === 'MASTERY_SESSION' &&
        persistedStart?.status === 'ACTIVE' &&
        persistedStart?.version === 0,
      'PRACTICE_START_NOT_PERSISTED',
      currentStage,
    );
    recordMilestone(report, 'practice-started');

    currentStage = 'practice-reload-active';
    const reloadedActive = await requestJson(
      origin,
      'GET',
      `/learning/mastery/sessions/${encodeURIComponent(sessionId)}`,
      learnerToken,
      undefined,
      currentStage,
    );
    expectStatus(reloadedActive, 200, currentStage);
    proofAssert(
      reloadedActive.body?.status === 'ACTIVE' &&
        reloadedActive.body?.version === 0 &&
        typeof reloadedActive.body?.currentQuestion === 'string' &&
        Array.isArray(reloadedActive.body?.transcript),
      'PRACTICE_ACTIVE_RELOAD_FAILED',
      currentStage,
    );
    recordMilestone(report, 'practice-active-reloaded');

    const practiceAnswer =
      'Before operation, inspect the safety latch and confirm the indicator is green. ' +
      'Record the safety check in the training log.';
    currentStage = 'practice-turn-one';
    counters.practiceTurns += 1;
    const firstPracticeTurn = await requestJson(
      origin,
      'POST',
      `/learning/mastery/sessions/${encodeURIComponent(sessionId)}/turn`,
      learnerToken,
      { answer: practiceAnswer },
      currentStage,
    );
    expectStatus(firstPracticeTurn, 200, currentStage);
    proofAssert(
      typeof firstPracticeTurn.body?.result?.complete === 'boolean',
      'PRACTICE_TURN_ONE_RESULT',
      currentStage,
    );

    let finalPractice = firstPracticeTurn;
    if (firstPracticeTurn.body.result.complete !== true) {
      currentStage = 'practice-reload-between-turns';
      const activeAfterFirst = await requestJson(
        origin,
        'GET',
        `/learning/mastery/sessions/${encodeURIComponent(sessionId)}`,
        learnerToken,
        undefined,
        currentStage,
      );
      expectStatus(activeAfterFirst, 200, currentStage);
      proofAssert(
        activeAfterFirst.body?.status === 'ACTIVE' &&
          activeAfterFirst.body?.version === 1 &&
          Array.isArray(activeAfterFirst.body?.transcript),
        'PRACTICE_INTERMEDIATE_PERSISTENCE',
        currentStage,
      );
      recordMilestone(report, 'practice-intermediate-reloaded');

      currentStage = 'practice-turn-two';
      counters.practiceTurns += 1;
      proofAssert(counters.practiceTurns <= 2, 'PRACTICE_TURN_BUDGET', currentStage);
      finalPractice = await requestJson(
        origin,
        'POST',
        `/learning/mastery/sessions/${encodeURIComponent(sessionId)}/turn`,
        learnerToken,
        { answer: practiceAnswer },
        currentStage,
      );
      expectStatus(finalPractice, 200, currentStage);
      proofAssert(
        typeof finalPractice.body?.result?.complete === 'boolean',
        'PRACTICE_TURN_TWO_RESULT',
        currentStage,
      );
    }
    recordMilestone(report, 'practice-answer-persisted');

    currentStage = 'practice-reload-final';
    const finalPracticeReload = await requestJson(
      origin,
      'GET',
      `/learning/mastery/sessions/${encodeURIComponent(sessionId)}`,
      learnerToken,
      undefined,
      currentStage,
    );
    expectStatus(finalPracticeReload, 200, currentStage);
    proofAssert(
      finalPracticeReload.body?.status === 'COMPLETE' &&
        finalPracticeReload.body?.version === counters.practiceTurns &&
        finalPracticeReload.body?.currentQuestion === null &&
        Array.isArray(finalPracticeReload.body?.transcript) &&
        finalPracticeReload.body.transcript.length > 0 &&
        isObject(finalPracticeReload.body?.report) &&
        finalPracticeReload.body.report.complete === true &&
        Array.isArray(finalPracticeReload.body?.citations) &&
        finalPracticeReload.body.citations.some((citation) => citation?.page === 1),
      'PRACTICE_FINAL_RELOAD_FAILED',
      currentStage,
    );
    proofAssert(
      finalPractice.body?.result?.complete === true,
      'PRACTICE_NOT_COMPLETE',
      currentStage,
    );
    const persistedFinal = await db.learningRecord.findUnique({ where: { id: sessionId } });
    proofAssert(
      persistedFinal?.ownerId === learner.id &&
        persistedFinal?.type === 'MASTERY_SESSION' &&
        persistedFinal?.status === 'COMPLETE' &&
        persistedFinal?.version === counters.practiceTurns &&
        persistedFinal?.payload?.complete === true &&
        Array.isArray(persistedFinal?.payload?.transcript) &&
        persistedFinal.payload.transcript.length === finalPracticeReload.body.transcript.length &&
        isObject(persistedFinal?.payload?.report),
      'PRACTICE_DB_COMPARISON_FAILED',
      currentStage,
    );
    const persistedAttempt = await db.learningRecord.findFirst({
      where: { ownerId: learner.id, type: 'MASTERY_ATTEMPT' },
      orderBy: { createdAt: 'desc' },
    });
    proofAssert(
      persistedAttempt?.payload?.sessionId === sessionId &&
        !Object.prototype.hasOwnProperty.call(persistedAttempt.payload || {}, 'correct') &&
        !Object.prototype.hasOwnProperty.call(persistedAttempt.payload || {}, 'phase'),
      'PRACTICE_ATTEMPT_NOT_PERSISTED',
      currentStage,
    );
    recordMilestone(report, 'practice-final-persistence-validated');

    currentStage = 'learner-analytics';
    const learnerAnalytics = await requestJson(
      origin,
      'GET',
      `/learning/analytics?courseId=${encodeURIComponent(courseId)}`,
      learnerToken,
      undefined,
      currentStage,
    );
    expectStatus(learnerAnalytics, 200, currentStage);
    proofAssert(
      learnerAnalytics.body?.scope === 'learner' &&
        learnerAnalytics.body?.privacy?.learnerIdsReturned === false,
      'LEARNER_ANALYTICS_FAILED',
      currentStage,
    );
    recordMilestone(report, 'learner-analytics-read');

    currentStage = 'cohort-analytics';
    const cohortAnalytics = await requestJson(
      origin,
      'GET',
      `/learning/analytics/cohort?courseId=${encodeURIComponent(courseId)}`,
      instructorToken,
      undefined,
      currentStage,
    );
    expectStatus(cohortAnalytics, 200, currentStage);
    proofAssert(
      cohortAnalytics.body?.scope === 'cohort' &&
        cohortAnalytics.body?.privacy?.observedLearners === 1 &&
        cohortAnalytics.body?.privacy?.learnerIdsReturned === false &&
        cohortAnalytics.body?.gain?.status === 'insufficient_evidence' &&
        cohortAnalytics.body?.mastery?.status === 'insufficient_evidence',
      'COHORT_ANALYTICS_PRIVACY_FAILED',
      currentStage,
    );
    proofAssert(
      JSON.stringify(cohortAnalytics.body).includes(learner.id) === false,
      'COHORT_ANALYTICS_ID_LEAK',
      currentStage,
    );
    recordMilestone(report, 'cohort-analytics-suppressed-one');

    return true;
  } catch (error) {
    report.error = normalizedError(error, currentStage);
    return false;
  } finally {
    report.budget = { ...counters };
    if (dbModule?.db && fixtureUserIds.length > 0) {
      try {
        await dbModule.db.learningRecord.deleteMany({
          where: { ownerId: { in: fixtureUserIds } },
        });
      } catch {
        cleanupFailure = { stage: 'cleanup-records', code: 'CLEANUP_RECORDS_FAILED' };
      } finally {
        try {
          await dbModule.db.user.deleteMany({ where: { id: { in: fixtureUserIds } } });
        } catch {
          cleanupFailure = { stage: 'cleanup-users', code: 'CLEANUP_USERS_FAILED' };
        }
      }
    }
    if (cleanupFailure) report.cleanup = { status: 'failed', ...cleanupFailure };
    else report.cleanup = { status: 'passed' };
    if (dbModule?.db && typeof dbModule.db.$disconnect === 'function') {
      await dbModule.db.$disconnect().catch(() => {});
    }
  }
}

async function main() {
  if (!process.argv.slice(2).includes(LIVE_OPT_IN)) {
    refuse('pass --live for the development-only live HTTP proof');
    return;
  }
  const origin = liveOriginFromEnvironment();
  if (!origin) {
    refuse('REPLIT_DEV_DOMAIN must be a bare *.replit.dev development host');
    return;
  }

  const reportPath = `/tmp/prove-learning-loop-live-${process.pid}-${Date.now()}-${randomUUID()}.json`;
  const report = {
    testType: 'live HTTP signed-session seam; browser Firebase login not tested',
    outcome: 'failed',
    model: null,
    milestones: [],
    budget: null,
    cleanup: null,
    error: null,
  };
  let passed = false;
  try {
    passed = await runLiveProof(origin, report);
    if (report.cleanup?.status !== 'passed') passed = false;
    report.outcome = passed ? 'passed' : 'failed';
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
  } catch {
    report.outcome = 'failed';
    report.error ||= { stage: 'summary', code: 'SUMMARY_WRITE_FAILED' };
    try {
      await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    } catch {
      // Keep the terminal output safe and bounded if the temporary filesystem
      // itself is unavailable.
    }
  }

  if (!passed) {
    const error = report.error || report.cleanup;
    if (error?.status) console.error(`LIVE proof failed: ${error.stage} (${error.code}, HTTP ${error.status})`);
    else console.error(`LIVE proof failed: ${error?.stage || 'unknown'} (${error?.code || 'UNKNOWN'})`);
    console.log(`summary written: ${reportPath}`);
    process.exitCode = 1;
    return;
  }
  console.log(`summary written: ${reportPath}`);
}

await main();