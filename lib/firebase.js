// Firebase client initialization.
//
// All values are PUBLIC client config (VITE_FIREBASE_* or NEXT_PUBLIC_FIREBASE_*),
// safe to ship to the browser. The API's public config endpoint is preferred at
// runtime, with Vite env values as a local-build fallback. If the config is
// absent or incomplete, Firebase auth stays disabled and nobody is locked out.

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth, onAuthStateChanged } from 'firebase/auth';

const config = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY,
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN,
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID,
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET,
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID,
  appId: import.meta.env.VITE_FIREBASE_APP_ID,
};

let firebaseConfig = config;

// Minimum needed to actually initialize auth. Runtime config can turn this on
// after the initial module evaluation when env values are not bundled.
export let firebaseReady = Boolean(
  config.apiKey && config.authDomain && config.projectId && config.appId
);

let auth = null;
let authReady = Promise.resolve(null);
let initPromise = null;

function usableConfig(nextConfig) {
  return Boolean(
    nextConfig.apiKey &&
    nextConfig.authDomain &&
    nextConfig.projectId &&
    nextConfig.appId
  );
}

async function runtimeConfig() {
  if (typeof window === 'undefined') return {};
  try {
    const response = await fetch('/api/auth/firebase-config', { cache: 'no-store' });
    if (!response.ok) return {};
    const payload = await response.json();
    if (!payload || typeof payload !== 'object') return {};
    const values = payload.config && typeof payload.config === 'object'
      ? payload.config
      : payload;
    return Object.fromEntries(
      Object.entries(values).filter(([, value]) => typeof value === 'string' && value.trim()),
    );
  } catch {
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
      // Hold API calls until Firebase has restored its persisted session. This
      // prevents the first request after a reload from racing the auth listener.
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

export { auth };

export async function getFirebaseIdToken() {
  await initializeFirebase();
  if (!auth) return null;
  await authReady;
  return auth.currentUser ? auth.currentUser.getIdToken() : null;
}

export async function authFetch(input, init = {}) {
  const token = await getFirebaseIdToken();
  const headers = new Headers(init.headers || {});
  if (token && !headers.has('authorization')) {
    headers.set('authorization', `Bearer ${token}`);
  }
  return fetch(input, { ...init, headers });
}
