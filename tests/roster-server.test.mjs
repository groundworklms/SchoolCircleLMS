import assert from 'node:assert/strict';
import test from 'node:test';

import { rosterRoute } from '../lib/roster/http.js';
import {
  createRosterService,
  ENROLLMENT,
  ENROLLMENT_EVENT,
  MESSAGE,
  MESSAGE_OPERATION,
  EMAIL_IDENTITY,
  SEND_WINDOW,
  MAX_COURSE_ENROLLMENTS,
  MAX_SEND_OPERATIONS_PER_WINDOW,
  RATE_LIMIT_ERROR,
} from '../lib/roster/service.js';

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

/**
 * A small Prisma-shaped store with real transaction snapshots. The transaction
 * queue makes Promise.all fixtures exercise the same serialized course writes
 * as PostgreSQL's advisory lock, while upsert preserves the database primary
 * key uniqueness contract for the deterministic enrollment id.
 */
function memoryDb({ failCreate } = {}) {
  let sequence = 0;
  let creates = 0;
  let transactionTail = Promise.resolve();
  let rows = [];

  const matches = (row, where = {}) =>
    Object.entries(where).every(([key, value]) => {
      if (key !== 'payload') return row[key] === value;
      if (!value || typeof value !== 'object' || !Array.isArray(value.path)) {
        return row.payload === value;
      }
      let current = row.payload;
      for (const segment of value.path) current = current?.[segment];
      return current === value.equals;
    });

  const learningRecord = {
    async findUnique({ where }) {
      return copy(rows.find((row) => row.id === where.id) || null);
    },

    async findMany({ where = {} }) {
      return copy(rows.filter((row) => matches(row, where)));
    },

    async create({ data }) {
      if (failCreate?.(data, creates)) throw new Error('fixture create failure');
      creates += 1;
      const now = new Date(++sequence);
      const row = {
        ...copy(data),
        id: data.id || `record-${sequence}`,
        version: data.version ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      if (rows.some((candidate) => candidate.id === row.id)) {
        const error = new Error('duplicate primary key');
        error.code = 'P2002';
        throw error;
      }
      rows.push(row);
      return copy(row);
    },

    async upsert({ where, create, update }) {
      const existing = rows.find((row) => row.id === where.id);
      if (existing) {
        for (const [key, value] of Object.entries(update || {})) existing[key] = copy(value);
        return copy(existing);
      }
      return this.create({ data: create });
    },

    async updateMany({ where, data }) {
      const row = rows.find((candidate) => matches(candidate, where));
      if (!row) return { count: 0 };
      for (const [key, value] of Object.entries(data || {})) {
        row[key] = value && typeof value === 'object' && Object.hasOwn(value, 'increment')
          ? row[key] + value.increment
          : copy(value);
      }
      row.updatedAt = new Date(++sequence);
      return { count: 1 };
    },
  };

  const db = {
    learningRecord,
    async $transaction(callback) {
      const previous = transactionTail;
      let release;
      transactionTail = new Promise((resolve) => {
        release = resolve;
      });
      await previous;
      const before = copy(rows);
      try {
        return await callback(db);
      } catch (error) {
        rows = before;
        throw error;
      } finally {
        release();
      }
    },
  };

  return {
    db,
    rows: () => copy(rows),
  };
}

async function addCourse(db, {
  id = 'course-1',
  ownerId = 'instructor-1',
  title = 'Signals fundamentals',
  type = 'MANUAL_COURSE',
} = {}) {
  return db.learningRecord.create({
    data: {
      id,
      ownerId,
      type,
      status: 'DRAFT',
      payload: { title },
    },
  });
}

const instructor = {
  id: 'instructor-1',
  name: 'SSgt Instructor',
  role: 'INSTRUCTOR',
  email: 'instructor@example.test',
  emailVerified: true,
};
const otherInstructor = {
  id: 'instructor-2',
  name: 'Other Instructor',
  role: 'INSTRUCTOR',
  email: 'other@example.test',
  emailVerified: true,
};
const learner = {
  id: 'learner-1',
  name: 'Learner',
  role: 'LEARNER',
  email: 'student@example.test',
  emailVerified: true,
};
const otherLearner = {
  id: 'learner-2',
  name: 'Other Learner',
  role: 'LEARNER',
  email: 'other-student@example.test',
  emailVerified: true,
};

/**
 * A learner-written participation record. `ownerId` is the learner's own User id
 * and the payload carries `courseId`, exactly as lib/authoring/service.js and
 * lib/learning/core.js write them. An instructor cannot produce one of these.
 */
async function addProgress(db, {
  ownerId = learner.id,
  courseId = 'course-1',
  type = 'MANUAL_PROGRESS',
} = {}) {
  return db.learningRecord.create({
    data: { ownerId, type, status: 'ACTIVE', payload: { courseId, releaseId: 'release-1' } },
  });
}

/**
 * A recipient is deliverable only once BOTH hold: their verified email is bound to
 * their User row (which happens when they read their own inbox), and they have
 * started the course. Anything less must not receive a roster message.
 */
async function makeDeliverable(fixture, identity, {
  courseId = 'course-1',
  type = 'MANUAL_PROGRESS',
} = {}) {
  await fixture.service.listMessages(identity);
  await addProgress(fixture.db, { ownerId: identity.id, courseId, type });
}

async function serviceFixture(options) {
  const fixture = memoryDb(options);
  await addCourse(fixture.db);
  return { ...fixture, service: createRosterService({ db: fixture.db }) };
}

function codeOf(error) {
  return error?.code;
}

test('roster auth boundary is instructor-owned and ignores identity fields in requests', async () => {
  const { service } = await serviceFixture();

  await assert.rejects(
    service.getStudents({ ...learner, id: instructor.id }, { params: { id: 'course-1' } }),
    (error) => codeOf(error) === 'FORBIDDEN',
  );
  await assert.rejects(
    service.getStudents(otherInstructor, { params: { id: 'course-1' } }),
    (error) => codeOf(error) === 'NOT_FOUND',
  );
  await assert.rejects(
    service.addStudents(instructor, {
      params: { id: 'course-1' },
      body: {
        name: 'No spoof',
        email: 'nobody@example.test',
        section: 'A',
        ownerId: otherInstructor.id,
      },
    }),
    (error) => codeOf(error) === 'BAD_REQUEST',
  );

  const unauthenticated = rosterRoute(
    { roles: ['INSTRUCTOR'] },
    () => ({ json: { shouldNotRun: true } }),
  );
  const response = await unauthenticated(new Request('http://localhost/api/roster/courses/course-1'));
  assert.equal(response.status, 401);
  assert.equal((await response.json()).code, 'AUTH_REQUIRED');
});

test('CSV import is atomic when a persistence write fails', async () => {
  const fixture = await serviceFixture({
    failCreate: (data) =>
      data.type === ENROLLMENT && data.payload?.email === 'second@example.test',
  });

  await assert.rejects(
    fixture.service.addStudents(instructor, {
      params: { id: 'course-1' },
      body: {
        students: [
          { name: 'First', email: 'first@example.test', section: 'A' },
          { name: 'Second', email: 'second@example.test', section: 'A' },
        ],
      },
    }),
    /fixture create failure/,
  );

  const persisted = fixture.rows();
  assert.equal(persisted.filter((row) => row.type === ENROLLMENT).length, 0);
  assert.equal(persisted.filter((row) => row.type === ENROLLMENT_EVENT).length, 0);
});

test('deterministic course/email ids prevent concurrent duplicate enrollments', async () => {
  const fixture = await serviceFixture();
  const results = await Promise.all(
    Array.from({ length: 8 }, () =>
      fixture.service.addStudents(instructor, {
        params: { id: 'course-1' },
        body: { name: 'Repeated', email: 'REPEATED@example.test', section: 'A' },
      })),
  );

  const ids = results.flatMap((result) => result.json.students.map((student) => student.id));
  assert.equal(new Set(ids).size, 1);
  assert.equal(fixture.rows().filter((row) => row.type === ENROLLMENT).length, 1);
  assert.equal(fixture.rows().filter((row) => row.type === ENROLLMENT_EVENT).length, 1);
  assert.equal(results.at(-1).json.students[0].email, 'repeated@example.test');
});

test('cumulative import overflow rolls back and full rosters accept only existing duplicates', async () => {
  const fixture = await serviceFixture();
  const initial = Array.from({ length: MAX_COURSE_ENROLLMENTS - 100 }, (_, index) => ({
    name: `Initial ${index}`,
    email: `initial-${index}@example.test`,
    section: 'A',
  }));
  await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { students: initial },
  });
  const overflowing = Array.from({ length: 101 }, (_, index) => ({
    name: `Overflow ${index}`,
    email: `overflow-${index}@example.test`,
    section: 'A',
  }));
  await assert.rejects(
    fixture.service.addStudents(instructor, {
      params: { id: 'course-1' },
      body: { students: overflowing },
    }),
    (error) =>
      codeOf(error) === 'ROSTER_CAPACITY_EXCEEDED' &&
      /500|capacity|support/i.test(error.message),
  );
  assert.equal(fixture.rows().filter((row) => row.type === ENROLLMENT).length, 400);

  await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: {
      students: overflowing.slice(0, 100),
    },
  });
  const full = await fixture.service.getStudents(instructor, { params: { id: 'course-1' } });
  assert.equal(full.json.students.length, MAX_COURSE_ENROLLMENTS);
  const duplicateAtCapacity = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { ...initial[0] },
  });
  assert.equal(duplicateAtCapacity.json.students.length, MAX_COURSE_ENROLLMENTS);
  assert.equal(fixture.rows().filter((row) => row.type === ENROLLMENT).length, MAX_COURSE_ENROLLMENTS);
});

