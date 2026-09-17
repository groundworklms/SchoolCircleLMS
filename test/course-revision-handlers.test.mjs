import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

// Keep the structural validator and learner projection from the production
// adapter. Only the model transport is replaced; these tests never call a
// configured provider or a database.
const realArsenal = await import('../lib/arsenal-core.js');

const records = new Map();
const typedReleases = new Map();
const releaseEvidence = new Map();
const approvalSupport = [];
const modelCalls = [];
let nextRecordId = 1;
let modelGate = null;

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function snapshot(record) {
  return clone(record);
}

function resetStore() {
  records.clear();
  typedReleases.clear();
  releaseEvidence.clear();
  approvalSupport.length = 0;
  modelCalls.length = 0;
  nextRecordId = 1;
  modelGate = null;
}

function seedRecord({
  id,
  ownerId,
  type,
  status = 'PENDING',
  version = 0,
  payload,
}) {
  const record = {
    id,
    ownerId,
    type,
    status,
    version,
    payload: clone(payload),
    createdAt: new Date(1_700_000_000_000 + nextRecordId++),
    updatedAt: new Date(1_700_000_000_000 + nextRecordId++),
  };
  records.set(id, record);
  return snapshot(record);
}

function sourceRecord({ status = 'APPROVED', id = 'source-record' } = {}) {
  return seedRecord({
    id,
    ownerId: OWNER.id,
    type: 'SOURCE',
    status,
    payload: {
      title: 'Approved safety manual',
      sourceId: 'approved-source',
      text: 'The operator confirms the safety check before operation.',
      pages: [{
        page: 1,
        text: 'The operator confirms the safety check before operation.',
      }],
      chunks: [{
        page: 1,
        text: 'The operator confirms the safety check before operation.',
      }],
    },
  });
}

function courseDocument() {
  return {
    title: 'Safety course',
    sourceIds: ['source-record'],
    sections: [{
      id: 'safety-section',
      title: 'Safety check',
      cite: 'source-record p.1',
      lesson: 'The operator confirms the safety check before operation.',
      // Approval refuses a section with no lesson page: without one a learner
      // is shown an intro and the questions, but never the lesson body.
      pages: [{
        title: 'Safety check',
        blocks: [{ type: 'p', text: 'The operator confirms the safety check before operation.' }],
      }],
      pre: [{
        id: 'question-before',
        stem: 'When is the safety check required before operation?',
        options: ['Before operation', 'After operation'],
        answer: 0,
        rationale: 'The operator confirms the safety check before operation.',
        citation: {
          citation: 'source-record p.1',
          pubId: 'source-record',
          page: '1',
        },
      }],
      post: [{
        id: 'question-confirm',
        stem: 'What does the operator confirm before operation?',
        options: ['The safety check', 'Nothing'],
        answer: 0,
        rationale: 'The operator confirms the safety check before operation.',
        citation: {
          citation: 'source-record p.1',
          pubId: 'source-record',
          page: '1',
        },
      }],
    }],
  };
}

function courseRecord({
  id = 'course-record',
  status = 'APPROVED',
  version = 1,
  deliveryCourseId = 'course-record:release:1',
  payload = courseDocument(),
} = {}) {
  return seedRecord({
    id,
    ownerId: OWNER.id,
    type: 'COURSE_DRAFT',
    status,
    version,
    payload: {
      ...clone(payload),
      ...(deliveryCourseId ? { deliveryCourseId } : {}),
    },
  });
}

function revisedQuestion() {
  return {
    question: {
      stem: 'When must the operator perform the safety check before operation?',
      options: ['Before operation', 'After operation'],
      answerIndex: 0,
      rationale: 'The operator confirms the safety check before operation.',
      // The adapter must ignore this attempted anchor replacement.
      citation: 'invented-anchor',
    },
  };
}

function configureModelBarrier() {
  let arrived = 0;
  let release;
  let allArrived;
  const barrier = new Promise((resolve) => {
    allArrived = resolve;
  });
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  modelGate = {
    arrive() {
      arrived += 1;
      if (arrived === 2) allArrived();
      return gate;
    },
    allArrived: barrier,
    release,
  };
}

async function reviseCourseContent(input) {
  modelCalls.push(clone(input));
  if (modelGate) await modelGate.arrive();
  return revisedQuestion();
}

