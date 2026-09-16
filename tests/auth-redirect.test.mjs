import assert from 'node:assert/strict';
import test from 'node:test';

import { currentPathAndQuery, loginHref } from '../app/_auth/login-return.js';

test('anonymous login return preserves the canonical pathname and query', () => {
  const location = {
    pathname: '/prototype/published/course-7',
    search: '?releaseId=release-3&lesson=lesson-2',
    hash: '#answer',
  };
  assert.equal(currentPathAndQuery(location), '/prototype/published/course-7?releaseId=release-3&lesson=lesson-2');
  assert.equal(
    loginHref(currentPathAndQuery(location)),
    '/login?next=%2Fprototype%2Fpublished%2Fcourse-7%3FreleaseId%3Drelease-3%26lesson%3Dlesson-2',
  );
});

test('login return falls back for non-local location data', () => {
  assert.equal(currentPathAndQuery({ pathname: '//evil.example/course', search: '?next=1' }), '/prototype');
  assert.equal(currentPathAndQuery({ pathname: '/prototype/course', search: '\\evil' }), '/prototype/course');
  assert.equal(loginHref(), '/login?next=%2Fprototype');
});