test('retained dropped enrollments count toward capacity and oversized persisted rosters are rejected', async () => {
  const fixture = await serviceFixture();
  const students = Array.from({ length: MAX_COURSE_ENROLLMENTS }, (_, index) => ({
    name: `Student ${index}`,
    email: `student-${index}@example.test`,
    section: 'A',
  }));
  await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { students },
  });
  const roster = await fixture.service.getStudents(instructor, { params: { id: 'course-1' } });
  await fixture.service.updateStudents(instructor, {
    params: { id: 'course-1' },
    body: {
      ids: [roster.json.students[0].id],
      status: 'dropped',
      dropReason: 'withdrawn',
      effectiveDate: '2025-02-01',
    },
  });
  await assert.rejects(
    fixture.service.addStudents(instructor, {
      params: { id: 'course-1' },
      body: { name: 'No room', email: 'no-room@example.test', section: 'A' },
    }),
    (error) => codeOf(error) === 'ROSTER_CAPACITY_EXCEEDED',
  );

  const overflowFixture = await serviceFixture();
  for (let index = 0; index <= MAX_COURSE_ENROLLMENTS; index += 1) {
    await overflowFixture.db.learningRecord.create({
      data: {
        id: `overflow-${index}`,
        ownerId: instructor.id,
        type: ENROLLMENT,
        status: 'ACTIVE',
        payload: {
          courseId: 'course-1',
          studentId: `overflow-${index}`,
          name: `Overflow ${index}`,
          email: `overflow-${index}@example.test`,
          section: 'A',
          status: 'active',
        },
      },
    });
  }
  await assert.rejects(
    overflowFixture.service.getStudents(instructor, { params: { id: 'course-1' } }),
    (error) =>
      codeOf(error) === 'ROSTER_CAPACITY_EXCEEDED' &&
      /500|capacity|support/i.test(error.message),
  );
});