function updateRecord(record, data) {
  if (Object.prototype.hasOwnProperty.call(data, 'status')) record.status = data.status;
  if (Object.prototype.hasOwnProperty.call(data, 'payload')) record.payload = clone(data.payload);
  record.updatedAt = new Date(record.updatedAt.getTime() + 1);
}

async function approveCourseAtomically({
  courseId,
  ownerId,
  expectedVersion,
  candidatePayload,
  sourceId,
  sections,
  support = null,
  revisionId = null,
  revisionHistory = [],
}) {
  // The entailment measurement the caller took before opening the transaction.
  // Captured so a test can assert what a course approval actually measured --
  // and, with no doctrine service configured here, that it measured nothing.
  approvalSupport.push(support);
  const current = records.get(courseId);
  if (
    !current ||
    current.type !== 'COURSE_DRAFT' ||
    current.ownerId !== ownerId ||
    current.version !== expectedVersion
  ) {
    return { committed: false };
  }

  const priorPayload = current.payload && typeof current.payload === 'object'
    ? current.payload
    : {};
  if (revisionId && priorPayload.pendingRevisionId !== revisionId) {
    return { committed: false };
  }
  if (revisionId) {
    const pending = records.get(revisionId);
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
    ...clone(priorPayload),
    ...clone(candidatePayload),
    deliveryCourseId,
    revisionHistory: clone(revisionHistory),
  };
  delete nextPayload.pendingRevisionId;

  // This is the transaction boundary: the compare-and-set happens before the
  // new typed release is inserted, and no existing release row is replaced.
  current.status = 'APPROVED';
  current.payload = nextPayload;
  current.version += 1;
  current.updatedAt = new Date(current.updatedAt.getTime() + 1);

  typedReleases.set(deliveryCourseId, {
    id: deliveryCourseId,
    title: candidatePayload.title,
    sourceId,
    sections: clone(sections),
  });

  if (revisionId) {
    const revision = records.get(revisionId);
    revision.status = 'APPROVED';
    revision.payload = {
      ...clone(revision.payload),
      approvedVersion: expectedVersion + 1,
    };
  }
  return {
    committed: true,
    version: expectedVersion + 1,
    deliveryCourseId,
    materialised: {
      courseId: deliveryCourseId,
      sections: sections.length,
      items: sections.reduce(
        (total, section) =>
          total +
          (Array.isArray(section.pre) ? section.pre.length : 0) +
          (Array.isArray(section.post) ? section.post.length : 0) +
          (section.lesson ? 1 : 0),
        0,
      ),
    },
  };
}

async function createCourseRevisionAtomically({
  courseId,
  ownerId,
  expectedVersion,
  expectedStatus,
  revisionPayload,
  revisionHistoryEntry,
}) {
  const current = records.get(courseId);
  if (
    !current ||
    current.type !== 'COURSE_DRAFT' ||
    current.ownerId !== ownerId ||
    current.version !== expectedVersion ||
    current.status !== expectedStatus
  ) {
    return { committed: false };
  }
  const previousRevisionId = current.payload?.pendingRevisionId;
  const previousRevision = previousRevisionId ? records.get(previousRevisionId) : null;
  if (
    previousRevisionId &&
    (!previousRevision ||
      previousRevision.type !== 'COURSE_REVISION' ||
      previousRevision.ownerId !== ownerId ||
      previousRevision.status !== 'PENDING' ||
      previousRevision.payload?.courseId !== courseId ||
      previousRevision.payload?.reviewedVersion !== expectedVersion)
  ) {
    return { committed: false };
  }
  const revision = seedRecord({
    id: `record-${nextRecordId++}`,
    ownerId,
    type: 'COURSE_REVISION',
    status: 'PENDING',
    payload: revisionPayload,
  });
  const history = clone(current.payload?.revisionHistory || []);
  if (previousRevisionId) {
    for (const entry of history) {
      if (entry?.id === previousRevisionId && entry.status === 'PENDING') {
        entry.status = 'SUPERSEDED';
      }
    }
    previousRevision.status = 'SUPERSEDED';
  }
  history.push({
    ...clone(revisionHistoryEntry),
    id: revision.id,
    status: revision.status,
    createdAt: revision.createdAt.toISOString(),
    updatedAt: revision.updatedAt.toISOString(),
  });
  current.payload = {
    ...clone(current.payload),
    pendingRevisionId: revision.id,
    revisionHistory: history,
  };
  current.version += 1;
  current.updatedAt = new Date(current.updatedAt.getTime() + 1);
  return {
    committed: true,
    revision,
    revisionHistory: history,
    version: expectedVersion + 1,
  };
}

