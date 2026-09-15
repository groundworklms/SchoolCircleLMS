import { useEffect } from 'react';
import { useLocation } from 'wouter';
import { useAuth } from './AuthProvider';

/*
 * Gate the prototype only when Firebase is configured. This mirrors the
 * upstream guard: an incomplete public Firebase configuration must not lock
 * out a deployment, while configured live routes remain fail-closed.
 */
export default function AuthGuard({ children }) {
  const { user, loading, ready, signOut } = useAuth();
  const [, setLocation] = useLocation();

  useEffect(() => {
    if (ready && !loading && !user) {
      setLocation('/login', { replace: true });
    }
  }, [ready, loading, user, setLocation]);

  if (!ready) return children;
  if (loading) return <div className="scl-fullcenter">Checking your session…</div>;
  if (!user) return null;

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