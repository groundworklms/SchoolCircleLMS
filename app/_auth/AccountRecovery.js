'use client';

import { useState } from 'react';
import '../prototype/student.css';
import { useAuth } from './AuthProvider';
import { signOutAndNavigateToLogin } from './account-recovery';

function errorMessage(error) {
  return error?.error || error?.message || 'The account service is unavailable.';
}

/**
 * Recovery actions are shared by the authenticated prototype gate and the
 * learning gate. Retry keeps the current Firebase session; sign-in again
 * deliberately offers a clean reauthentication path when that session/token
 * is the problem.
 */
export default function AccountRecovery({ error, onRetry, returnTo = '/prototype' }) {
  const { signOut, signOutError } = useAuth();
  const [signingOut, setSigningOut] = useState(false);
  const [signOutMessage, setSignOutMessage] = useState(null);

  const handleSignOut = async (reauthenticate = false) => {
    setSignOutMessage(null);
    setSigningOut(true);
    try {
      if (reauthenticate) {
        await signOutAndNavigateToLogin({
          signOut,
          navigate: (destination) => window.location.assign(destination),
          returnTo,
        });
      } else {
        await signOut();
      }
    } catch (signOutErrorValue) {
      setSignOutMessage(errorMessage(signOutErrorValue));
    } finally {
      setSigningOut(false);
    }
  };

  return (
    <div className="s-root s-account-recovery" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h2>We could not load your account</h2>
      <p>{errorMessage(error)}</p>
      {(signOutMessage || signOutError) && (
        <p role="alert" className="s-profile-editor-error">
          {signOutMessage || errorMessage(signOutError)}
        </p>
      )}
      <div className="p-btnrow">
        <button type="button" className="p-btn" style={{ width: 'max-content' }} onClick={onRetry}>
          Try again
        </button>
        <button type="button" className="p-btn ghost" onClick={() => handleSignOut()} disabled={signingOut}>
          {signingOut ? 'Signing out…' : 'Sign out'}
        </button>
        <button
          type="button"
          onClick={() => handleSignOut(true)}
          disabled={signingOut}
          className="p-btn ghost"
          style={{ width: 'max-content' }}
        >
          Sign in again
        </button>
      </div>
    </div>
  );
}