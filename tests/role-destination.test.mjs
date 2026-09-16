import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getDefaultDestination,
  getPostLoginDestination,
  isSafeDeepLink,
} from '../app/_auth/role-destination.js';

const completedAt = '2026-01-01T00:00:00.000Z';
const complete = (role) => ({
  id: `account-${role.toLowerCase()}`,
  name: 'Alex Rivera',
  role,
  branch: 'ARMY',
  payGrade: 'E-4',
  rank: 'Specialist',
  profileCompletedAt: completedAt,
});

test('role defaults route instructors to the builder and learners/both to the student dashboard', () => {
  assert.equal(getDefaultDestination(complete('INSTRUCTOR')), '/prototype/instructor');
  assert.equal(getDefaultDestination(complete('LEARNER')), '/prototype');
  assert.equal(getDefaultDestination(complete('BOTH')), '/prototype');
});

test('incomplete profiles always enter AuthGuard onboarding', () => {
  assert.equal(getDefaultDestination({ ...complete('INSTRUCTOR'), branch: null }), '/prototype');
  assert.equal(getPostLoginDestination({ ...complete('LEARNER'), rank: null }, '/learn/course/1'), '/prototype');
});

test('safe deep links preserve permitted role destinations', () => {
  const instructor = complete('INSTRUCTOR');
  const learner = complete('LEARNER');
  const both = complete('BOTH');

  assert.equal(isSafeDeepLink('/teach?area=settings', instructor), true);
  assert.equal(getPostLoginDestination(instructor, '/teach/course/42'), '/teach/course/42');
  assert.equal(isSafeDeepLink('/prototype/instructor/M092721/settings', instructor), true);
  assert.equal(isSafeDeepLink('/prototype/course/M092721', learner), true);
  assert.equal(isSafeDeepLink('/teach', both), true);
  assert.equal(isSafeDeepLink('/learn', both), true);
});

test('mismatched or external deep links fall back to the persisted role', () => {
  const instructor = complete('INSTRUCTOR');
  const learner = complete('LEARNER');

  assert.equal(getPostLoginDestination(instructor, '/learn/course/42'), '/prototype/instructor');
  assert.equal(getPostLoginDestination(learner, '/teach'), '/prototype');
  assert.equal(isSafeDeepLink('https://evil.example/teach', instructor), false);
  assert.equal(isSafeDeepLink('//evil.example/teach', instructor), false);
  assert.equal(isSafeDeepLink('/teach/../evil', instructor), false);
  assert.equal(isSafeDeepLink('/prototype/instructor/M092721', learner), false);
  assert.equal(getPostLoginDestination(instructor, '/unknown'), '/prototype/instructor');
});