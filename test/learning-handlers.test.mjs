import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createLearningRecord,
  createLearningEvidenceStore,
  db,
} from '../lib/db.js';
import {
  approveRubric,
  getMasterySession,
  getSource,
  listCourses,
  listMasterySessions,
  listSources,
} from '../lib/learning/core.js';
import { createEvidenceHandlers } from '../lib/learning/evidence.js';
import { errorStatus } from '../lib/learning/http.js';

// Opt in explicitly: CI sets a placeholder DATABASE_URL for prisma generate only.
const databaseReady = process.env.RUN_DB_TESTS === '1' && Boolean(process.env.DATABASE_URL);

async function status(promise) {
  try {
    await promise;
    return 200;
  } catch (error) {
    return errorStatus(error);
  }
}

test(
  'labelled route fixture scopes pending visibility and learner denial',
  { skip: !databaseReady },
  async () => {
    const suffix = `${Date.now()}-${process.pid}`;
    const instructorRow = await db.user.create({
      data: { name: `Fixture Instructor ${suffix}`, role: 'INSTRUCTOR', externalId: `fixture-i-${suffix}` },
    });
    const learnerRow = await db.user.create({
      data: { name: `Fixture Learner ${suffix}`, role: 'LEARNER', externalId: `fixture-l-${suffix}` },
    });
    // What lib/auth.js hands the handlers after verifying a bearer token.
    const instructor = { id: instructorRow.id, name: instructorRow.name, role: 'INSTRUCTOR' };
    const learner = { id: learnerRow.id, name: learnerRow.name, role: 'LEARNER' };
    const records = [];
    const source = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      payload: {
        title: `Fixture source ${suffix}`,
        sourceId: `fixture-source-${suffix}`,
        text: 'Approved fixture source text.',
        pages: [{ page: 1, text: 'Approved fixture source text.' }],
        chunks: [{ page: 1, text: 'Approved fixture source text.' }],
      },
    });
    records.push(source);
    const approvedSource = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: `Approved fixture source ${suffix}`,
        sourceId: `fixture-approved-source-${suffix}`,
        text: 'Approved fixture source text.',
        pages: [{ page: 1, text: 'Approved fixture source text.' }],
        chunks: [{ page: 1, text: 'Approved fixture source text.' }],
      },
    });
    records.push(approvedSource);
    const pendingCourse = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      payload: { title: `Pending ${suffix}`, sourceIds: [source.id], sections: [] },
    });
    records.push(pendingCourse);
    const approvedCourse = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: {
        title: `Approved ${suffix}`,
        sourceIds: [approvedSource.id],
        sections: [
          {
            title: 'Lesson',
            lesson: 'A cited lesson.',
            pre: [{ stem: 'Before?', options: ['A', 'B'], answer: 0 }],
            post: [{ stem: 'After?', options: ['A', 'B'], answer: 0 }],
          },
        ],
      },
    });
    records.push(approvedCourse);
    const invalidRubric = await createLearningRecord({
      ownerId: instructor.id,
      type: 'RUBRIC',
      payload: {
        rubric: { flagged: true },
        validation: { valid: true, flagged: true },
        traceability: { grounded: false, coverage: 0, ungrounded: [{ source: 'missing' }] },
      },
    });
    records.push(invalidRubric);
    const savedSession = await createLearningRecord({
      ownerId: learner.id,
      type: 'MASTERY_SESSION',
      status: 'COMPLETE',
      payload: {
        courseId: approvedCourse.id,
        sourceId: approvedSource.id,
        complete: true,
        source: 'Private grading context',
        rubric: [{ indicators: { mastered: 'Private indicator' } }],
        report: { criteria: [{ elo: 'Fixture objective', verdict: 'mastered' }] },
        transcript: ['Fixture saved answer'],
      },
    });
    records.push(savedSession);

    try {
      const store = createLearningEvidenceStore();
      const approvedProjection = await store.getApprovedCourse({ courseId: approvedCourse.id });
      assert.equal(approvedProjection.sections[0].lesson, 'A cited lesson.');
      assert.equal(approvedProjection.sections[0].items, undefined);
      assert.equal(approvedProjection.sections[0].pre[0].stem, 'Before?');

      const instructorSources = await listSources(instructor);
      assert.ok(instructorSources.json.some((entry) => entry.id === source.id));

      const instructorCourses = await listCourses(instructor);
      assert.ok(instructorCourses.json.some((entry) => entry.id === pendingCourse.id));

      const learnerCourses = await listCourses(learner);
      assert.deepEqual(
        learnerCourses.json.filter((entry) => entry.id === approvedCourse.id || entry.id === pendingCourse.id).map((entry) => entry.id),
        [approvedCourse.id],
      );

      assert.equal(await status(getSource(learner, { params: { id: source.id } })), 404);
      assert.equal(await status(approveRubric(instructor, { params: { id: invalidRubric.id } })), 409);

      const ownSession = await getMasterySession(learner, { params: { id: savedSession.id } });
      assert.equal(ownSession.json.report.criteria[0].verdict, 'mastered');
      assert.equal(ownSession.json.currentQuestion, null);
      assert.equal(ownSession.json.rubric, undefined);
      assert.equal(ownSession.json.source, undefined);
      assert.equal(await status(getMasterySession(instructor, { params: { id: savedSession.id } })), 404);

      const ownSessions = await listMasterySessions(learner, { query: { courseId: approvedCourse.id } });
      assert.deepEqual(ownSessions.json.map((entry) => entry.id), [savedSession.id]);

      // SCORM export through the real Prisma store: the export is recorded under the instructor.
      const evidence = createEvidenceHandlers({ store });
      const exported = await evidence.exportScorm(instructor, { query: { courseId: approvedCourse.id, version: '1.2' } });
      assert.equal(exported.headers['content-type'], 'application/zip');
      assert.ok(exported.body.length > 0);
      const exportRows = await db.learningRecord.findMany({ where: { ownerId: instructor.id, type: 'SCORM_EXPORT' } });
      records.push(...exportRows);
      assert.equal(exportRows.length, 1);
      assert.equal(exportRows[0].payload.courseId, approvedCourse.id);
      assert.equal(await status(evidence.exportScorm(learner, { query: { courseId: approvedCourse.id } })), 403);
    } finally {
      await db.learningRecord.deleteMany({ where: { id: { in: records.map((entry) => entry.id) } } });
      await db.user.deleteMany({ where: { id: { in: [instructorRow.id, learnerRow.id] } } });
    }
  },
);

