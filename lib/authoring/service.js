import { db as defaultDb } from '../db.js';
import {
  gradeBlock,
  redactDraft,
} from './content.js';

const COURSE = 'MANUAL_COURSE';
const RELEASE = 'MANUAL_RELEASE';
const PROGRESS = 'MANUAL_PROGRESS';
const ATTEMPT = 'MANUAL_ATTEMPT';
const MAX_ID = 128;

function clone(value) {
  if (value === undefined) return undefined;
  return JSON.parse(JSON.stringify(value));
}

function authoringError(message, code = 'BAD_REQUEST', status) {
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

function requireId(value, name) {
  if (typeof value !== 'string' || !value.trim() || value.length > MAX_ID) {
    throw authoringError(`${name} is required`, 'BAD_REQUEST');
  }
  return value;
}

function assertKeys(value, allowed, label = 'Request') {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw authoringError(`${label} must be an object`, 'BAD_REQUEST');
  }
  if (Object.keys(value).some((key) => !allowed.has(key))) {
    throw authoringError(`${label} contains an unsupported field`, 'BAD_REQUEST');
  }
}

function identityId(identity) {
  return requireId(identity?.id, 'Authenticated user');
}

function assertInstructor(identity) {
  identityId(identity);
  const role = String(identity?.role || '').toUpperCase();
  if (role && role !== 'INSTRUCTOR' && role !== 'BOTH') {
    throw authoringError('Instructor access is required', 'FORBIDDEN');
  }
}

function payloadOf(row) {
  return row?.payload && typeof row.payload === 'object' && !Array.isArray(row.payload)
    ? row.payload
    : {};
}

function draftOf(row) {
  const payload = payloadOf(row);
  return {
    title: payload.title ?? '',
    summary: payload.summary ?? '',
    objectives: Array.isArray(payload.objectives) ? clone(payload.objectives) : [],
    lessons: Array.isArray(payload.lessons) ? clone(payload.lessons) : [],
  };
}

function courseView(row) {
  const payload = payloadOf(row);
  return {
    id: row.id,
    version: Number.isInteger(row.version) ? row.version : 0,
    status: row.status,
    publishedReleaseId: payload.publishedReleaseId || null,
    draft: draftOf(row),
  };
}

function libraryView(row, release) {
  const payload = release ? releaseContent(release) : payloadOf(row);
  const coursePayload = payloadOf(row);
  return {
    id: row.id,
    title: typeof payload.title === 'string' ? payload.title : '',
    summary: typeof payload.summary === 'string' ? payload.summary : '',
    publishedReleaseId: coursePayload.publishedReleaseId || null,
  };
}

async function transaction(database, callback) {
  if (typeof database.$transaction === 'function') return database.$transaction(callback);
  return callback(database);
}

async function advisoryLock(database, key) {
  // Advisory locks are a transaction-scoped PostgreSQL primitive and need no
  // schema change. Injectable stores simply omit the optional raw-query seam.
  if (typeof database?.$executeRawUnsafe === 'function') {
    await database.$executeRawUnsafe(
      'SELECT pg_advisory_xact_lock(hashtext($1))',
      String(key).slice(0, 180),
    );
  } else if (typeof database?.$queryRaw === 'function') {
    await database.$queryRaw`SELECT pg_advisory_xact_lock(hashtext(${String(key).slice(0, 180)}))`;
  }
}

function recordsFor(rows, type, predicate) {
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => row?.type === type && (!predicate || predicate(row)))
    .sort((a, b) => {
      const ad = new Date(a?.updatedAt || a?.createdAt || 0).getTime();
      const bd = new Date(b?.updatedAt || b?.createdAt || 0).getTime();
      return bd - ad || String(b?.id || '').localeCompare(String(a?.id || ''));
    });
}

async function listRecords(database, where = {}) {
  return database.learningRecord.findMany({ where });
}

