/*
 * Recording a learner's answer in a generated course.
 *
 * What these guard, in order of how much it would cost to get wrong:
 *   1. Only an APPROVED item is answerable — a PENDING one is neither listed
 *      nor gradeable, and it is refused with the same message as an item that
 *      does not exist.
 *   2. A learner cannot record against a course they cannot see, and cannot
 *      pin a release that is not one of that course's own.
 *   3. The attempt is attributed to the VERIFIED identity and to the exact
 *      ratified item, never to anything the request body claims.
 *   4. The recorded row is the shape the instructor-side reader consumes:
 *      lib/db.js `listCohortAttempts` filters on it and Sextant grades it
 *      through buildAnalytics, so a missing phase or objective is a silent
 *      analytics blackout rather than an error.
 *
 * The store is injected, so no Prisma client and no database are involved.
 */
import assert from 'node:assert/strict';
import test from 'node:test';

import {
  createCourseAttemptHandlers,
  gradeItem,
  itemAddress,
  recordedAnswers,
} from '../lib/learning/attempts.js';
import { buildAnalytics } from '../lib/arsenal-evidence.js';

const LEARNER = { id: 'learner-1', role: 'LEARNER' };
const OTHER = { id: 'learner-2', role: 'LEARNER' };

const COURSE_ID = 'course-record-1';
const RELEASE_ID = 'course-record-1';

function approvedQuestion(id, overrides = {}) {
  return {
    id,
    kind: 'QUESTION',
    stem: 'Which principle applies?',
    options: ['Use cover', 'Ignore terrain'],
    answer: 0,
    rationale: 'Cover is what the source names first.',
    citation: { citation: 'src-1 p.135', pubId: 'TC 3-22.9', page: '135' },
    support: 0.9,
    status: 'APPROVED',
    ...overrides,
  };
}

function fixture({ courseRecord, sections } = {}) {
  const saved = [];
  const record = courseRecord === undefined
    ? {
        id: COURSE_ID,
        type: 'COURSE_DRAFT',
        status: 'APPROVED',
        ownerId: 'instructor-1',
        payload: { title: 'Movement', deliveryCourseId: RELEASE_ID },
      }
    : courseRecord;
  const releaseSections = sections || [{
    id: `${COURSE_ID}:s1`,
    title: 'Movement fundamentals',
    order: 0,
    items: [
      { id: `${COURSE_ID}:s1:lesson`, kind: 'LESSON', stem: 'Read this.', options: null, answer: null, status: 'APPROVED' },
      approvedQuestion(`${COURSE_ID}:s1:pre1`),
      approvedQuestion(`${COURSE_ID}:s1:post1`, { status: 'PENDING', stem: 'Unratified question?' }),
    ],
  }];
  const store = {
    async getCourseRecord(id) {
      return record && record.id === id ? record : null;
    },
    async listReleaseSections(releaseId) {
      return releaseId === RELEASE_ID ? releaseSections : [];
    },
    async listLearnerAttempts(learnerId) {
      // Newest first, as lib/db.js listLearningRecords returns them.
      return saved.filter((row) => row.ownerId === learnerId).slice().reverse();
    },
    async saveAttempt(learnerId, payload) {
      const row = { id: `rec-${saved.length + 1}`, ownerId: learnerId, type: 'MASTERY_ATTEMPT', status: 'RECORDED', payload };
      saved.push(row);
      return row;
    },
  };
  return { handlers: createCourseAttemptHandlers({ store }), saved, store };
}

function answerBody(overrides = {}) {
  return { itemId: `${COURSE_ID}:s1:pre1`, optionId: '0', attemptId: 'attempt-a', ...overrides };
}

/* ------------------------------ pure rules -------------------------------- */

test('a materialised item id states which half of a pre/post pair it belongs to', () => {
  assert.deepEqual(itemAddress('rec:s2:pre3'), { phase: 'pre', ordinal: 3 });
  assert.deepEqual(itemAddress('rec:s2:post1'), { phase: 'post', ordinal: 1 });
  // A lesson, a scenario and a legacy seeded id carry no phase, and are not
  // given one: an invented phase is a fabricated pre/post pairing.
  assert.equal(itemAddress('rec:s2:lesson'), null);
  assert.equal(itemAddress('rec:scenario:item'), null);
  assert.equal(itemAddress('seeded-item-9'), null);
});