const dbMock = {
  db: {},
  async createLearningRecord({ ownerId, type, status = 'PENDING', payload }) {
    return seedRecord({
      id: `record-${nextRecordId++}`,
      ownerId,
      type,
      status,
      payload,
    });
  },
  async getLearningRecord(id) {
    return snapshot(records.get(id) || null);
  },
  async approvePendingDeliveryCourseItems() { return 0; },
  async listDeliveryCourseItems() {
    // Per-item ratification (863f724) added these to lib/db.js. The mock has
    // to offer every export core.js imports or the module fails to link and
    // the whole suite reports one failure with no useful assertion.
    return [];
  },
  async getDeliveryCourseItem() {
    return null;
  },
  async updateDeliveryCourseItem() {
    return null;
  },
  async courseEvidenceCount() {
    // No typed delivery rows in this fixture, so no learner evidence. The
    // delete path reads this to decide archive-vs-remove.
    return { attempts: 0, schedules: 0, total: 0 };
  },
  async deleteLearningRecords(ids, { courseIds = [] } = {}) {
    let deleted = 0;
    for (const id of new Set(ids || [])) {
      if (records.delete(id)) deleted += 1;
    }
    return { records: deleted, courses: courseIds.length };
  },
  async getLearningRecordsByIds(ids) {
    // Same contract as the real batched read: a Map keyed by id, missing ids
    // simply absent. The production list path uses this instead of a query
    // per row, so the mock has to offer it too.
    return new Map(
      [...new Set(ids || [])]
        .map((id) => [id, snapshot(records.get(id) || null)])
        .filter(([, record]) => record),
    );
  },
  async listLearningRecords({ ownerId, type, status } = {}) {
    return [...records.values()]
      .filter((record) => !ownerId || record.ownerId === ownerId)
      .filter((record) => !type || record.type === type)
      .filter((record) => !status || record.status === status)
      .sort((left, right) => right.createdAt - left.createdAt)
      .map(snapshot);
  },
  async updateLearningRecord(id, data) {
    const record = records.get(id);
    if (!record) throw new Error(`missing record ${id}`);
    updateRecord(record, data);
    return snapshot(record);
  },
  async updateLearningRecordIfVersion(id, version, data) {
    const record = records.get(id);
    if (!record || record.version !== version) return false;
    updateRecord(record, data);
    record.version += 1;
    return true;
  },
  createCourseRevisionAtomically,
  approveCourseAtomically,
};

mock.module('../lib/db.js', { namedExports: dbMock });
mock.module('../lib/arsenal-core.js', {
  namedExports: {
    answerMasterySession: async () => null,
    deriveMasteryPlan: async () => null,
    draftCourse: async () => null,
    draftRubricTask: async () => null,
    expandCoursePages: realArsenal.expandCoursePages,
    passageForCitation: realArsenal.passageForCitation,
    generateRubric: async () => null,
    ingestSource: async () => null,
    learningModelStatus: () => ({ model: { ready: false } }),
    masteryPlanProvenance: realArsenal.masteryPlanProvenance,
    masteryView: () => null,
    redactCourse: realArsenal.redactCourse,
    restoreMasterySession: async () => null,
    reviseCourseContent,
    serialiseMasterySession: () => null,
    sourcePassageIndex: realArsenal.sourcePassageIndex,
    startMasterySession: async () => null,
    tutorAnswer: async () => null,
    validateCourseDraft: realArsenal.validateCourseDraft,
    validateKeyDistribution: realArsenal.validateKeyDistribution,
    validateMasteryPlan: () => ({ valid: true, criteria: [] }),
  },
});

const {
  approveCourse,
  expandCoursePagesRecord,
  getCourse,
  listCourses,
  reviseCourse,
} = await import('../lib/learning/core.js');
const { errorStatus } = await import('../lib/learning/http.js');

const OWNER = { id: 'saved-owner', role: 'INSTRUCTOR' };
const OTHER_INSTRUCTOR = { id: 'different-owner', role: 'INSTRUCTOR' };
const LEARNER = { id: 'saved-learner', role: 'LEARNER' };

function revisionRequest(version, instructions = 'Make the selected question more direct.') {
  return {
    version,
    scope: 'question',
    sectionId: 'safety-section',
    phase: 'pre',
    questionId: 'question-before',
    instructions,
  };
}

