import assert from 'node:assert/strict';
import { mock, test } from 'node:test';

let role = 'LEARNER';
const saved = {
  id: 'legacy',
  title: 'Saved course',
  sections: [{ items: [{ stem: 'Check?', options: ['Yes', 'No'], answer: 0, rationale: 'Key', support: 1 }] }],
};
mock.module('../lib/auth.js', {
  // The route drops the instructor capability when the request was made from a
  // learner surface, so the mock has to carry that export too.
  namedExports: {
    requireAnyRole: async () => ({ id: 'fixture', role }),
    learnerScopedIdentity: (identity) => (
      identity?.role === 'INSTRUCTOR' || identity?.role === 'BOTH'
        ? { ...identity, role: 'LEARNER' }
        : identity
    ),
  },
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
test('an instructor reading from the student view gets the learner projection', async () => {
  // "View as student" is worthless if it answers with the owner's view. The
  // same account, the same course, the same route -- and no answer key.
  role = 'INSTRUCTOR';
  const response = await GET(
    new Request('http://fixture/api/courses/legacy', {
      headers: { 'x-schoolcircle-view': 'learner' },
    }),
    { params: { id: 'legacy' } },
  );
  const body = await response.json();
  assert.deepEqual(body.course.sections[0].items[0], { stem: 'Check?', options: ['Yes', 'No'] });
  assert.equal(body.availableReleaseIds, undefined);
});
