import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { mock, test } from 'node:test';

/*
 * This is an isolated, database-backed loop test for the root Next handler.
 * Identity is deliberately not mocked: each request carries a signed session
 * whose subject and database id resolve through auth-boundary.js and auth.js,
 * so the Prisma User.role remains authoritative. The only test seams are
 * model I/O: lib/server/model.js supplies the current Coursewright/Sourcerer
 * JSON contracts, while fetch is intercepted only for the OpenAI-compatible
 * Rubricon and Whetstone transports. Quarry, Coursewright, Rubricon, Sourcerer,
 * Whetstone, persistence, approval guards, and the Next route registry all run
 * for real; no feature output or LearningRecord is seeded by this test.
 */

const API_ORIGIN = 'https://schoolcircle.example.test';
const SOURCE_TEXT =
  'Before operation, inspect the safety latch and confirm the indicator is green. ' +
  'Record the safety check in the training log.';

function generatedCourseResponse(system) {
  if (system.includes('micro-lesson')) {
    return {
      refused: false,
      lesson:
        'Before operation, inspect the safety latch and confirm the indicator is green. ' +
        'Record the safety check in the training log.',
    };
  }
  if (system.includes('"items"')) {
    return {
      refused: false,
      items: [
        {
          stem: 'What must the learner inspect before operation?',
          options: ['The safety latch', 'The weather report'],
          answerIndex: 0,
          rationale: 'Before operation, inspect the safety latch.',
        },
      ],
    };
  }
  if (system.includes('"cards"')) {
    return {
      refused: false,
      cards: [
        {
          front: 'What must be inspected before operation?',
          back: 'Before operation, inspect the safety latch.',
        },
      ],
    };
  }
  if (system.includes('Design ONE realistic applied scenario')) {
    return {
      refused: false,
      situation: 'Before operation, inspect the safety latch.',
      task: 'Confirm the indicator is green.',
      coaching: 'Record the safety check in the training log.',
    };
  }
  if (system.includes('Write THREE open-ended discussion prompts')) {
    return {
      refused: false,
      prompts: [
        'Why inspect the safety latch before operation?',
        'How do you confirm the indicator is green?',
        'When should you record the safety check in the training log?',
      ],
    };
  }
  if (system.includes('summarize a generated course')) {
    return {
      refused: false,
      summary:
        'The course covers the safety latch before operation and the green indicator. ' +
        'It also covers recording the safety check in the training log.',
    };
  }
  if (system.includes('Answer ONLY from the provided passages')) {
    return {
      refused: false,
      answer: 'Before operation, inspect the safety latch and confirm the indicator is green. [1]',
      used: [1],
    };
  }
  if (system.includes('strict fact-checker')) {
    return {
      claims: [
        {
          claim: 'Before operation, inspect the safety latch and confirm the indicator is green.',
          supported: true,
        },
      ],
      unsupported: [],
    };
  }
  throw new Error(`Unexpected model system prompt: ${system}`);
}

mock.module('../lib/server/model.js', {
  namedExports: {
    providerStatus: () => ({ ready: true, reason: null, provider: 'isolated-test-model' }),
    generateJSON: async ({ system }) => ({ data: generatedCourseResponse(system) }),
    askJSON: async ({ system }) => ({ data: generatedCourseResponse(system) }),
  },
});

const { POST, GET } = await import('../app/api/[...path]/route.js');

