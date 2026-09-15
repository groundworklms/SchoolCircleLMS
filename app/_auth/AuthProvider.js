'use client';

import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { initializeFirebase, signOutOfSchoolCircle } from '../../lib/firebase';

const AuthCtx = createContext({
  user: null,
  loading: false,
  ready: false,
  error: null,
  signOut: () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState(null);

  useEffect(() => {
    let unsub;
    let alive = true;

    const fail = (cause) => {
      if (!alive) return;
      setUser(null);
      setReady(false);
      setError(cause instanceof Error ? cause : new Error('Firebase could not be initialized.'));
      setLoading(false);
    };

    initializeFirebase()
      .then(({ auth, firebaseReady }) => {
        if (!alive) return;
        setReady(firebaseReady);
        if (!firebaseReady || !auth) {
          setLoading(false);
          return;
        }
        try {
          unsub = onAuthStateChanged(
            auth,
            (nextUser) => {
              if (!alive) return;
              setUser(nextUser);
              setLoading(false);
            },
            fail,
          );
        } catch (cause) {
          fail(cause);
        }
      })
      .catch(fail);

    return () => {
      alive = false;
      unsub?.();
    };
  }, []);

  const signOut = signOutOfSchoolCircle;

  return (
    <AuthCtx.Provider value={{ user, loading, ready, error, signOut }}>
      {children}
    </AuthCtx.Provider>
  );
}

export const useAuth = () => useContext(AuthCtx);