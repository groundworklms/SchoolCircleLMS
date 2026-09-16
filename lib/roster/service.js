import { createHash, randomUUID } from 'node:crypto';

import { db as defaultDb } from '../db.js';

const COURSE_TYPES = new Set(['MANUAL_COURSE', 'COURSE_DRAFT']);
const ENROLLMENT = 'ROSTER_ENROLLMENT';
const ENROLLMENT_EVENT = 'ROSTER_ENROLLMENT_EVENT';
const MESSAGE = 'ROSTER_MESSAGE';
const MESSAGE_OPERATION = 'ROSTER_MESSAGE_OPERATION';
// Binds one verified email address to one SchoolCircle User id. `LearningRecord.type`
// is a plain string, so this discriminator needs no Prisma migration (the live Cloud
// SQL database is migrated from prisma/migrations/ on merge; see .github/workflows).
const EMAIL_IDENTITY = 'ROSTER_EMAIL_IDENTITY';
// Per-instructor fixed-window send counter.
const SEND_WINDOW = 'ROSTER_SEND_WINDOW';

// Learner-initiated course participation. Every one of these records is written by
// the LEARNER's own authenticated request with `ownerId` = that learner's User id
// (lib/authoring/service.js for the MANUAL_* pair, lib/learning/core.js for the
// MASTERY_* pair), and every payload carries `courseId`. An instructor cannot forge
// one, which is what makes this a real relationship rather than a typed-in address.
const LEARNER_PROGRESS_TYPES = [
  'MANUAL_PROGRESS',
  'MANUAL_ATTEMPT',
  'MASTERY_SESSION',
  'MASTERY_ATTEMPT',
];

const MAX_COURSE_ID = 128;
const MAX_STUDENT_ID = 128;
const MAX_NAME = 200;
const MAX_EMAIL = 254;
const MAX_SECTION = 120;
const MAX_DROP_REASON = 500;
const MAX_SUBJECT = 200;
const MAX_MESSAGE_BODY = 10_000;
const MAX_STUDENTS = 500;
const MAX_COURSE_ENROLLMENTS = 500;
const MAX_INBOX_MESSAGES = 500;
const CAPACITY_ERROR = 'ROSTER_CAPACITY_EXCEEDED';
const RATE_LIMIT_ERROR = 'ROSTER_RATE_LIMITED';

// Fixed-window send quota per instructor. The window is deliberately coarse and
// DB-backed (a LearningRecord row) rather than in-memory, so the limit holds across
// every serverless instance instead of per process.
const SEND_WINDOW_MS = 60 * 60 * 1000;
const MAX_SEND_OPERATIONS_PER_WINDOW = 20;
const MAX_SEND_DELIVERIES_PER_WINDOW = 2_000;

function rosterError(message, code = 'BAD_REQUEST', status) {
  const error = new Error(message);
  error.code = code;
  error.status = status ?? ({
    BAD_REQUEST: 400,
    CONFLICT: 409,
    FORBIDDEN: 403,
    NOT_FOUND: 404,
    PAYLOAD_TOO_LARGE: 413,
  }[code] || 500);
  return error;
}

function rosterCapacityError() {
  return rosterError(
    `Roster capacity is limited to ${MAX_COURSE_ENROLLMENTS} students; contact support to manage this roster.`,
    CAPACITY_ERROR,
    409,
  );
}

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function payloadOf(row) {
  return row?.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload
    : {};
}

function assertObject(value, label = 'Request') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw rosterError(`${label} must be an object`);
  }
}

function assertKeys(value, allowed, label = 'Request') {
  assertObject(value, label);
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw rosterError(`${label} contains an unsupported field`);
  }
}

function requiredId(value, label, max = MAX_COURSE_ID) {
  if (typeof value !== 'string' || !value.trim() || value.length > max) {
    throw rosterError(`${label} is required`);
  }
  return value.trim();
}

function identityId(identity) {
  return requiredId(identity?.id, 'Authenticated user');
}

function assertInstructor(identity) {
  identityId(identity);
  const role = String(identity?.role || '').toUpperCase();
  if (role !== 'INSTRUCTOR' && role !== 'BOTH') {
    throw rosterError('Instructor access is required', 'FORBIDDEN');
  }
}