async function findCourse(database, id) {
  const row = await database.learningRecord.findUnique({ where: { id } });
  return row?.type === COURSE ? row : null;
}

async function ownedCourse(database, identity, id) {
  const row = await findCourse(database, requireId(id, 'Course'));
  if (!row || row.ownerId !== identityId(identity)) {
    throw authoringError('Course not found', 'NOT_FOUND');
  }
  return row;
}

function releaseContent(row) {
  const payload = payloadOf(row);
  return payload.content && typeof payload.content === 'object'
    ? clone(payload.content)
    : clone(payload);
}

function blocksOf(content) {
  return (Array.isArray(content?.lessons) ? content.lessons : [])
    .flatMap((lesson) => (Array.isArray(lesson?.blocks) ? lesson.blocks : []));
}

function blockFor(content, blockId) {
  return blocksOf(content).find((block) => block?.id === blockId) || null;
}

function progressPayload(row) {
  const payload = payloadOf(row);
  const completedBlockIds = Array.isArray(payload.completedBlockIds)
    ? payload.completedBlockIds.filter((id) => typeof id === 'string')
    : [];
  const answers = payload.answers && typeof payload.answers === 'object' && !Array.isArray(payload.answers)
    ? clone(payload.answers)
    : {};
  return { completedBlockIds, answers };
}

function progressView(content, data) {
  const blockIds = blocksOf(content).map((block) => block.id);
  const allowed = new Set(blockIds);
  const completedBlockIds = [...new Set(data.completedBlockIds)].filter((id) => allowed.has(id));
  const answers = {};
  for (const [blockId, answer] of Object.entries(data.answers || {})) {
    if (allowed.has(blockId) && answer && typeof answer === 'object') answers[blockId] = clone(answer);
  }
  const total = blockIds.length;
  const completed = completedBlockIds.length;
  return {
    completedBlockIds,
    completed,
    total,
    percent: total ? Math.round((completed / total) * 100) : 0,
    answers,
  };
}

async function findRelease(database, course, releaseId) {
  const id = requireId(releaseId, 'Release');
  const row = await database.learningRecord.findUnique({ where: { id } });
  if (
    !row ||
    row.type !== RELEASE ||
    row.ownerId !== course.ownerId ||
    payloadOf(row).courseId !== course.id
  ) {
    throw authoringError('Published release not found', 'NOT_FOUND');
  }
  return row;
}

async function learnerContext(database, courseId, releaseId) {
  const course = await findCourse(database, requireId(courseId, 'Course'));
  if (!course || course.status !== 'PUBLISHED') {
    throw authoringError('Published course not found', 'NOT_FOUND');
  }
  const payload = payloadOf(course);
  const selectedId = releaseId || payload.publishedReleaseId;
  if (!selectedId) throw authoringError('Published release not found', 'NOT_FOUND');
  const release = await findRelease(database, course, selectedId);
  return { course, release, content: releaseContent(release) };
}

async function latestProgress(database, learnerId, courseId, releaseId) {
  const rows = await listRecords(database, {
    ownerId: learnerId,
    type: PROGRESS,
  });
  return recordsFor(rows, PROGRESS, (row) => {
    const payload = payloadOf(row);
    return payload.courseId === courseId && payload.releaseId === releaseId;
  })[0] || null;
}

function toProgress(content, row) {
  return progressView(content, row ? progressPayload(row) : { completedBlockIds: [], answers: {} });
}

async function saveProgress(database, {
  learnerId,
  courseId,
  releaseId,
  content,
  completedBlockIds,
  answers,
}) {
  const existing = await latestProgress(database, learnerId, courseId, releaseId);
  const data = {
    courseId,
    releaseId,
    completedBlockIds: [...new Set(completedBlockIds)],
    answers: clone(answers || {}),
  };
  if (!existing) {
    const created = await database.learningRecord.create({
      data: {
        ownerId: learnerId,
        type: PROGRESS,
        status: 'ACTIVE',
        payload: data,
      },
    });
    return toProgress(content, created);
  }
  const version = Number.isInteger(existing.version) ? existing.version : 0;
  const changed = await database.learningRecord.updateMany({
    where: { id: existing.id, ownerId: learnerId, version },
    data: { payload: data, status: 'ACTIVE', version: { increment: 1 } },
  });
  if (changed?.count !== 1) throw authoringError('Progress changed; please retry.', 'CONFLICT');
  const updated = await database.learningRecord.findUnique({ where: { id: existing.id } });
  return toProgress(content, updated || { payload: data });
}