test('drops require reason/date and retain history through reactivation', async () => {
  const fixture = await serviceFixture();
  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Drop candidate', email: 'drop@example.test', section: 'A' },
  });
  const id = added.json.students[0].id;

  await assert.rejects(
    fixture.service.updateStudents(instructor, {
      params: { id: 'course-1' },
      body: { ids: [id], status: 'dropped', effectiveDate: '2025-01-01' },
    }),
    (error) => codeOf(error) === 'BAD_REQUEST',
  );
  await assert.rejects(
    fixture.service.updateStudents(instructor, {
      params: { id: 'course-1' },
      body: { ids: [id], status: 'dropped', dropReason: 'withdrawn', effectiveDate: '2025-02-30' },
    }),
    (error) => codeOf(error) === 'BAD_REQUEST',
  );

  const dropped = await fixture.service.updateStudents(instructor, {
    params: { id: 'course-1' },
    body: {
      ids: [id],
      status: 'dropped',
      dropReason: 'withdrawn',
      effectiveDate: '2025-02-01',
    },
  });
  assert.deepEqual(dropped.json.students[0], {
    id,
    name: 'Drop candidate',
    email: 'drop@example.test',
    section: 'A',
    status: 'dropped',
    dropReason: 'withdrawn',
    effectiveDate: '2025-02-01',
  });
  const droppedAgain = await fixture.service.updateStudents(instructor, {
    params: { id: 'course-1' },
    body: {
      ids: [id],
      status: 'dropped',
      dropReason: 'withdrawn',
      effectiveDate: '2025-02-01',
    },
  });
  assert.equal(droppedAgain.json.students[0].status, 'dropped');

  const reactivated = await fixture.service.updateStudents(instructor, {
    params: { id: 'course-1' },
    body: { ids: [id], status: 'active', dropReason: null, effectiveDate: null },
  });
  assert.equal(reactivated.json.students[0].status, 'active');
  assert.equal(reactivated.json.students[0].dropReason, null);
  assert.equal(reactivated.json.students[0].effectiveDate, null);
  const reactivatedAgain = await fixture.service.updateStudents(instructor, {
    params: { id: 'course-1' },
    body: { ids: [id], status: 'active', dropReason: null, effectiveDate: null },
  });
  assert.equal(reactivatedAgain.json.students[0].status, 'active');

  const events = fixture.rows()
    .filter((row) => row.type === ENROLLMENT_EVENT)
    .map((row) => row.payload);
  assert.deepEqual(events.map((event) => [event.event, event.status]), [
    ['enrolled', 'active'],
    ['status_changed', 'dropped'],
    ['status_changed', 'active'],
  ]);
  assert.equal(events[1].dropReason, 'withdrawn');
  assert.equal(events[1].effectiveDate, '2025-02-01');
});

