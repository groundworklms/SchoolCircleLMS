import { type ReactNode, useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from './AuthProvider';

export default function AuthGuard({ children }: { children: ReactNode }) {
  const { user, loading, ready, signOut } = useAuth();
  const [, navigate] = useLocation();
  useEffect(() => { if (ready && !loading && !user) navigate('/login', { replace: true }); }, [ready, loading, user, navigate]);
  if (!ready) return <>{children}</>;
  if (loading) return <div className="scl-fullcenter">Checking your session…</div>;
  if (!user) return null;
  async function handleSignOut() { await signOut(); }
  return <><div className="scl-authpill"><span>{user.displayName || user.email || 'Signed in'}</span><button onClick={() => { void handleSignOut(); }}>Sign out</button></div>{children}</>;
}