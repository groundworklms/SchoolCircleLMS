// Firebase client initialization.
//
// All values are PUBLIC client config (NEXT_PUBLIC_*), safe to ship to the
// browser — set them in Firebase App Hosting / .env.local. If the config is
// absent or incomplete, `firebaseReady` is false and `auth` is null, and the
// app degrades gracefully: no login is enforced and nobody is locked out.

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';
import { LEARNER_VIEW, LEARNER_VIEW_HEADER, isLearnerSurface } from './learner-view.js';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

// Minimum needed to actually initialize auth.
export const firebaseReady = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId
);

let auth = null;
// Resolves once Firebase has restored its persisted session, so the first API
// call after a reload cannot race the auth listener and go out anonymous.
let authReady = Promise.resolve(null);

// Only initialize in the browser (auth is client-only) and only when configured.
if (firebaseReady && typeof window !== 'undefined') {
  const app = getApps().length ? getApp() : initializeApp(config);
  auth = getAuth(app);
  authReady = new Promise((resolve) => {
    const unsubscribe = onAuthStateChanged(auth, (user) => {
      unsubscribe();
      resolve(user);
    });
  });
}

export { auth };

/** The current user's Firebase ID token, or null when signed out / unconfigured. */
export async function getFirebaseIdToken() {
  if (!auth) return null;
  await authReady;
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

/**
 * `fetch` that carries the Firebase ID token as a bearer credential. The
 * learning API (/api/learning/*, /api/auth/user) verifies it server-side and
 * maps it to a SchoolCircle user; every other route ignores it.
 *
 * A request from a learner surface also asks to be answered as a learner.
 * An instructor's account may see its own unpublished drafts, which is right
 * everywhere they author and wrong on the student side: "View as student" is
 * the control they would use to confirm that nothing unreviewed reaches a
 * learner, and answering it with the owner's view told them the reassuring
 * thing instead of the true one.
 *
 * This is not a role assertion — the header can only ever make the server drop
 * a capability, never grant one, and the role itself still comes from the
 * database (lib/auth.js `learnerScopedIdentity`, lib/learning/http.js). It is
 * set here rather than at each call site so that every learner screen is
 * covered by one rule, and an instructor screen cannot opt into it by
 * accident: it is the address that decides, not the caller.
 */
export async function authFetch(input, init = {}) {
  const token = await getFirebaseIdToken();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }
  if (
    typeof window !== 'undefined' &&
    isLearnerSurface(window.location.pathname) &&
    !headers.has(LEARNER_VIEW_HEADER)
  ) {
    headers.set(LEARNER_VIEW_HEADER, LEARNER_VIEW);
  }
  return fetch(input, { ...init, headers });
}