function jsonRequest(path, token, method, body) {
  const headers = new Headers();
  if (token) headers.set('authorization', `Bearer ${token}`);
  if (body !== undefined) headers.set('content-type', 'application/json');
  return new Request(`${API_ORIGIN}/api${path}`, {
    method,
    headers,
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
}

async function json(response) {
  const body = await response.json();
  return body;
}

async function request(method, path, token, body) {
  const handler = method === 'GET' ? GET : POST;
  const response = await handler(jsonRequest(path, token, method, body));
  return { response, body: await json(response) };
}

function rubriconResponse() {
  return new Response(
    JSON.stringify({
      choices: [
        {
          message: {
            content: JSON.stringify({
              flagged: false,
              dimensions: [
                {
                  name: 'Safety latch inspection',
                  source: 'Before operation, inspect the safety latch',
                  anchors: {
                    unsatisfactory: 'Does not inspect the safety latch.',
                    satisfactory: 'Inspects the safety latch before operation.',
                    proficient: 'Inspects the safety latch before operation and confirms the indicator is green.',
                  },
                },
              ],
            }),
          },
        },
      ],
    }),
    { status: 200, headers: { 'content-type': 'application/json' } },
  );
}

function whetstoneResponse(user) {
  if (user.includes('Build the mastery rubric.')) {
    return {
      criteria: [
        {
          elo: 'Safety latch inspection',
          indicators: {
            developing: 'Names the safety latch.',
            competent: 'Explains the safety latch inspection.',
            mastered: 'Explains inspecting the safety latch before operation.',
          },
        },
        {
          elo: 'Safety check recording',
          indicators: {
            developing: 'Mentions a training log.',
            competent: 'Explains recording the safety check.',
            mastered: 'Explains recording the safety check in the training log.',
          },
        },
      ],
    };
  }
  if (user.includes('Ask the opening question.')) {
    return { question: 'What must you inspect before operation?' };
  }
  if (user.includes('Score it.')) {
    return {
      verdict: 'mastered',
      feedback: 'Correct: you explained the safety latch inspection before operation.',
      followup: '',
    };
  }
  throw new Error(`Unexpected Whetstone prompt: ${user}`);
}

test('root Next route proves the connected core learning loop', async (t) => {
  if (!process.env.DATABASE_URL) {
    t.skip('DATABASE_URL is required for the isolated PostgreSQL learning-loop fixture');
    return;
  }

  const dbModule = await import('../lib/server/db.js');
  const session = await import('../lib/server/session.js');
  const suffix = `core-learning-loop-${process.pid}-${Date.now()}-${randomUUID()}`;
  const fixtureOwnerIds = [];
  const fixtureUserIds = [];
  const previousEnv = new Map(
    [
      'SESSION_SECRET',
      'RUBRICON_ENDPOINT',
      'RUBRICON_MODEL',
      'RUBRICON_API_KEY',
      'WHETSTONE_ENDPOINT',
      'WHETSTONE_MODEL',
      'WHETSTONE_API_KEY',
    ].map((key) => [key, process.env[key]]),
  );
  process.env.SESSION_SECRET = `${suffix}-session-secret`;
  process.env.RUBRICON_ENDPOINT = 'https://core-learning-loop-rubricon.test/chat';
  process.env.RUBRICON_MODEL = 'core-learning-loop-rubricon';
  process.env.RUBRICON_API_KEY = 'core-learning-loop-rubricon-key';
  process.env.WHETSTONE_ENDPOINT = 'https://core-learning-loop-whetstone.test/chat';
  process.env.WHETSTONE_MODEL = 'core-learning-loop-whetstone';
  process.env.WHETSTONE_API_KEY = 'core-learning-loop-whetstone-key';

  const fetchMock = mock.method(globalThis, 'fetch', async (url, init = {}) => {
    if (url === process.env.RUBRICON_ENDPOINT) return rubriconResponse();
    if (url === process.env.WHETSTONE_ENDPOINT) {
      const requestBody = JSON.parse(init.body);
      return new Response(
        JSON.stringify({
          choices: [
            {
              message: {
                content: JSON.stringify(whetstoneResponse(requestBody.messages?.[1]?.content || '')),
              },
            },
          ],
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    }
    throw new Error(`Unexpected non-model fetch: ${url}`);
  });

  t.after(async () => {
    fetchMock.mock.restore();
    if (fixtureOwnerIds.length) {
      await dbModule.db.learningRecord.deleteMany({
        where: { ownerId: { in: fixtureOwnerIds } },
      });
    }
    if (fixtureUserIds.length) {
      await dbModule.db.user.deleteMany({
        where: { id: { in: fixtureUserIds } },
      });
    }
    for (const [key, value] of previousEnv) {
      if (value === undefined) delete process.env[key];
      else process.env[key] = value;
    }
  });

  async function createUser(role, label) {
    const user = await dbModule.db.user.create({
      data: {
        name: `${label} ${suffix}`,
        role,
        externalId: `${suffix}-${label.toLowerCase()}-${randomUUID()}`,
      },
    });
    fixtureOwnerIds.push(user.id);
    fixtureUserIds.push(user.id);
    return user;
  }

  const instructor = await createUser('INSTRUCTOR', 'Instructor');
  const learners = [
    await createUser('LEARNER', 'Learner 1'),
    await createUser('LEARNER', 'Learner 2'),
    await createUser('LEARNER', 'Learner 3'),
    await createUser('LEARNER', 'Learner 4'),
    await createUser('LEARNER', 'Learner 5'),
  ];
  const tokenFor = (user) =>
    session.createSessionToken({ userId: user.id, subject: user.externalId });
  const instructorToken = tokenFor(instructor);
  const learnerTokens = learners.map(tokenFor);

  const sourceCreated = await request('POST', '/learning/sources', instructorToken, {
    title: `Core loop source ${suffix}`,
    sourceId: `core-loop-source-${suffix}`,
    text: SOURCE_TEXT,
    pages: [{ page: 1, text: SOURCE_TEXT }],
  });
  assert.equal(sourceCreated.response.status, 201);
  assert.equal(sourceCreated.body.status, 'PENDING');
  const sourceId = sourceCreated.body.id;
  const pendingSource = await dbModule.db.learningRecord.findUnique({ where: { id: sourceId } });
  assert.equal(pendingSource.ownerId, instructor.id);
  assert.equal(pendingSource.type, 'SOURCE');
  assert.equal(pendingSource.status, 'PENDING');
  assert.equal(pendingSource.payload.pages[0].page, 1);
  assert.ok(pendingSource.payload.chunks.length > 0);

  const learnerPendingSource = await request(
    'GET',
    `/learning/sources/${sourceId}`,
    learnerTokens[0],
  );
  assert.equal(learnerPendingSource.response.status, 404);
  const sourceApproval = await request(
    'POST',
    `/learning/sources/${sourceId}/approve`,
    instructorToken,
    {},
  );
  assert.equal(sourceApproval.response.status, 200);
  assert.equal(sourceApproval.body.status, 'APPROVED');
  const learnerSource = await request('GET', `/learning/sources/${sourceId}`, learnerTokens[0]);
  assert.equal(learnerSource.response.status, 200);
  assert.equal(learnerSource.body.status, 'APPROVED');
  assert.equal(learnerSource.body.pages[0].page, 1);
  assert.ok(learnerSource.body.chunks[0].text.includes('safety latch'));

  const draftCreated = await request('POST', '/learning/courses/draft', instructorToken, {
    title: `Core loop course ${suffix}`,
    objectives: ['Explain the safety latch inspection before operation'],
    sourceIds: [sourceId],
    diagrams: false,
  });
  assert.equal(draftCreated.response.status, 201);
  assert.equal(draftCreated.body.status, 'PENDING');
  const courseId = draftCreated.body.id;
  const draft = await dbModule.db.learningRecord.findUnique({ where: { id: courseId } });
  assert.equal(draft.ownerId, instructor.id);
  assert.equal(draft.type, 'COURSE_DRAFT');
  assert.equal(draft.status, 'PENDING');
  assert.equal(draft.payload.sourceIds[0], sourceId);
  assert.equal(draft.payload.sections.length, 1);
  assert.match(draft.payload.sections[0].lesson, /safety latch/);
  assert.equal(draft.payload.sections[0].pre[0].answer, 0);
  assert.equal(draft.payload.sections[0].post[0].answer, 0);

  const learnerPendingCourse = await request(
    'GET',
    `/learning/courses/${courseId}`,
    learnerTokens[0],
  );
  assert.equal(learnerPendingCourse.response.status, 404);
  const courseApproval = await request(
    'POST',
    `/learning/courses/${courseId}/approve`,
    instructorToken,
    {},
  );
  assert.equal(courseApproval.response.status, 200);
  assert.equal(courseApproval.body.status, 'APPROVED');
  const learnerCourse = await request('GET', `/learning/courses/${courseId}`, learnerTokens[0]);
  assert.equal(learnerCourse.response.status, 200);
  assert.equal(learnerCourse.body.status, 'APPROVED');
  assert.deepEqual(learnerCourse.body.course.sourceIds, [sourceId]);
  assert.equal(learnerCourse.body.course.sections[0].lesson.includes('safety latch'), true);
  assert.equal('answer' in learnerCourse.body.course.sections[0].pre[0], false);
  assert.equal('rationale' in learnerCourse.body.course.sections[0].pre[0], false);

  const rubricCreated = await request('POST', '/learning/rubrics/generate', instructorToken, {
    sourceId,
    task: {
      code: `CORE-${suffix}`,
      title: 'Safety latch inspection',
      standard: 'Before operation, inspect the safety latch and confirm the indicator is green.',
    },
  });
  assert.equal(rubricCreated.response.status, 201);
  assert.equal(rubricCreated.body.status, 'PENDING');
  assert.equal(rubricCreated.body.validation.valid, true);
  assert.equal(rubricCreated.body.traceability.grounded, true);
  const rubricId = rubricCreated.body.id;
  const rubricApproval = await request(
    'POST',
    `/learning/rubrics/${rubricId}/approve`,
    instructorToken,
    {},
  );
  assert.equal(rubricApproval.response.status, 200);
  assert.equal(rubricApproval.body.status, 'APPROVED');
  const learnerRubric = await request('GET', `/learning/rubrics/${rubricId}`, learnerTokens[0]);
  assert.equal(learnerRubric.response.status, 403);

  const citedAnswer = await request('POST', '/learning/tutor', learnerTokens[0], {
    sourceIds: [sourceId],
    question: 'What must the learner inspect before operation?',
  });
  assert.equal(citedAnswer.response.status, 200);
  assert.equal(citedAnswer.body.refused, false);
  assert.match(citedAnswer.body.answer, /\[1\]/);
  assert.equal(citedAnswer.body.citations[0].source, `${sourceId} p.1`);
  const citedTurn = await dbModule.db.learningRecord.findUnique({
    where: { id: citedAnswer.body.id },
  });
  assert.equal(citedTurn.ownerId, learners[0].id);
  assert.equal(citedTurn.payload.refused, false);
  assert.equal(citedTurn.payload.citations[0].source, `${sourceId} p.1`);

  const refusedAnswer = await request('POST', '/learning/tutor', learnerTokens[0], {
    sourceIds: [sourceId],
    question: 'What is the moon phase today?',
  });
  assert.equal(refusedAnswer.response.status, 200);
  assert.equal(refusedAnswer.body.refused, true);
  assert.equal(refusedAnswer.body.citations.length, 0);
  const refusedTurn = await dbModule.db.learningRecord.findUnique({
    where: { id: refusedAnswer.body.id },
  });
  assert.equal(refusedTurn.ownerId, learners[0].id);
  assert.equal(refusedTurn.payload.refused, true);

  async function createAndCompletePractice(learnerIndex) {
    const started = await request('POST', '/learning/mastery/sessions', learnerTokens[learnerIndex], {
      sourceId,
      courseId,
      objectives: 'Explain the safety latch inspection before operation',
      maxTurns: 2,
    });
    assert.equal(started.response.status, 201);
    assert.equal(started.body.status, 'ACTIVE');
    assert.equal(started.body.currentQuestion, 'What must you inspect before operation?');
    const sessionId = started.body.id;
    const persistedStart = await dbModule.db.learningRecord.findUnique({
      where: { id: sessionId },
    });
    assert.equal(persistedStart.ownerId, learners[learnerIndex].id);
    assert.equal(persistedStart.version, 0);
    assert.equal(persistedStart.status, 'ACTIVE');

    const turn = await request(
      'POST',
      `/learning/mastery/sessions/${sessionId}/turn`,
      learnerTokens[learnerIndex],
      { answer: 'Before operation, inspect the safety latch and confirm the indicator is green.' },
    );
    assert.equal(turn.response.status, 200, JSON.stringify(turn.body));
    assert.equal(turn.body.result.complete, false);
    assert.equal(turn.body.result.verdict, 'mastered');
    assert.equal((await dbModule.db.learningRecord.findUnique({ where: { id: sessionId } })).payload.eloIndex, 1);
    const resumed = await request(
      'GET',
      `/learning/mastery/sessions/${sessionId}`,
      learnerTokens[learnerIndex],
    );
    assert.equal(resumed.response.status, 200);
    assert.equal(resumed.body.status, 'ACTIVE');
    assert.equal(resumed.body.version, 1);
    assert.equal(resumed.body.currentQuestion, 'What must you inspect before operation?');
    assert.equal(resumed.body.report.criteria[0].verdict, 'mastered');
    assert.equal(resumed.body.report.criteria[1].verdict, 'not yet assessed');
    const completedTurn = await request(
      'POST',
      `/learning/mastery/sessions/${sessionId}/turn`,
      learnerTokens[learnerIndex],
      { answer: 'Record the safety check in the training log.' },
    );
    assert.equal(completedTurn.response.status, 200, JSON.stringify(completedTurn.body));
    assert.equal(completedTurn.body.result.complete, true);
    assert.equal(completedTurn.body.result.verdict, 'mastered');
    assert.equal((await dbModule.db.learningRecord.findUnique({ where: { id: sessionId } })).payload.eloIndex, 2);
    const loaded = await request(
      'GET',
      `/learning/mastery/sessions/${sessionId}`,
      learnerTokens[learnerIndex],
    );
    assert.equal(loaded.response.status, 200);
    assert.equal(loaded.body.status, 'COMPLETE');
    assert.equal(loaded.body.version, 2);
    assert.equal(loaded.body.currentQuestion, null);
    assert.equal(loaded.body.report.criteria[0].verdict, 'mastered');
    assert.equal(loaded.body.report.criteria[1].verdict, 'mastered');
    assert.equal(loaded.body.citations[0].page, 1);
    assert.equal(loaded.body.rubric, undefined);
    assert.equal(loaded.body.source, undefined);
    assert.equal(
      await dbModule.updateLearningRecordIfVersion(sessionId, 0, { status: 'ACTIVE' }),
      false,
    );
    return sessionId;
  }

  await createAndCompletePractice(0);
  const suppressed = await request(
    'GET',
    `/learning/analytics/cohort?courseId=${encodeURIComponent(courseId)}`,
    instructorToken,
  );
  assert.equal(suppressed.response.status, 200);
  assert.equal(suppressed.body.privacy.observedLearners, 1);
  assert.equal(suppressed.body.privacy.learnerIdsReturned, false);
  assert.equal(suppressed.body.gain.status, 'insufficient_evidence');
  assert.equal(suppressed.body.mastery.status, 'insufficient_evidence');

  await createAndCompletePractice(1);
  await createAndCompletePractice(2);
  await createAndCompletePractice(3);
  await createAndCompletePractice(4);
  const cohort = await request(
    'GET',
    `/learning/analytics/cohort?courseId=${encodeURIComponent(courseId)}`,
    instructorToken,
  );
  assert.equal(cohort.response.status, 200);
  assert.equal(cohort.body.privacy.observedLearners, 5);
  assert.equal(cohort.body.privacy.learnerIdsReturned, false);
  assert.equal(cohort.body.gain.status, 'insufficient_evidence');
  assert.equal(cohort.body.evidence.gain.status, 'insufficient_evidence');
  assert.ok(Array.isArray(cohort.body.mastery));
  assert.ok(cohort.body.mastery.length > 0);
  for (const learner of learners) {
    assert.equal(JSON.stringify(cohort.body).includes(learner.id), false);
  }
});