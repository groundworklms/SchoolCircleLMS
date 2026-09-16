'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { auth, firebaseReady } from '../../lib/firebase';
import { authenticatedFetch } from '../../lib/auth-fetch';
import { createProfileCoordinator } from './profile-coordinator';

const AuthCtx = createContext({
  user: null,
  profile: null,
  profileLoading: false,
  profileError: null,
  refreshProfile: async () => null,
  updateProfile: async () => null,
  loading: false,
  ready: false,
  signOut: () => {},
  signOutError: null,
});

function responseError(body, status, fallback) {
  const message = body?.error || body?.message || fallback;
  const error = new Error(message);
  error.error = message;
  error.status = status;
  if (body?.code) error.code = body.code;
  return error;
}

async function readProfileResponse(response, fallback) {
  let body = null;
  try {
    body = await response.json();
  } catch {
    body = null;
  }
  if (!response.ok) throw responseError(body, response.status, fallback);
  if (!body?.user) throw responseError(body, 503, 'Account service returned an invalid profile.');
  return body.user;
}

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Only "loading" when we actually have Firebase to wait on.
  const [loading, setLoading] = useState(firebaseReady);
  const [profileState, setProfileState] = useState({ profile: null, loading: firebaseReady, error: null });
  const [signOutError, setSignOutError] = useState(null);
  const coordinatorRef = useRef(null);

  if (!coordinatorRef.current) {
    coordinatorRef.current = createProfileCoordinator({
      getActiveUser: () => auth?.currentUser || null,
      loadProfile: async (firebaseUser, { signal }) => {
        const response = await authenticatedFetch('/api/auth/user', { signal }, firebaseUser);
        return readProfileResponse(response, 'Unable to load your account.');
      },
      saveProfile: async (payload, { user: expectedUser }) => {
        const response = await authenticatedFetch('/api/account/profile', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        }, expectedUser);
        return readProfileResponse(response, 'Unable to save your account.');
      },
    });
  }
  const coordinator = coordinatorRef.current;

  useEffect(() => coordinator.subscribe(setProfileState), [coordinator]);

  useEffect(() => {
    if (!firebaseReady || !auth) {
      setLoading(false);
      setProfileState({ profile: null, loading: false, error: null });
      return undefined;
    }
    const unsubscribe = onAuthStateChanged(auth, (nextUser) => {
      // The coordinator clears its account synchronously before this state
      // publication, closing the old-profile/new-token render window.
      coordinator.onAuthStateChanged(nextUser);
      setUser(nextUser);
      setLoading(false);
      setSignOutError(null);
    });
    return () => unsubscribe();
  }, [coordinator]);

  const refreshProfile = useCallback(() => coordinator.refresh(), [coordinator]);
  const updateProfile = useCallback((payload) => coordinator.update(payload), [coordinator]);

  const signOut = useCallback(async () => {
    setSignOutError(null);
    if (!auth) return;
    try {
      await fbSignOut(auth);
    } catch (error) {
      const clientError = responseError(null, error?.code, error?.message || 'Unable to sign out.');
      setSignOutError(clientError);
      throw clientError;
    }
  }, []);

  return (
    <AuthCtx.Provider
      value={{
        user,
        profile: profileState.profile,
        profileLoading: profileState.loading,
        profileError: profileState.error,
        refreshProfile,
        updateProfile,
        loading,
        ready: firebaseReady,
        signOut,
        signOutError,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);