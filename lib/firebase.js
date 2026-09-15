// Firebase client initialization for the Next runtime.
//
// Firebase web configuration is public, but the deployment keeps the canonical
// values in its existing VITE_* environment variables. The browser deliberately
// does not read those names: the Next route at /api/auth/firebase-config maps
// them to this public shape at runtime. NEXT_PUBLIC_* values remain a safe local
// build-time fallback.

import { getApp, getApps, initializeApp } from 'firebase/app';
import { getAuth, onAuthStateChanged, signOut } from 'firebase/auth';

const config = {
  apiKey: process.env.NEXT_PUBLIC_FIREBASE_API_KEY,
  authDomain: process.env.NEXT_PUBLIC_FIREBASE_AUTH_DOMAIN,
  projectId: process.env.NEXT_PUBLIC_FIREBASE_PROJECT_ID,
  storageBucket: process.env.NEXT_PUBLIC_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: process.env.NEXT_PUBLIC_FIREBASE_MESSAGING_SENDER_ID,
  appId: process.env.NEXT_PUBLIC_FIREBASE_APP_ID,
};

let firebaseConfig = config;
export let firebaseReady = usableConfig(config);
export let auth = null;

let authReady = Promise.resolve(null);
let initPromise = null;

function usableConfig(nextConfig) {
  return Boolean(
    nextConfig?.apiKey &&
      nextConfig?.authDomain &&
      nextConfig?.projectId &&
      nextConfig?.appId,
  );
}

async function runtimeConfig() {
  if (typeof window === 'undefined') return {};
  try {
    const response = await fetch('/api/auth/firebase-config', { cache: 'no-store' });
    if (!response.ok) return {};
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') return {};
    const values =
      payload.config && typeof payload.config === 'object' ? payload.config : payload;
    return Object.fromEntries(
      Object.entries(values).filter(
        ([, value]) => typeof value === 'string' && value.trim(),
      ),
    );
  } catch {
    // Authentication remains explicitly unavailable when no public config has
    // been published; callers must not manufacture a session client-side.
    return {};
  }
}

export async function initializeFirebase() {
  if (initPromise) return initPromise;

  initPromise = (async () => {
    const publicConfig = await runtimeConfig();
    firebaseConfig = { ...config, ...publicConfig };
    firebaseReady = usableConfig(firebaseConfig);

    if (firebaseReady && typeof window !== 'undefined') {
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      auth = getAuth(app);
      // Hold API calls until Firebase restores its persisted session. This
      // prevents the first request after a reload racing the auth listener.
      authReady = new Promise((resolve) => {
        let unsubscribe;
        unsubscribe = onAuthStateChanged(auth, (user) => {
          unsubscribe?.();
          resolve(user);
        });
      });
    }

    return { auth, firebaseReady };
  })();

  return initPromise;
}

export async function getFirebaseIdToken() {
  await initializeFirebase();
  if (!auth) return null;
  await authReady;
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

/** Fetch with the verified Firebase bearer token, when a session exists. */
export async function authFetch(input, init = {}) {
  const token = await getFirebaseIdToken();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}

/** Clear both supported sessions; a Firebase token must not survive UI logout. */
export async function signOutOfSchoolCircle() {
  const { auth } = await initializeFirebase();
  if (auth) await signOut(auth);
  window.location.assign('/api/logout?returnTo=/');
}