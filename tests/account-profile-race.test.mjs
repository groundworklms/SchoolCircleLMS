import assert from 'node:assert/strict';
import test from 'node:test';

import {
  isCurrentProfileMutation,
  isCurrentProfileRequest,
} from '../app/_auth/profile-race.js';

test('a profile load from an old Firebase object cannot commit after account switch', () => {
  const firstSession = { uid: 'same-uid' };
  const returnedSession = { uid: 'same-uid' };
  const request = {};

  assert.equal(
    isCurrentProfileRequest({
      expectedFirebaseUser: firstSession,
      activeFirebaseUser: returnedSession,
      expectedSession: 1,
      activeSession: 3,
      expectedRequest: request,
      activeRequest: request,
    }),
    false,
  );
});

test('a request aborted by sign-out cannot commit while Firebase is anonymous', () => {
  const signedIn = { uid: 'uid-a' };

  assert.equal(
    isCurrentProfileRequest({
      expectedFirebaseUser: signedIn,
      activeFirebaseUser: null,
      expectedSession: 1,
      activeSession: 2,
      expectedRequest: {},
      activeRequest: {},
      observedFirebaseUser: signedIn,
    }),
    false,
  );
});

test('a save started before Firebase emits the account-switch callback cannot target the new account', () => {
  const oldObservedUser = { uid: 'uid-a' };
  const newFirebaseUser = { uid: 'uid-b' };

  assert.equal(
    isCurrentProfileMutation({
      expectedFirebaseUser: newFirebaseUser,
      activeFirebaseUser: newFirebaseUser,
      observedFirebaseUser: oldObservedUser,
      expectedSession: 1,
      activeSession: 1,
      expectedProfileId: 'account-a',
      activeProfileId: 'account-a',
    }),
    false,
  );
});

test('a save cannot publish an old account after sign-out and same-UID return', () => {
  const firstSession = { uid: 'same-uid' };
  const returnedSession = { uid: 'same-uid' };

  assert.equal(
    isCurrentProfileMutation({
      expectedFirebaseUser: firstSession,
      activeFirebaseUser: returnedSession,
      expectedSession: 1,
      activeSession: 3,
      expectedProfileId: 'account-a',
      activeProfileId: 'account-a',
    }),
    false,
  );
});

test('a profile save can commit only for the same account session and identity', () => {
  const firebaseUser = { uid: 'uid-a' };

  assert.equal(
    isCurrentProfileMutation({
      expectedFirebaseUser: firebaseUser,
      activeFirebaseUser: firebaseUser,
      expectedSession: 4,
      activeSession: 4,
      expectedProfileId: 'account-a',
      activeProfileId: 'account-a',
    }),
    true,
  );
  assert.equal(
    isCurrentProfileMutation({
      expectedFirebaseUser: firebaseUser,
      activeFirebaseUser: firebaseUser,
      expectedSession: 4,
      activeSession: 4,
      expectedProfileId: 'account-a',
      activeProfileId: 'account-b',
    }),
    false,
  );
});