test('grading names the same fields the published reader returns', () => {
  const item = approvedQuestion('rec:s1:pre1');
  assert.deepEqual(gradeItem(item, '0'), {
    blockId: 'rec:s1:pre1',
    optionId: '0',
    correct: true,
    feedback: 'Cover is what the source names first.',
  });
  assert.equal(gradeItem(item, '1').correct, false);
});

test('a choice outside the item is refused rather than coerced', () => {
  const item = approvedQuestion('rec:s1:pre1');
  for (const bad of ['2', '-1', 'Use cover', '', null, undefined, '1.5']) {
    assert.throws(() => gradeItem(item, bad), /optionId must be the index/);
  }
});

test('an approved question with no usable key is not graded at all', () => {
  const item = approvedQuestion('rec:s1:pre1', { answer: null });
  assert.throws(() => gradeItem(item, '0'), /no keyed answer/);
});

test('the newest answer per item is what the reader gets back', () => {
  const rows = [
    { payload: { courseId: 'c', releaseId: 'r', itemId: 'i1', result: { optionId: '1', correct: false, feedback: 'no' } } },
    { payload: { courseId: 'c', releaseId: 'r', itemId: 'i1', result: { optionId: '0', correct: true, feedback: 'yes' } } },
    { payload: { courseId: 'c', releaseId: 'other', itemId: 'i2', result: { optionId: '0', correct: true, feedback: 'x' } } },
  ];
  assert.deepEqual(recordedAnswers(rows, 'c', 'r'), {
    i1: { optionId: '1', correct: false, feedback: 'no' },
  });
});

/* --------------------------- the answerable set --------------------------- */

test('only ratified questions are offered to a learner', async () => {
  const { handlers } = fixture();
  const { json } = await handlers.getCourseAttempts(LEARNER, { params: { id: COURSE_ID }, query: {} });
  assert.equal(json.releaseId, RELEASE_ID);
  assert.equal(json.items.length, 1);
  assert.equal(json.items[0].id, `${COURSE_ID}:s1:pre1`);
  assert.equal(json.items[0].sectionIndex, 0);
  assert.equal(json.items[0].phase, 'pre');
  // The pending question's own text never leaves the server.
  assert.doesNotMatch(JSON.stringify(json), /Unratified question/);
});

test('the ratified set carries the lesson prose a learner may read', async () => {
  // This response is the reader's ONLY source of course content. Prose used to
  // come from the authoring draft instead, which no ratification decision
  // touches, so a PENDING lesson was read by learners anyway.
  const { handlers } = fixture();
  const { json } = await handlers.getCourseAttempts(LEARNER, { params: { id: COURSE_ID }, query: {} });
  assert.deepEqual(json.lessons, [{
    sectionIndex: 0,
    sectionTitle: 'Movement fundamentals',
    id: `${COURSE_ID}:s1:lesson`,
    released: true,
    text: 'Read this.',
    citation: null,
    content: null,
  }]);
});

test('the structured teaching content on a lesson row is released with its prose and withheld with it', async () => {
  // Pages, diagram and flashcards ride on the LESSON row's `options` (see
  // project-course.js `lessonContent`), so one ratification decision governs
  // the words a learner reads AND the pages they read them through.
  const content = { intro: 'Why this matters.', pages: [{ title: 'One idea', blocks: [{ type: 'p', text: 'Read this.' }] }] };
  const lessonRow = (status) => ({
    id: `${COURSE_ID}:s1:lesson`, kind: 'LESSON', stem: 'Read this.', options: content, answer: null, citation: null, status,
  });
  const section = (status) => ({ id: `${COURSE_ID}:s1`, title: 'Movement fundamentals', order: 0, items: [lessonRow(status)] });

  const released = fixture({ sections: [section('APPROVED')] });
  const { json: shown } = await released.handlers.getCourseAttempts(LEARNER, { params: { id: COURSE_ID }, query: {} });
  assert.deepEqual(shown.lessons[0].content, content);

  const withheld = fixture({ sections: [section('PENDING')] });
  const { json: hidden } = await withheld.handlers.getCourseAttempts(LEARNER, { params: { id: COURSE_ID }, query: {} });
  assert.equal(hidden.lessons[0].released, false);
  assert.equal(hidden.lessons[0].content, null);
  assert.doesNotMatch(JSON.stringify(hidden.lessons), /Why this matters|One idea/);
});

