import assert from 'node:assert/strict';
import test from 'node:test';

import { currentPathAndQuery, loginHref } from '../app/_auth/login-return.js';

test('anonymous login return preserves the canonical pathname and query', () => {
  const location = {
    pathname: '/prototype/course/course-7/lessons/lesson-2',
    search: '?page=2',
    hash: '#answer',
  };
  assert.equal(currentPathAndQuery(location), '/prototype/course/course-7/lessons/lesson-2?page=2');
  assert.equal(
    loginHref(currentPathAndQuery(location)),
    '/login?next=%2Fprototype%2Fcourse%2Fcourse-7%2Flessons%2Flesson-2%3Fpage%3D2',
  );
});

test('login return falls back for non-local location data', () => {
  assert.equal(currentPathAndQuery({ pathname: '//evil.example/course', search: '?next=1' }), '/prototype');
  assert.equal(currentPathAndQuery({ pathname: '/prototype/course', search: '\\evil' }), '/prototype/course');
  assert.equal(loginHref(), '/login?next=%2Fprototype');
});
