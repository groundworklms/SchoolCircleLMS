'use client';

/**
 * Client hooks for the learning API (/api/learning/*). Every request goes
 * through `authFetch`, which attaches the Firebase ID token; the server maps
 * it to a SchoolCircle user and role. Nothing here decides authorization.
 */

import { useCallback, useEffect, useState } from 'react';
import { authFetch } from '../../lib/firebase';

const API_BASE = '/api/learning';

/** The Prisma-backed identity (id, name, ROLE) for the signed-in Firebase user, or null. */
export function useAuthUser() {
  const [user, setUser] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    authFetch('/api/auth/user')
      .then((res) => res.json())
      .then((data) => {
        if (!alive) return;
        setUser(data?.user || null);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setUser(null);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { user, loading };
}

/** GET /api/learning/status: auth, persistence, and arsenal readiness. */
export function useLearningStatus() {
  const [status, setStatus] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    authFetch(`${API_BASE}/status`)
      .then((res) => res.json())
      .then((data) => {
        if (!alive) return;
        setStatus(data);
        setLoading(false);
      })
      .catch((err) => {
        if (!alive) return;
        setError(err);
        setLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);

  return { status, error, loading };
}

/** GET `${API_BASE}${path}`; a non-2xx JSON body becomes `error`. */
export function useApiQuery(path, options) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { enabled = true } = options || {};

  // Clear stale data when the path changes.
  useEffect(() => {
    setData(null);
    setError(null);
  }, [path]);

  const fetcher = useCallback(
    async (signal) => {
      if (!enabled) return;
      setLoading(true);
      setError(null);
      try {
        const res = await authFetch(`${API_BASE}${path}`, {
          headers: { 'Content-Type': 'application/json' },
          signal,
        });
        const json = await res.json();
        if (!res.ok) throw json;
        setData(json);
      } catch (err) {
        if (err?.name === 'AbortError') return;
        setError(err);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [path, enabled],
  );

  useEffect(() => {
    const controller = new AbortController();
    fetcher(controller.signal);
    return () => controller.abort();
  }, [fetcher]);

  return { data, error, loading, refetch: () => fetcher() };
}

/** POST/PUT/DELETE to `${API_BASE}${path}`; rejects with the JSON error body. */
export function useApiMutation(path, method = 'POST') {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mutate = async (payload) => {
    setLoading(true);
    setError(null);
    try {
      const res = await authFetch(`${API_BASE}${path}`, {
        method,
        headers: { 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      let json;
      try {
        json = await res.json();
      } catch {
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return null;
      }
      if (!res.ok) throw json;
      return json;
    } catch (err) {
      setError(err);
      throw err;
    } finally {
      setLoading(false);
    }
  };

  return { mutate, loading, error };
}

/**
 * Browser downloads do not carry the bearer token. Fetch the protected asset
 * first, then hand a blob to the browser.
 */
export async function downloadAuthenticated(path, filename) {
  const response = await authFetch(path);
  if (!response.ok) {
    let detail = `Download failed (${response.status})`;
    try {
      const body = await response.json();
      detail = body?.error || detail;
    } catch {
      // Keep the explicit status error when the server did not return JSON.
    }
    throw new Error(detail);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}