test('message request ids make retries durable and reject changed replay payloads', async () => {
  const fixture = await serviceFixture();
  await makeDeliverable(fixture, learner);
  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Retry recipient', email: learner.email, section: 'A' },
  });
  const studentId = added.json.students[0].id;
  const requestId = '123e4567-e89b-12d3-a456-426614174000';
  const body = {
    studentIds: [studentId],
    subject: 'One notice',
    body: 'Exactly once.',
    requestId,
  };

  assert.deepEqual(
    (await fixture.service.sendMessages(instructor, { params: { id: 'course-1' }, body })).json,
    { delivered: 1 },
  );
  assert.deepEqual(
    (await fixture.service.sendMessages(instructor, { params: { id: 'course-1' }, body })).json,
    { delivered: 1 },
  );
  assert.equal(fixture.rows().filter((row) => row.type === MESSAGE).length, 1);
  assert.equal(fixture.rows().filter((row) => row.type === MESSAGE_OPERATION).length, 1);

  await assert.rejects(
    fixture.service.sendMessages(instructor, {
      params: { id: 'course-1' },
      body: { ...body, subject: 'Changed notice' },
    }),
    (error) => codeOf(error) === 'CONFLICT',
  );
  assert.equal(fixture.rows().filter((row) => row.type === MESSAGE).length, 1);

  await fixture.service.updateStudents(instructor, {
    params: { id: 'course-1' },
    body: {
      ids: [studentId],
      status: 'dropped',
      dropReason: 'withdrawn',
      effectiveDate: '2025-02-01',
    },
  });
  // The durable operation is checked before recipient state, so an exact
  // retry returns the original result without sending another message.
  assert.deepEqual(
    (await fixture.service.sendMessages(instructor, { params: { id: 'course-1' }, body })).json,
    { delivered: 1 },
  );
  await assert.rejects(
    fixture.service.sendMessages(instructor, {
      params: { id: 'course-1' },
      body: { ...body, requestId: 'not-a-uuid' },
    }),
    (error) => codeOf(error) === 'BAD_REQUEST',
  );
});

test('messages are instructor-scoped, only active recipients are sent, and dropped records remain', async () => {
  const fixture = await serviceFixture();
  await makeDeliverable(fixture, learner);
  const active = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Active', email: learner.email, section: 'A' },
  });
  const dropped = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Dropped', email: 'dropped@example.test', section: 'A' },
  });
  await fixture.service.updateStudents(instructor, {
    params: { id: 'course-1' },
    body: {
      ids: [dropped.json.students.find((student) => student.email === 'dropped@example.test').id],
      status: 'dropped',
      dropReason: 'withdrawn',
      effectiveDate: '2025-02-01',
    },
  });

  const sent = await fixture.service.sendMessages(instructor, {
    params: { id: 'course-1' },
    body: {
      studentIds: [active.json.students.find((student) => student.email === learner.email).id],
      subject: 'Welcome',
      body: 'Your next lab is Monday.',
    },
  });
  assert.deepEqual(sent.json, { delivered: 1 });
  assert.equal(fixture.rows().filter((row) => row.type === MESSAGE).length, 1);

  await assert.rejects(
    fixture.service.sendMessages(otherInstructor, {
      params: { id: 'course-1' },
      body: {
        studentIds: [active.json.students.find((student) => student.email === learner.email).id],
        subject: 'Nope',
        body: 'Nope',
      },
    }),
    (error) => codeOf(error) === 'NOT_FOUND',
  );
  await assert.rejects(
    fixture.service.sendMessages(instructor, {
      params: { id: 'course-1' },
      body: {
        studentIds: [dropped.json.students.find((student) => student.email === 'dropped@example.test').id],
        subject: 'Nope',
        body: 'Nope',
      },
    }),
    (error) => codeOf(error) === 'BAD_REQUEST' || codeOf(error) === 'NOT_FOUND',
  );
  assert.equal(fixture.rows().filter((row) => row.type === MESSAGE).length, 1);
  assert.equal(
    fixture.rows().find((row) => row.type === ENROLLMENT && row.payload.email === 'dropped@example.test')
      .payload.status,
    'dropped',
  );
});

