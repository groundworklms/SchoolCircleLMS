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