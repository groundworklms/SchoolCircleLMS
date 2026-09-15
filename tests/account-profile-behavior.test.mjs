import assert from 'node:assert/strict';
import test from 'node:test';

import { accountDisplay } from '../app/_auth/account-display.js';
import { signOutAndNavigateToLogin } from '../app/_auth/account-recovery.js';
import { createProfileCoordinator } from '../app/_auth/profile-coordinator.js';
import { validateProfileFields } from '../app/_auth/profile-form.js';
import { authenticatedFetch } from '../lib/auth-fetch.js';

const deferred = () => {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
};

const profile = (id, name, completed = true) => ({
  id,
  name,
  rank: null,
  profileCompletedAt: completed ? '2026-01-01T00:00:00.000Z' : null,
  role: 'LEARNER',
  externalId: `firebase:test:${id}`,
});

test('profile coordinator discards a prior account load after account switch', async () => {
  let activeUser = null;
  const loads = [];
  const coordinator = createProfileCoordinator({
    getActiveUser: () => activeUser,
    loadProfile: (user, options) => {
      const pending = deferred();
      loads.push({ user, pending, signal: options.signal });
      return pending.promise;
    },
    saveProfile: async () => profile('unused', 'Unused'),
  });

  const userA = { uid: 'uid-a' };
  const userB = { uid: 'uid-b' };
  activeUser = userA;
  coordinator.onAuthStateChanged(userA);
  activeUser = userB;
  coordinator.onAuthStateChanged(userB);

  loads[0].pending.resolve(profile('account-a', 'A'));
  await Promise.resolve();
  assert.equal(coordinator.getState().profile, null);
  assert.equal(coordinator.getState().loading, true);

  loads[1].pending.resolve(profile('account-b', 'B'));
  await Promise.resolve();
  assert.equal(coordinator.getState().profile.id, 'account-b');
});

test('sign-out and same-UID return cannot publish the signed-out account', async () => {
  let activeUser = null;
  const loads = [];
  const coordinator = createProfileCoordinator({
    getActiveUser: () => activeUser,
    loadProfile: (user, options) => {
      const pending = deferred();
      loads.push({ user, pending, signal: options.signal });
      return pending.promise;
    },
    saveProfile: async () => profile('unused', 'Unused'),
  });

  const firstFirebaseUser = { uid: 'same-uid' };
  const returnedFirebaseUser = { uid: 'same-uid' };
  activeUser = firstFirebaseUser;
  coordinator.onAuthStateChanged(firstFirebaseUser);
  activeUser = null;
  coordinator.onAuthStateChanged(null);
  activeUser = returnedFirebaseUser;
  coordinator.onAuthStateChanged(returnedFirebaseUser);

  loads[0].pending.resolve(profile('old-account', 'Old'));
  loads[1].pending.resolve(profile('new-account', 'New'));
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(coordinator.getState().profile.id, 'new-account');
});

test('saving invalidates an older GET before publishing the saved identity', async () => {
  let activeUser = null;
  const loads = [];
  const saves = [];
  const coordinator = createProfileCoordinator({
    getActiveUser: () => activeUser,
    loadProfile: (user, options) => {
      const pending = deferred();
      loads.push({ user, pending, signal: options.signal });
      return pending.promise;
    },
    saveProfile: (payload) => {
      const pending = deferred();
      saves.push({ payload, pending });
      return pending.promise;
    },
  });
  const user = { uid: 'uid-a' };
  activeUser = user;
  coordinator.onAuthStateChanged(user);
  loads[0].pending.resolve(profile('account-a', 'Before'));
  await Promise.resolve();

  const refreshPromise = coordinator.refresh();
  const pendingGet = loads.at(-1);
  const savePromise = coordinator.update({ name: '  After  ', rank: '' });
  assert.equal(pendingGet.signal.aborted, true);
  assert.deepEqual(saves[0].payload, { name: 'After', rank: null });

  pendingGet.pending.resolve(profile('account-a', 'Stale GET'));
  saves[0].pending.resolve(profile('account-a', 'After'));
  await Promise.all([refreshPromise, savePromise]);
  assert.equal(coordinator.getState().profile.name, 'After');
});