test('inbox is keyed by the recipient User row and never leaks or permits recipient spoofing', async () => {
  const fixture = await serviceFixture();
  await makeDeliverable(fixture, learner);
  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Manual enrollment', email: learner.email, section: 'A' },
  });
  const studentId = added.json.students[0].id;
  await fixture.service.sendMessages(instructor, {
    params: { id: 'course-1' },
    body: { studentIds: [studentId], subject: 'Notice', body: 'Read this.' },
  });

  const own = await fixture.service.listMessages(learner);
  assert.equal(own.json.messages.length, 1);
  const message = own.json.messages[0];
  assert.deepEqual(Object.keys(message).sort(), [
    'body',
    'courseName',
    'createdAt',
    'id',
    'read',
    'senderName',
    'subject',
  ]);
  assert.equal(message.read, false);
  // A different User id is a different mailbox, whatever address it presents --
  // including the recipient's own address on someone else's account.
  assert.equal((await fixture.service.listMessages(otherLearner)).json.messages.length, 0);
  assert.equal((await fixture.service.listMessages({
    ...otherLearner,
    email: learner.email,
  })).json.messages.length, 0);
  // Changing the verified address on the SAME account keeps that account's
  // mailbox: delivery follows the User row, not the token's email claim.
  assert.equal((await fixture.service.listMessages({
    ...learner,
    email: 'renamed@example.test',
  })).json.messages.length, 1);
  await assert.rejects(
    fixture.service.listMessages({ ...learner, emailVerified: false }),
    (error) =>
      codeOf(error) === 'FORBIDDEN' &&
      /verified email address/i.test(error.message),
  );

  await assert.rejects(
    fixture.service.markMessageRead(
      otherLearner,
      { body: { id: message.id, read: true } },
    ),
    (error) => codeOf(error) === 'NOT_FOUND',
  );
  await assert.rejects(
    fixture.service.markMessageRead(
      { ...otherLearner, email: learner.email },
      { body: { id: message.id, read: true } },
    ),
    (error) => codeOf(error) === 'NOT_FOUND',
  );
  await assert.rejects(
    fixture.service.markMessageRead(
      { ...learner, emailVerified: false },
      { body: { id: message.id, read: true } },
    ),
    (error) =>
      codeOf(error) === 'FORBIDDEN' &&
      /verified email address/i.test(error.message),
  );
  assert.equal((await fixture.service.listMessages(learner)).json.messages[0].read, false);
  await assert.rejects(
    fixture.service.markMessageRead(learner, {
      body: { id: message.id, read: true, recipientEmail: 'wrong@example.test' },
    }),
    (error) => codeOf(error) === 'BAD_REQUEST',
  );
  assert.deepEqual(
    (await fixture.service.markMessageRead(learner, { body: { id: message.id, read: true } })).json,
    { id: message.id, read: true },
  );
  assert.equal((await fixture.service.listMessages(learner)).json.messages[0].read, true);
  for (let index = 0; index < 501; index += 1) {
    await fixture.db.learningRecord.create({
      data: {
        ownerId: instructor.id,
        type: MESSAGE,
        status: 'UNREAD',
        payload: {
          courseId: 'course-1',
          courseName: 'Signals fundamentals',
          senderName: instructor.name,
          recipientUserId: learner.id,
          recipientEmail: learner.email,
          subject: `Synthetic ${index}`,
          body: 'Bounded inbox fixture',
          read: false,
        },
      },
    });
  }
  const boundedInbox = await fixture.service.listMessages(learner);
  assert.equal(boundedInbox.json.messages.length, 500);
  assert.equal(boundedInbox.json.messages[0].subject, 'Synthetic 500');
});

test('roster and message input bounds reject oversized or malformed requests before writes', async () => {
  const fixture = await serviceFixture();
  const tooMany = Array.from({ length: 501 }, (_, index) => ({
    name: `Student ${index}`,
    email: `student-${index}@example.test`,
    section: 'A',
  }));
  await assert.rejects(
    fixture.service.addStudents(instructor, { params: { id: 'course-1' }, body: { students: tooMany } }),
    (error) => codeOf(error) === 'PAYLOAD_TOO_LARGE',
  );
  await assert.rejects(
    fixture.service.addStudents(instructor, {
      params: { id: 'course-1' },
      body: { name: 'x'.repeat(201), email: 'long@example.test', section: 'A' },
    }),
    (error) => codeOf(error) === 'BAD_REQUEST',
  );
  await assert.rejects(
    fixture.service.addStudents(instructor, {
      params: { id: 'course-1' },
      body: { name: 'Bad email', email: 'not-an-email', section: 'A' },
    }),
    (error) => codeOf(error) === 'BAD_REQUEST',
  );

  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Bounded', email: 'bounded@example.test', section: 'A' },
  });
  const studentId = added.json.students[0].id;
  await assert.rejects(
    fixture.service.sendMessages(instructor, {
      params: { id: 'course-1' },
      body: { studentIds: [studentId], subject: 'x'.repeat(201), body: 'ok' },
    }),
    (error) => codeOf(error) === 'BAD_REQUEST',
  );
  await assert.rejects(
    fixture.service.sendMessages(instructor, {
      params: { id: 'course-1' },
      body: { studentIds: [studentId], subject: 'ok', body: 'x'.repeat(10_001) },
    }),
    (error) => codeOf(error) === 'BAD_REQUEST',
  );
  assert.equal(fixture.rows().filter((row) => row.type === ENROLLMENT).length, 1);
  assert.equal(fixture.rows().filter((row) => row.type === MESSAGE).length, 0);
});
// --- Delivery authorization (the #84 spoofed-broadcast hole) -----------------

