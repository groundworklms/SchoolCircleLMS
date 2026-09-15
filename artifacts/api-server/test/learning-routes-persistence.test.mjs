import assert from 'node:assert/strict';
import http from 'node:http';
import express from 'express';
import test from 'node:test';

import learningRouter from '../src/routes/learning.js';
import {
  createLearningRecord,
  createLearningEvidenceStore,
  db,
} from '../src/lib/db.js';

const databaseReady = Boolean(process.env.DATABASE_URL);

function request(server, method, path, userId) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        ...server.address(),
        method,
        path,
        headers: { 'content-type': 'application/json', 'x-fixture': userId },
      },
      (res) => {
        let body = '';
        res.setEncoding('utf8');
        res.on('data', (chunk) => {
          body += chunk;
        });
        res.on('end', () => {
          let json = null;
          try {
            json = body ? JSON.parse(body) : null;
          } catch {
            // Non-JSON responses are still useful to report in an assertion.
          }
          resolve({ status: res.statusCode, body: json });
        });
      },
    );
    req.on('error', reject);
    req.end();
  });
}

test(
  'labelled route fixture scopes pending visibility and learner denial',
  { skip: !databaseReady },
  async () => {
    const suffix = `${Date.now()}-${process.pid}`;
    const instructor = await db.user.create({
      data: { name: `Fixture Instructor ${suffix}`, role: 'INSTRUCTOR', externalId: `fixture-i-${suffix}` },
    });
    const learner = await db.user.create({
      data: { name: `Fixture Learner ${suffix}`, role: 'LEARNER', externalId: `fixture-l-${suffix}` },
    });
    const records = [];
    const source = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      payload: {
        title: `Fixture source ${suffix}`,
        sourceId: `fixture-source-${suffix}`,
        text: 'Approved fixture source text.',
        pages: [{ page: 1, text: 'Approved fixture source text.' }],
        chunks: [{ page: 1, text: 'Approved fixture source text.' }],
      },
    });
    records.push(source);
    const approvedSource = await createLearningRecord({
      ownerId: instructor.id,
      type: 'SOURCE',
      status: 'APPROVED',
      payload: {
        title: `Approved fixture source ${suffix}`,
        sourceId: `fixture-approved-source-${suffix}`,
        text: 'Approved fixture source text.',
        pages: [{ page: 1, text: 'Approved fixture source text.' }],
        chunks: [{ page: 1, text: 'Approved fixture source text.' }],
      },
    });
    records.push(approvedSource);
    const pendingCourse = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      payload: { title: `Pending ${suffix}`, sourceIds: [source.id], sections: [] },
    });
    records.push(pendingCourse);
    const approvedCourse = await createLearningRecord({
      ownerId: instructor.id,
      type: 'COURSE_DRAFT',
      status: 'APPROVED',
      payload: {
        title: `Approved ${suffix}`,
        sourceIds: [approvedSource.id],
        sections: [
          {
            title: 'Lesson',
            lesson: 'A cited lesson.',
            pre: [{ stem: 'Before?', options: ['A', 'B'], answer: 0 }],
            post: [{ stem: 'After?', options: ['A', 'B'], answer: 0 }],
          },
        ],
      },
    });
    records.push(approvedCourse);
    const invalidRubric = await createLearningRecord({
      ownerId: instructor.id,
      type: 'RUBRIC',
      payload: {
        rubric: { flagged: true },
        validation: { valid: true, flagged: true },
        traceability: { grounded: false, coverage: 0, ungrounded: [{ source: 'missing' }] },
      },
    });
    records.push(invalidRubric);
    const savedSession = await createLearningRecord({
      ownerId: learner.id,
      type: 'MASTERY_SESSION',
      status: 'COMPLETE',
      payload: {
        courseId: approvedCourse.id,
        sourceId: approvedSource.id,
        complete: true,
        source: 'Private grading context',
        rubric: [{ indicators: { mastered: 'Private indicator' } }],
        report: { criteria: [{ elo: 'Fixture objective', verdict: 'mastered' }] },
        transcript: ['Fixture saved answer'],
      },
    });
    records.push(savedSession);

    const approvedProjection = await createLearningEvidenceStore().getApprovedCourse({
      courseId: approvedCourse.id,
    });
    assert.equal(approvedProjection.sections[0].lesson, 'A cited lesson.');
    assert.equal(approvedProjection.sections[0].items, undefined);
    assert.equal(approvedProjection.sections[0].pre[0].stem, 'Before?');

    const app = express();
    app.use((req, _res, next) => {
      req.user = { id: req.headers['x-fixture'] };
      next();
    });
    app.use('/api/learning', learningRouter);
    const server = app.listen(0);
    try {
      const instructorSources = await request(
        server,
        'GET',
        '/api/learning/sources',
        instructor.id,
      );
      assert.equal(instructorSources.status, 200);
      assert.ok(instructorSources.body.some((entry) => entry.id === source.id));

      const instructorCourses = await request(
        server,
        'GET',
        '/api/learning/courses',
        instructor.id,
      );
      assert.equal(instructorCourses.status, 200);
      assert.ok(instructorCourses.body.some((entry) => entry.id === pendingCourse.id));

      const learnerCourses = await request(
        server,
        'GET',
        '/api/learning/courses',
        learner.id,
      );
      assert.equal(learnerCourses.status, 200);
      assert.deepEqual(
        learnerCourses.body.map((entry) => entry.id),
        [approvedCourse.id],
      );

      const pendingForLearner = await request(
        server,
        'GET',
        `/api/learning/sources/${source.id}`,
        learner.id,
      );
      assert.equal(pendingForLearner.status, 404);

      const invalidApproval = await request(
        server,
        'POST',
        `/api/learning/rubrics/${invalidRubric.id}/approve`,
        instructor.id,
      );
      assert.equal(invalidApproval.status, 409);
      const ownSession = await request(server, 'GET', `/api/learning/mastery/sessions/${savedSession.id}`, learner.id);
      assert.equal(ownSession.status, 200);
      assert.equal(ownSession.body.report.criteria[0].verdict, 'mastered');
      assert.equal(ownSession.body.currentQuestion, null);
      assert.equal(ownSession.body.rubric, undefined);
      assert.equal(ownSession.body.source, undefined);
      const otherSession = await request(server, 'GET', `/api/learning/mastery/sessions/${savedSession.id}`, instructor.id);
      assert.equal(otherSession.status, 404);
      const ownSessions = await request(server, 'GET', `/api/learning/mastery/sessions?courseId=${approvedCourse.id}`, learner.id);
      assert.deepEqual(ownSessions.body.map((entry) => entry.id), [savedSession.id]);
    } finally {
      await new Promise((resolve) => server.close(resolve));
      await db.learningRecord.deleteMany({ where: { id: { in: records.map((entry) => entry.id) } } });
      await db.user.deleteMany({ where: { id: { in: [instructor.id, learner.id] } } });
    }
  },
);