function boundedText(value, label, max, { required = true, allowNewlines = false } = {}) {
  if (value === undefined || value === null) {
    if (!required) return null;
    throw rosterError(`${label} is required`);
  }
  const controls = allowNewlines
    ? /[\u0000-\u0008\u000b\u000c\u000e-\u001f\u007f-\u009f]/u
    : /[\u0000-\u001f\u007f-\u009f]/u;
  if (typeof value !== 'string' || value.length > max || controls.test(value)) {
    throw rosterError(`${label} is invalid`);
  }
  const text = value.trim();
  if (required && !text) throw rosterError(`${label} is required`);
  return text || null;
}

function normalizeEmail(value, label = 'email') {
  const email = boundedText(value, label, MAX_EMAIL);
  if (!email || !/^[^@\s]+@[^@\s]+$/u.test(email)) {
    throw rosterError(`${label} is invalid`);
  }
  return email.toLowerCase();
}

function requestUuid(value) {
  if (
    typeof value !== 'string' ||
    value.length > 36 ||
    !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu.test(value)
  ) {
    throw rosterError('requestId must be a valid UUID');
  }
  return value.toLowerCase();
}

function identityEmail(identity) {
  // `email` is copied by lib/auth.js from the verified Firebase token. It is
  // intentionally never accepted from a request body or query string.
  if (identity?.emailVerified !== true) {
    throw rosterError(
      'A verified email address is required to access roster messages.',
      'FORBIDDEN',
    );
  }
  try {
    return normalizeEmail(identity?.email, 'A verified email address');
  } catch {
    throw rosterError(
      'A verified email address is required to access roster messages.',
      'FORBIDDEN',
    );
  }
}

function isoDate(value, label = 'effectiveDate') {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/u.test(value)) {
    throw rosterError(`${label} must be a valid YYYY-MM-DD date`);
  }
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(`${value}T00:00:00.000Z`);
  if (
    date.getUTCFullYear() !== year ||
    date.getUTCMonth() + 1 !== month ||
    date.getUTCDate() !== day
  ) {
    throw rosterError(`${label} must be a valid YYYY-MM-DD date`);
  }
  return value;
}

function deterministicId(prefix, value) {
  const digest = createHash('sha256').update(value).digest('hex').slice(0, 48);
  return `${prefix}-${digest}`;
}

function enrollmentIdFor(courseId, email) {
  return deterministicId('roster-student', `${courseId}\u0000${email}`);
}

function courseTitle(course) {
  const payload = payloadOf(course);
  const draft = payload.draft && typeof payload.draft === 'object' ? payload.draft : null;
  return (
    (typeof payload.title === 'string' && payload.title.trim()) ||
    (typeof draft?.title === 'string' && draft.title.trim()) ||
    (typeof payload.course?.title === 'string' && payload.course.title.trim()) ||
    course.id
  );
}

function enrollmentData(row) {
  const payload = payloadOf(row);
  return {
    id: row.id,
    name: payload.name || '',
    email: payload.email || '',
    section: payload.section ?? null,
    status: payload.status === 'dropped' ? 'dropped' : 'active',
    dropReason: payload.status === 'dropped' ? (payload.dropReason || null) : null,
    effectiveDate: payload.status === 'dropped' ? (payload.effectiveDate || null) : null,
  };
}

function messageData(row) {
  const payload = payloadOf(row);
  const createdAt = row.createdAt instanceof Date
    ? row.createdAt.toISOString()
    : new Date(row.createdAt || 0).toISOString();
  return {
    id: row.id,
    subject: payload.subject,
    body: payload.body,
    courseName: payload.courseName,
    senderName: payload.senderName,
    createdAt,
    read: payload.read === true || row.status === 'READ',
  };
}

async function transaction(database, callback) {
  if (typeof database?.$transaction === 'function') {
    // A 500-student import writes the enrollment and audit rows in one
    // interactive transaction. Keep the timeout finite, but above Prisma's
    // five-second default so a healthy PostgreSQL instance is not aborted
    // halfway through an atomic import.
    return database.$transaction(callback, { maxWait: 5_000, timeout: 30_000 });
  }
  return callback(database);
}

