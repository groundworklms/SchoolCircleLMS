'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut as fbSignOut } from 'firebase/auth';
import { auth, firebaseReady } from '../../lib/firebase';

const AuthCtx = createContext({
  user: null,
  loading: false,
  ready: false,
  signOut: () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Only "loading" when we actually have Firebase to wait on.
  const [loading, setLoading] = useState(firebaseReady);

  useEffect(() => {
    if (!firebaseReady || !auth) {
      setLoading(false);
      return;
    }
    const unsub = onAuthStateChanged(auth, (u) => {
      setUser(u);
      setLoading(false);
    });
    return () => unsub();
  }, []);

  const signOut = () => {
    if (auth) fbSignOut(auth);
  };

  return (
    <AuthCtx.Provider value={{ user, loading, ready: firebaseReady, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);