test('a typed-in address receives nothing without a verified User row and course participation', async () => {
  const fixture = await serviceFixture();
  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: {
      students: [
        { name: 'Never signed up', email: 'stranger@example.test', section: 'A' },
        { name: 'Signed in, never started', email: learner.email, section: 'A' },
        { name: 'Started, never signed in', email: otherLearner.email, section: 'A' },
      ],
    },
  });
  const idFor = (email) => added.json.students.find((student) => student.email === email).id;

  // Bound to a User row, but no participation in this course.
  await fixture.service.listMessages(learner);
  // Participation in this course, but the address is bound to no User row.
  await addProgress(fixture.db, { ownerId: otherLearner.id });

  for (const email of ['stranger@example.test', learner.email, otherLearner.email]) {
    await assert.rejects(
      fixture.service.sendMessages(instructor, {
        params: { id: 'course-1' },
        body: { studentIds: [idFor(email)], subject: 'Help Desk', body: 'Click here.' },
      }),
      // One identical error for every reason, so a send cannot be used to probe
      // which addresses have SchoolCircle accounts.
      (error) =>
        codeOf(error) === 'FORBIDDEN' &&
        /signed in with that verified email address and started this course/i.test(error.message),
    );
  }
  assert.equal(fixture.rows().filter((row) => row.type === MESSAGE).length, 0);

  // Both halves present -> delivery succeeds.
  await addProgress(fixture.db, { ownerId: learner.id });
  assert.deepEqual(
    (await fixture.service.sendMessages(instructor, {
      params: { id: 'course-1' },
      body: { studentIds: [idFor(learner.email)], subject: 'Real', body: 'Lab Monday.' },
    })).json,
    { delivered: 1 },
  );
  assert.equal(fixture.rows().filter((row) => row.type === MESSAGE).length, 1);
});

test('participation in another course does not authorize delivery', async () => {
  const fixture = await serviceFixture();
  await addCourse(fixture.db, { id: 'course-2', title: 'Unrelated' });
  await fixture.service.listMessages(learner);
  await addProgress(fixture.db, { ownerId: learner.id, courseId: 'course-2' });
  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Elsewhere', email: learner.email, section: 'A' },
  });

  await assert.rejects(
    fixture.service.sendMessages(instructor, {
      params: { id: 'course-1' },
      body: { studentIds: [added.json.students[0].id], subject: 'No', body: 'No.' },
    }),
    (error) => codeOf(error) === 'FORBIDDEN',
  );
  assert.equal(fixture.rows().filter((row) => row.type === MESSAGE).length, 0);
});

test('every learner-written participation type authorizes delivery', async () => {
  for (const type of ['MANUAL_PROGRESS', 'MANUAL_ATTEMPT', 'MASTERY_SESSION', 'MASTERY_ATTEMPT']) {
    const fixture = await serviceFixture();
    await makeDeliverable(fixture, learner, { type });
    const added = await fixture.service.addStudents(instructor, {
      params: { id: 'course-1' },
      body: { name: 'Participant', email: learner.email, section: 'A' },
    });
    assert.deepEqual(
      (await fixture.service.sendMessages(instructor, {
        params: { id: 'course-1' },
        body: { studentIds: [added.json.students[0].id], subject: type, body: 'Delivered.' },
      })).json,
      { delivered: 1 },
      `${type} should authorize delivery`,
    );
  }
});

test('a learner cannot read another learner message', async () => {
  const fixture = await serviceFixture();
  await makeDeliverable(fixture, learner);
  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Recipient', email: learner.email, section: 'A' },
  });
  await fixture.service.sendMessages(instructor, {
    params: { id: 'course-1' },
    body: { studentIds: [added.json.students[0].id], subject: 'Private', body: 'For one learner.' },
  });
  const messageId = (await fixture.service.listMessages(learner)).json.messages[0].id;

  assert.equal((await fixture.service.listMessages(otherLearner)).json.messages.length, 0);
  // Not even by claiming the recipient's address, and not even as the instructor
  // who owns the row.
  for (const impostor of [
    otherLearner,
    { ...otherLearner, email: learner.email },
    { ...otherLearner, id: 'learner-3' },
    instructor,
  ]) {
    await assert.rejects(
      fixture.service.markMessageRead(impostor, { body: { id: messageId, read: true } }),
      (error) => codeOf(error) === 'NOT_FOUND',
    );
    await assert.rejects(
      fixture.service.deleteMessage(impostor, { body: { id: messageId } }),
      (error) => codeOf(error) === 'NOT_FOUND',
    );
  }
  assert.equal((await fixture.service.listMessages(learner)).json.messages.length, 1);
});

