'use client';

import { useEffect } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';

/* Gates a route behind Firebase auth. Critically, if Firebase is NOT configured
   (`ready` false), this is a NO-OP — the app stays fully usable and nobody is
   locked out. Only when auth is actually configured do we require a session. */
export default function AuthGuard({ children }) {
  const { user, loading, ready, signOut } = useAuth();
  const router = useRouter();

  useEffect(() => {
    if (ready && !loading && !user) router.replace('/login');
  }, [ready, loading, user, router]);

  // Auth not configured → let everyone through unchanged.
  if (!ready) return children;

  if (loading) return <div className="scl-fullcenter">Checking your session…</div>;

  if (!user) return null; // redirecting to /login

  return (
    <>
      <div className="scl-authpill">
        <span>{user.displayName || user.email || 'Signed in'}</span>
        <button onClick={signOut}>Sign out</button>
      </div>
      {children}
    </>
  );
}
