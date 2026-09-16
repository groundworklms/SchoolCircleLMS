import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let role = 'LEARNER';
const saved = {
  id: 'legacy',
  title: 'Saved course',
  sections: [{ items: [{ stem: 'Check?', options: ['Yes', 'No'], answer: 0, rationale: 'Key', support: 1 }] }],
};
mock.module('../lib/auth.js', {
  namedExports: { requireAnyRole: async () => ({ id: 'fixture', role }) },
});
mock.module('../lib/db.js', {
  namedExports: {
    db: {
      learningRecord: { findUnique: async () => null, findMany: async () => [] },
      course: { findUnique: async ({ where }) => where.id === saved.id ? saved : null },
    },
  },
});
const { GET } = await import('../app/api/courses/[id]/route.js');

test('unlinked legacy typed course detail remains readable and learner-safe', async () => {
  const response = await GET(new Request('http://fixture/api/courses/legacy'), { params: { id: 'legacy' } });
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.course.id, 'legacy');
  assert.equal(body.releaseId, 'legacy');
  assert.deepEqual(body.course.sections[0].items[0], { stem: 'Check?', options: ['Yes', 'No'] });
  assert.equal(response.headers.get('Cache-Control'), 'private, no-store');
});

test('legacy course cannot use a release pin to read a different course', async () => {
  const response = await GET(new Request('http://fixture/api/courses/legacy?releaseId=other'), {
    params: { id: 'legacy' },
  });
  assert.equal(response.status, 404);
});

test('instructor legacy detail retains assessment review fields', async () => {
  role = 'INSTRUCTOR';
  const response = await GET(new Request('http://fixture/api/courses/legacy'), { params: { id: 'legacy' } });
  const body = await response.json();
  assert.equal(body.course.sections[0].items[0].answer, 0);
  assert.deepEqual(body.availableReleaseIds, ['legacy']);
});