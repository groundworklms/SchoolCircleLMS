"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { authFetch } from "../../lib/firebase.js";
import { useAuth } from "../_auth/AuthProvider";

const API_BASE = "/api/learning";
const INVALIDATE = "schoolcircle:learning-changed";

export function useAuthUser() {
  const { user: identity, loading: identityLoading } = useAuth() as { user: { uid: string } | null; loading: boolean };
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    let alive = true;
    setUser(null);
    setLoading(true);
    if (identityLoading) return;
    authFetch("/api/auth/user")
      .then(async (response: Response) => response.ok ? response.json() : null)
      .then((data: any) => {
        if (!alive) return;
        setUser(data?.user || null);
        setLoading(false);
      })
      .catch(() => {
        if (!alive) return;
        setUser(null);
        setLoading(false);
      });
    return () => { alive = false; };
  }, [identity?.uid, identityLoading]);

  return { user, loading };
}

export function useLearningStatus() {
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    authFetch(`${API_BASE}/status`)
      .then((response: Response) => response.json())
      .then((data: any) => {
        setStatus(data);
        setLoading(false);
      })
      .catch((err: any) => {
        setError(err);
        setLoading(false);
      });
  }, []);

  return { status, error, loading };
}

export function useApiQuery<T>(
  path: string,
  options?: { enabled?: boolean },
) {
  const { user: identity, loading: identityLoading } = useAuth() as { user: { uid: string } | null; loading: boolean };
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(options?.enabled ?? true);
  const request = useRef<AbortController | null>(null);
  const enabled = options?.enabled ?? true;

  useEffect(() => {
    setData(null);
    setError(null);
  }, [path, identity?.uid]);

  const fetcher = useCallback(
    async () => {
      request.current?.abort();
      if (!enabled || identityLoading) {
        setLoading(identityLoading && enabled);
        return;
      }
      const controller = new AbortController();
      request.current = controller;
      const { signal } = controller;
      setLoading(true);
      setError(null);
      try {
        const response = await authFetch(`${API_BASE}${path}`, {
          headers: { "Content-Type": "application/json" },
          signal,
        });
        const json = await response.json();
        if (!response.ok) throw { ...json, status: response.status };
        if (signal.aborted) return;
        setData(json as T);
      } catch (err: any) {
        if (signal.aborted || err?.name === "AbortError") return;
        setError(err);
      } finally {
        if (!signal?.aborted) setLoading(false);
      }
    },
    [enabled, path, identity?.uid, identityLoading],
  );

  useEffect(() => {
    void fetcher();
    const refresh = () => { void fetcher(); };
    window.addEventListener("focus", refresh);
    window.addEventListener(INVALIDATE, refresh);
    return () => {
      request.current?.abort();
      window.removeEventListener("focus", refresh);
      window.removeEventListener(INVALIDATE, refresh);
    };
  }, [fetcher]);

  return { data, error, loading, refetch: fetcher };
}

export function useApiMutation<T, Payload = any>(
  path: string,
  method: "POST" | "PUT" | "DELETE" = "POST",
) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);
  const inFlight = useRef(false);

  const mutate = async (payload?: Payload): Promise<T> => {
    if (inFlight.current) throw new Error("A request is already in progress.");
    inFlight.current = true;
    setLoading(true);
    setError(null);
    try {
      const response = await authFetch(`${API_BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: payload === undefined ? undefined : JSON.stringify(payload),
      });
      let json: any;
      try {
        json = await response.json();
      } catch {
        if (!response.ok) throw new Error(`Status ${response.status}`);
        window.dispatchEvent(new Event(INVALIDATE));
        return null as T;
      }
      if (!response.ok) throw { ...json, status: response.status };
      window.dispatchEvent(new Event(INVALIDATE));
      return json as T;
    } catch (err: any) {
      setError(err);
      throw err;
    } finally {
      inFlight.current = false;
      setLoading(false);
    }
  };

  return { mutate, loading, error };
}

/**
 * Browser downloads do not include the Firebase bearer token automatically.
 * Fetch the protected asset first, then hand a blob to the browser.
 */
export async function downloadAuthenticated(path: string, filename: string) {
  const response = await authFetch(path);
  if (!response.ok) {
    let detail = `Download failed (${response.status})`;
    try {
      const body: any = await response.json();
      detail = body?.error || detail;
    } catch {
      // Keep the explicit status error when the server did not return JSON.
    }
    throw new Error(detail);
  }

  const blob = await response.blob();
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = filename;
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 0);
}