import test from 'node:test';
import assert from 'node:assert/strict';
import { isStale, jobView, JOB_DONE, JOB_FAILED, JOB_RUNNING, STALE_AFTER_MS } from '../lib/learning/job.js';

const at = (ms) => new Date(ms).toISOString();

test('a job view carries progress and never the input it was given', () => {
  const view = jobView({
    id: 'job-1',
    status: JOB_RUNNING,
    createdAt: at(0),
    updatedAt: at(Date.now()),
    payload: {
      input: { sourceIds: ['source-1'], title: 'A title the client already has' },
      events: [{ phase: 'sources', documents: 1 }],
    },
  });
  assert.equal(view.id, 'job-1');
  assert.equal(view.status, JOB_RUNNING);
  assert.deepEqual(view.events, [{ phase: 'sources', documents: 1 }]);
  assert.equal('input' in view, false, 'the client sent the input; sending it back is noise');
});

test('a finished job carries the course it produced', () => {
  const view = jobView({
    id: 'job-1',
    status: JOB_DONE,
    createdAt: at(0),
    updatedAt: at(0),
    payload: { events: [], courseId: 'course-9', record: { id: 'course-9', title: 'A course' } },
  });
  assert.equal(view.courseId, 'course-9');
  assert.equal(view.record.title, 'A course');
});

test('a failed job carries the reason and its code', () => {
  const view = jobView({
    id: 'job-1',
    status: JOB_FAILED,
    createdAt: at(0),
    updatedAt: at(0),
    payload: { events: [], error: 'Model endpoint 404 for model "x"', code: 'MODEL_UNAVAILABLE' },
  });
  assert.match(view.error, /Model endpoint 404/);
  assert.equal(view.code, 'MODEL_UNAVAILABLE');
});

// The row is the only evidence a job still exists. Nothing renews it but a
// flush, and a flush happens whenever anything is emitted.
test('a running job untouched for minutes is stale', () => {
  const now = Date.now();
  const running = (updatedAt) => ({ status: JOB_RUNNING, createdAt: at(0), updatedAt: at(updatedAt) });
  assert.equal(isStale(running(now - 1000), now), false, 'just written to');
  assert.equal(isStale(running(now - STALE_AFTER_MS + 5000), now), false, 'slow, but alive');
  assert.equal(isStale(running(now - STALE_AFTER_MS - 1000), now), true, 'nothing owns this any more');
});

// A deploy is how a job stops being worked on, and it is the case this must
// name rather than leave a spinner turning.
test('a finished job is never stale, however old', () => {
  const now = Date.now();
  const long = at(now - STALE_AFTER_MS * 10);
  assert.equal(isStale({ status: JOB_DONE, createdAt: long, updatedAt: long }, now), false);
  assert.equal(isStale({ status: JOB_FAILED, createdAt: long, updatedAt: long }, now), false);
  assert.equal(isStale(null, now), false);
});

test('jobView survives a row with nothing useful on it', () => {
  assert.equal(jobView(null), null);
  const bare = jobView({ id: 'job-1', status: JOB_RUNNING, createdAt: at(Date.now()), updatedAt: at(Date.now()) });
  assert.deepEqual(bare.events, []);
  assert.equal(bare.courseId, undefined);
});

// The whole point of the change: the request that starts a generation must not
// wait for it. A test that only checked the row existed would pass on the old
// design too.
test('startJob returns before the work does, and records the outcome afterwards', async () => {
  const { startJob } = await import('../lib/learning/job.js');
  const db = await import('../lib/db.js');

  const rows = new Map();
  const createdAt = new Date().toISOString();
  const originalCreate = db.createLearningRecord;
  const originalUpdate = db.updateLearningRecord;

  // node:test cannot monkey-patch an ES module binding, so the store is driven
  // through the real helpers only where that is possible; here the job layer is
  // exercised against a stub passed in its place.
  const stub = {
    create: async ({ ownerId, type, status, payload }) => {
      const record = { id: `job-${rows.size + 1}`, ownerId, type, status, payload, createdAt, updatedAt: createdAt };
      rows.set(record.id, record);
      return record;
    },
    update: async (id, data) => {
      const record = rows.get(id);
      Object.assign(record, data, { updatedAt: new Date().toISOString() });
      return record;
    },
  };

  // Prove the ordering without a database: `run` blocks until released, and the
  // start call must have returned long before.
  let release;
  const blocked = new Promise((resolve) => { release = resolve; });
  let startReturned = false;
  let workFinished = false;

  const record = await startJob({
    ownerId: 'owner-1',
    input: { sourceIds: ['s1'] },
    run: async (emit) => {
      emit({ phase: 'sources', documents: 1 });
      await blocked;
      workFinished = true;
      return { json: { id: 'course-9', title: 'A course' } };
    },
    // Injected for the test; production passes nothing and the real db is used.
    store: stub,
  }).then((value) => { startReturned = true; return value; });

  assert.ok(startReturned, 'the POST returned');
  assert.equal(workFinished, false, 'and it did not wait for the generation');
  assert.equal(record.status, 'RUNNING');

  release();
  // Let the detached chain settle.
  await new Promise((resolve) => setTimeout(resolve, 50));
  assert.equal(workFinished, true);
  assert.equal(rows.get(record.id).status, 'DONE');
  assert.equal(rows.get(record.id).payload.courseId, 'course-9');
  assert.ok(originalCreate && originalUpdate, 'the real helpers still exist for production use');
});