function seedRevisionFixture({ status = 'APPROVED', version = 1 } = {}) {
  sourceRecord();
  const course = courseRecord({ status, version });
  const priorRelease = {
    id: course.payload.deliveryCourseId,
    title: course.payload.title,
    sections: clone(course.payload.sections),
  };
  typedReleases.set(priorRelease.id, priorRelease);
  releaseEvidence.set(priorRelease.id, {
    releaseId: priorRelease.id,
    attempt: { answer: 'Before operation', score: 1 },
  });
  return course;
}

test('revision enforces saved role/owner and approved persisted sources', async () => {
  resetStore();
  sourceRecord({ status: 'PENDING' });
  courseRecord({ status: 'PENDING', version: 0, deliveryCourseId: null });

  await assert.rejects(
    reviseCourse(LEARNER, {
      params: { id: 'course-record' },
      body: revisionRequest(0),
    }),
    (error) => error.code === 'NOT_FOUND' && errorStatus(error) === 404,
  );
  await assert.rejects(
    reviseCourse(OTHER_INSTRUCTOR, {
      params: { id: 'course-record' },
      body: revisionRequest(0),
    }),
    (error) => error.code === 'NOT_FOUND' && errorStatus(error) === 404,
  );
  await assert.rejects(
    reviseCourse(OWNER, {
      params: { id: 'course-record' },
      body: revisionRequest(0),
    }),
    (error) => error.code === 'NOT_FOUND' && errorStatus(error) === 404,
  );
  await assert.rejects(
    approveCourse(LEARNER, {
      params: { id: 'course-record' },
      body: { version: 0 },
    }),
    (error) => error.code === 'NOT_FOUND' && errorStatus(error) === 404,
  );
  await assert.rejects(
    approveCourse(OTHER_INSTRUCTOR, {
      params: { id: 'course-record' },
      body: { version: 0 },
    }),
    (error) => error.code === 'NOT_FOUND' && errorStatus(error) === 404,
  );
  assert.equal(modelCalls.length, 0, 'unapproved source must not reach the model seam');
});

test('revision stores a pending candidate while learners retain the prior release', async () => {
  resetStore();
  const course = seedRevisionFixture();
  const original = clone(course.payload);
  const result = await reviseCourse(OWNER, {
    params: { id: course.id },
    body: revisionRequest(course.version),
  });

  assert.equal(result.status, 201);
  assert.equal(result.json.version, course.version + 1);
  assert.equal(result.json.hasPendingRevision, true);
  assert.equal(result.json.course.sections[0].pre[0].stem, revisedQuestion().question.stem);
  assert.equal(result.json.course.sections[0].pre[0].citation.pubId, 'source-record');
  assert.deepEqual(
    result.json.course.sections[0].post[0],
    original.sections[0].post[0],
    'the unselected question must remain byte-for-byte unchanged',
  );
  assert.equal(modelCalls.length, 1);
  assert.deepEqual(modelCalls[0].sourceDocuments.map((document) => document.source), [
    'source-record p.1',
  ]);

  const ownerView = await getCourse(OWNER, { params: { id: course.id } });
  assert.equal(ownerView.json.hasPendingRevision, true);
  assert.equal(ownerView.json.course.sections[0].pre[0].stem, revisedQuestion().question.stem);
  assert.equal(ownerView.json.revisionHistory[0].status, 'PENDING');

  const learnerView = await getCourse(LEARNER, { params: { id: course.id } });
  assert.equal(learnerView.json.hasPendingRevision, false);
  /* A learner does not see the pending revision -- and no longer sees the
     APPROVED draft's questions either. Both are unratified text: approving a
     course releases its shape, and every sentence in it is a PENDING Item
     until an instructor ratifies it one at a time. The learner reader now
     takes all content from the delivery projection, which is the response that
     has passed that gate, so nothing here is left to leak. */
  assert.equal(learnerView.json.course.sections[0].pre, undefined);
  assert.equal(learnerView.json.course.sections[0].post, undefined);
  assert.equal(learnerView.json.course.sections[0].lesson, undefined);
  const learnerJson = JSON.stringify(learnerView.json.course);
  assert.equal(
    learnerJson.includes(original.sections[0].pre[0].stem),
    false,
    'a learner must not see a pending revision, nor the unratified draft it revises',
  );
  assert.equal(learnerJson.includes(revisedQuestion().question.stem), false);
  // The shape the approval did release is still there.
  assert.equal(learnerView.json.course.sections[0].title, original.sections[0].title);
  assert.equal(learnerView.json.course.pendingRevisionId, undefined);
  assert.deepEqual(
    (await listCourses(LEARNER)).json,
    [{
      id: course.id,
      status: 'APPROVED',
      version: course.version + 1,
      title: original.title,
      sections: 1,
    }],
  );
});

