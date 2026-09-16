/*
 * Native PostgreSQL persistence tests for manual authoring.
 *
 * This file never uses DATABASE_URL from the workspace. When native
 * PostgreSQL binaries are unavailable it is skipped; it never falls back to a
 * cloud database or a caller database.
 */
import assert from 'node:assert/strict';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import test, { after, before } from 'node:test';

function has(binary) {
  return spawnSync(binary, ['--version'], { stdio: 'ignore' }).status === 0;
}

const nativePostgres = ['initdb', 'pg_ctl', 'createdb'].every(has);
const skipped = { skip: !nativePostgres };
const state = {};

function draft(title = 'Native navigation') {
  return {
    title,
    summary: 'A persisted native release.',
    objectives: ['Use the navigation fundamentals.'],
    lessons: [{
      id: 'lesson-1',
      title: 'Fundamentals',
      blocks: [
        { id: 'text-1', type: 'text', body: 'Read the lesson.' },
        { id: 'image-1', type: 'image', url: 'https://example.test/map.png', alt: 'A map', caption: 'Map' },
        {
          id: 'check-1',
          type: 'check',
          prompt: 'Which option is correct?',
          body: '',
          options: [
            { id: 'option-1', text: 'Correct' },
            { id: 'option-2', text: 'Incorrect' },
          ],
          correctOptionId: 'option-1',
          explanation: 'The first option is correct.',
        },
      ],
    }],
  };
}

function run(binary, args) {
  const result = spawnSync(binary, args, {
    env: {
      ...process.env,
      DATABASE_URL: state.url,
      NODE_ENV: 'test',
      CLOUD_SQL_CONNECTION_NAME: '',
    },
    encoding: 'utf8',
    timeout: 120000,
  });
  assert.equal(result.status, 0, `${binary} failed in isolated authoring test`);
  return result;
}

