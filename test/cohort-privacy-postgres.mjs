import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import { createServer } from 'node:net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import test from 'node:test';
import { Client } from 'pg';

import { buildAnalytics } from '../lib/arsenal-evidence.js';

function freePort() {
  return new Promise((resolve, reject) => {
    const server = createServer();
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const port = server.address().port;
      server.close(() => resolve(port));
    });
  });
}

function command(name, args) {
  execFileSync(name, args, { stdio: 'ignore' });
}

async function startPostgres() {
  const directory = mkdtempSync(join(tmpdir(), 'cohort-privacy-postgres-'));
  const port = await freePort();
  const log = join(directory, 'postgres.log');
  try {
    command('initdb', ['-D', directory, '-A', 'trust', '-U', 'postgres']);
    command('pg_ctl', [
      '-D',
      directory,
      '-l',
      log,
      '-o',
      `-p ${port} -h 127.0.0.1 -k ${directory}`,
      '-w',
      'start',
    ]);
    command('createdb', ['-h', '127.0.0.1', '-p', String(port), '-U', 'postgres', 'cohort_privacy']);
  } catch (error) {
    try {
      command('pg_ctl', ['-D', directory, '-m', 'immediate', '-w', 'stop']);
    } catch {
      // The cluster may not have started.
    }
    rmSync(directory, { recursive: true, force: true });
    throw error;
  }
  return {
    directory,
    port,
    url: `postgresql://postgres@127.0.0.1:${port}/cohort_privacy`,
    stop() {
      try {
        command('pg_ctl', ['-D', directory, '-m', 'immediate', '-w', 'stop']);
      } finally {
        rmSync(directory, { recursive: true, force: true });
      }
    },
  };
}

async function createFixtureSchema(url) {
  const client = new Client({ connectionString: url });
  await client.connect();
  await client.query(`
    CREATE TYPE "Role" AS ENUM ('INSTRUCTOR', 'LEARNER');
    CREATE TABLE "User" (
      "id" TEXT PRIMARY KEY,
      "name" TEXT NOT NULL,
      "role" "Role" NOT NULL DEFAULT 'LEARNER',
      "externalId" TEXT UNIQUE,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
    CREATE TABLE "LearningRecord" (
      "id" TEXT PRIMARY KEY,
      "ownerId" TEXT NOT NULL,
      "type" TEXT NOT NULL,
      "status" TEXT NOT NULL DEFAULT 'PENDING',
      "payload" JSONB NOT NULL,
      "version" INTEGER NOT NULL DEFAULT 0,
      "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
      "updatedAt" TIMESTAMP(3) NOT NULL
    );
  `);
  await client.query(`
    INSERT INTO "User" ("id", "name", "role")
    VALUES
      ('course-owner', 'Course owner', 'INSTRUCTOR'),
      ('learner-a', 'Learner A', 'LEARNER'),
      ('learner-b', 'Learner B', 'LEARNER'),
      ('learner-c', 'Learner C', 'LEARNER'),
      ('learner-d', 'Learner D', 'LEARNER'),
      ('learner-e', 'Learner E', 'LEARNER')
  `);
  await client.end();
}