test('a deferred save cannot publish after A-to-B or sign-out/same-UID return', async () => {
  let activeUser = null;
  const loads = [];
  const saves = [];
  const coordinator = createProfileCoordinator({
    getActiveUser: () => activeUser,
    loadProfile: (user, options) => {
      const pending = deferred();
      loads.push({ user, pending, signal: options.signal });
      return pending.promise;
    },
    saveProfile: (payload) => {
      const pending = deferred();
      saves.push({ payload, pending });
      return pending.promise;
    },
  });
  const publishedNames = [];
  coordinator.subscribe((nextState) => publishedNames.push(nextState.profile?.name || null));

  const userA = { uid: 'uid-a' };
  const userB = { uid: 'uid-b' };
  activeUser = userA;
  coordinator.onAuthStateChanged(userA);
  loads[0].pending.resolve(profile('account-a', 'A'));
  await Promise.resolve();

  const saveA = coordinator.update({ name: 'Saved A', rank: null });
  activeUser = userB;
  coordinator.onAuthStateChanged(userB);
  saves[0].pending.resolve(profile('account-a', 'Stale A'));
  await assert.rejects(saveA, /account changed/i);
  assert.equal(coordinator.getState().profile, null);
  assert.equal(coordinator.getState().loading, true);
  assert.equal(publishedNames.includes('Stale A'), false);

  loads[1].pending.resolve(profile('account-b', 'B'));
  await Promise.resolve();
  assert.equal(coordinator.getState().profile.id, 'account-b');

  const returnedUserB = { uid: 'uid-b' };
  const saveB = coordinator.update({ name: 'Saved B', rank: null });
  activeUser = null;
  coordinator.onAuthStateChanged(null);
  activeUser = returnedUserB;
  coordinator.onAuthStateChanged(returnedUserB);
  saves[1].pending.resolve(profile('account-b', 'Stale after sign-out'));
  await assert.rejects(saveB, /account changed/i);
  assert.equal(coordinator.getState().profile, null);
  assert.equal(coordinator.getState().loading, true);
  assert.equal(publishedNames.includes('Stale after sign-out'), false);

  loads[2].pending.resolve(profile('account-b-returned', 'Returned B'));
  await Promise.resolve();
  assert.equal(coordinator.getState().profile.id, 'account-b-returned');
});

test('profile form validation trims fields and preserves nullable rank', () => {
  assert.deepEqual(validateProfileFields('  Rivera  ', ' Cpl '), {
    value: { name: 'Rivera', rank: 'Cpl' },
  });
  assert.deepEqual(validateProfileFields('Rivera', '   '), {
    value: { name: 'Rivera', rank: null },
  });
  assert.equal(validateProfileFields('   ', '').error, 'Name must be between 1 and 80 characters.');
  assert.equal(validateProfileFields('Rivera', 'r'.repeat(41)).error, 'Rank must be 40 characters or fewer.');
});

test('prototype shells use demo identity only when Firebase is unconfigured', () => {
  const demo = { name: 'Demo Student', initials: 'DS' };
  assert.deepEqual(accountDisplay({ ready: false, profile: null, demo }), {
    authenticated: false,
    name: 'Demo Student',
    rank: null,
    initials: 'DS',
    account: null,
  });
  assert.deepEqual(
    accountDisplay({
      ready: true,
      profile: { id: 'account-a', name: 'Persisted Name', rank: 'Cpl' },
      demo,
    }),
    {
      authenticated: true,
      name: 'Persisted Name',
      rank: 'Cpl',
      initials: 'PN',
      account: { id: 'account-a', name: 'Persisted Name', rank: 'Cpl' },
    },
  );
});

test('sign-in-again waits for sign-out before navigating', async () => {
  const signOutRequest = deferred();
  const destinations = [];
  const navigation = signOutAndNavigateToLogin({
    signOut: () => signOutRequest.promise,
    navigate: (destination) => destinations.push(destination),
    returnTo: '/prototype?view=settings',
  });

  await Promise.resolve();
  assert.deepEqual(destinations, []);
  signOutRequest.resolve();
  await navigation;
  assert.deepEqual(destinations, ['/login?next=%2Fprototype%3Fview%3Dsettings']);
});

test('sign-in-again preserves sign-out failure and does not navigate', async () => {
  const destinations = [];
  const failure = new Error('expired Firebase session');
  await assert.rejects(
    signOutAndNavigateToLogin({
      signOut: async () => {
        throw failure;
      },
      navigate: (destination) => destinations.push(destination),
      returnTo: '/prototype',
    }),
    failure,
  );
  assert.deepEqual(destinations, []);
});

test('authenticatedFetch refuses to dispatch an old token after a deferred account switch', async () => {
  const tokenRequest = deferred();
  const userA = { getIdToken: () => tokenRequest.promise };
  const userB = { getIdToken: async () => 'token-b' };
  const fakeAuth = { currentUser: userA };
  const requests = [];
  const request = authenticatedFetch(
    '/api/account/profile',
    { method: 'PATCH' },
    userA,
    {
      authInstance: fakeAuth,
      fetchImpl: (...args) => {
        requests.push(args);
        return Promise.resolve({ ok: true });
      },
      HeadersImpl: Headers,
    },
  );

  fakeAuth.currentUser = userB;
  tokenRequest.resolve('token-a');
  await assert.rejects(request, /session changed/i);
  assert.deepEqual(requests, []);
});