'use client';

/**
 * Client hooks for the learning API (/api/learning/*). Every request goes
 * through `authFetch`, which attaches the Firebase ID token; the server maps
 * it to a SchoolCircle user and role. Nothing here decides authorization.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { authFetch } from '../../lib/firebase';

const API_BASE = '/api/learning';

/**
 * Two mounted queries for the identical endpoint -- a lesson's reader and the
 * tutor rail both need the same course envelope -- used to fire two identical
 * GETs, because each `useApiQuery` owned its own network call with no idea
 * the other existed. This shares one in-flight request per URL across
 * whichever hook instances ask for it at the same time, and is cleared as
 * soon as it settles so the next render's fetch is never served stale data.
 *
 * A deliberate revalidation (`refetch`, a focus/visibility return) does not
 * go through this map: it bypasses it entirely via `fetchJson`, because the
 * caller there is asking on purpose and must get its own round trip rather
 * than whatever another mount happened to kick off first.
 */
const inFlightMounts = new Map();

async function fetchJson(url) {
  const res = await authFetch(url, { headers: { 'Content-Type': 'application/json' } });
  const json = await res.json();
  if (!res.ok) throw json;
  return json;
}

function dedupedFetch(url) {
  const existing = inFlightMounts.get(url);
  if (existing) return existing;
  const request = fetchJson(url);
  inFlightMounts.set(url, request);
  request.finally(() => {
    if (inFlightMounts.get(url) === request) inFlightMounts.delete(url);
  });
  return request;
}

/** GET `${API_BASE}${path}`; a non-2xx JSON body becomes `error`. */
export function useApiQuery(path, options) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(false);
  const { enabled = true, refreshOnFocus = false } = options || {};
  const mountedRef = useRef(false);
  const requestIdRef = useRef(0);
  const focusRequestRef = useRef(null);
  const pathRef = useRef(path);
  const enabledRef = useRef(enabled);
  pathRef.current = path;
  enabledRef.current = enabled;

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      requestIdRef.current += 1;
      focusRequestRef.current = null;
    };
  }, []);

  // Clear stale data when the path changes.
  useEffect(() => {
    setData(null);
    setError(null);
  }, [path]);

  const fetcher = useCallback(
    async ({ dedupe = true } = {}) => {
      if (
        !enabled
        || !enabledRef.current
        || pathRef.current !== path
        || !mountedRef.current
      ) return undefined;
      const requestId = ++requestIdRef.current;
      const isCurrent = () => (
        mountedRef.current
        && enabledRef.current
        && pathRef.current === path
        && requestIdRef.current === requestId
      );
      setLoading(true);
      setError(null);
      try {
        const url = `${API_BASE}${path}`;
        const json = await (dedupe ? dedupedFetch(url) : fetchJson(url));
        if (!isCurrent()) return undefined;
        setData(json);
        return json;
      } catch (err) {
        if (!isCurrent()) return;
        setError(err);
      } finally {
        if (isCurrent()) setLoading(false);
      }
    },
    [path, enabled],
  );

  useEffect(() => {
    if (!enabled) {
      setLoading(false);
      return undefined;
    }
    fetcher();
    return () => {
      // A stale response is invalidated by requestId rather than by
      // cancelling the network call: the mount fetch above may be shared
      // with another query for the same path (see dedupedFetch), and
      // cancelling it out from under that sibling would break its load too.
      requestIdRef.current += 1;
    };
  }, [fetcher]);

  useEffect(() => {
    if (
      !refreshOnFocus
      || !enabled
      || typeof window === 'undefined'
      || typeof document === 'undefined'
    ) return undefined;

    const refresh = () => {
      if (document.visibilityState === 'hidden' || focusRequestRef.current) return;
      // Focus and visibilitychange/pageshow are often emitted together when a
      // tab returns. Keep that one return trip to a single request.
      const request = Promise.resolve(fetcher());
      focusRequestRef.current = request;
      request.finally(() => {
        if (focusRequestRef.current === request) focusRequestRef.current = null;
      });
    };
    window.addEventListener('focus', refresh);
    window.addEventListener('pageshow', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      window.removeEventListener('focus', refresh);
      window.removeEventListener('pageshow', refresh);
      document.removeEventListener('visibilitychange', refresh);
      focusRequestRef.current = null;
    };
  }, [enabled, fetcher, refreshOnFocus]);

  return {
    data,
    error,
    loading,
    // A caller asking to refetch means now, for real -- never the request
    // some other mounted query happened to already have in flight.
    refetch: useCallback(() => fetcher({ dedupe: false }), [fetcher]),
  };
}