test('concurrent revision requests allow one compare-and-set winner', async () => {
  resetStore();
  const course = seedRevisionFixture({ status: 'PENDING', version: 0 });
  const request = revisionRequest(course.version);
  configureModelBarrier();

  const first = reviseCourse(OWNER, { params: { id: course.id }, body: request });
  const second = reviseCourse(OWNER, { params: { id: course.id }, body: request });
  await modelGate.allArrived;
  modelGate.release();
  const results = await Promise.allSettled([first, second]);

  assert.equal(results.filter((result) => result.status === 'fulfilled').length, 1);
  const failures = results.filter((result) => result.status === 'rejected');
  assert.equal(failures.length, 1);
  assert.equal(failures[0].reason.code, 'CONFLICT');
  assert.equal(failures[0].reason.status, 409);

  const current = await dbMock.getLearningRecord(course.id);
  assert.equal(current.version, 1);
  assert.ok(current.payload.pendingRevisionId);
  const revisions = [...records.values()].filter((record) => record.type === 'COURSE_REVISION');
  assert.equal(revisions.length, 1, 'the losing transaction must roll back its revision row');
  assert.equal(revisions.filter((revision) => revision.status === 'PENDING').length, 1);
  assert.equal(revisions.filter((revision) => revision.status === 'STALE').length, 0);
});

test('successive pending revisions supersede only the previous candidate', async () => {
  resetStore();
  const course = seedRevisionFixture({ status: 'PENDING', version: 0 });
  const first = await reviseCourse(OWNER, {
    params: { id: course.id }, body: revisionRequest(0),
  });
  const firstId = records.get(course.id).payload.pendingRevisionId;
  const second = await reviseCourse(OWNER, {
    params: { id: course.id }, body: revisionRequest(first.json.version),
  });
  const root = records.get(course.id);
  assert.equal(second.json.version, 2);
  assert.notEqual(root.payload.pendingRevisionId, firstId);
  assert.equal(records.get(firstId).status, 'SUPERSEDED');
  assert.equal(records.get(root.payload.pendingRevisionId).status, 'PENDING');
  assert.equal([...records.values()].filter((row) =>
    row.type === 'COURSE_REVISION' && row.status === 'PENDING').length, 1);
  assert.deepEqual(root.payload.revisionHistory.map((entry) => entry.status),
    ['SUPERSEDED', 'PENDING']);
});

test('approval rejects an exact-version mismatch, then atomically creates a new release', async () => {
  resetStore();
  const course = seedRevisionFixture();
  const priorReleaseId = course.payload.deliveryCourseId;
  const priorTyped = clone(typedReleases.get(priorReleaseId));
  const priorEvidence = clone(releaseEvidence.get(priorReleaseId));
  const revised = await reviseCourse(OWNER, {
    params: { id: course.id },
    body: revisionRequest(course.version),
  });
  const currentVersion = revised.json.version;

  await assert.rejects(
    approveCourse(OWNER, {
      params: { id: course.id },
      body: { version: currentVersion - 1 },
    }),
    (error) => error.code === 'CONFLICT' && errorStatus(error) === 409,
  );
  assert.equal(typedReleases.size, 1, 'stale approval must not materialise typed rows');
  assert.deepEqual(typedReleases.get(priorReleaseId), priorTyped);
  assert.deepEqual(releaseEvidence.get(priorReleaseId), priorEvidence);

  const approved = await approveCourse(OWNER, {
    params: { id: course.id },
    body: { version: currentVersion },
  });
  const newReleaseId = approved.json.deliveryCourseId;
  assert.equal(approved.json.status, 'APPROVED');
  assert.equal(approved.json.version, currentVersion + 1);
  assert.notEqual(newReleaseId, priorReleaseId);
  assert.equal(approved.json.hasPendingRevision, false);
  assert.equal(approved.json.materialised.courseId, newReleaseId);
  assert.deepEqual(typedReleases.get(priorReleaseId), priorTyped);
  assert.deepEqual(releaseEvidence.get(priorReleaseId), priorEvidence);
  assert.ok(typedReleases.has(newReleaseId), 'approval materialises beside the prior release');
  assert.equal(
    typedReleases.get(newReleaseId).sections[0].pre[0].stem,
    revised.json.course.sections[0].pre[0].stem,
  );
  assert.equal(
    (await dbMock.getLearningRecord(course.id)).payload.pendingRevisionId,
    undefined,
  );
});