function answerMatches(first, second) {
  return first?.releaseId === second.releaseId &&
    first?.courseId === second.courseId &&
    first?.blockId === second.blockId &&
    first?.optionId === second.optionId;
}

export function createAuthoringService({ db = defaultDb } = {}) {
  if (!db?.learningRecord) throw new TypeError('A LearningRecord database is required');

  return {
    async listCourses(identity) {
      assertInstructor(identity);
      const rows = await listRecords(db, { ownerId: identityId(identity), type: COURSE });
      return { courses: recordsFor(rows, COURSE).map(courseView) };
    },

    async getCourse(identity, { params = {} } = {}) {
      assertInstructor(identity);
      return { course: courseView(await ownedCourse(db, identity, params.id)) };
    },

    async getResults(identity, { params = {} } = {}) {
      assertInstructor(identity);
      const course = await ownedCourse(db, identity, params.id);
      const currentRelease = payloadOf(course).publishedReleaseId || null;
      // Every instructor results view used to load every LearningRecord row of
      // every type/owner (tutor turns, mastery sessions, other instructors'
      // courses...) just to filter two types down to one course in memory
      // (#74). Scope the query itself instead: type narrows the index, the
      // JSON-path filter narrows to this course. The in-memory checks stay as
      // a safety net for stores (tests) that don't enforce the JSON path.
      const rows = currentRelease
        ? await listRecords(db, {
            type: { in: [PROGRESS, ATTEMPT] },
            payload: { path: ['courseId'], equals: course.id },
          })
        : [];
      const progressRows = recordsFor(rows, PROGRESS, (row) =>
        payloadOf(row).courseId === course.id && currentRelease && payloadOf(row).releaseId === currentRelease);
      const attemptRows = recordsFor(rows, ATTEMPT, (row) =>
        payloadOf(row).courseId === course.id && currentRelease && payloadOf(row).releaseId === currentRelease);
      const learnerRows = [...progressRows, ...attemptRows];
      const candidateLearners = new Set(learnerRows.map((row) => row.ownerId).filter(Boolean));
      let learners = candidateLearners;
      if (db.user?.findMany && candidateLearners.size) {
        const users = await db.user.findMany({
          where: { id: { in: [...candidateLearners] }, role: { in: ['LEARNER', 'BOTH'] } },
          select: { id: true },
        });
        learners = new Set((users || []).map((user) => user.id));
      }
      const learnerProgressRows = progressRows.filter((row) => learners.has(row.ownerId));
      const learnerAttemptRows = attemptRows.filter((row) => learners.has(row.ownerId));
      const currentByLearner = new Map();
      for (const row of learnerProgressRows) {
        if (!currentByLearner.has(row.ownerId)) currentByLearner.set(row.ownerId, row);
      }
      let content = draftOf(course);
      if (currentRelease) {
        // A direct primary-key lookup, not a scan of `rows` — `rows` no
        // longer carries RELEASE-type records now that it is scoped to
        // PROGRESS/ATTEMPT above.
        const release = await db.learningRecord.findUnique({ where: { id: currentRelease } });
        if (release && release.type === RELEASE && payloadOf(release).courseId === course.id) {
          content = releaseContent(release);
        }
      }
      const blockMap = new Map(blocksOf(content).map((block) => [block.id, {
        blockId: block.id,
        responses: 0,
        accuracy: null,
        _learners: new Set(),
        _correct: 0,
      }]));
      const attemptedBlocks = new Set();
      const latestAttempts = new Map();
      // Attempts are retained as the audit trail, but a retry/new answer is
      // represented by one deterministic latest response per learner/block.
      for (const row of learnerAttemptRows) {
        const attempt = payloadOf(row);
        const key = `${row.ownerId}:${attempt.blockId}`;
        if (!latestAttempts.has(key)) latestAttempts.set(key, row);
      }
      for (const row of latestAttempts.values()) {
        const attempt = payloadOf(row);
        const aggregate = blockMap.get(attempt.blockId);
        if (!aggregate) continue;
        attemptedBlocks.add(`${row.ownerId}:${attempt.blockId}`);
        aggregate._learners.add(row.ownerId);
        if (attempt.result?.correct === true || attempt.correct === true) aggregate._correct += 1;
      }
      // Include progress answers written by an older adapter when no attempt
      // audit row exists for that learner/block.
      for (const row of currentByLearner.values()) {
        const progress = progressPayload(row);
        for (const [blockId, answer] of Object.entries(progress.answers)) {
          if (attemptedBlocks.has(`${row.ownerId}:${blockId}`)) continue;
          const aggregate = blockMap.get(blockId);
          if (!aggregate || !answer || typeof answer !== 'object') continue;
          aggregate.responses += 1;
          aggregate._learners.add(row.ownerId);
          if (answer.correct === true) aggregate._correct += 1;
        }
      }
      for (const aggregate of blockMap.values()) {
        aggregate.responses = aggregate._learners.size;
        aggregate.accuracy = aggregate._learners.size < 5
          ? null
          : aggregate.responses
            ? Math.max(0, Math.min(100, Math.round((aggregate._correct / aggregate.responses) * 100)))
            : null;
        delete aggregate._learners;
        delete aggregate._correct;
      }
      let completed = 0;
      const blockIds = blocksOf(content).map((block) => block.id);
      for (const row of currentByLearner.values()) {
        const done = new Set(progressPayload(row).completedBlockIds);
        if (blockIds.length > 0 && blockIds.every((id) => done.has(id))) completed += 1;
      }
      return {
        results: {
          learners: learners.size,
          completed,
          blocks: [...blockMap.values()],
        },
      };
    },

    async listLibrary() {
      const rows = await listRecords(db, { type: COURSE, status: 'PUBLISHED' });
      // Same shape as getResults above (#74), just smaller today: every
      // published course's release is one specific record, so fetch those
      // ids instead of every release of every course ever authored.
      const releaseIds = [...new Set(
        recordsFor(rows, COURSE)
          .map((row) => payloadOf(row).publishedReleaseId)
          .filter(Boolean)
      )];
      const releases = releaseIds.length
        ? await listRecords(db, { type: RELEASE, id: { in: releaseIds } })
        : [];
      return {
        courses: recordsFor(rows, COURSE)
          .map((row) => {
            const releaseId = payloadOf(row).publishedReleaseId;
            const release = releases.find((candidate) =>
              candidate.id === releaseId &&
              candidate.ownerId === row.ownerId &&
              payloadOf(candidate).courseId === row.id);
            return release ? libraryView(row, release) : null;
          })
          .filter(Boolean),
      };
    },

    async getLibrary(identity, { params = {}, query = {} } = {}) {
      const { course, release, content } = await learnerContext(db, params.id, query.releaseId);
      const progressRow = await latestProgress(db, identityId(identity), course.id, release.id);
      return {
        release: {
          id: release.id,
          courseId: course.id,
          content: redactDraft(content),
        },
        progress: toProgress(content, progressRow),
      };
    },

    async submitAttempt(identity, { params = {}, body = {} } = {}) {
      const learnerId = identityId(identity);
      assertKeys(body, new Set(['releaseId', 'blockId', 'optionId', 'attemptId']));
      const releaseId = requireId(body?.releaseId, 'Release');
      const blockId = requireId(body?.blockId, 'Block');
      const optionId = requireId(body?.optionId, 'Option');
      const attemptId = requireId(body?.attemptId, 'Attempt');
      const { course, release, content } = await learnerContext(db, params.id, releaseId);
      const block = blockFor(content, blockId);
      if (!block || (block.type !== 'check' && block.type !== 'scenario')) {
        throw authoringError('Answerable block not found', 'NOT_FOUND');
      }
      if (!Array.isArray(block.options) || !block.options.some((option) => option?.id === optionId)) {
        throw authoringError('Option not found', 'BAD_REQUEST');
      }
      return transaction(db, async (tx) => {
        // Serialize every progress mutation for one learner/release. The
        // attempt-specific lock is retained for idempotency, and is acquired
        // after the common lock so concurrent answers cannot lose one another.
        await advisoryLock(tx, `manual-progress:${learnerId}:${releaseId}`);
        await advisoryLock(tx, `manual-attempt:${learnerId}:${attemptId}`);
        const rows = await listRecords(tx, { ownerId: learnerId, type: ATTEMPT });
        const previous = recordsFor(rows, ATTEMPT, (row) => payloadOf(row).attemptId === attemptId)[0];
        const requested = { courseId: course.id, releaseId, blockId, optionId };
        if (previous) {
          const prior = payloadOf(previous);
          if (!answerMatches(prior, requested)) {
            throw authoringError('Attempt id was already used for another answer.', 'CONFLICT');
          }
          const priorProgress = await latestProgress(tx, learnerId, course.id, releaseId);
          return {
            result: clone(prior.result),
            progress: toProgress(content, priorProgress),
          };
        }
        const result = gradeBlock(block, optionId);
        const oldProgress = await latestProgress(tx, learnerId, course.id, releaseId);
        const old = progressPayload(oldProgress);
        const completed = new Set(old.completedBlockIds);
        if (result.correct) completed.add(blockId);
        const answers = { ...old.answers, [blockId]: {
          optionId: result.optionId,
          correct: result.correct,
          feedback: result.feedback,
        } };
        // A wrong retry must not undo a previous correct answer.
        if (old.answers?.[blockId]?.correct === true && !result.correct) answers[blockId] = old.answers[blockId];
        await tx.learningRecord.create({
          data: {
            ownerId: learnerId,
            type: ATTEMPT,
            status: 'RECORDED',
            payload: { ...requested, attemptId, result: clone(result) },
          },
        });
        const progress = await saveProgress(tx, {
          learnerId,
          courseId: course.id,
          releaseId,
          content,
          completedBlockIds: [...completed],
          answers,
        });
        return { result, progress };
      });
    },

    async completeBlock(identity, { params = {}, body = {} } = {}) {
      const learnerId = identityId(identity);
      assertKeys(body, new Set(['releaseId', 'blockId']));
      const releaseId = requireId(body?.releaseId, 'Release');
      const blockId = requireId(body?.blockId, 'Block');
      const { course, release, content } = await learnerContext(db, params.id, releaseId);
      const block = blockFor(content, blockId);
      if (!block) throw authoringError('Block not found', 'NOT_FOUND');
      if (block.type === 'check' || block.type === 'scenario') {
        throw authoringError('A check must be answered correctly before it is complete.', 'BAD_REQUEST');
      }
      return transaction(db, async (tx) => {
        await advisoryLock(tx, `manual-progress:${learnerId}:${release.id}`);
        const oldProgress = await latestProgress(tx, learnerId, course.id, release.id);
        const old = progressPayload(oldProgress);
        const completed = new Set(old.completedBlockIds);
        completed.add(blockId);
        const progress = await saveProgress(tx, {
          learnerId,
          courseId: course.id,
          releaseId,
          content,
          completedBlockIds: [...completed],
          answers: old.answers,
        });
        return { progress };
      });
    },

  };
}

export { authoringError };
