import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchRequest, Router } from '../lib/server/router.js';
import createEvidenceRouter from '../lib/server/routes/learning-evidence.js';
import learningRouter from '../lib/server/routes/learning.js';

const API_ORIGIN = 'https://schoolcircle.example.test';
let fixtureNumber = 0;

async function createFixture(t) {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is required for the isolated PostgreSQL evidence fixture');
    return null;
  }

  const dbModule = await import('../lib/server/db.js');
  const prefix = `evidence-production-${process.pid}-${Date.now()}-${fixtureNumber++}`;
  const instructorId = `${prefix}-instructor`;
  const learnerId = `${prefix}-learner`;
  const courseId = `${prefix}-course`;
  const recordIds = [];
  const userIds = new Set([instructorId, learnerId]);
  const store = dbModule.createLearningEvidenceStore();
  await dbModule.db.user.createMany({
    data: [
      { id: instructorId, name: 'Evidence fixture instructor', role: 'INSTRUCTOR' },
      { id: learnerId, name: 'Evidence fixture learner', role: 'LEARNER' },
    ],
  });

  async function ensureLearners(ids) {
    for (const id of ids) {
      if (!id || userIds.has(id)) continue;
      await dbModule.db.user.create({
        data: { id, name: `Evidence fixture ${id}`, role: 'LEARNER' },
      });
      userIds.add(id);
    }
  }

  async function insert({ ownerId, type, payload, status = 'RECORDED', id, createdAt, updatedAt }) {
    const row = await dbModule.db.learningRecord.create({
      data: {
        id: id || `${prefix}-${recordIds.length}`,
        ownerId,
        type,
        status,
        payload,
        ...(createdAt ? { createdAt } : {}),
        ...(updatedAt ? { updatedAt } : {}),
      },
    });
    recordIds.push(row.id);
    return row;
  }

  async function cleanup() {
    const ownedRows = await dbModule.db.learningRecord.findMany({
      where: { ownerId: { in: [instructorId, learnerId] } },
    });
    const ids = [...new Set([...recordIds, ...ownedRows.map((row) => row.id)])];
    if (ids.length) {
      await dbModule.db.learningRecord.deleteMany({ where: { id: { in: ids } } });
    }
    await dbModule.db.user.deleteMany({
      where: { id: { in: [...userIds] } },
    });
  }

  return {
    db: dbModule.db,
    store,
    insert,
    ensureLearners,
    cleanup,
    courseId,
    instructorId,
    learnerId,
  };
}

function evidenceRouter(fixture) {
  const verifiedInstructor = (req, _res, next) => {
    req.user = { id: fixture.instructorId, role: 'INSTRUCTOR', name: 'Evidence fixture instructor' };
    next();
  };
  return createEvidenceRouter({
    requireUser: verifiedInstructor,
    requireInstructor: verifiedInstructor,
    store: fixture.store,
  });
}

function productionRouter(fixture, role, model) {
  const identity = role === 'INSTRUCTOR'
    ? { id: fixture.instructorId, role, name: 'Evidence fixture instructor' }
    : { id: fixture.learnerId, role, name: 'Evidence fixture learner' };
  const verified = (req, _res, next) => {
    req.user = identity;
    next();
  };
  const evidence = createEvidenceRouter({
    requireUser: verified,
    requireInstructor: verified,
    store: fixture.store,
    model,
  });
  const registry = Router();
  registry.use('/learning', learningRouter);
  registry.use(evidence);
  registry.testMiddleware = [verified];
  return registry;
}

async function getResponse(router, path, options = {}) {
  const headers = new Headers(options.headers);
  let body = options.body;
  if (body !== undefined && typeof body !== 'string') {
    if (!headers.has('content-type')) headers.set('content-type', 'application/json');
    body = JSON.stringify(body);
  }
  return dispatchRequest(
    new Request(`${API_ORIGIN}/api${path}`, {
      ...options,
      headers,
      ...(body !== undefined ? { body } : {}),
    }),
    router,
    { middleware: router.testMiddleware || [] },
  );
}

async function getJson(router, path) {
  const response = await getResponse(router, path);
  return { response, body: await response.json() };
}

