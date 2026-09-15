import { useState, useEffect, useCallback } from "react";

const API_BASE = "/api/learning";

export function useAuthUser() {
  const [user, setUser] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`/api/auth/user`)
      .then(res => res.json())
      .then(data => {
        setUser(data?.user || null);
        setLoading(false);
      })
      .catch(() => {
        setUser(null);
        setLoading(false);
      });
  }, []);

  return { user, loading };
}

export function useLearningStatus() {
  const [status, setStatus] = useState<any>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    fetch(`${API_BASE}/status`)
      .then((res) => res.json())
      .then((data) => {
        setStatus(data);
        setLoading(false);
      })
      .catch((err) => {
        setError(err);
        setLoading(false);
      });
  }, []);

  return { status, error, loading };
}

export function useApiQuery<T>(path: string, options?: { enabled?: boolean }) {
  const [data, setData] = useState<T | null>(null);
  const [error, setError] = useState<any>(null);
  const [loading, setLoading] = useState(false);
  const { enabled = true } = options || {};

  // Clear stale data when path changes
  useEffect(() => {
    setData(null);
    setError(null);
  }, [path]);

  const fetcher = useCallback(async (signal?: AbortSignal) => {
    if (!enabled) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        headers: { "Content-Type": "application/json" },
        signal
      });
      const json = await res.json();
      if (!res.ok) {
        throw json;
      }
      setData(json);
    } catch (err: any) {
      if (err.name === 'AbortError') return;
      setError(err);
    } finally {
      if (!signal?.aborted) {
        setLoading(false);
      }
    }
  }, [path, enabled]);

  useEffect(() => {
    const controller = new AbortController();
    fetcher(controller.signal);
    return () => controller.abort();
  }, [fetcher]);

  return { data, error, loading, refetch: () => fetcher() };
}

export function useApiMutation<T, Payload = any>(path: string, method: "POST" | "PUT" | "DELETE" = "POST") {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<any>(null);

  const mutate = async (payload?: Payload): Promise<T> => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(`${API_BASE}${path}`, {
        method,
        headers: { "Content-Type": "application/json" },
        body: payload ? JSON.stringify(payload) : undefined,
      });
      let json;
      try {
        json = await res.json();
      } catch (e) {
        if (!res.ok) throw new Error(`Status ${res.status}`);
        return null as T;
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