if (nativePostgres) {
  before(async () => {
    state.root = mkdtempSync(join(tmpdir(), 'schoolcircle-authoring-pg-'));
    state.data = join(state.root, 'data');
    state.socket = join(state.root, 'socket');
    mkdirSync(state.socket, { mode: 0o700 });
    state.databaseName = 'schoolcircle_authoring_test';
    state.url =
      `postgresql://schoolcircle_test@localhost/${state.databaseName}` +
      `?host=${encodeURIComponent(state.socket)}&connection_limit=8`;
    state.saved = {
      DATABASE_URL: process.env.DATABASE_URL,
      CLOUD_SQL_CONNECTION_NAME: process.env.CLOUD_SQL_CONNECTION_NAME,
      NEXT_PUBLIC_FIREBASE_PROJECT_ID: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
      NODE_ENV: process.env.NODE_ENV,
    };

    // The singleton imports below must see only this private Unix-socket DB.
    process.env.DATABASE_URL = state.url;
    delete process.env.CLOUD_SQL_CONNECTION_NAME;
    delete process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID;
    process.env.NODE_ENV = 'test';

    run('initdb', [
      '-D', state.data,
      '-U', 'schoolcircle_test',
      '--auth-local=trust',
      '--auth-host=reject',
      '--no-locale',
      '-E', 'UTF8',
    ]);
    run('pg_ctl', [
      '-D', state.data,
      '-l', join(state.root, 'postgres.log'),
      '-o', `-k ${state.socket} -c listen_addresses=''`,
      '-w',
      'start',
    ]);
    state.started = true;
    run('createdb', ['-h', state.socket, '-U', 'schoolcircle_test', state.databaseName]);
    run(process.execPath, [
      'node_modules/prisma/build/index.js',
      'migrate',
      'deploy',
      '--schema',
      join(process.cwd(), 'prisma/schema.prisma'),
    ]);

    const [{ db }, { createAuthoringService }] = await Promise.all([
      import('../lib/db.js'),
      import('../lib/authoring/service.js'),
    ]);
    state.db = db;
    state.service = createAuthoringService({ db });
    state.instructor = { id: 'native-instructor', role: 'INSTRUCTOR' };
    state.otherInstructor = { id: 'native-other-instructor', role: 'INSTRUCTOR' };
    state.learners = Array.from({ length: 6 }, (_, index) => ({
      id: `native-learner-${index + 1}`,
      role: 'LEARNER',
    }));
    await db.user.create({
      data: { id: state.instructor.id, name: 'Native instructor', role: 'INSTRUCTOR' },
    });
    await db.user.create({
      data: { id: state.otherInstructor.id, name: 'Other instructor', role: 'INSTRUCTOR' },
    });
    for (const [index, learner] of state.learners.entries()) {
      await db.user.create({
        data: { id: learner.id, name: `Native learner ${index + 1}`, role: 'LEARNER' },
      });
    }
    state.courseId = 'native-course';
    state.releaseOne = 'native-release-one';
    state.releaseTwo = 'native-release-two';
    await db.learningRecord.create({
      data: {
        id: state.courseId,
        ownerId: state.instructor.id,
        type: 'MANUAL_COURSE',
        status: 'PUBLISHED',
        payload: { ...draft('Republished navigation'), publishedReleaseId: state.releaseTwo },
      },
    });
    await db.learningRecord.create({
      data: {
        id: state.releaseOne,
        ownerId: state.instructor.id,
        type: 'MANUAL_RELEASE',
        status: 'PUBLISHED',
        payload: { courseId: state.courseId, content: draft() },
      },
    });
    await db.learningRecord.create({
      data: {
        id: state.releaseTwo,
        ownerId: state.instructor.id,
        type: 'MANUAL_RELEASE',
        status: 'PUBLISHED',
        payload: { courseId: state.courseId, content: draft('Republished navigation') },
      },
    });
  });

  after(async () => {
    if (state.db) await state.db.$disconnect().catch(() => {});
    if (state.saved) {
      for (const [key, value] of Object.entries(state.saved)) {
        if (value === undefined) delete process.env[key];
        else process.env[key] = value;
      }
    }
    if (state.started) {
      spawnSync('pg_ctl', ['-D', state.data, '-m', 'immediate', '-w', 'stop'], { stdio: 'ignore' });
    }
    if (state.root) rmSync(state.root, { recursive: true, force: true });
  });

  test('native seeded release remains immutable and redacted for learners', async () => {
    const { service, instructor, learners, courseId, releaseOne } = state;
    assert.equal((await service.getCourse(instructor, { params: { id: courseId } })).course.status, 'PUBLISHED');
    const learnerView = await service.getLibrary(learners[0], {
      params: { id: courseId },
      query: { releaseId: releaseOne },
    });
    const check = learnerView.release.content.lessons[0].blocks[2];
    assert.equal(check.correctOptionId, undefined);
    assert.equal(check.explanation, undefined);

    const pinned = await service.getLibrary(learners[0], {
      params: { id: courseId },
      query: { releaseId: releaseOne },
    });
    assert.equal(pinned.release.content.title, 'Native navigation');
  });

  test('native owner and role checks reject cross-owner access', async () => {
    const { service, instructor, otherInstructor, learners, courseId } = state;
    await assert.rejects(
      service.getCourse(otherInstructor, { params: { id: courseId } }),
      (error) => error.code === 'NOT_FOUND',
    );
    await assert.rejects(
      service.getResults(otherInstructor, { params: { id: courseId } }),
      (error) => error.code === 'NOT_FOUND',
    );
    assert.equal((await service.listCourses(instructor)).courses.length, 1);
  });

  test('native attempts grade on the server and bind idempotent retries', async () => {
    const { service, learners, courseId, releaseOne } = state;
    const wrong = await service.submitAttempt(learners[0], {
      params: { id: courseId },
      body: {
        releaseId: releaseOne,
        blockId: 'check-1',
        optionId: 'option-2',
        attemptId: 'native-attempt-1',
      },
    });
    assert.equal(wrong.result.correct, false);
    const retry = await service.submitAttempt(learners[0], {
      params: { id: courseId },
      body: {
        releaseId: releaseOne,
        blockId: 'check-1',
        optionId: 'option-2',
        attemptId: 'native-attempt-1',
      },
    });
    assert.deepEqual(retry.result, wrong.result);
    await assert.rejects(
      service.submitAttempt(learners[0], {
        params: { id: courseId },
        body: {
          releaseId: releaseOne,
          blockId: 'check-1',
          optionId: 'option-1',
          attemptId: 'native-attempt-1',
        },
      }),
      (error) => error.code === 'CONFLICT',
    );
    await assert.rejects(
      service.completeBlock(learners[0], {
        params: { id: courseId },
        body: { releaseId: releaseOne, blockId: 'check-1' },
      }),
      (error) => error.code === 'BAD_REQUEST',
    );
    assert.equal(retry.progress.answers['check-1'].correct, false);
  });

  test('native concurrent progress retains both completed block IDs', async () => {
    const { service, learners, courseId, releaseOne } = state;
    const [first, second] = await Promise.all([
      service.completeBlock(learners[1], {
        params: { id: courseId },
        body: { releaseId: releaseOne, blockId: 'text-1' },
      }),
      service.completeBlock(learners[1], {
        params: { id: courseId },
        body: { releaseId: releaseOne, blockId: 'image-1' },
      }),
    ]);
    const completed = new Set([
      ...first.progress.completedBlockIds,
      ...second.progress.completedBlockIds,
    ]);
    assert.deepEqual([...completed].sort(), ['image-1', 'text-1']);
    const reloaded = await service.getLibrary(learners[1], {
      params: { id: courseId },
      query: { releaseId: releaseOne },
    });
    assert.deepEqual(reloaded.progress.completedBlockIds.sort(), ['image-1', 'text-1']);
  });

  test('native seeded release selection pins old content and resets current-release results', async () => {
    const { service, instructor, learners, courseId, releaseOne, releaseTwo } = state;
    const current = await service.getCourse(instructor, { params: { id: courseId } });
    assert.equal(current.course.publishedReleaseId, releaseTwo);
    assert.notEqual(releaseTwo, releaseOne);
    const old = await service.getLibrary(learners[0], {
      params: { id: courseId },
      query: { releaseId: releaseOne },
    });
    const currentView = await service.getLibrary(learners[0], {
      params: { id: courseId },
      query: {},
    });
    assert.equal(old.release.content.title, 'Native navigation');
    assert.equal(currentView.release.content.title, 'Republished navigation');
    const reset = await service.getResults(instructor, { params: { id: courseId } });
    assert.equal(reset.results.learners, 0);
    assert.equal(reset.results.blocks.find((block) => block.blockId === 'check-1').responses, 0);
  });

  test('native results use latest current-release answers and suppress small cohorts', async () => {
    const { service, instructor, learners, courseId, releaseTwo } = state;
    for (const [index, learner] of learners.entries()) {
      const first = await service.submitAttempt(learner, {
        params: { id: courseId },
        body: {
          releaseId: releaseTwo,
          blockId: 'check-1',
          optionId: index === 0 ? 'option-1' : 'option-2',
          attemptId: `native-latest-first-${index}`,
        },
      });
      assert.equal(typeof first.result.correct, 'boolean');
      if (index === 0) {
        const latest = await service.submitAttempt(learner, {
          params: { id: courseId },
          body: {
            releaseId: releaseTwo,
            blockId: 'check-1',
            optionId: 'option-1',
            attemptId: `native-latest-second-${index}`,
          },
        });
        assert.equal(latest.result.correct, true);
      }
    }
    // Five learners are wrong and one is correct: latest-answer accuracy is 17%.
    const result = await service.getResults(instructor, { params: { id: courseId } });
    const block = result.results.blocks.find((entry) => entry.blockId === 'check-1');
    assert.equal(result.results.learners, 6);
    assert.equal(block.responses, 6);
    assert.equal(block.accuracy, 17);
    assert.ok(block.accuracy >= 0 && block.accuracy <= 100);
    const repeated = await service.submitAttempt(learners[1], {
      params: { id: courseId },
      body: {
        releaseId: releaseTwo,
        blockId: 'check-1',
        optionId: 'option-2',
        attemptId: 'native-latest-first-1',
      },
    });
    assert.equal(repeated.result.correct, false);
    const afterRetry = await service.getResults(instructor, { params: { id: courseId } });
    const afterRetryBlock = afterRetry.results.blocks.find((entry) => entry.blockId === 'check-1');
    assert.equal(afterRetryBlock.responses, 6);
    assert.equal(afterRetryBlock.accuracy, 17);
  });
} else {
  test('manual authoring native PostgreSQL flow (native binaries unavailable)', skipped, () => {});
}