test('a lesson a human has not ratified is withheld exactly as a question is', async () => {
  const { handlers } = fixture({
    sections: [{
      id: `${COURSE_ID}:s1`,
      title: 'Movement fundamentals',
      order: 0,
      items: [
        {
          id: `${COURSE_ID}:s1:lesson`,
          kind: 'LESSON',
          stem: 'Unratified lesson prose.',
          options: null,
          answer: null,
          citation: { citation: 'src-1 p.135', pubId: 'TC 3-22.9', page: '135' },
          status: 'PENDING',
        },
        approvedQuestion(`${COURSE_ID}:s1:pre1`),
      ],
    }],
  });
  const { json } = await handlers.getCourseAttempts(LEARNER, { params: { id: COURSE_ID }, query: {} });
  assert.equal(json.lessons.length, 1);
  assert.equal(json.lessons[0].released, false);
  // Neither the wording nor the citation that vouches for it leaves the server.
  assert.doesNotMatch(JSON.stringify(json.lessons), /Unratified lesson prose|p\.135/);
  // The approved check in the same section is unaffected: a learner still has
  // something to do, and the answer they give is still recorded.
  assert.equal(json.items.length, 1);
  const recorded = await handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody(),
  });
  assert.equal(recorded.json.recorded, true);
});

test('the answerable set carries no answer key, rationale or support score', async () => {
  const { handlers } = fixture();
  const { json } = await handlers.getCourseAttempts(LEARNER, { params: { id: COURSE_ID }, query: {} });
  assert.deepEqual(Object.keys(json.items[0]).sort(), [
    'id', 'options', 'ordinal', 'phase', 'sectionIndex', 'sectionTitle', 'stem',
  ]);
  assert.doesNotMatch(JSON.stringify(json), /Cover is what the source names first|"answer"|"support"/);
});

test('a learner sees only their own recorded answers', async () => {
  const { handlers } = fixture();
  await handlers.recordCourseAttempt(LEARNER, { params: { id: COURSE_ID }, body: answerBody() });
  const mine = await handlers.getCourseAttempts(LEARNER, { params: { id: COURSE_ID }, query: {} });
  const theirs = await handlers.getCourseAttempts(OTHER, { params: { id: COURSE_ID }, query: {} });
  assert.deepEqual(mine.json.answers, {
    [`${COURSE_ID}:s1:pre1`]: { optionId: '0', correct: true, feedback: 'Cover is what the source names first.' },
  });
  assert.deepEqual(theirs.json.answers, {});
});

/* ------------------------------- recording -------------------------------- */

test('an answer is recorded, attributed, and graded back to the learner', async () => {
  const { handlers, saved } = fixture();
  const response = await handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody(),
  });
  assert.equal(response.status, 201);
  assert.equal(response.json.result.correct, true);
  assert.equal(response.json.result.feedback, 'Cover is what the source names first.');
  assert.equal(saved.length, 1);
  assert.equal(saved[0].ownerId, LEARNER.id);
  assert.equal(saved[0].type, 'MASTERY_ATTEMPT');
  assert.equal(saved[0].status, 'RECORDED');
  assert.equal(saved[0].payload.itemId, `${COURSE_ID}:s1:pre1`);
  assert.equal(saved[0].payload.courseId, COURSE_ID);
  assert.equal(saved[0].payload.releaseId, RELEASE_ID);
});

test('a PENDING item is never answerable, and says no more than a missing one', async () => {
  const { handlers, saved } = fixture();
  const pending = handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody({ itemId: `${COURSE_ID}:s1:post1` }),
  });
  await assert.rejects(pending, (error) => error.code === 'NOT_FOUND' && /Item not found/.test(error.message));
  const absent = handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody({ itemId: 'no-such-item' }),
  });
  await assert.rejects(absent, (error) => error.code === 'NOT_FOUND' && /Item not found/.test(error.message));
  // A lesson block is not an assessment and cannot be answered either.
  const lesson = handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody({ itemId: `${COURSE_ID}:s1:lesson` }),
  });
  await assert.rejects(lesson, (error) => error.code === 'NOT_FOUND');
  assert.equal(saved.length, 0);
});