/* An approval must never fail, stall, or invent a number because the entailment
 * verifier is unreachable -- it must simply produce unverified items. No
 * doctrine service is configured here, which is exactly that path: the
 * measurement step runs, measures nothing, and the release materialises with
 * every Item.support null. */
test('approval succeeds with no verifier, and measures nothing rather than defaulting', async () => {
  resetStore();
  const savedUrl = process.env.DOCTRINE_BASE_URL;
  delete process.env.DOCTRINE_BASE_URL;
  try {
    const course = seedRevisionFixture();
    const revised = await reviseCourse(OWNER, {
      params: { id: course.id },
      body: revisionRequest(course.version),
    });
    const approved = await approveCourse(OWNER, {
      params: { id: course.id },
      body: { version: revised.json.version },
    });

    assert.equal(approved.json.status, 'APPROVED');
    assert.ok(typedReleases.has(approved.json.deliveryCourseId));
    assert.equal(approvalSupport.length, 1);
    const support = approvalSupport[0];
    assert.ok(support instanceof Map, 'the transaction is handed measurements, keyed by item id');
    // Empty, not populated with zeroes, floors or estimates. There is no
    // default value anywhere in this path.
    assert.equal(support.size, 0);
  } finally {
    if (savedUrl === undefined) delete process.env.DOCTRINE_BASE_URL;
    else process.env.DOCTRINE_BASE_URL = savedUrl;
  }
});

async function status(promise) {
  try {
    await promise;
    return 200;
  } catch (error) {
    return errorStatus(error);
  }
}

test('expandCoursePagesRecord refuses while a revision is pending review', async () => {
  // Writing pages bumps the course version; approveCourse then rejects the
  // pending revision as stale with no way back, and a fresh revision bases on
  // the revision's course, which never got the pages. 409 before any model call.
  resetStore();
  const course = seedRevisionFixture();
  const revised = await reviseCourse(OWNER, { params: { id: course.id }, body: revisionRequest(course.version) });
  assert.equal(revised.json.hasPendingRevision, true);
  const callsBefore = modelCalls.length;
  assert.equal(await status(expandCoursePagesRecord(OWNER, { params: { id: course.id } })), 409);
  assert.equal(modelCalls.length, callsBefore, 'no model call is made for a course that cannot take the pages');
  assert.equal((await dbMock.getLearningRecord(course.id)).version, revised.json.version, 'the version is untouched');
});

test('expandCoursePagesRecord writes grounded pages onto the saved course, owner only', async () => {
  resetStore();
  sourceRecord();
  const course = courseRecord({ status: 'APPROVED', version: 1 });
  assert.equal(await status(expandCoursePagesRecord(LEARNER, { params: { id: course.id } })), 404);
  assert.equal(await status(expandCoursePagesRecord(OTHER_INSTRUCTOR, { params: { id: course.id } })), 404);
  // The mocked model reports not ready: the owner gets 503, not "0 expanded".
  assert.equal(await status(expandCoursePagesRecord(OWNER, { params: { id: course.id } })), 503);
  assert.equal((await dbMock.getLearningRecord(course.id)).version, 1);
});

/* The builder offered "Approve and publish" beside its own status line reading
   "Rewrite lesson pages (10/11 written)", and nothing refused it. Items are
   generated per section whether or not that section's page was written, so a
   course could be published with a section a learner opens to find the
   questions but not the lesson they are asked about. */
test('a section with no lesson page blocks approval, and is named', async () => {
  resetStore();
  const course = seedRevisionFixture();
  // The fixture is already released, so a revision is what there is to approve.
  const [section] = records.get(course.id).payload.sections;
  const title = section.title;
  delete section.pages;

  const revised = await reviseCourse(OWNER, {
    params: { id: course.id },
    body: revisionRequest(course.version),
  });

  await assert.rejects(
    approveCourse(OWNER, { params: { id: course.id }, body: { version: revised.json.version } }),
    (error) =>
      error.code === 'COURSE_PAGES_UNWRITTEN'
      && errorStatus(error) === 422
      && error.message.includes(title)
      && error.validation.unwritten === 1,
  );
});