test('a learner can delete only their own message, and the audit row survives', async () => {
  const fixture = await serviceFixture();
  await makeDeliverable(fixture, learner);
  await makeDeliverable(fixture, otherLearner);
  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: {
      students: [
        { name: 'One', email: learner.email, section: 'A' },
        { name: 'Two', email: otherLearner.email, section: 'A' },
      ],
    },
  });
  await fixture.service.sendMessages(instructor, {
    params: { id: 'course-1' },
    body: {
      studentIds: added.json.students.map((student) => student.id),
      subject: 'Broadcast',
      body: 'Two recipients.',
    },
  });
  const mine = (await fixture.service.listMessages(learner)).json.messages[0];
  assert.equal((await fixture.service.listMessages(otherLearner)).json.messages.length, 1);

  assert.deepEqual(
    (await fixture.service.deleteMessage(learner, { body: { id: mine.id } })).json,
    { id: mine.id, deleted: true },
  );
  assert.equal((await fixture.service.listMessages(learner)).json.messages.length, 0);
  // The other recipient's copy is untouched.
  assert.equal((await fixture.service.listMessages(otherLearner)).json.messages.length, 1);
  // Soft delete: the instructor-side audit row remains, flagged.
  const row = fixture.rows().find((candidate) => candidate.id === mine.id);
  assert.equal(row.type, MESSAGE);
  assert.equal(row.payload.hiddenByRecipient, true);

  // A hidden message is gone for every purpose, and deleting twice is a 404.
  await assert.rejects(
    fixture.service.deleteMessage(learner, { body: { id: mine.id } }),
    (error) => codeOf(error) === 'NOT_FOUND',
  );
  await assert.rejects(
    fixture.service.markMessageRead(learner, { body: { id: mine.id, read: true } }),
    (error) => codeOf(error) === 'NOT_FOUND',
  );
  await assert.rejects(
    fixture.service.deleteMessage(learner, { body: { id: mine.id, read: true } }),
    (error) => codeOf(error) === 'BAD_REQUEST',
  );
  await assert.rejects(
    fixture.service.deleteMessage({ ...learner, emailVerified: false }, { body: { id: mine.id } }),
    (error) => codeOf(error) === 'FORBIDDEN',
  );
});

test('the per-instructor send limit is enforced and is not consumed by idempotent retries', async () => {
  const fixture = await serviceFixture();
  await makeDeliverable(fixture, learner);
  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Recipient', email: learner.email, section: 'A' },
  });
  const studentId = added.json.students[0].id;
  const send = (subject) => fixture.service.sendMessages(instructor, {
    params: { id: 'course-1' },
    body: { studentIds: [studentId], subject, body: 'Spam.' },
  });

  for (let index = 0; index < MAX_SEND_OPERATIONS_PER_WINDOW; index += 1) {
    assert.deepEqual((await send(`Notice ${index}`)).json, { delivered: 1 });
  }
  await assert.rejects(
    send('One too many'),
    (error) =>
      codeOf(error) === RATE_LIMIT_ERROR &&
      error.status === 429 &&
      /per hour/i.test(error.message),
  );
  assert.equal(
    fixture.rows().filter((row) => row.type === MESSAGE).length,
    MAX_SEND_OPERATIONS_PER_WINDOW,
  );

  // The counter is one durable row per instructor per window.
  const windows = fixture.rows().filter((row) => row.type === SEND_WINDOW);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].ownerId, instructor.id);
  assert.equal(windows[0].payload.operations, MAX_SEND_OPERATIONS_PER_WINDOW);
  assert.equal(windows[0].payload.deliveries, MAX_SEND_OPERATIONS_PER_WINDOW);

  // A second instructor has an independent window: the limit is per sender.
  await addCourse(fixture.db, { id: 'course-2', ownerId: otherInstructor.id, title: 'Other' });
  await addProgress(fixture.db, { ownerId: learner.id, courseId: 'course-2' });
  const theirs = await fixture.service.addStudents(otherInstructor, {
    params: { id: 'course-2' },
    body: { name: 'Recipient', email: learner.email, section: 'A' },
  });
  assert.deepEqual(
    (await fixture.service.sendMessages(otherInstructor, {
      params: { id: 'course-2' },
      body: { studentIds: [theirs.json.students[0].id], subject: 'Fine', body: 'Allowed.' },
    })).json,
    { delivered: 1 },
  );
  assert.equal(fixture.rows().filter((row) => row.type === SEND_WINDOW).length, 2);
});