async function getJsonResponse(router, path, options = {}) {
  const response = await getResponse(router, path, options);
  return { response, body: await response.json() };
}

async function seedApprovedCourse(fixture) {
  await fixture.insert({
    id: fixture.courseId,
    ownerId: fixture.instructorId,
    type: 'COURSE_DRAFT',
    status: 'APPROVED',
    payload: {
      title: 'Production evidence fixture',
      approved: true,
      sections: [{
        title: 'Movement',
        cite: 'fixture doctrine p. 1',
        lesson: 'Movement keeps the unit aligned with the objective.',
        pre: [{ stem: 'What keeps the unit aligned?', options: ['Movement'], answer: 0 }],
        post: [{ stem: 'Which action keeps alignment?', options: ['Movement'], answer: 0 }],
      }],
    },
  });
}

async function seedMasteryOnly(fixture, learnerIds) {
  await fixture.ensureLearners(learnerIds);
  for (const learnerId of learnerIds) {
    await fixture.insert({
      ownerId: learnerId,
      type: 'MASTERY_SESSION',
      payload: {
        courseId: fixture.courseId,
        report: {
          criteria: [{ competency: 'movement', verdict: 'mastered' }],
        },
      },
    });
  }
}

async function seedAttempts(fixture, learnerIds) {
  await fixture.ensureLearners(learnerIds);
  for (const learnerId of learnerIds) {
    for (const phase of ['pre', 'post']) {
      await fixture.insert({
        ownerId: learnerId,
        type: 'MASTERY_ATTEMPT',
        payload: {
          courseId: fixture.courseId,
          objective: 'movement',
          phase,
          correct: phase === 'post',
          answer: { choice: phase === 'post' ? 'yes' : 'no' },
        },
      });
    }
  }
}

test('production export returns a valid Cartridge ZIP and records the instructor owner', async (t) => {
  const fixture = await createFixture(t);
  if (!fixture) return;

  try {
    await seedApprovedCourse(fixture);
    const router = evidenceRouter(fixture);
    const response = await getResponse(
      router,
      `/learning/export?courseId=${encodeURIComponent(fixture.courseId)}&version=1.2`,
    );

    assert.equal(response.status, 200);
    assert.equal(response.headers.get('content-type'), 'application/zip');
    assert.match(response.headers.get('content-disposition'), /Production-evidence-fixture\.zip/);
    assert.equal(response.headers.get('x-scorm-version'), '1.2');
    const bytes = new Uint8Array(await response.arrayBuffer());
    assert.deepEqual(Array.from(bytes.slice(0, 4)), [0x50, 0x4b, 0x03, 0x04]);
    assert.ok(bytes.length > 100);

    const auditRows = await fixture.db.learningRecord.findMany({
      where: { ownerId: fixture.instructorId, type: 'SCORM_EXPORT' },
    });
    assert.equal(auditRows.length, 1);
    assert.equal(auditRows[0].ownerId, fixture.instructorId);
    assert.equal(auditRows[0].payload.courseId, fixture.courseId);
    assert.equal(auditRows[0].payload.version, '1.2');
  } finally {
    await fixture.cleanup();
  }
});

