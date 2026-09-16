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

function memoryDb() {
  let sequence = 0;
  const rows = [];
  const learningRecord = {
    async create({ data }) {
      const now = new Date(++sequence);
      const row = {
        ...copy(data),
        id: `record-${sequence}`,
        version: data.version ?? 0,
        createdAt: now,
        updatedAt: now,
      };
      rows.push(row);
      return copy(row);
    },
    async findUnique({ where }) {
      return copy(rows.find((row) => row.id === where.id) || null);
    },
    async findMany({ where = {} }) {
      return copy(rows.filter((row) => Object.entries(where).every(([key, value]) => row[key] === value)));
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
  return { db, rows };
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

test('authoring service enforces CAS, immutable releases, grading, retries, and archive restore', async () => {
  const { db } = memoryDb();
  const service = createAuthoringService({ db });
  const instructor = { id: 'instructor-1', role: 'INSTRUCTOR' };
  const learner = { id: 'learner-1', role: 'LEARNER' };
  await assert.rejects(
    service.createCourse(learner, { title: 'Not allowed' }),
    (error) => error.code === 'FORBIDDEN',
  );

  const created = await service.createCourse(instructor, { title: validDraft.title });
  const id = created.course.id;
  const saved = await service.saveCourse(instructor, {
    params: { id },
    body: { version: 0, draft: validDraft },
  });
  await assert.rejects(
    service.saveCourse(instructor, { params: { id }, body: { version: 0, draft: validDraft } }),
    (error) => error.code === 'CONFLICT',
  );
  const published = await service.publishCourse(instructor, {
    params: { id },
    body: { version: saved.course.version },
  });
  const releaseId = published.course.publishedReleaseId;
  const before = await service.getLibrary(learner, { params: { id }, query: { releaseId } });
  assert.equal(before.release.content.lessons[0].blocks[1].correctOptionId, undefined);

  const wrong = await service.submitAttempt(learner, {
    params: { id },
    body: { releaseId, blockId: 'check-1', optionId: 'option-2', attemptId: 'attempt-1' },
  });
  assert.equal(wrong.result.correct, false);
  const retry = await service.submitAttempt(learner, {
    params: { id },
    body: { releaseId, blockId: 'check-1', optionId: 'option-2', attemptId: 'attempt-1' },
  });
  assert.deepEqual(retry.result, wrong.result);
  const aggregate = await service.getResults(instructor, { params: { id } });
  assert.equal(aggregate.results.learners, 1);
  assert.equal(aggregate.results.blocks.find((block) => block.blockId === 'check-1').accuracy, null);
  await assert.rejects(
    service.getResults(learner, { params: { id } }),
    (error) => error.code === 'FORBIDDEN',
  );
  await assert.rejects(
    service.submitAttempt(learner, {
      params: { id },
      body: { releaseId, blockId: 'check-1', optionId: 'option-1', attemptId: 'attempt-1' },
    }),
    (error) => error.code === 'CONFLICT',
  );
  await assert.rejects(
    service.completeBlock(learner, { params: { id }, body: { releaseId, blockId: 'check-1' } }),
    (error) => error.code === 'BAD_REQUEST',
  );
  const edited = await service.saveCourse(instructor, {
    params: { id },
    body: {
      version: published.course.version,
      draft: { ...validDraft, title: 'A newer draft title' },
    },
  });
  assert.equal((await service.listLibrary()).courses[0].title, validDraft.title);

  const archived = await service.archiveCourse(instructor, {
    params: { id },
    body: { version: edited.course.version, archived: true },
  });
  assert.equal(archived.course.status, 'ARCHIVED');
  await assert.rejects(service.getLibrary(learner, { params: { id }, query: {} }), (error) => error.code === 'NOT_FOUND');
  const restored = await service.archiveCourse(instructor, {
    params: { id },
    body: { version: archived.course.version, archived: false },
  });
  assert.equal(restored.course.status, 'PUBLISHED');
  const pinned = await service.getLibrary(learner, { params: { id }, query: { releaseId } });
  assert.equal(pinned.release.id, releaseId);
});