async function advisoryLock(database, key) {
  if (typeof database?.$executeRawUnsafe === 'function') {
    await database.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      String(key).slice(0, 180),
    );
  } else if (typeof database?.$queryRaw === 'function') {
    await database.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${String(key).slice(0, 180)}))`;
  }
}

async function findCourse(database, id) {
  const courseId = requiredId(id, 'Course');
  const row = await database.learningRecord.findUnique({ where: { id: courseId } });
  if (!row || !COURSE_TYPES.has(row.type)) {
    throw rosterError('Course not found', 'NOT_FOUND');
  }
  return row;
}

async function ownedCourse(database, identity, id) {
  const course = await findCourse(database, id);
  if (course.ownerId !== identityId(identity)) {
    // A cross-owner course is deliberately indistinguishable from a missing
    // course so its title, enrollment, and message state cannot be probed.
    throw rosterError('Course not found', 'NOT_FOUND');
  }
  return course;
}

async function courseEnrollments(database, courseId, ownerId) {
  const rows = await database.learningRecord.findMany({
    where: {
      type: ENROLLMENT,
      ownerId,
      payload: { path: ['courseId'], equals: courseId },
    },
    orderBy: { id: 'asc' },
    take: MAX_COURSE_ENROLLMENTS + 1,
  });
  const candidates = Array.isArray(rows) ? rows : [];
  if (candidates.length > MAX_COURSE_ENROLLMENTS) throw rosterCapacityError();
  return candidates.filter((row) => {
    const payload = payloadOf(row);
    return (
      row.ownerId === ownerId &&
      payload.courseId === courseId &&
      row.type === ENROLLMENT
    );
  });
}

function studentInput(value, index) {
  assertKeys(value, new Set(['name', 'email', 'section']), `students[${index}]`);
  const name = boundedText(value.name, `students[${index}].name`, MAX_NAME);
  const email = normalizeEmail(value.email, `students[${index}].email`);
  const section = value.section === undefined || value.section === null
    ? null
    : boundedText(value.section, `students[${index}].section`, MAX_SECTION, { required: false });
  return { name, email, section };
}

function parseStudentInputs(body) {
  assertObject(body);
  let values;
  if (Object.hasOwn(body, 'students')) {
    assertKeys(body, new Set(['students']));
    if (!Array.isArray(body.students) || body.students.length === 0) {
      throw rosterError('students must be a non-empty array');
    }
    if (body.students.length > MAX_STUDENTS) {
      throw rosterError(`A maximum of ${MAX_STUDENTS} students may be imported`, 'PAYLOAD_TOO_LARGE');
    }
    values = body.students;
  } else {
    assertKeys(body, new Set(['name', 'email', 'section']));
    values = [body];
  }

  const students = values.map(studentInput);
  const emails = new Set();
  for (const student of students) {
    if (emails.has(student.email)) {
      throw rosterError(`Duplicate enrollment email: ${student.email}`, 'CONFLICT');
    }
    emails.add(student.email);
  }
  return students;
}

function assertEnrollmentRow(row, courseId, ownerId) {
  const payload = payloadOf(row);
  if (
    !row ||
    row.type !== ENROLLMENT ||
    row.ownerId !== ownerId ||
    payload.courseId !== courseId
  ) {
    throw rosterError('Student enrollment not found', 'NOT_FOUND');
  }
}

async function upsertEnrollment(database, course, ownerId, student) {
  const id = enrollmentIdFor(course.id, student.email);
  const data = {
    id,
    ownerId,
    type: ENROLLMENT,
    status: 'ACTIVE',
    payload: {
      courseId: course.id,
      studentId: id,
      name: student.name,
      email: student.email,
      section: student.section,
      status: 'active',
      dropReason: null,
      effectiveDate: null,
    },
  };

  let existing = null;
  if (typeof database.learningRecord.findUnique === 'function') {
    existing = await database.learningRecord.findUnique({ where: { id } });
  }
  // A small in-memory test seam may not implement Prisma's upsert. Search
  // the natural key there as well so repeated imports remain idempotent even
  // when that seam assigns generated ids to create() calls.
  if (!existing && typeof database.learningRecord.upsert !== 'function') {
    const rows = await database.learningRecord.findMany({
      where: {
        type: ENROLLMENT,
        ownerId,
        payload: { path: ['courseId'], equals: course.id },
      },
    });
    existing = (Array.isArray(rows) ? rows : []).find((candidate) => {
      const payload = payloadOf(candidate);
      return (
        candidate.ownerId === ownerId &&
        payload.courseId === course.id &&
        payload.email === student.email
      );
    }) || null;
  }
  if (existing) {
    assertEnrollmentRow(existing, course.id, ownerId);
    return { row: existing, created: false };
  }

  let row;
  if (typeof database.learningRecord.upsert === 'function') {
    row = await database.learningRecord.upsert({
      where: { id },
      create: data,
      // A duplicate import is idempotent. Never replace a student's name,
      // section, or drop history just because an import was repeated.
      update: {},
    });
  } else {
    // The production Prisma client always has upsert. This fallback keeps the
    // service seam useful for focused in-memory tests.
    row = await database.learningRecord.create({ data });
  }
  assertEnrollmentRow(row, course.id, ownerId);
  return { row, created: true };
}

async function createEnrollmentEvent(database, {
  ownerId,
  courseId,
  studentId,
  event,
  previousStatus = null,
  status,
  dropReason = null,
  effectiveDate = null,
  id = null,
}) {
  const data = {
    ...(id ? { id } : {}),
    ownerId,
    type: ENROLLMENT_EVENT,
    status: 'RECORDED',
    payload: {
      courseId,
      studentId,
      event,
      previousStatus,
      status,
      dropReason,
      effectiveDate,
    },
  };
  if (id && typeof database.learningRecord.upsert === 'function') {
    return database.learningRecord.upsert({
      where: { id },
      create: data,
      update: {},
    });
  }
  return database.learningRecord.create({ data });
}

function sortedStudents(rows) {
  return rows
    .slice()
    .sort((a, b) => {
      const ad = new Date(a.createdAt || 0).getTime();
      const bd = new Date(b.createdAt || 0).getTime();
      return ad - bd || String(a.id).localeCompare(String(b.id));
    })
    .map(enrollmentData);
}

function messageRecipientId(row) {
  const userId = payloadOf(row).recipientUserId;
  return typeof userId === 'string' && userId ? userId : null;
}

function messageHidden(row) {
  return payloadOf(row).hiddenByRecipient === true;
}

function senderName(identity) {
  const name = typeof identity?.name === 'string' ? identity.name.trim() : '';
  // Never fall back to the sender's own email address. `senderName` is persisted
  // into every recipient's row and read back by the inbox, so a fallback here
  // would publish the instructor's address to everyone they message.
  return name.slice(0, MAX_NAME) || 'Course instructor';
}

function emailIdentityIdFor(email) {
  return deterministicId('roster-email-identity', email);
}

function emailBindingUserId(row, email) {
  const payload = payloadOf(row);
  if (!row || row.type !== EMAIL_IDENTITY || payload.email !== email) return null;
  return typeof payload.userId === 'string' && payload.userId ? payload.userId : null;
}

/**
 * Record that `userId` controls `email`, and return whichever user the address is
 * bound to.
 *
 * The row id is derived from the address alone, so exactly one User may ever hold a
 * mailbox address and the FIRST verified claim wins. A later claim -- the same
 * address arriving on a second Firebase uid, or a recycled address handed to a new
 * person -- does not re-point the binding. That is deliberate: silently
 * transferring a mailbox on an email claim is precisely the recycled-address
 * attack, so the new holder simply receives nothing rather than inheriting the
 * previous holder's mail.
 */
async function bindVerifiedEmail(database, userId, email) {
  const id = emailIdentityIdFor(email);
  const existing = await database.learningRecord.findUnique({ where: { id } });
  if (existing) return emailBindingUserId(existing, email);
  const data = {
    id,
    ownerId: userId,
    type: EMAIL_IDENTITY,
    status: 'ACTIVE',
    payload: { email, userId, boundAt: new Date().toISOString() },
  };
  try {
    if (typeof database.learningRecord.upsert === 'function') {
      // `update: {}` keeps the first writer's binding on a concurrent claim.
      return emailBindingUserId(
        await database.learningRecord.upsert({ where: { id }, create: data, update: {} }),
        email,
      );
    }
    return emailBindingUserId(await database.learningRecord.create({ data }), email);
  } catch (error) {
    if (error?.code !== 'P2002') throw error;
    return emailBindingUserId(
      await database.learningRecord.findUnique({ where: { id } }),
      email,
    );
  }
}

/**
 * The User id whose mailbox this request may read or change.
 *
 * A verified email remains the proof that the caller controls an address, but the
 * mailbox itself is keyed by the User row id. Two Firebase uids that share a
 * verified address therefore cannot share one inbox, and a recycled address
 * inherits no history.
 */
async function mailboxUserId(database, identity) {
  const userId = identityId(identity);
  await bindVerifiedEmail(database, userId, identityEmail(identity));
  return userId;
}

async function resolveRecipientUserId(database, email) {
  const row = await database.learningRecord.findUnique({
    where: { id: emailIdentityIdFor(email) },
  });
  return emailBindingUserId(row, email);
}

/**
 * User ids with learner-initiated participation in `courseId`.
 *
 * Read course-wide (four queries) rather than per recipient so a 500-student send
 * does not issue 2,000 queries. Note there is no index on `payload.courseId`, so
 * this scans the type partition; it is a known cost, not a correctness problem.
 */
async function courseLearnerIds(database, courseId) {
  const ids = new Set();
  for (const type of LEARNER_PROGRESS_TYPES) {
    const rows = await database.learningRecord.findMany({
      where: { type, payload: { path: ['courseId'], equals: courseId } },
    });
    for (const row of Array.isArray(rows) ? rows : []) {
      if (
        row?.type === type &&
        payloadOf(row).courseId === courseId &&
        typeof row.ownerId === 'string' &&
        row.ownerId
      ) {
        ids.add(row.ownerId);
      }
    }
  }
  return ids;
}

/**
 * Charge one send of `deliveries` recipients against the instructor's window.
 *
 * Callers must already hold the `roster-sender:<ownerId>` advisory lock: the
 * counter lives in a JSON payload, which PostgreSQL cannot increment atomically,
 * so the read-modify-write is serialized by that lock and guarded by the row
 * version as a second line of defence.
 */
async function consumeSendQuota(database, ownerId, deliveries, now = Date.now()) {
  const windowStart = Math.floor(now / SEND_WINDOW_MS) * SEND_WINDOW_MS;
  const id = deterministicId('roster-send-window', `${ownerId}\u0000${windowStart}`);
  const existing = await database.learningRecord.findUnique({ where: { id } });
  if (existing && (existing.type !== SEND_WINDOW || existing.ownerId !== ownerId)) {
    throw rosterError('Message rate limit state is unavailable; please retry.', 'CONFLICT');
  }
  const payload = payloadOf(existing);
  const operations = Number.isInteger(payload.operations) ? payload.operations : 0;
  const delivered = Number.isInteger(payload.deliveries) ? payload.deliveries : 0;
  if (
    operations + 1 > MAX_SEND_OPERATIONS_PER_WINDOW ||
    delivered + deliveries > MAX_SEND_DELIVERIES_PER_WINDOW
  ) {
    throw rosterError(
      `Roster messaging is limited to ${MAX_SEND_OPERATIONS_PER_WINDOW} sends and ${MAX_SEND_DELIVERIES_PER_WINDOW} recipients per hour. Please try again later.`,
      RATE_LIMIT_ERROR,
      429,
    );
  }
  const next = {
    windowStart,
    operations: operations + 1,
    deliveries: delivered + deliveries,
  };
  if (!existing) {
    await database.learningRecord.create({
      data: { id, ownerId, type: SEND_WINDOW, status: 'ACTIVE', payload: next },
    });
    return;
  }
  const changed = await database.learningRecord.updateMany({
    where: { id, ownerId, type: SEND_WINDOW, version: existing.version },
    data: { payload: next, version: { increment: 1 } },
  });
  if (changed?.count !== 1) {
    throw rosterError('Message rate limit changed; please retry.', 'CONFLICT');
  }
}

export function createRosterService({ db = defaultDb } = {}) {
  if (!db?.learningRecord) throw new TypeError('A LearningRecord database is required');

  return {
    async getStudents(identity, { params = {} } = {}) {
      assertInstructor(identity);
      const course = await ownedCourse(db, identity, params.id);
      const rows = await courseEnrollments(db, course.id, identityId(identity));
      return { json: { students: sortedStudents(rows) } };
    },

    async addStudents(identity, { params = {}, body = {} } = {}) {
      assertInstructor(identity);
      const students = parseStudentInputs(body);
      const course = await ownedCourse(db, identity, params.id);
      const ownerId = identityId(identity);

      const result = await transaction(db, async (tx) => {
        await advisoryLock(tx, `roster-course:${course.id}`);
        const existing = await courseEnrollments(tx, course.id, ownerId);
        const existingIds = new Set(existing.map((row) => row.id));
        const existingEmails = new Set(existing.map((row) => payloadOf(row).email));
        const newCount = students.filter((student) =>
          !existingIds.has(enrollmentIdFor(course.id, student.email)) &&
          !existingEmails.has(student.email)).length;
        if (existing.length + newCount > MAX_COURSE_ENROLLMENTS) {
          throw rosterCapacityError();
        }
        for (const student of students) {
          const saved = await upsertEnrollment(tx, course, ownerId, student);
          if (saved.created) {
            await createEnrollmentEvent(tx, {
              ownerId,
              courseId: course.id,
              studentId: saved.row.id,
              event: 'enrolled',
              status: 'active',
              id: deterministicId('roster-event', `${saved.row.id}\u0000enrolled`),
            });
          }
        }
        const rows = await courseEnrollments(tx, course.id, ownerId);
        return { students: sortedStudents(rows) };
      });
      return { status: 201, json: result };
    },

    async updateStudents(identity, { params = {}, body = {} } = {}) {
      assertInstructor(identity);
      assertKeys(body, new Set(['ids', 'status', 'dropReason', 'effectiveDate']));
      if (
        !Array.isArray(body.ids) ||
        body.ids.length === 0 ||
        body.ids.length > MAX_STUDENTS ||
        body.ids.some((id) => typeof id !== 'string' || !id.trim() || id.length > MAX_STUDENT_ID)
      ) {
        throw rosterError(`ids must contain between 1 and ${MAX_STUDENTS} student ids`);
      }
      const ids = body.ids.map((id) => id.trim());
      if (new Set(ids).size !== ids.length) throw rosterError('ids must not contain duplicates');
      if (body.status !== 'active' && body.status !== 'dropped') {
        throw rosterError('status must be active or dropped');
      }
      const status = body.status;
      let dropReason = null;
      let effectiveDate = null;
      if (status === 'dropped') {
        dropReason = boundedText(body.dropReason, 'dropReason', MAX_DROP_REASON);
        effectiveDate = isoDate(body.effectiveDate);
      } else {
        if (body.dropReason !== undefined && body.dropReason !== null) {
          throw rosterError('dropReason is only valid when status is dropped');
        }
        if (body.effectiveDate !== undefined && body.effectiveDate !== null) {
          effectiveDate = isoDate(body.effectiveDate);
        }
      }

      const course = await ownedCourse(db, identity, params.id);
      const ownerId = identityId(identity);
      return transaction(db, async (tx) => {
        await advisoryLock(tx, `roster-course:${course.id}`);
        const rows = await courseEnrollments(tx, course.id, ownerId);
        const byId = new Map(rows.map((row) => [row.id, row]));
        const targets = ids.map((id) => {
          const row = byId.get(id);
          if (!row) throw rosterError('Student enrollment not found', 'NOT_FOUND');
          return row;
        });

        const updated = [];
        for (const row of targets) {
          const old = enrollmentData(row);
          const payload = payloadOf(row);
          const nextPayload = {
            ...payload,
            status,
            dropReason: status === 'dropped' ? dropReason : null,
            effectiveDate: status === 'dropped' ? effectiveDate : null,
          };
          if (
            old.status === status &&
            old.dropReason === nextPayload.dropReason &&
            old.effectiveDate === nextPayload.effectiveDate
          ) {
            updated.push(row);
            continue;
          }
          const changed = await tx.learningRecord.updateMany({
            where: { id: row.id, ownerId, type: ENROLLMENT },
            data: { status: status === 'dropped' ? 'DROPPED' : 'ACTIVE', payload: nextPayload },
          });
          if (changed?.count !== 1) {
            throw rosterError('Roster changed; please retry.', 'CONFLICT');
          }
          await createEnrollmentEvent(tx, {
            ownerId,
            courseId: course.id,
            studentId: row.id,
            event: 'status_changed',
            previousStatus: old.status,
            status,
            dropReason: nextPayload.dropReason,
            effectiveDate: nextPayload.effectiveDate,
          });
          updated.push({ ...row, status: status === 'dropped' ? 'DROPPED' : 'ACTIVE', payload: nextPayload });
        }
        return { json: { students: updated.map(enrollmentData) } };
      });
    },

    async sendMessages(identity, { params = {}, body = {} } = {}) {
      assertInstructor(identity);
      assertKeys(body, new Set(['studentIds', 'subject', 'body', 'requestId']));
      if (
        !Array.isArray(body.studentIds) ||
        body.studentIds.length === 0 ||
        body.studentIds.length > MAX_STUDENTS ||
        body.studentIds.some((id) => typeof id !== 'string' || !id.trim() || id.length > MAX_STUDENT_ID)
      ) {
        throw rosterError(`studentIds must contain between 1 and ${MAX_STUDENTS} student ids`);
      }
      const studentIds = body.studentIds.map((id) => id.trim());
      if (new Set(studentIds).size !== studentIds.length) {
        throw rosterError('studentIds must not contain duplicates');
      }
      const subject = boundedText(body.subject, 'subject', MAX_SUBJECT);
      const messageBody = boundedText(body.body, 'body', MAX_MESSAGE_BODY, { allowNewlines: true });
      const course = await ownedCourse(db, identity, params.id);
      const ownerId = identityId(identity);
      const requestId = body.requestId === undefined ? randomUUID() : requestUuid(body.requestId);
      const requestHash = createHash('sha256')
        .update(JSON.stringify({ studentIds, subject, body: messageBody }))
        .digest('hex');
      const operationId = deterministicId(
        'roster-message-operation',
        `${ownerId}\u0000${course.id}\u0000${requestId}`,
      );

      const delivered = await transaction(db, async (tx) => {
        // Sending and dropping share one course-scoped transaction lock. A
        // message cannot pass the active check while the same student is
        // being dropped in another request.
        await advisoryLock(tx, `roster-course:${course.id}`);
        // Always course-then-sender, so two concurrent sends can never deadlock.
        await advisoryLock(tx, `roster-sender:${ownerId}`);
        const prior = await tx.learningRecord.findUnique({ where: { id: operationId } });
        if (prior) {
          const priorPayload = payloadOf(prior);
          if (
            prior.type !== MESSAGE_OPERATION ||
            prior.ownerId !== ownerId ||
            priorPayload.courseId !== course.id ||
            priorPayload.requestId !== requestId
          ) {
            throw rosterError('Message request key is already in use.', 'CONFLICT');
          }
          if (priorPayload.requestHash !== requestHash) {
            throw rosterError('Message request key was reused with different content.', 'CONFLICT');
          }
          return Number.isInteger(priorPayload.delivered) ? priorPayload.delivered : 0;
        }
        const rows = await courseEnrollments(tx, course.id, ownerId);
        const byId = new Map(rows.map((row) => [row.id, row]));
        const recipients = studentIds.map((id) => {
          const row = byId.get(id);
          if (!row) throw rosterError('Student enrollment not found', 'NOT_FOUND');
          if (enrollmentData(row).status !== 'active') {
            throw rosterError('Dropped students cannot receive roster messages');
          }
          return row;
        });
        const sender = senderName(identity);

        // Delivery is bound to a User row, not to an address an instructor typed.
        // Both conditions are required, and BOTH failures raise the SAME error so
        // a send cannot be used to probe whether an address has a SchoolCircle
        // account.
        const learnerIds = await courseLearnerIds(tx, course.id);
        const resolved = [];
        for (const row of recipients) {
          const student = enrollmentData(row);
          const recipientUserId = await resolveRecipientUserId(tx, student.email);
          if (!recipientUserId || !learnerIds.has(recipientUserId)) {
            throw rosterError(
              'A roster message can only be sent to a student who has signed in with that verified email address and started this course.',
              'FORBIDDEN',
            );
          }
          resolved.push({ row, student, recipientUserId });
        }

        await consumeSendQuota(tx, ownerId, resolved.length);

        for (const { row, student, recipientUserId } of resolved) {
          await tx.learningRecord.create({
            data: {
              ownerId,
              type: MESSAGE,
              status: 'UNREAD',
              payload: {
                courseId: course.id,
                courseName: courseTitle(course),
                senderId: ownerId,
                senderName: sender,
                recipientStudentId: row.id,
                // Delivery key. `recipientEmail` below is retained only as
                // instructor-side display/audit metadata and is never read to
                // decide who may see a message.
                recipientUserId,
                recipientEmail: student.email,
                subject,
                body: messageBody,
                read: false,
              },
            },
          });
        }
        await tx.learningRecord.create({
          data: {
            id: operationId,
            ownerId,
            type: MESSAGE_OPERATION,
            status: 'RECORDED',
            payload: {
              courseId: course.id,
              requestId,
              requestHash,
              delivered: recipients.length,
            },
          },
        });
        return recipients.length;
      });
      return { status: 201, json: { delivered } };
    },

    async listMessages(identity) {
      const userId = await mailboxUserId(db, identity);
      const rows = await db.learningRecord.findMany({
        where: {
          type: MESSAGE,
          payload: { path: ['recipientUserId'], equals: userId },
        },
        orderBy: [{ createdAt: 'desc' }, { id: 'desc' }],
        take: MAX_INBOX_MESSAGES,
      });
      return {
        json: {
          messages: (Array.isArray(rows) ? rows : [])
            .filter((row) => messageRecipientId(row) === userId && !messageHidden(row))
            .sort((a, b) => {
              const ad = new Date(a.createdAt || 0).getTime();
              const bd = new Date(b.createdAt || 0).getTime();
              return bd - ad || String(b.id).localeCompare(String(a.id));
            })
            .slice(0, MAX_INBOX_MESSAGES)
            .map(messageData),
        },
      };
    },

    async markMessageRead(identity, { body = {} } = {}) {
      const userId = await mailboxUserId(db, identity);
      assertKeys(body, new Set(['id', 'read']));
      const id = requiredId(body.id, 'Message', MAX_STUDENT_ID);
      if (body.read !== true) throw rosterError('read must be true');
      const row = await db.learningRecord.findUnique({ where: { id } });
      if (
        !row ||
        row.type !== MESSAGE ||
        messageRecipientId(row) !== userId ||
        messageHidden(row)
      ) {
        // Do not distinguish a missing message from one belonging to another
        // mailbox.
        throw rosterError('Message not found', 'NOT_FOUND');
      }
      const nextPayload = { ...payloadOf(row), read: true };
      const changed = await db.learningRecord.updateMany({
        where: { id, type: MESSAGE, ownerId: row.ownerId },
        data: { status: 'READ', payload: nextPayload },
      });
      if (changed?.count !== 1) throw rosterError('Message changed; please retry.', 'CONFLICT');
      return { json: { id, read: true } };
    },

    /**
     * Remove a message from the recipient's inbox.
     *
     * A soft delete, for two reasons: the instructor-owned row is the audit record
     * of what was sent, and a learner must never be able to erase another party's
     * record. `hiddenByRecipient` is only ever honoured for the one mailbox keyed
     * by `identity.id`, so a learner can hide their own copy and nothing else.
     */
    async deleteMessage(identity, { body = {} } = {}) {
      const userId = await mailboxUserId(db, identity);
      assertKeys(body, new Set(['id']));
      const id = requiredId(body.id, 'Message', MAX_STUDENT_ID);
      const row = await db.learningRecord.findUnique({ where: { id } });
      if (
        !row ||
        row.type !== MESSAGE ||
        messageRecipientId(row) !== userId ||
        messageHidden(row)
      ) {
        throw rosterError('Message not found', 'NOT_FOUND');
      }
      const nextPayload = {
        ...payloadOf(row),
        hiddenByRecipient: true,
        hiddenAt: new Date().toISOString(),
      };
      const changed = await db.learningRecord.updateMany({
        where: { id, type: MESSAGE, ownerId: row.ownerId },
        data: { payload: nextPayload },
      });
      if (changed?.count !== 1) throw rosterError('Message changed; please retry.', 'CONFLICT');
      return { json: { id, deleted: true } };
    },

    // Explicit aliases make the framework-free service convenient to consume
    // from focused tests without making routes depend on method names.
    getRoster(identity, input) {
      return this.getStudents(identity, input);
    },
    addRoster(identity, input) {
      return this.addStudents(identity, input);
    },
    patchRoster(identity, input) {
      return this.updateStudents(identity, input);
    },
  };
}

export {
  ENROLLMENT,
  ENROLLMENT_EVENT,
  MESSAGE,
  MESSAGE_OPERATION,
  EMAIL_IDENTITY,
  SEND_WINDOW,
  LEARNER_PROGRESS_TYPES,
  MAX_COURSE_ENROLLMENTS,
  MAX_SEND_OPERATIONS_PER_WINDOW,
  MAX_SEND_DELIVERIES_PER_WINDOW,
  RATE_LIMIT_ERROR,
  emailIdentityIdFor,
  rosterError,
};