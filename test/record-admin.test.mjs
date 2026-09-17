/*
 * Rename and delete for sources, rubrics and courses.
 *
 * The expensive thing to get wrong here is deletion, in two ways:
 *
 *   1. A typed Course cascades to Section -> Item -> Attempt/Schedule, so
 *      deleting a delivered course silently erases learner work. These tests
 *      pin the archive-instead-of-delete behaviour and the "no force flag"
 *      promise.
 *   2. A source is the grounding behind every citation drawn from it, and a
 *      rubric is how a completed mastery session is explained. Removing either
 *      while something still points at it breaks provenance after the fact.
 *
 * The database is an in-memory fake: these assertions are about which records
 * survive and which refusals fire, and a real Postgres would make them slower
 * without making them stronger. `tests/*-postgres.mjs` covers the real driver.
 */
import assert from 'node:assert/strict';
import { beforeEach, mock, test } from 'node:test';

const records = new Map();
const courses = new Map();
let evidence = new Map();
let seq = 0;

function snapshot(row) {
  return row ? JSON.parse(JSON.stringify(row)) : null;
}

const learningRecord = {
  // The source library (#109) looks up SOURCE_PDF rows by id list and, when
  // an adapter is not Prisma, insists it is a declared in-memory double.
  sourcePdfTestAdapter: 'memory',
  async findUnique({ where }) {
    return snapshot(records.get(where.id) || null);
  },
  async findMany({ where = {} } = {}) {
    const ids = Array.isArray(where.id?.in) ? new Set(where.id.in) : null;
    return [...records.values()]
      .filter((r) => !ids || ids.has(r.id))
      .filter((r) => !where.type || r.type === where.type)
      .filter((r) => !where.status || r.status === where.status)
      .filter((r) => !where.ownerId || r.ownerId === where.ownerId)
      .map(snapshot);
  },
  async create({ data }) {
    const row = { id: data.id || `rec-${++seq}`, version: 0, status: 'PENDING', ...data };
    records.set(row.id, row);
    return snapshot(row);
  },
  async updateMany({ where, data }) {
    const row = records.get(where.id);
    if (!row) return { count: 0 };
    if (where.version !== undefined && row.version !== where.version) return { count: 0 };
    const { version, ...rest } = data;
    Object.assign(row, rest);
    if (version?.increment) row.version += version.increment;
    return { count: 1 };
  },
  async update({ where, data }) {
    const row = records.get(where.id);
    if (!row) throw new Error('not found');
    Object.assign(row, data);
    return snapshot(row);
  },
  async deleteMany({ where }) {
    const ids = where?.id?.in || (where?.id ? [where.id] : []);
    let count = 0;
    for (const id of ids) if (records.delete(id)) count += 1;
    return { count };
  },
};

mock.module('../lib/db.js', {
  namedExports: {
    db: {
      learningRecord,
      course: {
        async deleteMany({ where }) {
          return { count: courses.delete(where.id) ? 1 : 0 };
        },
      },
      async $transaction(fn) { return fn({ learningRecord, course: { deleteMany: async ({ where }) => ({ count: courses.delete(where.id) ? 1 : 0 }) } }); },
    },
    async createLearningRecord(data) { return learningRecord.create({ data }); },
    async getLearningRecord(id) { return learningRecord.findUnique({ where: { id } }); },
    async getLearningRecordsByIds(ids) {
      return new Map([...new Set(ids || [])]
        .map((id) => [id, snapshot(records.get(id) || null)])
        .filter(([, r]) => r));
    },
    async listLearningRecords(filter) { return learningRecord.findMany({ where: filter || {} }); },
    async updateLearningRecord(id, data) { return learningRecord.update({ where: { id }, data }); },
    async updateLearningRecordIfVersion(id, version, data) {
      const r = await learningRecord.updateMany({
        where: { id, version }, data: { ...data, version: { increment: 1 } },
      });
      return r.count === 1;
    },
    async createCourseRevisionAtomically() { return { committed: false }; },
    async approveCourseAtomically() { throw new Error('not used'); },
    async deleteLearningRecords(ids, { courseIds = [] } = {}) {
      let removed = 0;
      for (const id of new Set(ids || [])) if (records.delete(id)) removed += 1;
      let dropped = 0;
      for (const id of new Set(courseIds)) if (courses.delete(id)) dropped += 1;
      return { records: removed, courses: dropped };
    },
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
    async courseEvidenceCount(courseId) {
      const n = evidence.get(courseId) || 0;
      return { attempts: n, schedules: 0, total: n };
    },
  },
});

