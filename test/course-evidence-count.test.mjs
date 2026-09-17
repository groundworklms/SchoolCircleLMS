/*
 * Can a course with learner work in it be destroyed?
 *
 * `RowActions` promises "A course learners have worked in is archived instead,
 * and their work is kept", and `courseEvidenceCount` is the only thing that
 * decides whether that promise fires. It counted the typed Attempt and Schedule
 * tables -- and nothing in the product writes them for a generated course, so
 * it read zero for every course that existed and an approved course full of
 * learner answers was hard-deletable. An answer to a generated course's check
 * is a MASTERY_ATTEMPT LearningRecord (lib/learning/attempts.js).
 *
 * These tests drive the REAL lib/db.js and the REAL deleteCourse against a fake
 * Prisma client, rather than mocking `courseEvidenceCount` the way
 * test/record-admin.test.mjs does. The bug was inside that function, so a test
 * that stubs it cannot see it: the archive-versus-delete logic was already
 * right and already tested, and it was being fed a zero.
 *
 * The client is installed on globalThis before lib/db.js is imported, which is
 * the same HMR cache the module already reads (`globalForPrisma.prisma`). No
 * database, and no second copy of the queries under test.
 */
import assert from 'node:assert/strict';
import { beforeEach, test } from 'node:test';

const attemptRows = [];
const scheduleRows = [];
const records = new Map();
const courses = new Set();
let seq = 0;

const snapshot = (row) => (row ? JSON.parse(JSON.stringify(row)) : null);
const courseOf = (where) => where?.item?.section?.courseId;

