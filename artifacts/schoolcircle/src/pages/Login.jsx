import { useEffect, useState } from 'react';
import { GoogleAuthProvider, signInWithEmailAndPassword, signInWithPopup, createUserWithEmailAndPassword } from 'firebase/auth';
import { Link, useLocation } from 'wouter';
import { auth } from '../../../../lib/firebase.js';
import { useAuth } from '../auth/AuthProvider';
import '../landing.css';

export default function LoginPage() {
  const [, setLocation] = useLocation();
  const { user, loading, ready } = useAuth();
  const [mode, setMode] = useState('signin');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState('');

  useEffect(() => {
    if (ready && !loading && user) setLocation('/prototype', { replace: true });
  }, [ready, loading, user, setLocation]);

  async function google() {
    if (!auth) return;
    setErr('');
    setBusy(true);
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
      setLocation('/prototype', { replace: true });
    } catch (error) {
      setErr(error?.message || 'Sign-in failed.');
    } finally {
      setBusy(false);
    }
  }

  async function emailPass(event) {
    event.preventDefault();
    if (!auth) return;
    setErr('');
    setBusy(true);
    try {
      if (mode === 'signup') {
        await createUserWithEmailAndPassword(auth, email, password);
      } else {
        await signInWithEmailAndPassword(auth, email, password);
      }
      setLocation('/prototype', { replace: true });
    } catch (error) {
      setErr(error?.message || 'Sign-in failed.');
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

          {loading && <p className="scl-lead">Checking sign-in configuration…</p>}

          {!ready && !loading && (
            <div className="scl-note">
              Sign-in isn’t configured on this deployment yet. You can continue straight to the
              prototype for now.
              <div style={{ marginTop: 10 }}>
                <Link href="/prototype" className="scl-btn scl-btn-primary scl-btn-block">
                  Continue to the prototype →
                </Link>
              </div>
              <div style={{ marginTop: 10, textAlign: 'center' }}>
                <a href="/api/login?returnTo=/prototype" className="scl-linkbtn">
                  Sign in with Replit
                </a>
              </div>
            </div>
          )}

          {ready && !loading && (
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
                    onChange={(event) => setEmail(event.target.value)}
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
                    onChange={(event) => setPassword(event.target.value)}
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