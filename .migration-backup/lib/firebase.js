// Firebase client initialization.
//
// All values are PUBLIC client config (NEXT_PUBLIC_*), safe to ship to the
// browser — set them in Firebase App Hosting / .env.local. If the config is
// absent or incomplete, `firebaseReady` is false and `auth` is null, and the
// app degrades gracefully: no login is enforced and nobody is locked out.

import { initializeApp, getApps, getApp } from 'firebase/app';
import { getAuth } from 'firebase/auth';

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

// Only initialize in the browser (auth is client-only) and only when configured.
if (firebaseReady && typeof window !== 'undefined') {
  const app = getApps().length ? getApp() : initializeApp(config);
  auth = getAuth(app);
}

export { auth };
