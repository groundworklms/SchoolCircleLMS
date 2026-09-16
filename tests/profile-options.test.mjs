import assert from 'node:assert/strict';
import test from 'node:test';

import {
  getPayGrades,
  getRanks,
  isProfileComplete,
  PROFILE_ROLES,
  SERVICE_BRANCHES,
} from '../lib/profile-options.js';

const completedAt = '2026-01-01T00:00:00.000Z';

const profile = (overrides = {}) => ({
  profileCompletedAt: completedAt,
  name: 'Alex Rivera',
  role: 'LEARNER',
  branch: 'ARMY',
  payGrade: 'E-4',
  rank: 'Specialist',
  ...overrides,
});

test('publishes the profile role and service branch options', () => {
  assert.deepEqual(PROFILE_ROLES, [
    { value: 'LEARNER', label: 'Student' },
    { value: 'INSTRUCTOR', label: 'Instructor' },
    { value: 'BOTH', label: 'Student and instructor' },
  ]);
  assert.deepEqual(SERVICE_BRANCHES, [
    { value: 'ARMY', label: 'Army' },
    { value: 'MARINE_CORPS', label: 'Marine Corps' },
    { value: 'NAVY', label: 'Navy' },
    { value: 'AIR_FORCE', label: 'Air Force' },
    { value: 'SPACE_FORCE', label: 'Space Force' },
    { value: 'COAST_GUARD', label: 'Coast Guard' },
    { value: 'CIVILIAN', label: 'Civilian / not serving' },
  ]);
});

test('returns branch-specific pay grades and rejects unsupported branches or grades', () => {
  assert.deepEqual(getPayGrades('ARMY').slice(0, 9), [
    { value: 'E-1', label: 'E-1' },
    { value: 'E-2', label: 'E-2' },
    { value: 'E-3', label: 'E-3' },
    { value: 'E-4', label: 'E-4' },
    { value: 'E-5', label: 'E-5' },
    { value: 'E-6', label: 'E-6' },
    { value: 'E-7', label: 'E-7' },
    { value: 'E-8', label: 'E-8' },
    { value: 'E-9', label: 'E-9' },
  ]);
  assert.deepEqual(getPayGrades('SPACE_FORCE').map(({ value }) => value), [
    'E-1', 'E-2', 'E-3', 'E-4', 'E-5', 'E-6', 'E-7', 'E-8', 'E-9',
    'O-1', 'O-2', 'O-3', 'O-4', 'O-5', 'O-6', 'O-7', 'O-8', 'O-9', 'O-10',
  ]);
  assert.deepEqual(getPayGrades('CIVILIAN'), []);
  assert.deepEqual(getPayGrades('NOT_A_BRANCH'), []);
  assert.deepEqual(getRanks('ARMY', 'E-99'), []);
  assert.deepEqual(getRanks('NOT_A_BRANCH', 'E-1'), []);
});

test('includes standard enlisted, warrant, and officer rank options', () => {
  assert.deepEqual(getRanks('ARMY', 'E-4'), [
    { value: 'Specialist', label: 'Specialist' },
    { value: 'Corporal', label: 'Corporal' },
  ]);
  assert.deepEqual(getRanks('MARINE_CORPS', 'E-8'), [
    { value: 'Master Sergeant', label: 'Master Sergeant' },
    { value: 'First Sergeant', label: 'First Sergeant' },
  ]);
  assert.deepEqual(getRanks('AIR_FORCE', 'W-1'), [
    { value: 'Warrant Officer 1', label: 'Warrant Officer 1' },
  ]);
  assert.deepEqual(getRanks('AIR_FORCE', 'W-2'), [
    { value: 'Chief Warrant Officer 2', label: 'Chief Warrant Officer 2' },
  ]);
  assert.deepEqual(getRanks('SPACE_FORCE', 'W-1'), []);
  assert.deepEqual(getRanks('NAVY', 'O-2'), [
    { value: 'Lieutenant Junior Grade', label: 'Lieutenant Junior Grade' },
  ]);
  for (const branch of SERVICE_BRANCHES
    .map(({ value }) => value)
    .filter((value) => value !== 'CIVILIAN')) {
    for (const grade of getPayGrades(branch)) {
      for (const rank of getRanks(branch, grade.value)) {
        assert.ok(rank.value.length <= 40);
      }
    }
  }
});

test('accepts complete learner, instructor, and combined military profiles', () => {
  for (const role of ['LEARNER', 'INSTRUCTOR', 'BOTH']) {
    assert.equal(isProfileComplete(profile({ role })), true);
  }
  assert.equal(isProfileComplete(profile({
    branch: 'NAVY',
    payGrade: 'O-2',
    rank: 'Lieutenant Junior Grade',
  })), true);
});

test('rejects incomplete or mismatched military profiles', () => {
  for (const overrides of [
    { profileCompletedAt: null },
    { profileCompletedAt: 'not-a-date' },
    { name: '   ' },
    { role: 'ADMIN' },
    { branch: 'NOT_A_BRANCH' },
    { branch: 'ARMY', payGrade: 'E-99', rank: 'Specialist' },
    { branch: 'ARMY', payGrade: 'E-5', rank: 'Specialist' },
    { branch: 'SPACE_FORCE', payGrade: 'W-1', rank: 'Warrant Officer 1' },
  ]) {
    assert.equal(isProfileComplete(profile(overrides)), false, JSON.stringify(overrides));
  }
});

test('accepts a civilian only after clearing military grade and rank', () => {
  assert.equal(isProfileComplete(profile({
    branch: 'CIVILIAN',
    payGrade: null,
    rank: null,
  })), true);
  assert.equal(isProfileComplete(profile({
    branch: 'CIVILIAN',
    payGrade: '',
    rank: '',
  })), true);
  assert.equal(isProfileComplete(profile({
    branch: 'CIVILIAN',
    payGrade: 'E-4',
    rank: '',
  })), false);
  assert.equal(isProfileComplete(profile({
    branch: 'CIVILIAN',
    payGrade: '',
    rank: 'Specialist',
  })), false);
});

test('keeps legacy profiles incomplete until branch and grade are recorded', () => {
  assert.equal(isProfileComplete({
    profileCompletedAt: completedAt,
    name: 'Legacy User',
    role: 'LEARNER',
    rank: 'Corporal',
  }), false);
});