const core = await import('../lib/learning/core.js');

const OWNER = { id: 'instructor-1', role: 'INSTRUCTOR' };
const OTHER = { id: 'instructor-2', role: 'INSTRUCTOR' };

beforeEach(() => {
  records.clear();
  courses.clear();
  evidence = new Map();
  seq = 0;
});

function seed(id, type, payload, { status = 'PENDING', ownerId = OWNER.id } = {}) {
  records.set(id, { id, ownerId, type, status, payload, version: 0 });
  return records.get(id);
}

/* --------------------------------- sources -------------------------------- */

test('a source renames, and only its owner can do it', async () => {
  seed('src-1', 'SOURCE', { title: 'Old title', sourceId: 'MCRP', pages: [] });

  const result = await core.renameSource(OWNER, { params: { id: 'src-1' }, body: { title: '  New title  ' } });
  assert.equal(result.json.title, 'New title', 'trimmed');
  assert.equal(records.get('src-1').payload.sourceId, 'MCRP', 'other payload fields survive');

  await assert.rejects(
    () => core.renameSource(OTHER, { params: { id: 'src-1' }, body: { title: 'Hijack' } }),
    (e) => e.code === 'NOT_FOUND',
  );
  assert.equal(records.get('src-1').payload.title, 'New title', 'a denied rename changes nothing');
});

test('an empty or oversized title is refused', async () => {
  seed('src-1', 'SOURCE', { title: 'Keep me' });
  for (const title of ['', '   ', undefined, 'x'.repeat(201)]) {
    await assert.rejects(
      () => core.renameSource(OWNER, { params: { id: 'src-1' }, body: { title } }),
      (e) => e.code === 'BAD_REQUEST',
      `expected refusal for ${JSON.stringify(title)}`,
    );
  }
  assert.equal(records.get('src-1').payload.title, 'Keep me');
});

test('an unused source deletes; one a course cites is refused by name', async () => {
  seed('src-free', 'SOURCE', { title: 'Unused' });
  seed('src-used', 'SOURCE', { title: 'Cited' });
  seed('course-1', 'COURSE_DRAFT', { title: 'Marksmanship', sourceIds: ['src-used'] });

  await core.deleteSource(OWNER, { params: { id: 'src-free' } });
  assert.equal(records.has('src-free'), false);

  await assert.rejects(
    () => core.deleteSource(OWNER, { params: { id: 'src-used' } }),
    (e) => {
      assert.equal(e.code, 'SOURCE_IN_USE');
      assert.equal(e.status, 409);
      // The message has to name the blocker, or the instructor cannot act on it.
      assert.match(e.message, /Marksmanship/);
      return true;
    },
  );
  assert.equal(records.has('src-used'), true, 'grounding is not broken');
});

/* --------------------------------- rubrics -------------------------------- */

test('a rubric in use by a mastery session cannot be deleted', async () => {
  seed('rub-1', 'RUBRIC', { title: 'Sight alignment' }, { status: 'APPROVED' });
  seed('sess-1', 'MASTERY_SESSION', { rubricId: 'rub-1' });

  await assert.rejects(
    () => core.deleteRubric(OWNER, { params: { id: 'rub-1' } }),
    (e) => e.code === 'RUBRIC_IN_USE' && e.status === 409,
  );
  assert.equal(records.has('rub-1'), true);

  // Once nothing grades against it, it goes.
  records.delete('sess-1');
  await core.deleteRubric(OWNER, { params: { id: 'rub-1' } });
  assert.equal(records.has('rub-1'), false);
});

/* --------------------------------- courses -------------------------------- */

test('renaming a course keeps the record and the generated document in step', async () => {
  seed('course-1', 'COURSE_DRAFT', {
    title: 'Draft title',
    course: { title: 'Draft title', sections: [{ id: 's1' }] },
  });
  await core.renameCourse(OWNER, { params: { id: 'course-1' }, body: { title: 'Real title' } });
  const payload = records.get('course-1').payload;
  assert.equal(payload.title, 'Real title');
  assert.equal(payload.course.title, 'Real title', 'the document title must not disagree');
  assert.deepEqual(payload.course.sections, [{ id: 's1' }], 'content untouched');
});

