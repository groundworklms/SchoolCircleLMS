import assert from 'node:assert/strict';
import test from 'node:test';

import {
  duplicateDraft,
  redactDraft,
  validateDraft,
} from '../lib/authoring/content.js';
import { createAuthoringService } from '../lib/authoring/service.js';

function copy(value) {
  return value === undefined ? undefined : structuredClone(value);
}

// Minimal support for the two Prisma clauses getResults/listLibrary now query
// with (#74): `{ in: [...] }` on a plain field, and a single-segment JSON
// path filter on `payload`. Anything else falls back to strict equality,
// same as before.
function matchesClause(row, key, value) {
  if (value && typeof value === 'object' && !Array.isArray(value)) {
    if (Array.isArray(value.in)) return value.in.includes(row[key]);
    if (Array.isArray(value.path) && value.path.length === 1) {
      return (row[key] || {})[value.path[0]] === value.equals;
    }
  }
  return row[key] === value;
}

function memoryDb(initialRows = []) {
  let sequence = 0;
  const rows = [];
  const seed = (data) => {
    const now = new Date(++sequence);
    const row = {
      ...copy(data),
      id: data.id || `record-${sequence}`,
      version: data.version ?? 0,
      createdAt: data.createdAt || now,
      updatedAt: data.updatedAt || now,
    };
    rows.push(row);
    return copy(row);
  };
  initialRows.forEach(seed);
  const learningRecord = {
    async create({ data }) {
      return seed(data);
    },
    async findUnique({ where }) {
      return copy(rows.find((row) => row.id === where.id) || null);
    },
    async findMany({ where = {} }) {
      return copy(rows.filter((row) => Object.entries(where).every(([key, value]) => matchesClause(row, key, value))));
    },
    async updateMany({ where, data }) {
      const row = rows.find((candidate) =>
        Object.entries(where).every(([key, value]) => candidate[key] === value));
      if (!row) return { count: 0 };
      for (const [key, value] of Object.entries(data)) {
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
      return callback(db);
    },
  };
  return { db, rows, seed };
}

const validDraft = {
  title: 'Navigation fundamentals',
  summary: 'A short lesson.',
  objectives: ['Describe the fundamentals.'],
  lessons: [{
    id: 'lesson-1',
    title: 'Lesson one',
    blocks: [
      { id: 'text-1', type: 'text', body: 'Use **safe** Markdown.' },
      {
        id: 'check-1',
        type: 'check',
        prompt: 'Choose one.',
        body: '',
        options: [{ id: 'option-1', text: 'Correct' }, { id: 'option-2', text: 'Wrong' }],
        correctOptionId: 'option-1',
        explanation: 'The first option is correct.',
      },
    ],
  }],
};

test('content validation is partial for drafts and strict for publication', () => {
  assert.equal(validateDraft({ title: '' }).valid, true);
  assert.equal(validateDraft(validDraft, { publishing: true }).valid, true);
  assert.equal(validateDraft({
    ...validDraft,
    lessons: [{ ...validDraft.lessons[0], blocks: [{ ...validDraft.lessons[0].blocks[1], correctOptionId: 'missing' }] }],
  }, { publishing: true }).valid, false);
  const learner = redactDraft(validDraft);
  assert.equal(learner.lessons[0].blocks[1].correctOptionId, undefined);
  assert.equal(learner.lessons[0].blocks[1].explanation, undefined);
  assert.notEqual(duplicateDraft(validDraft).lessons[0].id, validDraft.lessons[0].id);
  assert.notEqual(
    duplicateDraft(validDraft).lessons[0].blocks[1].options[0].id,
    validDraft.lessons[0].blocks[1].options[0].id,
  );
});

test('manual writes are removed while seeded playback, grading, and results remain', async () => {
  const instructor = { id: 'instructor-1', role: 'INSTRUCTOR' };
  const learner = { id: 'learner-1', role: 'LEARNER' };
  const id = 'course-seeded';
  const releaseId = 'release-seeded';
  const { db } = memoryDb([
    {
      id,
      ownerId: instructor.id,
      type: 'MANUAL_COURSE',
      status: 'PUBLISHED',
      payload: { ...validDraft, publishedReleaseId: releaseId },
    },
    {
      id: releaseId,
      ownerId: instructor.id,
      type: 'MANUAL_RELEASE',
      status: 'PUBLISHED',
      payload: { courseId: id, content: validDraft },
    },
  ]);
  const seededService = createAuthoringService({ db });
  assert.equal(seededService.createCourse, undefined);
  assert.equal(seededService.saveCourse, undefined);
  assert.equal(seededService.publishCourse, undefined);
  assert.equal(seededService.archiveCourse, undefined);

  const course = await seededService.getCourse(instructor, { params: { id } });
  assert.equal(course.course.status, 'PUBLISHED');
  assert.equal((await seededService.listCourses(instructor)).courses[0].id, id);

  const before = await seededService.getLibrary(learner, { params: { id }, query: { releaseId } });
  assert.equal(before.release.content.lessons[0].blocks[1].correctOptionId, undefined);

  const wrong = await seededService.submitAttempt(learner, {
    params: { id },
    body: { releaseId, blockId: 'check-1', optionId: 'option-2', attemptId: 'attempt-1' },
  });
  assert.equal(wrong.result.correct, false);
  const retry = await seededService.submitAttempt(learner, {
    params: { id },
    body: { releaseId, blockId: 'check-1', optionId: 'option-2', attemptId: 'attempt-1' },
  });
  assert.deepEqual(retry.result, wrong.result);
  const aggregate = await seededService.getResults(instructor, { params: { id } });
  assert.equal(aggregate.results.learners, 1);
  assert.equal(aggregate.results.blocks.find((block) => block.blockId === 'check-1').accuracy, null);
  await assert.rejects(
    seededService.getResults(learner, { params: { id } }),
    (error) => error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    seededService.submitAttempt(learner, {
      params: { id },
      body: { releaseId, blockId: 'check-1', optionId: 'option-1', attemptId: 'attempt-1' },
    }),
    (error) => error.code === 'CONFLICT',
  );
  await assert.rejects(
    seededService.completeBlock(learner, { params: { id }, body: { releaseId, blockId: 'check-1' } }),
    (error) => error.code === 'BAD_REQUEST',
  );
  assert.equal((await seededService.listLibrary()).courses[0].title, validDraft.title);
  const pinned = await seededService.getLibrary(learner, { params: { id }, query: { releaseId } });
  assert.equal(pinned.release.id, releaseId);
});

test('release-pinned attempts grade the latest snapshot without rewriting old evidence', async () => {
  const instructor = { id: 'release-instructor', role: 'INSTRUCTOR' };
  const learner = { id: 'release-learner', role: 'LEARNER' };
  const courseId = 'release-course';
  const oldReleaseId = 'release-course:release:old';
  const latestReleaseId = 'release-course:release:latest';
  const latestDraft = {
    ...validDraft,
    title: 'Latest navigation',
    lessons: [{
      ...validDraft.lessons[0],
      blocks: validDraft.lessons[0].blocks.map((block) =>
        block.id === 'check-1' ? { ...block, explanation: 'The latest release is correct.' } : block),
    }],
  };
  const { db } = memoryDb([
    {
      id: courseId,
      ownerId: instructor.id,
      type: 'MANUAL_COURSE',
      status: 'PUBLISHED',
      payload: { ...latestDraft, publishedReleaseId: latestReleaseId },
    },
    {
      id: oldReleaseId,
      ownerId: instructor.id,
      type: 'MANUAL_RELEASE',
      status: 'PUBLISHED',
      payload: { courseId, content: validDraft },
    },
    {
      id: latestReleaseId,
      ownerId: instructor.id,
      type: 'MANUAL_RELEASE',
      status: 'PUBLISHED',
      payload: { courseId, content: latestDraft },
    },
  ]);
  const service = createAuthoringService({ db });

  const oldAttempt = await service.submitAttempt(learner, {
    params: { id: courseId },
    body: {
      releaseId: oldReleaseId,
      blockId: 'check-1',
      optionId: 'option-2',
      attemptId: 'old-release-attempt',
    },
  });
  const latestAttempt = await service.submitAttempt(learner, {
    params: { id: courseId },
    body: {
      releaseId: latestReleaseId,
      blockId: 'check-1',
      optionId: 'option-1',
      attemptId: 'latest-release-attempt',
    },
  });
  assert.equal(oldAttempt.result.correct, false);
  assert.equal(latestAttempt.result.correct, true);

  const oldView = await service.getLibrary(learner, {
    params: { id: courseId },
    query: { releaseId: oldReleaseId },
  });
  const latestView = await service.getLibrary(learner, {
    params: { id: courseId },
    query: {},
  });
  assert.equal(oldView.release.content.title, validDraft.title);
  assert.equal(latestView.release.content.title, latestDraft.title);

  const attempts = await db.learningRecord.findMany({
    where: { ownerId: learner.id, type: 'MANUAL_ATTEMPT' },
  });
  assert.deepEqual(
    attempts.map((row) => [row.payload.releaseId, row.payload.result.correct]),
    [[oldReleaseId, false], [latestReleaseId, true]],
  );
  const results = await service.getResults(instructor, { params: { id: courseId } });
  assert.equal(results.results.blocks.find((block) => block.blockId === 'check-1').responses, 1);
});
