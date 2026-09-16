'use client';

import { authenticatedFetch } from '../../../lib/auth-fetch.js';

export const LIBRARY_API = '/api/authoring/library';

export function messageForError(error, fallback = 'Something went wrong. Please try again.') {
  if (!error) return fallback;
  return error.error || error.message || fallback;
}

async function responseBody(response) {
  try {
    return await response.json();
  } catch {
    return null;
  }
}

/**
 * Keep the auth transport injectable. Browser requests use the repository's
 * authenticatedFetch (and the Firebase user from useAuth); browser tests can
 * provide a request function without creating Firebase credentials.
 */
export async function requestAuthoring(path, options = {}, user, request = authenticatedFetch) {
  if (!user) throw new Error('Sign in to view the course library.');
  const headers = new Headers(options.headers || {});
  if (!headers.has('Content-Type') && options.body) headers.set('Content-Type', 'application/json');
  const response = await request(`${LIBRARY_API}${path}`, {
    ...options,
    cache: 'no-store',
    headers,
  }, user);
  const body = await responseBody(response);
  if (!response.ok) {
    const error = new Error(body?.error || body?.message || `Request failed (${response.status})`);
    error.status = response.status;
    if (body?.code) error.code = body.code;
    error.error = body?.error || body?.message || error.message;
    throw error;
  }
  return body;
}

export function createLibraryTransport({ user, request = authenticatedFetch } = {}) {
  return {
    library(signal) {
      return requestAuthoring('', { signal }, user, request);
    },
    course(courseId, releaseId, signal) {
      const query = releaseId ? `?releaseId=${encodeURIComponent(releaseId)}` : '';
      return requestAuthoring(`/${encodeURIComponent(courseId)}${query}`, { signal }, user, request);
    },
    answer(courseId, payload) {
      return requestAuthoring(`/${encodeURIComponent(courseId)}/attempts`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }, user, request);
    },
    complete(courseId, payload) {
      return requestAuthoring(`/${encodeURIComponent(courseId)}/progress`, {
        method: 'POST',
        body: JSON.stringify(payload),
      }, user, request);
    },
  };
}

function createAttemptId() {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') return crypto.randomUUID();
  return `attempt-${Date.now()}-${Math.random().toString(36).slice(2)}`;
}

/**
 * Idempotency is per block and selected option. A failed network call does
 * not clear the entry, so a retry of that answer carries the exact same key.
 * Choosing a different option intentionally gets a new key.
 */
export function createStableAttemptManager(send, idFactory = createAttemptId) {
  const attempts = new Map();
  return (blockId, optionId, suppliedAttemptId) => {
    const previous = attempts.get(blockId);
    const attemptId = suppliedAttemptId || (previous?.optionId === optionId ? previous.attemptId : idFactory());
    attempts.set(blockId, { optionId, attemptId });
    return send(blockId, optionId, attemptId);
  };
}

/**
 * A mutation captures the epoch before it starts. Updating the key when the
 * Firebase account, course, or pinned release changes makes an old response
 * reject instead of publishing state into the new reader.
 */
export function createSessionEpochGuard() {
  let currentKey = Symbol('initial-session');
  let epoch = 0;
  return {
    update(key) {
      if (key !== currentKey) {
        currentKey = key;
        epoch += 1;
      }
      return epoch;
    },
    capture() {
      return epoch;
    },
    isCurrent(token) {
      return token === epoch;
    },
  };
}

export function createStaleSessionError() {
  const error = new Error('This save belongs to an earlier account or course session.');
  error.code = 'STALE_SESSION';
  error.stale = true;
  return error;
}

export function createTransportError(message, status) {
  const error = new Error(message);
  error.error = message;
  if (status !== undefined) error.status = status;
  return error;
}