/** POST/PUT/DELETE to `${API_BASE}${path}`; rejects with the JSON error body. */
export function useApiMutation(path, method = 'POST') {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const mutate = async (payload) => {
    setLoading(true);
    setError(null);
    try {
      const isFormData = typeof FormData !== 'undefined' && payload instanceof FormData;
      const res = await authFetch(`${API_BASE}${path}`, {
        method,
        ...(isFormData ? {} : { headers: { 'Content-Type': 'application/json' } }),
        body: payload ? (isFormData ? payload : JSON.stringify(payload)) : undefined,
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
/**
 * POST to an NDJSON endpoint and hand each line to `onEvent` as it arrives.
 *
 * Course generation is a minute or more of model calls. A spinner over that
 * tells an instructor nothing and hides the reason when a section refuses, so
 * the draft route has a streaming twin that reports every artifact as it lands.
 *
 * Deliberately fetch + a stream reader rather than EventSource: EventSource
 * cannot attach the Authorization header these routes require.
 */
export function useApiStream(path) {
  const [loading, setLoading] = useState(false);

  const start = async (payload, onEvent) => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      if (!res.ok || !res.body) {
        // A failure before the stream opens is an ordinary JSON error body.
        let json = null;
        try { json = await res.json(); } catch {}
        throw json || new Error(`Status ${res.status}`);
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buffer = '';
      let last = null;
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        buffer += decoder.decode(value, { stream: true });
        // A chunk can split a line, and can carry several.
        const lines = buffer.split('\n');
        buffer = lines.pop() ?? '';
        for (const line of lines) {
          if (!line.trim()) continue;
          let event;
          try { event = JSON.parse(line); } catch { continue; }
          last = event;
          onEvent(event);
        }
      }
      if (buffer.trim()) {
        try {
          const event = JSON.parse(buffer);
          last = event;
          onEvent(event);
        } catch {}
      }
      return last;
    } finally {
      setLoading(false);
    }
  };

  return { start, loading };
}

/**
 * Start a course generation as a job and follow it by polling.
 *
 * The streaming hook above cannot be used for this any more. It holds one
 * response open for the length of the generation, and Cloud Run cuts a response
 * at 300 seconds however much data is still flowing -- so every course longer
 * than five or six sections lost its report, and the generation with it. The
 * POST here returns as soon as the job row exists, and progress is read from
 * short requests that cannot be cut.
 *
 * The polling is doing two jobs. It is how this screen learns what has been
 * written, and it is what keeps the server instance handling requests, which is
 * what keeps the detached generation running. Stopping the poll does not lose
 * the job -- it is a row, and `GET /job` finds it again -- but it can stall it,
 * so the loop keeps going until the job reports an outcome.
 *
 * `onEvent` is given every event exactly once, in order, so the same reducer
 * that rendered the stream renders this unchanged.
 */
export function useCourseJob(path = '/courses/draft/job') {
  const [loading, setLoading] = useState(false);

  const start = async (payload, onEvent, { pollMs = 2500, signal } = {}) => {
    setLoading(true);
    try {
      const res = await authFetch(`${API_BASE}${path}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      });
      let json = null;
      try { json = await res.json(); } catch {}
      if (!res.ok) throw json || new Error(`Status ${res.status}`);
      const id = json?.id;
      if (!id) throw new Error('The server did not return a generation job.');
      return await follow(id, onEvent, { pollMs, signal });
    } finally {
      setLoading(false);
    }
  };

  /**
   * Follow a job that already exists -- one this tab started, or one found by
   * `GET /job` after a reload.
   *
   * `seen` is a count rather than a set of ids: the events are an append-only
   * list on the row, so everything past the count is new and nothing needs
   * identifying. That is also what makes a re-attach cheap, since the whole
   * list arrives and only the tail is replayed.
   */
  const follow = async (id, onEvent, { pollMs = 2500, signal } = {}) => {
    let seen = 0;
    for (;;) {
      if (signal?.aborted) return null;
      const res = await authFetch(`${API_BASE}${path}/${encodeURIComponent(id)}`);
      let json = null;
      try { json = await res.json(); } catch {}
      if (!res.ok) throw json || new Error(`Status ${res.status}`);

      const events = Array.isArray(json?.events) ? json.events : [];
      for (const event of events.slice(seen)) onEvent(event);
      seen = events.length;

      if (json?.status === 'DONE') {
        // Shaped like the stream's last event, so callers that already knew
        // what a finished generation looks like do not learn a second shape.
        return { phase: 'saved', status: 'PENDING', record: json.record || null, jobId: id };
      }
      if (json?.status === 'FAILED') {
        return { phase: 'failed', error: json.error, code: json.code, jobId: id };
      }
      if (json?.stale) {
        // RUNNING, but nothing has touched the row in minutes. The instance
        // that owned it is gone -- a deploy is the way this happens -- and
        // waiting longer only looks like progress.
        return { phase: 'stalled', jobId: id };
      }
      await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
  };

  return { start, follow, loading };
}

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