test('a course a learner cannot see cannot be recorded against', async () => {
  for (const courseRecord of [
    null,
    { id: COURSE_ID, type: 'COURSE_DRAFT', status: 'PENDING', ownerId: 'instructor-1', payload: {} },
    { id: COURSE_ID, type: 'SOURCE', status: 'APPROVED', ownerId: 'instructor-1', payload: {} },
  ]) {
    const { handlers, saved } = fixture({ courseRecord });
    await assert.rejects(
      handlers.recordCourseAttempt(LEARNER, { params: { id: COURSE_ID }, body: answerBody() }),
      (error) => error.code === 'NOT_FOUND' && /Course not found/.test(error.message),
    );
    await assert.rejects(
      handlers.getCourseAttempts(LEARNER, { params: { id: COURSE_ID }, query: {} }),
      (error) => error.code === 'NOT_FOUND',
    );
    assert.equal(saved.length, 0);
  }
});

test('a release pin cannot reach a release this course does not own', async () => {
  const { handlers, saved } = fixture();
  await assert.rejects(
    handlers.recordCourseAttempt(LEARNER, {
      params: { id: COURSE_ID },
      body: answerBody({ releaseId: 'some-other-course' }),
    }),
    (error) => error.code === 'NOT_FOUND' && /Release not found/.test(error.message),
  );
  assert.equal(saved.length, 0);
});

test('retrying the same answer replays it; reusing the key for another is a conflict', async () => {
  const { handlers, saved } = fixture();
  const first = await handlers.recordCourseAttempt(LEARNER, { params: { id: COURSE_ID }, body: answerBody() });
  const replay = await handlers.recordCourseAttempt(LEARNER, { params: { id: COURSE_ID }, body: answerBody() });
  assert.equal(replay.json.recorded, false);
  assert.deepEqual(replay.json.result, first.json.result);
  assert.equal(saved.length, 1);

  await assert.rejects(
    handlers.recordCourseAttempt(LEARNER, { params: { id: COURSE_ID }, body: answerBody({ optionId: '1' }) }),
    (error) => error.code === 'CONFLICT',
  );
  assert.equal(saved.length, 1);

  // A different key for a different choice is a genuine second attempt, and
  // both stay on record: the miss is evidence.
  const second = await handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody({ optionId: '1', attemptId: 'attempt-b' }),
  });
  assert.equal(second.json.result.correct, false);
  assert.equal(saved.length, 2);
});

test('a malformed request is refused before anything is written', async () => {
  const { handlers, saved } = fixture();
  for (const body of [
    answerBody({ itemId: '' }),
    answerBody({ attemptId: '' }),
    answerBody({ optionId: undefined }),
    answerBody({ optionId: '7' }),
  ]) {
    await assert.rejects(
      handlers.recordCourseAttempt(LEARNER, { params: { id: COURSE_ID }, body }),
      (error) => error.code === 'BAD_REQUEST',
    );
  }
  assert.equal(saved.length, 0);
});

/* ------------------- the shape the instructor side reads ------------------ */

