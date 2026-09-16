import assert from 'node:assert/strict';
import test from 'node:test';

const ROOT_ID = 'course-root';
const OWNER_ID = 'saved-owner';

function clone(value) {
  return value === undefined ? undefined : structuredClone(value);
}

function matches(row, where = {}) {
  return Object.entries(where).every(([key, expected]) => row[key] === expected);
}

function applyData(row, data) {
  for (const [key, value] of Object.entries(data || {})) {
    if (
      value &&
      typeof value === 'object' &&
      !Array.isArray(value) &&
      Object.prototype.hasOwnProperty.call(value, 'increment')
    ) {
      row[key] += value.increment;
    } else {
      row[key] = clone(value);
    }
  }
}

function createFakePrisma() {
  const rows = new Map();
  let nextRevisionNumber = 1;
  let failRootCas = false;
  let failPreviousSupersede = false;

  function snapshot() {
    return {
      rows: clone([...rows.entries()]),
      nextRevisionNumber,
    };
  }

  function restore(state) {
    rows.clear();
    for (const [id, row] of state.rows) rows.set(id, row);
    nextRevisionNumber = state.nextRevisionNumber;
  }

  function seedRoot({
    version = 0,
    status = 'PENDING',
    payload = { title: 'Safety course', revisionHistory: [] },
  } = {}) {
    rows.set(ROOT_ID, {
      id: ROOT_ID,
      ownerId: OWNER_ID,
      type: 'COURSE_DRAFT',
      status,
      version,
      payload: clone(payload),
      createdAt: new Date('2024-01-01T00:00:00.000Z'),
      updatedAt: new Date('2024-01-01T00:00:00.000Z'),
    });
  }

  const tx = {
    learningRecord: {
      async findUnique({ where: { id } }) {
        return clone(rows.get(id) || null);
      },
      async create({ data }) {
        const id = `revision-${nextRevisionNumber++}`;
        const now = new Date(`2024-01-01T00:00:0${nextRevisionNumber}.000Z`);
        const row = {
          id,
          ...clone(data),
          createdAt: now,
          updatedAt: now,
          version: 0,
        };
        rows.set(id, row);
        return clone(row);
      },
      async updateMany({ where, data }) {
        if (where.id === ROOT_ID && failRootCas) {
          failRootCas = false;
          return { count: 0 };
        }
        if (
          where.type === 'COURSE_REVISION' &&
          where.status === 'PENDING' &&
          failPreviousSupersede
        ) {
          failPreviousSupersede = false;
          return { count: 0 };
        }
        const matching = [...rows.values()].filter((row) => matches(row, where));
        for (const row of matching) applyData(row, data);
        return { count: matching.length };
      },
    },
  };

  return {
    $transaction: async (callback) => {
      const before = snapshot();
      try {
        return await callback(tx);
      } catch (error) {
        restore(before);
        throw error;
      }
    },
    rows,
    reset() {
      rows.clear();
      nextRevisionNumber = 1;
      failRootCas = false;
      failPreviousSupersede = false;
    },
    seedRoot,
    snapshot,
    failNextRootCas() {
      failRootCas = true;
    },
    failNextPreviousSupersede() {
      failPreviousSupersede = true;
    },
  };
}

// lib/db.js deliberately takes the already-created global Prisma singleton.
// No PrismaClient constructor, DATABASE_URL, or database connection is used.
const fakePrisma = createFakePrisma();
globalThis.prisma = fakePrisma;
const { createCourseRevisionAtomically } = await import('../lib/db.js');

function revisionPayload(number, { courseId = ROOT_ID } = {}) {
  return {
    courseId,
    baseVersion: number - 1,
    reviewedVersion: number,
    scope: 'question',
    sectionId: 'section-1',
    phase: 'pre',
    questionId: `question-${number}`,
    instructions: `Revision ${number}`,
    sourceIds: ['source-record'],
    course: { title: `Safety course revision ${number}`, sections: [] },
  };
}