test('production mastery-only membership suppresses four learners and emits five without fake gain', async (t) => {
  const fixture = await createFixture(t);
  if (!fixture) return;

  try {
    await seedApprovedCourse(fixture);
    const fourLearners = ['mastery-1', 'mastery-2', 'mastery-3', 'mastery-4']
      .map((id) => `${fixture.instructorId}-${id}`);
    await seedMasteryOnly(fixture, fourLearners);
    await fixture.insert({
      ownerId: fixture.instructorId,
      type: 'MASTERY_SESSION',
      payload: {
        courseId: fixture.courseId,
        report: { criteria: [{ competency: 'instructor-member', verdict: 'mastered' }] },
      },
    });
    // A persisted row without an owner identity is not a cohort member.
    await fixture.insert({
      ownerId: '',
      type: 'MASTERY_SESSION',
      payload: {
        courseId: fixture.courseId,
        report: { criteria: [{ competency: 'unknown-member', verdict: 'mastered' }] },
      },
    });
    const router = evidenceRouter(fixture);

    const suppressed = await getJson(
      router,
      `/learning/analytics/cohort?courseId=${encodeURIComponent(fixture.courseId)}`,
    );
    assert.equal(suppressed.response.status, 200);
    assert.equal(suppressed.body.privacy.observedLearners, 4);
    assert.equal(suppressed.body.gain.status, 'insufficient_evidence');
    assert.equal(suppressed.body.mastery.status, 'insufficient_evidence');

    const savedProfile = {
      dims: {
        visual: 1,
        verbal: 0,
        reading: null,
        hands_on: null,
        self_paced: null,
        structured: null,
      },
      dominantModality: 'visual',
    };
    for (const learnerId of fourLearners) {
      await fixture.insert({
        ownerId: learnerId,
        type: 'PROFILE',
        payload: { profile: savedProfile },
      });
    }
    await fixture.insert({
      ownerId: fixture.instructorId,
      type: 'PROFILE',
      payload: { profile: savedProfile },
    });
    const suppressedProfile = await getJson(
      router,
      `/learning/profile/cohort?courseId=${encodeURIComponent(fixture.courseId)}`,
    );
    assert.equal(suppressedProfile.response.status, 200);
    assert.equal(suppressedProfile.body.status, 'insufficient_evidence');
    assert.equal(suppressedProfile.body.observedLearners, 4);
    assert.equal(suppressedProfile.body.profile, null);

    await seedMasteryOnly(fixture, [`${fixture.instructorId}-mastery-5`]);
    const emitted = await getJson(
      router,
      `/learning/analytics/cohort?courseId=${encodeURIComponent(fixture.courseId)}`,
    );
    assert.equal(emitted.response.status, 200);
    assert.equal(emitted.body.privacy.observedLearners, 5);
    assert.equal(emitted.body.gain.status, 'insufficient_evidence');
    assert.equal(emitted.body.evidence.gain.status, 'insufficient_evidence');
    assert.equal(emitted.body.mastery.length, 1);
    assert.equal(emitted.body.mastery[0].competency, 'movement');
    assert.equal(emitted.body.mastery.some((item) => item.competency === 'unknown-member'), false);

    await fixture.insert({
      ownerId: `${fixture.instructorId}-mastery-5`,
      type: 'PROFILE',
      payload: { profile: savedProfile },
    });
    const cohortProfile = await getJson(
      router,
      `/learning/profile/cohort?courseId=${encodeURIComponent(fixture.courseId)}`,
    );
    assert.equal(cohortProfile.response.status, 200);
    assert.equal(cohortProfile.body.status, 'complete');
    assert.equal(cohortProfile.body.n, 5);
  } finally {
    await fixture.cleanup();
  }
});

test('production cohort membership unions mixed and disjoint attempt/session learners', async (t) => {
  const fixture = await createFixture(t);
  if (!fixture) return;

  try {
    await seedApprovedCourse(fixture);
    const attemptLearners = ['attempt-1', 'attempt-2', 'attempt-3']
      .map((id) => `${fixture.instructorId}-${id}`);
    const overlappingSessionLearner = `${fixture.instructorId}-attempt-3`;
    const disjointSessionLearner = `${fixture.instructorId}-session-4`;
    const finalDisjointLearner = `${fixture.instructorId}-session-5`;
    await seedAttempts(fixture, attemptLearners);
    await seedMasteryOnly(fixture, [overlappingSessionLearner, disjointSessionLearner]);
    const router = evidenceRouter(fixture);

    const fourLearnerResponse = await getJson(
      router,
      `/learning/analytics/cohort?courseId=${encodeURIComponent(fixture.courseId)}`,
    );
    assert.equal(fourLearnerResponse.response.status, 200);
    assert.equal(fourLearnerResponse.body.privacy.observedLearners, 4);
    assert.equal(fourLearnerResponse.body.gain.status, 'insufficient_evidence');
    const serialized = JSON.stringify(fourLearnerResponse.body);
    assert.equal(serialized.includes(attemptLearners[0]), false);
    assert.equal(serialized.includes('"answer"'), false);

    await seedMasteryOnly(fixture, [finalDisjointLearner]);
    const fiveLearnerResponse = await getJson(
      router,
      `/learning/analytics/cohort?courseId=${encodeURIComponent(fixture.courseId)}`,
    );
    assert.equal(fiveLearnerResponse.response.status, 200);
    assert.equal(fiveLearnerResponse.body.privacy.observedLearners, 5);
    assert.equal(fiveLearnerResponse.body.gain.status, 'insufficient_evidence');
    assert.deepEqual(fiveLearnerResponse.body.gaps, []);
    assert.equal(fiveLearnerResponse.body.mastery.status, 'insufficient_evidence');
  } finally {
    await fixture.cleanup();
  }
});

