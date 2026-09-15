'use client';

import { useEffect, useState } from 'react';
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
import { auth, firebaseReady } from '../../lib/firebase';
import { isAllowedEmail, DENIED_MESSAGE } from '../../lib/allowlist';
import { useAuth } from '../_auth/AuthProvider';
import '../landing.css';

export default function LoginPage() {
  const router = useRouter();
  const { user, ready } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  // Already signed in (and allowed) → into the app.
  useEffect(() => {
    if (ready && user && isAllowedEmail(user.email)) router.replace('/prototype');
  }, [ready, user, router]);

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
  async function admit(cred) {
    if (isAllowedEmail(cred.user.email)) return true;
    const isNew = getAdditionalUserInfo(cred)?.isNewUser;
    try {
      if (isNew) await cred.user.delete();
    } catch {
      /* fall through to sign-out */
    }
    await signOut(auth);
    setErr(DENIED_MESSAGE);
    return false;
  }

  async function google() {
    setErr('');
    setBusy(true);
    try {
      const cred = await signInWithPopup(auth, new GoogleAuthProvider());
      if (await admit(cred)) router.replace('/prototype');
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
      const cred =
        mode === 'signup'
          ? await createUserWithEmailAndPassword(auth, email, password)
          : await signInWithEmailAndPassword(auth, email, password);
      if (await admit(cred)) router.replace('/prototype');
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
          <p className="scl-lead">Access the SchoolCircle prototype.</p>

          {!firebaseReady && (
            <div className="scl-note">
              Sign-in isn’t configured on this deployment yet. You can continue straight to the
              prototype for now.
              <div style={{ marginTop: 10 }}>
                <Link href="/prototype" className="scl-btn scl-btn-primary scl-btn-block">
                  Continue to the prototype →
                </Link>
              </div>
            </div>
          )}

          {firebaseReady && (
            <>
              {err && <div className="scl-err">{err}</div>}

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