const learningRecord = {
  async findUnique({ where }) {
    return snapshot(records.get(where.id) || null);
  },
  async findMany({ where = {} } = {}) {
    return [...records.values()]
      .filter((row) => !where.type || row.type === where.type)
      .filter((row) => !where.status || row.status === where.status)
      .filter((row) => !where.ownerId || row.ownerId === where.ownerId)
      .map(snapshot);
  },
  async update({ where, data }) {
    const row = records.get(where.id);
    if (!row) throw new Error(`no record ${where.id}`);
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

const course = {
  async deleteMany({ where }) {
    return { count: courses.delete(where.id) ? 1 : 0 };
  },
};

globalThis.prisma = {
  learningRecord,
  course,
  attempt: {
    async count({ where }) {
      return attemptRows.filter((row) => row.courseId === courseOf(where)).length;
    },
  },
  schedule: {
    async count({ where }) {
      return scheduleRows.filter((row) => row.courseId === courseOf(where)).length;
    },
  },
  async $transaction(fn) {
    return fn({ learningRecord, course });
  },
};

const { courseEvidenceCount } = await import('../lib/db.js');
const { deleteCourse } = await import('../lib/learning/core.js');

const OWNER = { id: 'instructor-1', role: 'INSTRUCTOR' };

function seed(id, type, payload, { status = 'PENDING', ownerId = OWNER.id } = {}) {
  records.set(id, { id, ownerId, type, status, payload, version: 0 });
  return records.get(id);
}

/** One recorded answer, in the shape lib/learning/attempts.js actually saves. */
function seedAnswer({ courseId, releaseId, ownerId = 'learner-1' }) {
  seq += 1;
  return seed(`answer-${seq}`, 'MASTERY_ATTEMPT', {
    courseId,
    ...(releaseId === undefined ? {} : { releaseId }),
    itemId: `${releaseId || courseId}:s0:pre1`,
    attemptId: `attempt-${seq}`,
    optionId: '0',
    correct: true,
    objective: 'Safety check',
    phase: 'pre',
    result: { blockId: 'x', optionId: '0', correct: true, feedback: '' },
  }, { status: 'RECORDED', ownerId });
}

beforeEach(() => {
  attemptRows.length = 0;
  scheduleRows.length = 0;
  records.clear();
  courses.clear();
  seq = 0;
});

test('a recorded answer counts as learner evidence, where it is actually written', async () => {
  courses.add('course-1');
  seedAnswer({ courseId: 'course-1', releaseId: 'course-1' });
  seedAnswer({ courseId: 'course-1', releaseId: 'course-1', ownerId: 'learner-2' });

  const counted = await courseEvidenceCount('course-1');
  // No typed rows at all: this is exactly the state a generated course is in,
  // and the state the old query reported as untouched.
  assert.equal(counted.attempts, 0);
  assert.equal(counted.schedules, 0);
  assert.equal(counted.recorded, 2);
  assert.equal(counted.total, 2);
});

test('the typed tables still count, and the two stores add up rather than replace each other', async () => {
  attemptRows.push({ courseId: 'course-1' });
  scheduleRows.push({ courseId: 'course-1' }, { courseId: 'course-1' });
  seedAnswer({ courseId: 'course-1', releaseId: 'course-1' });

  assert.deepEqual(await courseEvidenceCount('course-1'), {
    attempts: 1,
    schedules: 2,
    recorded: 1,
    total: 4,
  });
});

test('an answer is counted under its own release, once, however many releases are summed', async () => {
  // deleteCourse sums this over every release id of the course, and the root
  // record id is always one of them (lib/learning/delivery.js). An answer
  // matched by BOTH its releaseId and its courseId would be counted twice and
  // the confirmation prompt would overstate the cost by a factor of two.
  seedAnswer({ courseId: 'course-1', releaseId: 'release-2' });
  assert.equal((await courseEvidenceCount('release-2')).recorded, 1);
  assert.equal((await courseEvidenceCount('course-1')).recorded, 0);

  // A row written before releases were pinned names no release; it belongs to
  // the root, and is still counted exactly once.
  records.clear();
  seedAnswer({ courseId: 'course-1' });
  assert.equal((await courseEvidenceCount('course-1')).recorded, 1);
  assert.equal((await courseEvidenceCount('release-2')).recorded, 0);
});

test('another course\'s answers are not this course\'s evidence', async () => {
  seedAnswer({ courseId: 'course-2', releaseId: 'course-2' });
  assert.equal((await courseEvidenceCount('course-1')).total, 0);
  assert.equal(await courseEvidenceCount('').then((c) => c.total), 0);
  assert.equal(await courseEvidenceCount(null).then((c) => c.recorded), 0);
});

/* ------------------- the promise the count exists to keep ------------------ */

test('an approved course a learner has answered in is archived, not destroyed', async () => {
  seed('course-1', 'COURSE_DRAFT', { title: 'Delivered', deliveryCourseId: 'course-1' }, { status: 'APPROVED' });
  courses.add('course-1');
  seedAnswer({ courseId: 'course-1', releaseId: 'course-1' });

  const result = await deleteCourse(OWNER, { params: { id: 'course-1' }, query: {} });
  assert.equal(result.json.deleted, false);
  assert.equal(result.json.archived, true);
  assert.equal(result.json.evidence.recorded, 1);
  assert.equal(records.get('course-1').status, 'ARCHIVED');
  assert.equal(courses.has('course-1'), true, 'the delivery rows survive');
  // And the answer itself is still on record, which is what "their work is
  // kept" means.
  assert.equal([...records.values()].filter((r) => r.type === 'MASTERY_ATTEMPT').length, 1);
});

test('permanent removal of an answered course still demands the exact title', async () => {
  seed('course-1', 'COURSE_DRAFT', { title: 'Delivered course', deliveryCourseId: 'course-1' }, { status: 'APPROVED' });
  courses.add('course-1');
  seedAnswer({ courseId: 'course-1', releaseId: 'course-1' });

  await assert.rejects(
    () => deleteCourse(OWNER, { params: { id: 'course-1' }, query: { permanent: '1' } }),
    (error) => {
      assert.equal(error.code, 'CONFIRMATION_REQUIRED');
      // The cost has to name the recorded answers, or an instructor confirms
      // against a count that says nothing of them.
      assert.match(error.message, /1 recorded answer/);
      return true;
    },
  );
  assert.equal(courses.has('course-1'), true, 'nothing was destroyed');
});

test('an approved course nobody has answered in is still removable', async () => {
  // The other half of the guarantee: counting a second store must not make
  // every course permanent. An untouched course goes on the first click.
  seed('course-1', 'COURSE_DRAFT', { title: 'Untouched', deliveryCourseId: 'course-1' }, { status: 'APPROVED' });
  courses.add('course-1');
  // A different course's learner work is present and must not hold this one.
  seedAnswer({ courseId: 'course-2', releaseId: 'course-2' });

  const result = await deleteCourse(OWNER, { params: { id: 'course-1' }, query: {} });
  assert.equal(result.json.deleted, true);
  assert.equal(result.json.archived, false);
  assert.equal(records.has('course-1'), false);
  assert.equal(courses.has('course-1'), false);
});