function historyEntry(number) {
  return {
    scope: 'question',
    sectionId: 'section-1',
    phase: 'pre',
    questionId: `question-${number}`,
    instructions: `Revision ${number}`,
    baseVersion: number - 1,
    version: number,
  };
}

async function createRevision(number, options = {}) {
  return createCourseRevisionAtomically({
    courseId: ROOT_ID,
    ownerId: OWNER_ID,
    expectedVersion: number - 1,
    expectedStatus: 'PENDING',
    revisionPayload: revisionPayload(number, options),
    revisionHistoryEntry: historyEntry(number),
  });
}

test('real helper commits successive pending revisions and supersedes the prior candidate', async () => {
  fakePrisma.reset();
  fakePrisma.seedRoot();

  const first = await createRevision(1);
  assert.equal(first.committed, true);
  assert.equal(first.version, 1);
  assert.equal(first.revision.id, 'revision-1');
  assert.equal(first.revision.payload.courseId, ROOT_ID);
  assert.equal(first.revision.payload.reviewedVersion, 1);
  assert.equal(fakePrisma.rows.get(ROOT_ID).payload.pendingRevisionId, 'revision-1');
  assert.equal(fakePrisma.rows.get('revision-1').status, 'PENDING');

  const second = await createRevision(2);
  assert.equal(second.committed, true);
  assert.equal(second.version, 2);
  assert.equal(second.revision.id, 'revision-2');
  assert.equal(fakePrisma.rows.get(ROOT_ID).payload.pendingRevisionId, 'revision-2');
  assert.equal(fakePrisma.rows.get('revision-1').status, 'SUPERSEDED');
  assert.equal(fakePrisma.rows.get('revision-2').status, 'PENDING');
  assert.deepEqual(
    fakePrisma.rows.get(ROOT_ID).payload.revisionHistory.map((entry) => [
      entry.id,
      entry.status,
      entry.baseVersion,
      entry.version,
    ]),
    [
      ['revision-1', 'SUPERSEDED', 0, 1],
      ['revision-2', 'PENDING', 1, 2],
    ],
  );
});

test('real helper rejects a pending revision belonging to another course', async () => {
  fakePrisma.reset();
  fakePrisma.seedRoot();

  const first = await createRevision(1);
  assert.equal(first.committed, true);
  fakePrisma.rows.get('revision-1').payload.courseId = 'other-course';
  const before = fakePrisma.snapshot();

  const result = await createRevision(2);
  assert.deepEqual(result, { committed: false });
  assert.deepEqual(fakePrisma.snapshot(), before);
});

test('root CAS failure after revision creation rolls back root, history, and new row', async () => {
  fakePrisma.reset();
  fakePrisma.seedRoot();
  const before = fakePrisma.snapshot();
  fakePrisma.failNextRootCas();

  const result = await createRevision(1);

  assert.deepEqual(result, { committed: false });
  assert.deepEqual(fakePrisma.snapshot(), before);
  assert.deepEqual([...fakePrisma.rows.keys()], [ROOT_ID]);
});

test('previous-revision supersede failure rolls back root/history and new row', async () => {
  fakePrisma.reset();
  fakePrisma.seedRoot();
  const first = await createRevision(1);
  assert.equal(first.committed, true);
  const before = fakePrisma.snapshot();
  fakePrisma.failNextPreviousSupersede();

  const result = await createRevision(2);

  assert.deepEqual(result, { committed: false });
  assert.deepEqual(fakePrisma.snapshot(), before);
  assert.equal(fakePrisma.rows.get(ROOT_ID).version, 1);
  assert.equal(fakePrisma.rows.get(ROOT_ID).payload.pendingRevisionId, 'revision-1');
  assert.equal(fakePrisma.rows.get('revision-1').status, 'PENDING');
  assert.deepEqual([...fakePrisma.rows.keys()], [ROOT_ID, 'revision-1']);
});