test('an idempotent replay does not consume send quota', async () => {
  const fixture = await serviceFixture();
  await makeDeliverable(fixture, learner);
  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Recipient', email: learner.email, section: 'A' },
  });
  const body = {
    studentIds: [added.json.students[0].id],
    subject: 'Once',
    body: 'Exactly once.',
    requestId: '123e4567-e89b-12d3-a456-426614174000',
  };
  for (let index = 0; index < 5; index += 1) {
    assert.deepEqual(
      (await fixture.service.sendMessages(instructor, { params: { id: 'course-1' }, body })).json,
      { delivered: 1 },
    );
  }
  const windows = fixture.rows().filter((row) => row.type === SEND_WINDOW);
  assert.equal(windows.length, 1);
  assert.equal(windows[0].payload.operations, 1);
  assert.equal(windows[0].payload.deliveries, 1);
});

test('a verified email binds to one User row and is never re-pointed by a later claim', async () => {
  const fixture = await serviceFixture();
  await fixture.service.listMessages(learner);
  const bindings = fixture.rows().filter((row) => row.type === EMAIL_IDENTITY);
  assert.equal(bindings.length, 1);
  assert.equal(bindings[0].payload.userId, learner.id);
  assert.equal(bindings[0].payload.email, learner.email);

  // A second account presenting the same verified address does not take it over.
  await fixture.service.listMessages({ ...otherLearner, email: learner.email });
  const after = fixture.rows().filter((row) => row.type === EMAIL_IDENTITY);
  assert.equal(after.filter((row) => row.payload.email === learner.email).length, 1);
  assert.equal(
    after.find((row) => row.payload.email === learner.email).payload.userId,
    learner.id,
  );

  // So a message to that address still reaches only the first holder.
  await addProgress(fixture.db, { ownerId: learner.id });
  await addProgress(fixture.db, { ownerId: otherLearner.id });
  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Recipient', email: learner.email, section: 'A' },
  });
  await fixture.service.sendMessages(instructor, {
    params: { id: 'course-1' },
    body: { studentIds: [added.json.students[0].id], subject: 'Bound', body: 'One holder.' },
  });
  assert.equal((await fixture.service.listMessages(learner)).json.messages.length, 1);
  assert.equal(
    (await fixture.service.listMessages({ ...otherLearner, email: learner.email })).json.messages.length,
    0,
  );
});

test('a sender name never falls back to the sender email address', async () => {
  const fixture = await serviceFixture();
  await makeDeliverable(fixture, learner);
  const added = await fixture.service.addStudents(instructor, {
    params: { id: 'course-1' },
    body: { name: 'Recipient', email: learner.email, section: 'A' },
  });
  for (const nameless of [
    { ...instructor, name: '' },
    { ...instructor, name: '   ' },
    { ...instructor, name: null },
    { ...instructor, name: undefined },
  ]) {
    await fixture.service.sendMessages(nameless, {
      params: { id: 'course-1' },
      body: { studentIds: [added.json.students[0].id], subject: 'Anonymous', body: 'No name.' },
    });
  }
  const messages = (await fixture.service.listMessages(learner)).json.messages;
  assert.equal(messages.length, 4);
  for (const message of messages) {
    assert.equal(message.senderName, 'Course instructor');
    assert.ok(!/@/u.test(message.senderName), 'senderName must never contain an address');
  }
});

test('roster 5xx responses are logged with the cause and no connection string', async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const boom = rosterRoute({}, () => {
      throw new Error(
        'Cannot reach database server at postgresql://ci:secret@localhost:5432/ci?schema=public',
      );
    });
    const response = await boom(new Request('http://localhost/api/roster/messages'));
    assert.equal(response.status, 500);
    // The client still learns nothing.
    assert.equal((await response.json()).error, 'Roster service unavailable. Please retry.');
  } finally {
    console.error = original;
  }
  assert.equal(logged.length, 1);
  assert.match(logged[0], /\[roster\]/u);
  assert.match(logged[0], /reach database server/u);
  assert.match(logged[0], /\[redacted-url\]/u);
  assert.ok(!/secret/u.test(logged[0]), 'the connection string must not be logged');
  assert.ok(!/postgresql:\/\//u.test(logged[0]), 'the connection string must not be logged');
});

test('a 4xx roster response is not logged', async () => {
  const logged = [];
  const original = console.error;
  console.error = (...args) => logged.push(args.join(' '));
  try {
    const route = rosterRoute({}, () => {
      throw Object.assign(new Error('nope'), { code: 'NOT_FOUND' });
    });
    assert.equal((await route(new Request('http://localhost/api/roster/messages'))).status, 404);
  } finally {
    console.error = original;
  }
  assert.deepEqual(logged, []);
});
