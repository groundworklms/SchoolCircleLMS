import assert from 'node:assert/strict';
import test from 'node:test';

import { dispatchRequest } from '../lib/server/router.js';
import createEvidenceRouter from '../lib/server/routes/learning-evidence.js';
import { buildAar, buildCohortProfile } from '../lib/server/arsenal-evidence.js';

const ORIGIN = 'https://planning-reporting.example.test';

function request(path, options = {}) {
  const headers = new Headers(options.headers);
  if (options.body !== undefined && !headers.has('content-type')) {
    headers.set('content-type', 'application/json');
  }
  return new Request(`${ORIGIN}/api${path}`, {
    ...options,
    headers,
    ...(options.body !== undefined && typeof options.body !== 'string'
      ? { body: JSON.stringify(options.body) }
      : {}),
  });
}

async function json(response) {
  return response.json();
}

test('partial Waypoint responses reload with null unanswered dimensions', async () => {
  let saved;
  const store = {
    async saveLearnerProfile(value) {
      saved = value;
    },
    async getLearnerProfile() {
      return saved;
    },
  };
  const middleware = (req, _res, next) => {
    req.user = { id: 'profile-learner', role: 'LEARNER', name: 'Profile learner' };
    next();
  };
  const router = createEvidenceRouter({
    requireUser: middleware,
    requireInstructor: middleware,
    store,
  });

  const write = await dispatchRequest(
    request('/learning/profile', {
      method: 'POST',
      body: { responses: { v1: 5, h1: 1 } },
    }),
    router,
  );
  assert.equal(write.status, 201);
  const written = await json(write);
  assert.equal(written.profile.dims.visual, 1);
  assert.equal(written.profile.dims.verbal, null);
  assert.equal(written.profile.dims.reading, null);
  assert.equal(written.profile.dims.hands_on, 0);
  assert.equal(saved.responses.verbal, undefined);

  const reload = await dispatchRequest(
    request('/learning/profile'),
    router,
  );
  assert.equal(reload.status, 200);
  assert.equal((await json(reload)).profile.dims.verbal, null);

  const invalid = await dispatchRequest(
    request('/learning/profile', {
      method: 'POST',
      body: { responses: { v1: 6 } },
    }),
    router,
  );
  assert.equal(invalid.status, 400);
});

test('study plan persists syllabus provenance and all three COAs', async () => {
  let saved;
  const syllabus = [{ id: 'lesson-1', title: 'Land navigation', due: '2026-02-05', hours: 1 }];
  const store = {
    async getStudyPlanInput() {
      return { syllabus, asOf: '2026-02-01' };
    },
    async saveStudyPlan(value) {
      saved = value;
    },
  };
  const middleware = (req, _res, next) => {
    req.user = { id: 'plan-learner', role: 'LEARNER' };
    next();
  };
  const router = createEvidenceRouter({
    requireUser: middleware,
    requireInstructor: middleware,
    store,
  });

  const response = await dispatchRequest(
    request('/learning/study-plan', {
      method: 'POST',
      body: {
        courseId: 'persisted-course',
        // A client syllabus is deliberately ignored by the store seam.
        syllabus: [{ title: 'Invented lesson', due: '2099-01-01' }],
      },
    }),
    router,
  );
  assert.equal(response.status, 201);
  const body = await json(response);
  assert.deepEqual(Object.keys(body.plan.coas).sort(), ['catch_up', 'get_ahead', 'maintain']);
  assert.match(body.ics, /BEGIN:VCALENDAR\r\n/);
  assert.match(body.ics, /END:VCALENDAR/);
  assert.deepEqual(saved.input.syllabus, syllabus);

  const invalid = await dispatchRequest(
    request('/learning/study-plan', {
      method: 'POST',
      body: { courseId: 'persisted-course', availability: '60' },
    }),
    router,
  );
  assert.equal(invalid.status, 400);
});

test('AAR saves exact critique input and provenance while reporting heuristic fallback', async () => {
  let saved;
  const store = {
    async getAarInput() {
      return {
        courseTitle: 'Planning course',
        critiques: [
          { area: 'brief', kind: 'improve', severity: 5, iteration: '2026-01' },
          { area: 'brief', kind: 'improve', severity: 4, iteration: '2026-02' },
        ],
        provenance: { critiqueSetId: 'critique-set-1', status: 'RECORDED' },
      };
    },
    async saveAar(value) {
      saved = value;
    },
    async getAar() {
      return saved;
    },
  };
  const middleware = (req, _res, next) => {
    req.user = { id: 'aar-instructor', role: 'INSTRUCTOR' };
    next();
  };
  const router = createEvidenceRouter({
    requireUser: middleware,
    requireInstructor: middleware,
    store,
  });

  const response = await dispatchRequest(
    request('/learning/aar', {
      method: 'POST',
      body: { courseId: 'aar-course' },
    }),
    router,
  );
  assert.equal(response.status, 201);
  const body = await json(response);
  assert.equal(body.source, 'heuristic');
  assert.equal(body.modelAvailable, false);
  assert.deepEqual(body.inputIterations, ['2026-01', '2026-02']);
  assert.deepEqual(saved.input.critiques, [
    { area: 'brief', kind: 'improve', severity: 5, iteration: '2026-01' },
    { area: 'brief', kind: 'improve', severity: 4, iteration: '2026-02' },
  ]);
  assert.equal(saved.critiques[1].iteration, '2026-02');
  assert.deepEqual(saved.inputIterations, ['2026-01', '2026-02']);
  assert.equal(saved.input.provenance.critiqueSetId, 'critique-set-1');
  assert.equal(saved.report.meta.iterations, 2);

  const reload = await dispatchRequest(
    request('/learning/aar?courseId=aar-course'),
    router,
  );
  assert.equal(reload.status, 200);
  assert.equal((await json(reload)).input.provenance.critiqueSetId, 'critique-set-1');
});

test('configured Hotwash model failure remains an honest heuristic result', async () => {
  const result = await buildAar({
    critiques: [{ area: 'brief', iteration: '2026-01' }],
    model: async () => {
      throw new Error('model unavailable');
    },
  });
  assert.equal(result.source, 'heuristic');
  assert.equal(result.modelAvailable, false);
});

test('cohort profiles deduplicate repeated learner saves', () => {
  const profile = {
    dims: {
      visual: 1,
      verbal: null,
      reading: null,
      hands_on: null,
      self_paced: null,
      structured: null,
    },
    dominantModality: 'visual',
  };
  const entries = ['a', 'b', 'c', 'd', 'e', 'a'].map((learnerId) => ({
    learnerId,
    profile,
  }));
  const result = buildCohortProfile({ entries });
  assert.equal(result.status, 'complete');
  assert.equal(result.n, 5);
});