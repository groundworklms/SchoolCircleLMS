import { createContext, type ReactNode, useContext, useEffect, useMemo, useState } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { auth, firebaseReady } from '@/lib/firebase';

type AuthState = { user: User | null; loading: boolean; ready: boolean; signOut: () => Promise<boolean> };
const AuthContext = createContext<AuthState>({ user: null, loading: false, ready: false, signOut: async () => false });

export function AuthProvider({ children }: { children: ReactNode }) {
  const [user, setUser] = useState<User | null>(null);
  const [loading, setLoading] = useState(firebaseReady);
  const [authNotice, setAuthNotice] = useState('');
  useEffect(() => {
    if (!auth) { setLoading(false); return; }
    return onAuthStateChanged(auth, (nextUser) => { setUser(nextUser); setLoading(false); }, () => { setAuthNotice('Your session could not be checked. Please refresh and try again.'); setLoading(false); });
  }, []);
  const value = useMemo(() => ({
    user, loading, ready: firebaseReady,
    signOut: async () => {
      if (!auth) return true;
      try { await firebaseSignOut(auth); setUser(null); return true; }
      catch { setAuthNotice('Unable to sign out right now. Please try again.'); return false; }
    },
  }), [user, loading]);
  return <AuthContext.Provider value={value}>{children}{authNotice && <div className="scl-auth-notice" role="alert">{authNotice}<button onClick={() => setAuthNotice('')} aria-label="Dismiss">×</button></div>}</AuthContext.Provider>;
}

export const useAuth = () => useContext(AuthContext);