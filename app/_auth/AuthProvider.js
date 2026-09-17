'use client';

import { createContext, useCallback, useContext, useEffect, useRef, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { auth, firebaseReady } from '../../lib/firebase';
import { authenticatedFetch } from '../../lib/auth-fetch';
import {
  clearOfflineSession,
  offlineAuthUiEnabled,
  offlineUserFromSession,
  readOfflineSession,
  requestOfflineSession,
  resetOfflineUserCache,
  storeOfflineSession,
} from '../../lib/offline-session';
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
  offlineEnabled: false,
  signInOffline: async () => null,
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

  /*
   * Local operator sessions (lib/offline-session.js). This whole branch is
   * inert unless the bundle was built with NEXT_PUBLIC_AUTH_MODE=offline, and
   * even then the session itself is only honoured by a server that has
   * AUTH_MODE=offline and a local signing secret.
   *
   * The ref exists because the profile coordinator asks "who is active?"
   * synchronously, inside callbacks that must not wait for a React render.
   */
  const offlineEnabled = offlineAuthUiEnabled();
  const [offlineUser, setOfflineUser] = useState(null);
  const offlineUserRef = useRef(null);

  if (!coordinatorRef.current) {
    coordinatorRef.current = createProfileCoordinator({
      getActiveUser: () => auth?.currentUser || offlineUserRef.current || null,
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
      // An offline deployment has its own restore effect below; clearing here
      // would stomp it. Behaviour is unchanged when offline mode is off.
      if (!offlineEnabled) setProfileState({ profile: null, loading: false, error: null });
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
  }, [coordinator, offlineEnabled]);

  // Restore a stored operator session on load. Declared after the Firebase
  // effect so that on an offline deployment this is the state that survives.
  const adoptOfflineUser = useCallback((nextUser) => {
    offlineUserRef.current = nextUser;
    setOfflineUser(nextUser);
    setLoading(false);
    coordinator.onAuthStateChanged(nextUser);
  }, [coordinator]);

  useEffect(() => {
    if (!offlineEnabled) return;
    const session = readOfflineSession();
    adoptOfflineUser(session ? offlineUserFromSession(session) : null);
  }, [offlineEnabled, adoptOfflineUser]);

  const refreshProfile = useCallback(() => coordinator.refresh(), [coordinator]);
  const updateProfile = useCallback((payload) => coordinator.update(payload), [coordinator]);

  const signInOffline = useCallback(async (subject, passphrase) => {
    if (!offlineEnabled) throw responseError(null, 404, 'Offline sign-in is not enabled on this deployment.');
    const session = await requestOfflineSession(subject, passphrase);
    storeOfflineSession(session);
    const nextUser = offlineUserFromSession(session);
    adoptOfflineUser(nextUser);
    return nextUser;
  }, [offlineEnabled, adoptOfflineUser]);

  const signOut = useCallback(async () => {
    setSignOutError(null);
    // An offline session lives in local storage, not in Firebase; discarding it
    // is the whole of signing out. Checked first so a deployment running both
    // does not try to sign a Firebase user out of an operator session.
    if (offlineUserRef.current) {
      clearOfflineSession();
      resetOfflineUserCache();
      adoptOfflineUser(null);
      return;
    }
    if (!auth) return;
    try {
      await fbSignOut(auth);
    } catch (error) {
      const clientError = responseError(null, error?.code, error?.message || 'Unable to sign out.');
      setSignOutError(clientError);
      throw clientError;
    }
  }, [adoptOfflineUser]);

  return (
    <AuthCtx.Provider
      value={{
        user: user || offlineUser,
        profile: profileState.profile,
        profileLoading: profileState.loading,
        profileError: profileState.error,
        refreshProfile,
        updateProfile,
        loading,
        // `ready` means "this deployment has a way to sign in". Offline mode is
        // such a way, so AuthGuard must gate rather than pass everyone through.
        ready: firebaseReady || offlineEnabled,
        signOut,
        signOutError,
        offlineEnabled,
        signInOffline,
      }}
    >
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);