test('an unapproved draft deletes outright, with its revision history', async () => {
  seed('course-1', 'COURSE_DRAFT', {
    title: 'Never approved',
    pendingRevisionId: 'rev-2',
    revisionHistory: [{ id: 'rev-1', status: 'SUPERSEDED' }, { id: 'rev-2', status: 'PENDING' }],
  });
  seed('rev-1', 'COURSE_REVISION', { courseId: 'course-1' });
  seed('rev-2', 'COURSE_REVISION', { courseId: 'course-1' });

  const result = await core.deleteCourse(OWNER, { params: { id: 'course-1' }, query: {} });
  assert.equal(result.json.deleted, true);
  assert.equal(result.json.archived, false);
  assert.equal(records.has('course-1'), false);
  assert.equal(records.has('rev-1'), false, 'orphan revisions go too');
  assert.equal(records.has('rev-2'), false);
});

test('an approved course with learner work is ARCHIVED, never deleted', async () => {
  seed('course-1', 'COURSE_DRAFT', { title: 'Delivered', deliveryCourseId: 'course-1' }, { status: 'APPROVED' });
  courses.set('course-1', { id: 'course-1' });
  evidence.set('course-1', 7);

  const result = await core.deleteCourse(OWNER, { params: { id: 'course-1' }, query: {} });
  assert.equal(result.json.deleted, false);
  assert.equal(result.json.archived, true);
  assert.match(result.json.reason, /7 recorded attempt/);
  assert.equal(records.get('course-1').status, 'ARCHIVED');
  // The whole point: the typed rows that learner attempts cascade from survive.
  assert.equal(courses.has('course-1'), true, 'delivery rows must not be dropped');
});

test('no query parameter can force a destructive delete', async () => {
  seed('course-1', 'COURSE_DRAFT', { title: 'Delivered', deliveryCourseId: 'course-1' }, { status: 'APPROVED' });
  courses.set('course-1', { id: 'course-1' });
  evidence.set('course-1', 3);

  // Anything an optimistic caller might try. There is no supported escape.
  for (const query of [{ force: '1' }, { force: 'true' }, { hard: '1' }, { archive: '0' }]) {
    const result = await core.deleteCourse(OWNER, { params: { id: 'course-1' }, query });
    assert.equal(result.json.archived, true, `force attempt ${JSON.stringify(query)} must archive`);
    assert.equal(courses.has('course-1'), true);
    records.get('course-1').status = 'APPROVED';
  }
});

test('an approved course nobody has touched deletes, releases and all', async () => {
  seed('course-1', 'COURSE_DRAFT', {
    title: 'Untouched',
    deliveryCourseId: 'release-2',
    revisionHistory: [{ id: 'rev-1', deliveryCourseId: 'course-1' }],
  }, { status: 'APPROVED' });
  seed('rev-1', 'COURSE_REVISION', { courseId: 'course-1' });
  courses.set('course-1', { id: 'course-1' });
  courses.set('release-2', { id: 'release-2' });

  const result = await core.deleteCourse(OWNER, { params: { id: 'course-1' }, query: {} });
  assert.equal(result.json.deleted, true);
  assert.equal(records.has('course-1'), false);
  assert.equal(records.has('rev-1'), false);
  // Every release it ever delivered, not just the current one.
  assert.equal(courses.has('course-1'), false);
  assert.equal(courses.has('release-2'), false);
});

test('archive can be requested explicitly for an untouched course', async () => {
  seed('course-1', 'COURSE_DRAFT', { title: 'Untouched', deliveryCourseId: 'course-1' }, { status: 'APPROVED' });
  courses.set('course-1', { id: 'course-1' });

  const result = await core.deleteCourse(OWNER, { params: { id: 'course-1' }, query: { archive: '1' } });
  assert.equal(result.json.archived, true);
  assert.equal(records.get('course-1').status, 'ARCHIVED');
  assert.equal(courses.has('course-1'), true);
});

test('another instructor cannot rename or delete a course they do not own', async () => {
  seed('course-1', 'COURSE_DRAFT', { title: 'Mine' });
  for (const call of [
    () => core.renameCourse(OTHER, { params: { id: 'course-1' }, body: { title: 'Theirs' } }),
    () => core.deleteCourse(OTHER, { params: { id: 'course-1' }, query: {} }),
  ]) {
    await assert.rejects(call, (e) => e.code === 'NOT_FOUND');
  }
  assert.equal(records.has('course-1'), true);
  assert.equal(records.get('course-1').payload.title, 'Mine');
});