test('local PostgreSQL store uses owner roles and resists payload learner ids', async () => {
  const postgres = await startPostgres();
  const previousUrl = process.env.DATABASE_URL;
  const previousPrisma = globalThis.prisma;
  let importedDb;
  try {
    await createFixtureSchema(postgres.url);
    process.env.DATABASE_URL = postgres.url;
    globalThis.prisma = undefined;
    importedDb = await import(`../lib/db.js?cohortPrivacy=${process.pid}-${Date.now()}`);
    const { createLearningRecord, createLearningEvidenceStore, db } = importedDb;
    const course = await createLearningRecord({
      ownerId: 'course-owner',
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: { title: 'Cohort fixture' },
    });
    const save = (ownerId, type, payload) =>
      createLearningRecord({ ownerId, type, status: 'COMPLETE', payload });

    for (const learnerId of ['learner-a', 'learner-b', 'learner-c', 'learner-d']) {
      await save(learnerId, 'MASTERY_ATTEMPT', {
        courseId: course.id,
        learnerId: 'payload-overrode-owner',
        phase: 'pre',
        correct: false,
      });
      await save(learnerId, 'MASTERY_ATTEMPT', {
        courseId: course.id,
        learnerId: 'payload-overrode-owner',
        phase: 'post',
        correct: true,
      });
      await save(learnerId, 'MASTERY_SESSION', {
        courseId: course.id,
        learnerId: 'payload-overrode-owner',
        report: { criteria: [{ competency: 'movement', verdict: 'mastered' }] },
      });
    }
    await save('learner-e', 'MASTERY_SESSION', {
      courseId: course.id,
      learnerId: 'another-payload-id',
      report: { criteria: [{ competency: 'movement', verdict: 'mastered' }] },
    });
    await save('course-owner', 'MASTERY_ATTEMPT', {
      courseId: course.id,
      learnerId: 'learner-e',
      phase: 'pre',
      correct: false,
    });
    await save('course-owner', 'MASTERY_ATTEMPT', {
      courseId: course.id,
      learnerId: 'learner-e',
      phase: 'post',
      correct: true,
    });
    await save('course-owner', 'MASTERY_SESSION', {
      courseId: course.id,
      learnerId: 'learner-e',
      report: { criteria: [{ competency: 'movement', verdict: 'mastered' }] },
    });
    await save('learner-a', 'PROFILE', {
      profile: { dominantModality: 'visual', dims: { visual: 5 } },
    });
    await save('course-owner', 'PROFILE', {
      profile: { dominantModality: 'private-instructor-profile', dims: { visual: 5 } },
    });

    const store = createLearningEvidenceStore();
    const attempts = await store.listCohortAttempts({
      instructorId: 'course-owner',
      courseId: course.id,
    });
    const sessions = await store.listCohortMasteryReports({
      instructorId: 'course-owner',
      courseId: course.id,
    });
    assert.equal(attempts.length, 8);
    assert.deepEqual([...new Set(attempts.map((row) => row.learnerId))].sort(), [
      'learner-a',
      'learner-b',
      'learner-c',
      'learner-d',
    ]);
    assert.equal(attempts.every((row) => row.learnerId !== 'course-owner'), true);
    assert.equal(sessions.length, 5);
    assert.deepEqual([...new Set(sessions.map((row) => row.learnerId))].sort(), [
      'learner-a',
      'learner-b',
      'learner-c',
      'learner-d',
      'learner-e',
    ]);
    assert.equal(sessions.every((row) => row.learnerId !== 'course-owner'), true);
    const profiles = await store.listCohortProfiles({
      instructorId: 'course-owner',
      courseId: course.id,
    });
    assert.deepEqual(profiles.map((row) => row.learnerId), ['learner-a']);

    const analytics = buildAnalytics({ cohort: true, attempts, sessions });
    assert.equal(analytics.privacy.observedLearners, 5);
    assert.equal(analytics.gain.status, 'insufficient_evidence');
    assert.equal(analytics.gain.observedContributors, 4);
    assert.equal(Array.isArray(analytics.mastery), true);
    assert.equal(JSON.stringify(analytics).includes('"learnerId"'), false);
    assert.equal(JSON.stringify(analytics).includes('correct'), false);
    await db.$disconnect();
  } finally {
    if (importedDb?.db) {
      try {
        await importedDb.db.$disconnect();
      } catch {
        // The assertion failure is the useful error; cleanup must still stop Postgres.
      }
    }
    if (previousUrl === undefined) delete process.env.DATABASE_URL;
    else process.env.DATABASE_URL = previousUrl;
    globalThis.prisma = previousPrisma;
    postgres.stop();
  }
});