test('the recorded row is what the evidence store filters for and Sextant grades', async () => {
  const sections = [{
    id: `${COURSE_ID}:s1`,
    title: 'Movement fundamentals',
    order: 0,
    items: [
      approvedQuestion(`${COURSE_ID}:s1:pre1`),
      approvedQuestion(`${COURSE_ID}:s1:post1`, { answer: 1 }),
    ],
  }];
  const { handlers, saved } = fixture({ sections });
  // One learner gets the pre wrong and the post right: a real learning gain.
  await handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody({ itemId: `${COURSE_ID}:s1:pre1`, optionId: '1', attemptId: 'a1' }),
  });
  await handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody({ itemId: `${COURSE_ID}:s1:post1`, optionId: '1', attemptId: 'a2' }),
  });

  const payloads = saved.map((row) => row.payload);
  // lib/db.js listLearnerAttempts / listCohortAttempts admit a row only when
  // all four of these hold. Losing any one of them is a silent blackout, not
  // an error, which is why it is pinned here rather than left to integration.
  for (const payload of payloads) {
    assert.equal(payload.courseId, COURSE_ID);
    assert.equal(payload.releaseId, RELEASE_ID);
    assert.ok(payload.phase === 'pre' || payload.phase === 'post');
    assert.equal(typeof payload.correct, 'boolean');
    assert.equal(payload.objective, 'Movement fundamentals');
    assert.deepEqual(payload.gradedAgainst, { citation: 'src-1 p.135', pubId: 'TC 3-22.9', page: '135' });
  }

  // And Sextant reads it: pre wrong, post right is a measured gain where the
  // same rows used to produce "insufficient evidence" because nothing wrote
  // a phase or a correctness at all.
  const analytics = buildAnalytics({
    attempts: payloads.map((payload) => ({ ...payload, learnerId: LEARNER.id })),
    sessions: [],
  });
  assert.notEqual(analytics.gain.status, 'insufficient_evidence');
  assert.equal(analytics.gain.overall.prePct, 0);
  assert.equal(analytics.gain.overall.postPct, 1);

  // Class gaps stay behind Sextant's distinct-learner floor: one learner's
  // rows produce no row, a cohort's do, and the objective is the section the
  // instructor would go and reteach.
  assert.deepEqual(analytics.gaps, []);
  const cohort = buildAnalytics({
    attempts: ['a', 'b', 'c', 'd', 'e'].flatMap((learner) =>
      payloads.map((payload) => ({ ...payload, learnerId: `learner-${learner}` }))),
    sessions: [],
  });
  assert.equal(cohort.gaps[0].objective, 'Movement fundamentals');
});

/* --------------------------- stated confidence ---------------------------- */

/* The rule the calibration rests on, enforced at the write. An attempt either
   carries a confidence the learner actually stated, or carries none -- because
   0 on this scale means "guessing", and storing it for a learner who said
   nothing would fabricate the exact claim the measurement exists to make. */

test('a stated confidence is recorded beside the grade', async () => {
  const { handlers, saved } = fixture();
  const response = await handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody({ confidence: 3 }),
  });
  assert.equal(response.json.result.confidence, 3);
  assert.equal(saved[0].payload.confidence, 3);
  assert.equal(saved[0].payload.result.confidence, 3);
});

test('an answer with no confidence records none, rather than recording a guess', async () => {
  const { handlers, saved } = fixture();
  const response = await handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody(),
  });
  assert.equal(Object.prototype.hasOwnProperty.call(saved[0].payload, 'confidence'), false);
  assert.equal(Object.prototype.hasOwnProperty.call(response.json.result, 'confidence'), false);
});

test('a confidence off the scale is dropped, and the answer is still recorded', async () => {
  for (const [index, confidence] of [-1, 4, 2.5, '3', null, true].entries()) {
    const { handlers, saved } = fixture();
    // eslint-disable-next-line no-await-in-loop
    const response = await handlers.recordCourseAttempt(LEARNER, {
      params: { id: COURSE_ID },
      body: answerBody({ confidence, attemptId: `attempt-${index}` }),
    });
    assert.equal(response.json.recorded, true, `${confidence} still grades`);
    assert.equal(
      Object.prototype.hasOwnProperty.call(saved[0].payload, 'confidence'),
      false,
      `${confidence} is not a rating a learner made`,
    );
  }
});

test('zero is a real rating and survives, unlike an absent one', async () => {
  const { handlers, saved } = fixture();
  await handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody({ confidence: 0 }),
  });
  assert.equal(saved[0].payload.confidence, 0, 'a learner who says they guessed has said something');
});

test('a learner reading back their own answers can tell a rating from its absence', async () => {
  const { handlers } = fixture();
  await handlers.recordCourseAttempt(LEARNER, {
    params: { id: COURSE_ID },
    body: answerBody({ confidence: 2 }),
  });
  const mine = await handlers.getCourseAttempts(LEARNER, { params: { id: COURSE_ID }, query: {} });
  assert.deepEqual(mine.json.answers[`${COURSE_ID}:s1:pre1`], {
    optionId: '0',
    correct: true,
    feedback: 'Cover is what the source names first.',
    confidence: 2,
  });
});