test('evidence handlers enforce the store seam and instructor gates without a database', async () => {
  const saved = [];
  const store = {
    async getStudyPlanInput() {
      return { syllabus: [{ id: 'l1', title: 'Land navigation', due: '2026-02-05', hours: 1 }], asOf: '2026-02-01' };
    },
    async saveStudyPlan(args) {
      saved.push(args);
    },
    async getLearnerProfile() {
      return null;
    },
  };
  const handlers = createEvidenceHandlers({ store });
  const learner = { id: 'learner-1', name: 'Learner', role: 'LEARNER' };

  const plan = await handlers.createStudyPlan(learner, { body: { courseId: 'c1', ics: { dtstamp: '20260101T000000Z' } } });
  assert.equal(plan.status, 201);
  assert.equal(plan.json.persisted, true);
  assert.equal(saved[0].learnerId, 'learner-1');
  assert.match(saved[0].ics, /BEGIN:VCALENDAR/);

  assert.equal(await status(handlers.getProfile(learner)), 404);
  assert.equal(await status(handlers.getAar(learner, { query: { courseId: 'c1' } })), 403);
  assert.equal(await status(handlers.getAnalytics(learner, { query: { scope: 'cohort' } })), 403);
  assert.equal(await status(handlers.getAnalytics(learner, { query: {} })), 501); // seam missing
  assert.equal(await status(handlers.createStudyPlan(learner, { body: {} })), 400);
});

test('cohort handler unions learner membership across attempts and mastery records', async () => {
  const attempts = ['a', 'b', 'c', 'd'].flatMap((learnerId) => [
    { learnerId, objective: 'movement', phase: 'pre', correct: false },
    { learnerId, objective: 'movement', phase: 'post', correct: true },
  ]);
  const sessions = [
    { learnerId: 'd', criteria: [{ competency: 'movement', verdict: 'mastered' }] },
    { learnerId: 'e', criteria: [{ competency: 'movement', verdict: 'mastered' }] },
  ];
  const handlers = createEvidenceHandlers({
    store: {
      async listCohortAttempts() {
        return attempts;
      },
      async listCohortMasteryReports() {
        return sessions;
      },
    },
  });
  const result = await handlers.getAnalytics(
    { id: 'instructor-1', role: 'INSTRUCTOR' },
    { query: { scope: 'cohort', courseId: 'course-1' } },
  );

  assert.equal(result.json.privacy.observedLearners, 5);
  assert.equal(result.json.gain.status, 'insufficient_evidence');
  assert.equal(result.json.gain.observedContributors, 4);
  assert.equal(result.json.mastery.status, 'insufficient_evidence');
  assert.equal(result.json.mastery.observedContributors, 2);
});

test('count-only cohort seam responses fail closed instead of adding unknown counts', async () => {
  const handlers = createEvidenceHandlers({
    store: {
      async listCohortAttempts() {
        return {
          attempts: [
            { objective: 'movement', phase: 'pre', correct: false },
            { objective: 'movement', phase: 'post', correct: true },
          ],
          distinctLearnerCount: 4,
        };
      },
      async listCohortMasteryReports() {
        return {
          sessions: [],
          // This is the same four-person population, but the seam has no IDs
          // with which to prove that overlap.
          distinctLearnerCount: 4,
        };
      },
    },
  });
  const result = await handlers.getAnalytics(
    { id: 'instructor-1', role: 'INSTRUCTOR' },
    { query: { scope: 'cohort', courseId: 'course-1' } },
  );

  assert.equal(result.json.privacy.observedLearners, 0);
  assert.equal(result.json.gain.status, 'insufficient_evidence');
  assert.equal(result.json.mastery.status, 'insufficient_evidence');
});
