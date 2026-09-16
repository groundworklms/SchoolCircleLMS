// Firebase client initialization.
//
// All values are PUBLIC client config (NEXT_PUBLIC_*), safe to ship to the
// browser — set them in Firebase App Hosting / .env.local. If the config is
// absent or incomplete, `firebaseReady` is false and `auth` is null, and the
// app degrades gracefully: no login is enforced and nobody is locked out.

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

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
 */
export async function authFetch(input, init = {}) {
  const token = await getFirebaseIdToken();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
