import { createContext, useContext, useEffect, useState } from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut } from 'firebase/auth';
import { auth, firebaseReady, initializeFirebase } from '../../../../lib/firebase.js';

const AuthContext = createContext({
  user: null,
  loading: false,
  ready: false,
  signOut: () => {},
});

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null);
  // Only wait when Firebase is configured. An unconfigured deployment remains
  // usable so Replit login can continue to be introduced incrementally.
  const [ready, setReady] = useState(firebaseReady);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let unsubscribe;
    let disposed = false;

    initializeFirebase().then(({ firebaseReady: configured }) => {
      if (disposed) return;
      setReady(configured);
      if (!configured || !auth) {
        setLoading(false);
        return;
      }

      unsubscribe = onAuthStateChanged(auth, (nextUser) => {
        setUser(nextUser);
        setLoading(false);
      });
    });

    return () => {
      disposed = true;
      unsubscribe?.();
    };
  }, []);

  function signOut() {
    if (auth) void firebaseSignOut(auth);
  }

  return (
    <AuthContext.Provider value={{ user, loading, ready, signOut }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  return useContext(AuthContext);
}