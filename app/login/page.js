'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import Link from 'next/link';
import {
  GoogleAuthProvider,
  signInWithPopup,
  signInWithEmailAndPassword,
  createUserWithEmailAndPassword,
  getAdditionalUserInfo,
  signOut,
} from 'firebase/auth';
import { authFetch, initializeFirebase } from '../../lib/firebase';
import { isAllowedEmail, DENIED_MESSAGE } from '../../lib/allowlist';
import { useAuth } from '../_auth/AuthProvider';
import '../landing.css';

function safeSameSitePath(value) {
  if (
    typeof value !== 'string' ||
    !value.startsWith('/') ||
    value.startsWith('//') ||
    value.includes('\\') ||
    value.includes('\r') ||
    value.includes('\n')
  ) {
    return null;
  }

  try {
    const parsed = new URL(value, window.location.origin);
    if (parsed.origin !== window.location.origin) return null;
    return `${parsed.pathname}${parsed.search}${parsed.hash}` || '/';
  } catch {
    return null;
  }
}

function rolePath(role) {
  const normalizedRole = String(role || '').toUpperCase();
  if (normalizedRole === 'INSTRUCTOR') return '/teach';
  if (normalizedRole === 'LEARNER') return '/learn';
  throw new Error('Your account does not have an authorized learning role.');
}

export default function LoginPage() {
  const router = useRouter();
  const { user, ready, loading, error: authError } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  const [next, setNext] = useState(null);
  const [nextReady, setNextReady] = useState(false);
  const redirecting = useRef(false);

  // Resolve ?next before any auth redirect can run. Otherwise an initial
  // fallback can win the first effect pass and drop a deep link.
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('next');
    setNext(safeSameSitePath(wanted));
    setNextReady(true);
  }, []);

  async function redirectAuthenticated(firebaseUser) {
    if (!nextReady || redirecting.current || !isAllowedEmail(firebaseUser?.email)) return;
    redirecting.current = true;
    try {
      const response = await authFetch('/api/auth/user', { cache: 'no-store' });
      let payload = null;
      try {
        payload = await response.json();
      } catch {
        /* Keep the explicit auth error below when the server sent no JSON. */
      }
      if (!response.ok) {
        throw new Error(payload?.error || 'Unable to verify your authenticated account.');
      }
      if (!payload?.user) {
        throw new Error('Unable to verify your authenticated account.');
      }
      router.replace(next || rolePath(payload.user.role));
    } catch (cause) {
      redirecting.current = false;
      setErr(cause?.message || 'Unable to verify your authenticated account.');
    }
  }

  // Already signed in (and allowed) → use the server-owned role to choose the
  // learning surface. A safe ?next= remains an explicit deep-link override.
  useEffect(() => {
    if (!ready || loading || !nextReady || !user) return;
    void redirectAuthenticated(user);
  }, [ready, loading, nextReady, user, next]);

  // Bounced here by AuthGuard with a session that isn't on the tester list.
  useEffect(() => {
    if (typeof window !== 'undefined' && new URLSearchParams(window.location.search).has('denied')) {
      setErr(DENIED_MESSAGE);
    }
  }, []);

  /* Allowlist gate for a fresh credential. A brand-new account for an email
     that isn't on the list is deleted straight away (the session is fresh, so
     Firebase allows it) so strangers can't accumulate accounts; an existing
     one is just signed out. Returns true when the user may proceed. */
  async function admit(cred, firebaseAuth) {
    if (isAllowedEmail(cred.user.email)) return true;
    const isNew = getAdditionalUserInfo(cred)?.isNewUser;
    try {
      if (isNew) await cred.user.delete();
    } catch {
      /* fall through to sign-out */
    }
    await signOut(firebaseAuth);
    setErr(DENIED_MESSAGE);
    return false;
  }

  async function google() {
    setErr('');
    setBusy(true);
    try {
      const { auth, firebaseReady } = await initializeFirebase();
      if (!firebaseReady || !auth) throw new Error('Sign-in is not configured on this deployment.');
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      if (await admit(cred, auth)) await redirectAuthenticated(cred.user);
    } catch (e) {
      setErr(e?.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function emailPass(e) {
    e.preventDefault();
    setErr('');
    // Refuse sign-up for an email that isn't on the list before creating anything.
    if (mode === 'signup' && !isAllowedEmail(email)) {
      setErr(DENIED_MESSAGE);
      return;
    }
    setBusy(true);
    try {
      const { auth, firebaseReady } = await initializeFirebase();
      if (!firebaseReady || !auth) throw new Error('Sign-in is not configured on this deployment.');
      const cred =
        mode === 'signup'
          ? await createUserWithEmailAndPassword(auth, email, password)
          : await signInWithEmailAndPassword(auth, email, password);
      if (await admit(cred, auth)) await redirectAuthenticated(cred.user);
    } catch (e2) {
      setErr(e2?.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="scl-page">
      <nav className="scl-nav">
        <Link href="/" className="scl-brand" style={{ textDecoration: 'none', color: 'inherit' }}>
          <span className="scl-mark">S</span> SchoolCircle
        </Link>
      </nav>

      <div className="scl-login-center">
        <div className="scl-card">
          <h1>{mode === 'signup' ? 'Create your account' : 'Sign in'}</h1>
          <p className="scl-lead">Sign in to your SchoolCircle learning workspace.</p>

          {err && <div className="scl-err">{err}</div>}

          {loading && (
            <div className="scl-note">
              Checking the authentication service…
            </div>
          )}

          {!loading && !ready && (
            <div className="scl-note">
              Authentication is unavailable on this deployment. Sign-in is disabled until a
              verified authentication provider is available.
              {authError && (
                <div style={{ marginTop: 8 }}>
                  Please try again later or contact the deployment owner.
                </div>
              )}
            </div>
          )}

          {ready && !loading && nextReady && (
            <>
              <button className="scl-btn scl-btn-google" onClick={google} disabled={busy}>
                Continue with Google
              </button>
              <div className="scl-or">or</div>
              <form onSubmit={emailPass}>
                <div className="scl-field">
                  <label htmlFor="email">Email</label>
                  <input
                    id="email"
                    type="email"
                    autoComplete="email"
                    value={email}
                    onChange={(e) => setEmail(e.target.value)}
                    required
                  />
                </div>
                <div className="scl-field">
                  <label htmlFor="password">Password</label>
                  <input
                    id="password"
                    type="password"
                    autoComplete={mode === 'signup' ? 'new-password' : 'current-password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    required
                  />
                </div>
                <button className="scl-btn scl-btn-primary scl-btn-block" type="submit" disabled={busy}>
                  {busy ? 'Working…' : mode === 'signup' ? 'Create account' : 'Sign in'}
                </button>
              </form>
              <div className="scl-muted-row">
                {mode === 'signup' ? 'Already have an account? ' : 'New here? '}
                <button
                  className="scl-linkbtn"
                  onClick={() => {
                    setErr('');
                    setMode(mode === 'signup' ? 'signin' : 'signup');
                  }}
                >
                  {mode === 'signup' ? 'Sign in' : 'Create an account'}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}