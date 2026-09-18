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
import { getPostLoginDestination } from '../_auth/role-destination';
import '../landing.css';

export default function LoginPage() {
  const router = useRouter();
  const {
    user,
    profile,
    profileLoading,
    profileError,
    ready,
    offlineEnabled,
    signInOffline,
    authStalled,
  } = useAuth();
  const [mode, setMode] = useState('signin'); // 'signin' | 'signup'
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');
  // Local operator sign-in, shown only on a deployment built for offline use.
  const [operatorId, setOperatorId] = useState('');
  const [passphrase, setPassphrase] = useState('');
  // Where to land after sign-in. The persisted role chooses the default after
  // the profile request completes; a same-site permitted ?next= wins.
  const [next, setNext] = useState(null);
  const [nextReady, setNextReady] = useState(false);
  useEffect(() => {
    const wanted = new URLSearchParams(window.location.search).get('next');
    if (wanted && wanted.startsWith('/') && !wanted.startsWith('//')) setNext(wanted);
    setNextReady(true);
  }, []);

  // Already signed in (and allowed) → into the role's native app. Do not
  // navigate from Firebase's user callback alone: the profile may still be
  // loading, and the persisted role is the source of truth.
  useEffect(() => {
    // An offline operator is admitted by the server-side roster, not by the
    // email allowlist (see AuthGuard).
    const admitted = user?.offline === true || isAllowedEmail(user?.email);
    if (!nextReady || !ready || !user || !admitted || profileLoading) return;
    if (profileError) {
      setErr(profileError.error || profileError.message || 'Unable to load your account. Please try again.');
      return;
    }
    if (!profile) return;
    router.replace(getPostLoginDestination(profile, next));
  }, [nextReady, ready, user, profile, profileLoading, profileError, router, next]);

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
      await admit(cred);
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
      await admit(cred);
    } catch (e2) {
      setErr(e2?.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  /* Local operator sign-in. The server decides whether this is possible at
     all: without AUTH_MODE=offline and a local signing secret the route this
     posts to answers 404, and the form says so rather than pretending. */
  async function offlineSignIn(e) {
    e.preventDefault();
    setErr('');
    setBusy(true);
    try {
      await signInOffline(operatorId, passphrase);
      setPassphrase('');
    } catch (e3) {
      setErr(e3?.error || e3?.message || 'Offline sign-in failed.');
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

          {!firebaseReady && !offlineEnabled && (
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

          {offlineEnabled && (
            <div data-testid="offline-signin">
              {err && !firebaseReady && <div className="scl-err">{err}</div>}
              <p className="scl-lead">
                This deployment runs disconnected. Sign in with the operator id and passphrase
                issued for this machine.
              </p>
              <form onSubmit={offlineSignIn}>
                <div className="scl-field">
                  <label htmlFor="operator-id">Operator id</label>
                  <input
                    id="operator-id"
                    type="text"
                    autoComplete="username"
                    value={operatorId}
                    onChange={(ev) => setOperatorId(ev.target.value)}
                    required
                  />
                </div>
                <div className="scl-field">
                  <label htmlFor="operator-passphrase">Operator passphrase</label>
                  <input
                    id="operator-passphrase"
                    type="password"
                    autoComplete="current-password"
                    value={passphrase}
                    onChange={(ev) => setPassphrase(ev.target.value)}
                    required
                  />
                </div>
                <button className="scl-btn scl-btn-primary scl-btn-block" type="submit" disabled={busy}>
                  {busy ? 'Working…' : 'Sign in offline'}
                </button>
              </form>
              {firebaseReady && <div className="scl-or">or</div>}
            </div>
          )}

          {firebaseReady && (
            <>
              {/* The SDK never answered, so the app treated this visit as
                  signed out. Said plainly, because the alternative is a
                  visitor with a perfectly good session being silently bounced
                  to a login screen and concluding the product is broken --
                  and because signing in again is the thing that clears it. */}
              {authStalled && !err && (
                <div className="scl-err" role="status">
                  We could not read your sign-in state, so we have brought you here. Signing in again
                  will sort it out.
                </div>
              )}
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