test('a record of the wrong type is not reachable through the course handlers', async () => {
  seed('src-1', 'SOURCE', { title: 'A source' });
  await assert.rejects(
    () => core.deleteCourse(OWNER, { params: { id: 'src-1' }, query: {} }),
    (e) => e.code === 'NOT_FOUND',
  );
  assert.equal(records.has('src-1'), true);
});

/* --------------------- permanent removal (second decision) -------------------- */

test('permanent removal is refused without the exact title, even though the UI asks for it', async () => {
  seed('course-1', 'COURSE_DRAFT', {
    title: 'Delivered course', deliveryCourseId: 'course-1',
  }, { status: 'APPROVED' });
  courses.set('course-1', { id: 'course-1' });
  evidence.set('course-1', 5);

  // The guard lives on the server, so a scripted DELETE cannot skip the
  // confirmation the UI presents.
  for (const query of [
    { permanent: '1' },
    { permanent: '1', confirm: '' },
    { permanent: '1', confirm: 'delivered course' },  // case differs
    { permanent: '1', confirm: 'Delivered cours' },   // truncated
    { permanent: 'true', confirm: 'something else' },
  ]) {
    await assert.rejects(
      () => core.deleteCourse(OWNER, { params: { id: 'course-1' }, query }),
      (e) => {
        assert.equal(e.code, 'CONFIRMATION_REQUIRED');
        assert.equal(e.status, 409);
        // The refusal has to state the cost, or confirming is blind.
        assert.match(e.message, /5 learner attempt/);
        return true;
      },
      `expected refusal for ${JSON.stringify(query)}`,
    );
    assert.equal(courses.has('course-1'), true, 'nothing was destroyed');
  }
});

test('permanent removal with the exact title destroys the course and reports the cost', async () => {
  seed('course-1', 'COURSE_DRAFT', {
    title: 'Delivered course',
    deliveryCourseId: 'release-2',
    revisionHistory: [{ id: 'rev-1', deliveryCourseId: 'course-1' }],
  }, { status: 'APPROVED' });
  seed('rev-1', 'COURSE_REVISION', { courseId: 'course-1' });
  courses.set('course-1', { id: 'course-1' });
  courses.set('release-2', { id: 'release-2' });
  evidence.set('course-1', 4);
  evidence.set('release-2', 3);

  const result = await core.deleteCourse(OWNER, {
    params: { id: 'course-1' },
    query: { permanent: '1', confirm: 'Delivered course' },
  });
  assert.equal(result.json.deleted, true);
  assert.equal(result.json.permanent, true);
  assert.equal(result.json.destroyed.attempts, 7, 'counts across every release');
  assert.equal(records.has('course-1'), false);
  assert.equal(records.has('rev-1'), false);
  assert.equal(courses.has('course-1'), false);
  assert.equal(courses.has('release-2'), false);
});

test('a first removal still archives and reports what permanent removal would cost', async () => {
  seed('course-1', 'COURSE_DRAFT', { title: 'Delivered', deliveryCourseId: 'course-1' }, { status: 'APPROVED' });
  courses.set('course-1', { id: 'course-1' });
  evidence.set('course-1', 2);

  // No permanent flag: the first click must never destroy anything.
  const result = await core.deleteCourse(OWNER, { params: { id: 'course-1' }, query: {} });
  assert.equal(result.json.archived, true);
  assert.equal(result.json.canDeletePermanently, true);
  assert.equal(result.json.evidence.total, 2);
  assert.equal(courses.has('course-1'), true);
});

test('an untouched course needs no confirmation and reports nothing to destroy', async () => {
  seed('course-1', 'COURSE_DRAFT', { title: 'Untouched', deliveryCourseId: 'course-1' }, { status: 'APPROVED' });
  courses.set('course-1', { id: 'course-1' });

  const result = await core.deleteCourse(OWNER, { params: { id: 'course-1' }, query: {} });
  assert.equal(result.json.deleted, true, 'no learner work means a plain delete');
  assert.equal(result.json.permanent, undefined);
  assert.equal(courses.has('course-1'), false);
});
