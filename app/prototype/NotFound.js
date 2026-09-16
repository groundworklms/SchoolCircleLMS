'use client';

import { useState } from 'react';
import { useAuth } from '../_auth/AuthProvider';

export default function PrototypeNotFound() {
  const { ready, user, signOut } = useAuth();
  const [pending, setPending] = useState(false);
  const [error, setError] = useState('');

  const handleSignOut = async () => {
    if (pending) return;
    setPending(true);
    setError('');
    try {
      await signOut();
      window.location.href = '/';
    } catch {
      setError('Unable to sign out. Please try again.');
    } finally {
      setPending(false);
    }
  };

  return (
    <div className="p-root">
      <main className="p-not-found">
        <h1>Page not found</h1>
        <p>This prototype route does not exist.</p>
        <a className="p-btn ghost" href="/">Go to home</a>
        {ready && user && (
          <button className="p-btn" type="button" disabled={pending} onClick={handleSignOut}>
            {pending ? 'Signing out…' : 'Sign out'}
          </button>
        )}
        {error && <p role="alert">{error}</p>}
      </main>
    </div>
  );
}