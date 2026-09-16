/**
 * The repair loop an instructor actually walks: a generated draft that fails
 * grounding is saved for review, can be fixed one section at a time, and is
 * only publishable once every section passes.
 *
 * The real grounding validator runs throughout -- only the model transport and
 * the database are replaced.
 */
import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

const realArsenal = await import('../lib/arsenal-core.js');

const records = new Map();
let nextRecordId = 1;
let generatedCourse = null;
let generatedLesson = null;

const clone = (value) => (value === undefined ? undefined : structuredClone(value));
const snapshot = (record) => clone(record);

const SOURCE_TEXT = 'The operator confirms the safety check before operation.';
const GROUNDED_LESSON = 'The operator confirms the safety check before operation.';
// Prose a model plausibly writes, and which the grounding check rejects.
const UNGROUNDED_LESSON =
  'This module explores why disciplined preparation habits matter across every task you will encounter.';

function resetStore() {
  records.clear();
  nextRecordId = 1;
  generatedCourse = null;
  generatedLesson = null;
}

function seedRecord({ id, ownerId, type, status = 'PENDING', version = 0, payload }) {
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

function sourceRecord() {
  return seedRecord({
    id: 'source-record',
    ownerId: OWNER.id,
    type: 'SOURCE',
    status: 'APPROVED',
    payload: {
      title: 'Approved safety manual',
      sourceId: 'approved-source',
      text: SOURCE_TEXT,
      pages: [{ page: 1, text: SOURCE_TEXT }],
      chunks: [{ page: 1, text: SOURCE_TEXT }],
    },
  });
}

const question = (id, stem) => ({
  id,
  stem,
  options: ['Before operation', 'After operation'],
  answer: 0,
  rationale: SOURCE_TEXT,
  citation: { citation: 'source-record p.1', pubId: 'source-record', page: '1' },
});

const section = (id, lesson) => ({
  id,
  title: `Section ${id}`,
  cite: 'source-record p.1',
  lesson,
  pre: [question(`${id}-pre`, 'When is the safety check required before operation?')],
  post: [question(`${id}-post`, 'What does the operator confirm before operation?')],
});

const twoSectionCourse = (first, second) => ({
  title: 'Safety course',
  sections: [section('section-one', first), section('section-two', second)],
});

function updateRecord(record, data) {
  if (Object.prototype.hasOwnProperty.call(data, 'status')) record.status = data.status;
  if (Object.prototype.hasOwnProperty.call(data, 'payload')) record.payload = clone(data.payload);
  record.updatedAt = new Date(record.updatedAt.getTime() + 1);
}

const dbMock = {
  db: {},
  async createLearningRecord({ ownerId, type, status, payload }) {
    return seedRecord({ id: `record-${nextRecordId}`, ownerId, type, status, payload });
  },
  async getLearningRecord(id) {
    const record = records.get(id);
    return record ? snapshot(record) : null;
  },
  async getLearningRecordsByIds(ids) {
    const result = new Map();
    for (const id of ids) {
      const record = records.get(id);
      if (record) result.set(id, snapshot(record));
    }
    return result;
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
  async createCourseRevisionAtomically({ courseId, ownerId, expectedVersion, revisionPayload, revisionHistoryEntry }) {
    const course = records.get(courseId);
    if (!course || course.version !== expectedVersion) return { committed: false };
    const revision = seedRecord({
      id: `revision-${nextRecordId}`,
      ownerId,
      type: 'COURSE_REVISION',
      status: 'PENDING',
      payload: revisionPayload,
    });
    const history = [...(course.payload.revisionHistory || []), { ...revisionHistoryEntry, id: revision.id }];
    updateRecord(course, { payload: { ...course.payload, pendingRevisionId: revision.id, revisionHistory: history } });
    course.version += 1;
    return { committed: true, revision: snapshot(records.get(revision.id)), revisionHistory: history };
  },
  async approveCourseAtomically({ courseId, expectedVersion, candidatePayload, revisionHistory }) {
    const course = records.get(courseId);
    if (!course || course.version !== expectedVersion) return { committed: false };
    updateRecord(course, {
      status: 'APPROVED',
      payload: { ...candidatePayload, revisionHistory, pendingRevisionId: null },
    });
    course.version += 1;
    return { committed: true, version: course.version, materialised: true, deliveryCourseId: courseId };
  },
  async deleteLearningRecords(ids) {
    for (const id of ids) records.delete(id);
    return ids.length;
  },
  async courseEvidenceCount() {
    return 0;
  },
  matchesApprovedMasteryPlan: () => false,
};

mock.module('../lib/db.js', { namedExports: dbMock });
mock.module('../lib/arsenal-core.js', {
  namedExports: {
    answerMasterySession: async () => null,
    deriveMasteryPlan: async () => null,
    draftCourse: async () => clone(generatedCourse),
    draftRubricTask: async () => null,
    generateRubric: async () => null,
    ingestSource: async () => null,
    learningModelStatus: () => ({ model: { ready: true } }),
    masteryView: () => null,
    redactCourse: realArsenal.redactCourse,
    restoreMasterySession: async () => null,
    reviseCourseContent: async () => ({ lesson: generatedLesson }),
    serialiseMasterySession: () => null,
    startMasterySession: async () => null,
    tutorAnswer: async () => null,
    validateCourseDraft: realArsenal.validateCourseDraft,
    validateMasteryPlan: () => ({ valid: true, criteria: [] }),
  },
});

const { approveCourse, draftCourseRecord, getCourse, reviseCourse } = await import('../lib/learning/core.js');
const { errorStatus } = await import('../lib/learning/http.js');

const OWNER = { id: 'repair-owner', role: 'INSTRUCTOR' };
const LEARNER = { id: 'repair-learner', role: 'LEARNER' };

const draft = () =>
  draftCourseRecord(OWNER, { body: { sourceIds: ['source-record'] } });

test('a draft that fails grounding is saved for review, not discarded', async () => {
  resetStore();
  sourceRecord();
  generatedCourse = twoSectionCourse(UNGROUNDED_LESSON, GROUNDED_LESSON);

  const result = await draft();
  assert.equal(result.status, 201);
  assert.equal(result.json.status, 'PENDING');
  assert.equal(result.json.blockers.valid, false);
  assert.equal(result.json.blockers.sections.length, 1);
  assert.equal(result.json.blockers.sections[0].index, 0);

  // The expensive generation survived: the instructor has something to open.
  const saved = records.get(result.json.id);
  assert.equal(saved.type, 'COURSE_DRAFT');
  assert.equal(saved.payload.sections.length, 2);
});

test('a draft with nothing to review is still an outright generation failure', async () => {
  resetStore();
  sourceRecord();
  generatedCourse = { title: 'Empty course', sections: [] };

  await assert.rejects(draft, (error) => {
    assert.equal(error.code, 'COURSE_GENERATION_INVALID');
    assert.equal(errorStatus(error), 422);
    return true;
  });
  assert.equal([...records.values()].filter((r) => r.type === 'COURSE_DRAFT').length, 0);
});

test('the owner sees what is blocking publication; a learner sees no blockers', async () => {
  resetStore();
  sourceRecord();
  generatedCourse = twoSectionCourse(UNGROUNDED_LESSON, GROUNDED_LESSON);
  const { json: created } = await draft();

  const owned = await getCourse(OWNER, { params: { id: created.id } });
  assert.equal(owned.json.blockers.valid, false);
  assert.match(owned.json.blockers.sections[0].issues[0], /not grounded/);

  // A PENDING course is not visible to a learner at all; approving it is
  // what publishes, and that is gated below.
  await assert.rejects(() => getCourse(LEARNER, { params: { id: created.id } }));
});

test('a blocked draft cannot be published', async () => {
  resetStore();
  sourceRecord();
  generatedCourse = twoSectionCourse(UNGROUNDED_LESSON, GROUNDED_LESSON);
  const { json: created } = await draft();

  await assert.rejects(
    () => approveCourse(OWNER, { params: { id: created.id }, body: { version: created.version } }),
    (error) => {
      assert.equal(error.code, 'COURSE_NOT_APPROVABLE');
      assert.match(error.message, /not grounded/);
      return true;
    },
  );
  assert.equal(records.get(created.id).status, 'PENDING');
});

test('sections are repaired one at a time and the course then publishes', async () => {
  resetStore();
  sourceRecord();
  // Both sections ungrounded: under the old whole-course revision gate, the
  // fix for the first was rejected because the second was still bad.
  generatedCourse = twoSectionCourse(UNGROUNDED_LESSON, UNGROUNDED_LESSON);
  const { json: created } = await draft();
  assert.equal(created.blockers.sections.length, 2);

  generatedLesson = GROUNDED_LESSON;
  const first = await reviseCourse(OWNER, {
    params: { id: created.id },
    body: { version: created.version, scope: 'lesson', sectionId: 'section-one', instructions: 'Stay close to the source wording.' },
  });
  assert.equal(first.status, 201);
  assert.equal(first.json.blockers.valid, false, 'still blocked by the second section');
  assert.deepEqual(first.json.blockers.sections.map((s) => s.index), [1]);

  const second = await reviseCourse(OWNER, {
    params: { id: created.id },
    body: { version: first.json.version, scope: 'lesson', sectionId: 'section-two', instructions: 'Stay close to the source wording.' },
  });
  assert.equal(second.json.blockers.valid, true, 'the draft is now publishable');

  const approved = await approveCourse(OWNER, {
    params: { id: created.id },
    body: { version: second.json.version },
  });
  assert.equal(approved.json.status, 'APPROVED');
});

test('a revision that resolves nothing is refused', async () => {
  resetStore();
  sourceRecord();
  generatedCourse = twoSectionCourse(UNGROUNDED_LESSON, GROUNDED_LESSON);
  const { json: created } = await draft();

  generatedLesson = 'Another paragraph of general encouragement about workplace preparation habits.';
  await assert.rejects(
    () => reviseCourse(OWNER, {
      params: { id: created.id },
      body: { version: created.version, scope: 'lesson', sectionId: 'section-one', instructions: 'Try again.' },
    }),
    (error) => {
      assert.equal(error.code, 'COURSE_REVISION_NOT_APPROVABLE');
      assert.match(error.message, /did not resolve anything/);
      return true;
    },
  );
});

test('a revision may not unground a section that already passed', async () => {
  resetStore();
  sourceRecord();
  generatedCourse = twoSectionCourse(GROUNDED_LESSON, GROUNDED_LESSON);
  const { json: created } = await draft();
  assert.equal(created.blockers.valid, true);

  generatedLesson = UNGROUNDED_LESSON;
  await assert.rejects(
    () => reviseCourse(OWNER, {
      params: { id: created.id },
      body: { version: created.version, scope: 'lesson', sectionId: 'section-one', instructions: 'Make it friendlier.' },
    }),
    (error) => {
      assert.equal(error.code, 'COURSE_REVISION_NOT_APPROVABLE');
      assert.match(error.message, /ungrounded/);
      return true;
    },
  );
});