test('production profile save, edit, and reload preserve partial-response nulls', async (t) => {
  const fixture = await createFixture(t);
  if (!fixture) return;

  try {
    const router = productionRouter(fixture, 'LEARNER');
    const first = await getJsonResponse(
      router,
      '/learning/profile',
      {
        method: 'POST',
        body: { responses: { v1: 5, h1: 1 } },
      },
    );
    assert.equal(first.response.status, 201);
    assert.equal(first.body.profile.dims.visual, 1);
    assert.equal(first.body.profile.dims.verbal, null);
    assert.equal(first.body.profile.dims.reading, null);
    assert.equal(first.body.profile.dims.hands_on, 0);

    const edited = await getJsonResponse(
      router,
      '/learning/profile',
      {
        method: 'POST',
        body: { responses: { v1: 1, h1: 1 } },
      },
    );
    assert.equal(edited.response.status, 201);
    assert.equal(edited.body.profile.dims.visual, 0);

    const reloaded = await getJson(router, '/learning/profile');
    assert.equal(reloaded.response.status, 200);
    assert.deepEqual(reloaded.body.responses, { v1: 1, h1: 1 });
    assert.equal(reloaded.body.profile.dims.verbal, null);
    assert.equal(reloaded.body.profile.dims.self_paced, null);

    const profileRows = await fixture.db.learningRecord.findMany({
      where: { ownerId: fixture.learnerId, type: 'PROFILE' },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(profileRows.length, 2);
    assert.deepEqual(profileRows[0].payload.responses, { v1: 1, h1: 1 });
    assert.equal(profileRows[0].payload.profile.dims.verbal, null);
  } finally {
    await fixture.cleanup();
  }
});

test('production syllabus persistence drives learner plan COAs and ICS reload', async (t) => {
  const fixture = await createFixture(t);
  if (!fixture) return;

  try {
    await seedApprovedCourse(fixture);
    const instructorRouter = productionRouter(fixture, 'INSTRUCTOR');
    const learnerRouter = productionRouter(fixture, 'LEARNER');
    const syllabus = [
      { id: 'lesson-1', title: 'Land navigation', due: '2026-02-05', hours: 1 },
      { id: 'lesson-2', title: 'Movement', due: '2026-02-08', hours: 0.5, weight: 2 },
    ];
    const syllabusResponse = await getJsonResponse(
      instructorRouter,
      `/learning/courses/${encodeURIComponent(fixture.courseId)}/syllabus`,
      {
        method: 'POST',
        body: { syllabus },
      },
    );
    assert.equal(syllabusResponse.response.status, 200);
    const courseRow = await fixture.db.learningRecord.findUnique({
      where: { id: fixture.courseId },
    });
    assert.deepEqual(courseRow.payload.syllabus, syllabus);
    assert.equal(courseRow.payload.asOf, undefined);
    assert.equal(courseRow.payload.availability, undefined);

    const missingCourse = await fixture.insert({
      ownerId: fixture.instructorId,
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: { title: 'No syllabus fixture', approved: true, sections: [] },
    });
    const missing = await getJsonResponse(
      learnerRouter,
      '/learning/study-plan',
      {
        method: 'POST',
        body: { courseId: missingCourse.id, asOf: '2026-02-01' },
      },
    );
    assert.equal(missing.response.status, 404);
    assert.equal(missing.body.code, 'SYLLABUS_NOT_FOUND');

    const created = await getJsonResponse(
      learnerRouter,
      '/learning/study-plan',
      {
        method: 'POST',
        body: {
          courseId: fixture.courseId,
          asOf: '2026-02-01',
          availability: 60,
          ics: { calendarName: 'My study plan', startHour: 18 },
        },
      },
    );
    assert.equal(created.response.status, 201);
    assert.deepEqual(Object.keys(created.body.plan.coas).sort(), ['catch_up', 'get_ahead', 'maintain']);
    assert.equal(created.body.plan.asOf, '2026-02-01');
    assert.match(created.body.ics, /BEGIN:VCALENDAR\r\n/);
    assert.match(created.body.ics, /X-WR-CALNAME:My study plan\r\n/);
    assert.match(created.body.ics, /DTSTART:20260201T180000\r\n/);
    assert.match(created.body.ics, /END:VCALENDAR/);

    const planRow = await fixture.db.learningRecord.findFirst({
      where: {
        ownerId: fixture.learnerId,
        type: 'STUDY_PLAN',
      },
      orderBy: { createdAt: 'desc' },
    });
    assert.deepEqual(planRow.payload.input.syllabus, syllabus);
    assert.equal(planRow.payload.input.asOf, '2026-02-01');
    assert.equal(planRow.payload.input.availability, 60);
    assert.equal(planRow.payload.input.status, undefined);
    assert.match(planRow.payload.ics, /X-WR-CALNAME:My study plan\r\n/);
    assert.match(planRow.payload.ics, /DTSTART:20260201T180000\r\n/);

    const reloaded = await getJson(
      learnerRouter,
      `/learning/study-plan?courseId=${encodeURIComponent(fixture.courseId)}`,
    );
    assert.equal(reloaded.response.status, 200);
    assert.deepEqual(reloaded.body.input.syllabus, syllabus);
    assert.equal(reloaded.body.input.asOf, '2026-02-01');
    assert.equal(reloaded.body.input.availability, 60);
    assert.match(reloaded.body.ics, /X-WR-CALNAME:My study plan\r\n/);
    assert.match(reloaded.body.ics, /DTSTART:20260201T180000\r\n/);
    assert.deepEqual(Object.keys(reloaded.body.plan.coas).sort(), ['catch_up', 'get_ahead', 'maintain']);

    const calendar = await getResponse(
      learnerRouter,
      `/learning/study-plan?courseId=${encodeURIComponent(fixture.courseId)}&format=ics`,
    );
    assert.equal(calendar.status, 200);
    assert.equal(calendar.headers.get('content-type'), 'text/calendar');
    assert.match(await calendar.text(), /BEGIN:VCALENDAR\r\n/);
    const reminders = await getResponse(
      learnerRouter,
      `/learning/study-plan?courseId=${encodeURIComponent(fixture.courseId)}&format=reminders`,
    );
    assert.equal(reminders.status, 200);
    assert.match(await reminders.text(), /reminders/);
  } finally {
    await fixture.cleanup();
  }
});

test('production critique submissions retain all iterations in a saved AAR and reload', async (t) => {
  const fixture = await createFixture(t);
  if (!fixture) return;

  try {
    await seedApprovedCourse(fixture);
    const router = productionRouter(
      fixture,
      'INSTRUCTOR',
      async () => {
        throw new Error('fixture model unavailable');
      },
    );
    const first = await getJsonResponse(
      router,
      '/learning/aar/critiques',
      {
        method: 'POST',
        body: {
          courseId: fixture.courseId,
          critiques: [{
            area: 'brief',
            kind: 'improve',
            severity: 5,
            iteration: '2026-01',
            note: 'Clarify the opening objective.',
          }],
        },
      },
    );
    assert.equal(first.response.status, 201);

    const second = await getJsonResponse(
      router,
      '/learning/aar/critiques',
      {
        method: 'POST',
        body: {
          courseId: fixture.courseId,
          critiques: [
            {
              area: 'brief',
              kind: 'improve',
              severity: 4,
              iteration: '2026-02',
              note: 'Use a concrete example.',
            },
            {
              area: 'debrief',
              kind: 'sustain',
              iteration: '2026-02',
              note: 'Keep the peer discussion.',
            },
          ],
        },
      },
    );
    assert.equal(second.response.status, 201);

    const critiqueRows = await fixture.db.learningRecord.findMany({
      where: { ownerId: fixture.instructorId, type: 'CRITIQUE_SET' },
      orderBy: { createdAt: 'asc' },
    });
    assert.equal(critiqueRows.length, 2);
    assert.equal(critiqueRows[0].payload.critiques[0].iteration, '2026-01');
    assert.equal(critiqueRows[1].payload.critiques[0].iteration, '2026-02');
    assert.deepEqual(critiqueRows[1].payload.inputIterations, ['2026-02']);

    const generated = await getJsonResponse(
      router,
      '/learning/aar',
      {
        method: 'POST',
        body: { courseId: fixture.courseId },
      },
    );
    assert.equal(generated.response.status, 201);
    assert.equal(generated.body.source, 'heuristic');
    assert.equal(generated.body.modelAvailable, false);
    assert.deepEqual(generated.body.inputIterations, ['2026-01', '2026-02']);
    assert.equal(generated.body.input.critiques.length, 3);
    assert.equal(generated.body.report.meta.iterations, 2);

    const aarRow = await fixture.db.learningRecord.findFirst({
      where: { ownerId: fixture.instructorId, type: 'AAR' },
      orderBy: { createdAt: 'desc' },
    });
    assert.equal(aarRow.payload.input.critiques.length, 3);
    assert.deepEqual(aarRow.payload.input.iterations, ['2026-01', '2026-02']);
    assert.equal(aarRow.payload.input.provenance.critiqueSetIds.length, 2);
    assert.equal(aarRow.payload.modelAvailable, false);

    const reloaded = await getJson(
      router,
      `/learning/aar?courseId=${encodeURIComponent(fixture.courseId)}`,
    );
    assert.equal(reloaded.response.status, 200);
    assert.equal(reloaded.body.input.critiques.length, 3);
    assert.deepEqual(reloaded.body.inputIterations, ['2026-01', '2026-02']);
    assert.equal(reloaded.body.input.provenance.submissions.length, 2);
    assert.equal(reloaded.body.modelAvailable, false);
  } finally {
    await fixture.cleanup();
  }
});

test('production AAR input has deterministic id order when critique timestamps tie', async (t) => {
  const fixture = await createFixture(t);
  if (!fixture) return;

  try {
    await seedApprovedCourse(fixture);
    const tiedAt = new Date('2026-03-01T00:00:00.000Z');
    const firstId = `${fixture.instructorId}-critique-tie-a`;
    const secondId = `${fixture.instructorId}-critique-tie-b`;
    await fixture.insert({
      id: firstId,
      ownerId: fixture.instructorId,
      type: 'CRITIQUE_SET',
      payload: {
        courseId: fixture.courseId,
        critiques: [{ area: 'brief', iteration: 'tie-a', kind: 'improve', note: 'A' }],
        inputIterations: ['tie-a'],
      },
      createdAt: tiedAt,
      updatedAt: tiedAt,
    });
    await fixture.insert({
      id: secondId,
      ownerId: fixture.instructorId,
      type: 'CRITIQUE_SET',
      payload: {
        courseId: fixture.courseId,
        critiques: [{ area: 'brief', iteration: 'tie-b', kind: 'improve', note: 'B' }],
        inputIterations: ['tie-b'],
      },
      createdAt: tiedAt,
      updatedAt: tiedAt,
    });

    const input = await fixture.store.getAarInput({
      instructorId: fixture.instructorId,
      courseId: fixture.courseId,
    });
    assert.deepEqual(input.provenance.critiqueSetIds, [firstId, secondId]);
    assert.deepEqual(input.iterations, ['tie-a', 'tie-b']);
    assert.deepEqual(input.critiques.map((critique) => critique.iteration), ['tie-a', 'tie-b']);
  } finally {
    await fixture.cleanup();
  }
});