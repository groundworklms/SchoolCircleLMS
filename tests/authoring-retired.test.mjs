import assert from 'node:assert/strict';
import test from 'node:test';

import { POST as createCourse } from '../app/api/authoring/courses/route.js';
import { PATCH as saveCourse } from '../app/api/authoring/courses/[id]/route.js';
import { POST as publishCourse } from '../app/api/authoring/courses/[id]/publish/route.js';
import { POST as archiveCourse } from '../app/api/authoring/courses/[id]/archive/route.js';

async function assertRetired(handler, method, url) {
  const response = await handler(new Request(url, { method }));
  assert.equal(response.status, 410);
  assert.equal(response.headers.get('cache-control'), 'private, no-store');
  assert.deepEqual(await response.json(), {
    error: 'Manual course authoring is retired. Use AI course authoring.',
    code: 'MANUAL_AUTHORING_RETIRED',
  });
}

test('retired manual create, save, publish, and archive routes return 410 without auth or writes', async () => {
  await assertRetired(createCourse, 'POST', 'http://localhost/api/authoring/courses');
  await assertRetired(saveCourse, 'PATCH', 'http://localhost/api/authoring/courses/course-1');
  await assertRetired(publishCourse, 'POST', 'http://localhost/api/authoring/courses/course-1/publish');
  await assertRetired(archiveCourse, 'POST', 'http://localhost/api/authoring/courses/course-1/archive');
});
test('a legacy manual course can be cleared, but not one learners have used', async () => {
  // #78 kept these records on purpose, which left instructors with remnants
  // and no way to remove them. Removal must still not take learner work.
  const rows = new Map();
  let seq = 0;
  const db = {
    learningRecord: {
      async findUnique({ where }) { return rows.get(where.id) || null; },
      async findMany({ where = {} }) {
        return [...rows.values()]
          .filter((r) => !where.type || r.type === where.type)
          .filter((r) => !where.ownerId || r.ownerId === where.ownerId);
      },
      async updateMany({ where, data }) {
        const row = rows.get(where.id);
        if (!row || (where.ownerId && row.ownerId !== where.ownerId)) return { count: 0 };
        Object.assign(row, data);
        return { count: 1 };
      },
      async deleteMany({ where }) {
        const ids = where?.id?.in || [];
        let count = 0;
        for (const id of ids) if (rows.delete(id)) count += 1;
        return { count };
      },
      async create({ data }) {
        const row = { id: `r-${++seq}`, ...data };
        rows.set(row.id, row);
        return row;
      },
    },
  };

  const { createAuthoringService } = await import('../lib/authoring/service.js');
  const service = createAuthoringService({ db });
  const identity = { id: 'owner-1', role: 'INSTRUCTOR' };

  const seed = (id, type, payload, status = 'PUBLISHED') => {
    rows.set(id, { id, ownerId: 'owner-1', type, status, payload, version: 0 });
  };

  // Untouched remnant: goes, releases and all.
  seed('c-clean', 'MANUAL_COURSE', { title: 'Unused legacy' });
  seed('rel-1', 'MANUAL_RELEASE', { courseId: 'c-clean' });
  const cleared = await service.deleteCourse(identity, { params: { id: 'c-clean' } });
  assert.equal(cleared.json.deleted, true);
  assert.equal(rows.has('c-clean'), false);
  assert.equal(rows.has('rel-1'), false, 'its releases go too');

  // Used remnant: archived, learner rows untouched.
  seed('c-used', 'MANUAL_COURSE', { title: 'Used legacy' });
  seed('prog-1', 'MANUAL_PROGRESS', { courseId: 'c-used', learnerId: 'l-1' });
  const kept = await service.deleteCourse(identity, { params: { id: 'c-used' } });
  assert.equal(kept.json.deleted, false);
  assert.equal(kept.json.archived, true);
  assert.match(kept.json.reason, /1 progress or attempt record/);
  assert.equal(rows.get('c-used').status, 'ARCHIVED');
  assert.equal(rows.has('prog-1'), true, 'learner progress survives');

  // Someone else's remnant is not theirs to clear.
  rows.set('c-other', {
    id: 'c-other', ownerId: 'owner-2', type: 'MANUAL_COURSE', status: 'PUBLISHED', payload: {},
  });
  await assert.rejects(
    () => service.deleteCourse(identity, { params: { id: 'c-other' } }),
    (e) => e.code === 'NOT_FOUND',
  );
  assert.equal(rows.has('c-other'), true);
});
