'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useId, useMemo } from 'react';
import { authenticatedFetch } from '../../lib/auth-fetch';
import { useAuth } from '../_auth/AuthProvider';

/*
 * Transport, access control, and small form primitives shared by the course
 * list, lesson list, block editors, and main editor.
 */
export async function requestJson(request, path, options = {}) {
  const result = await request(path, options);
  if (result && typeof result.json === 'function') {
    let body = null;
    try {
      body = await result.json();
    } catch {
      body = null;
    }
    if (!result.ok) throw apiError(body, result.status);
    if (body == null) throw apiError(null, 502, 'The authoring service returned an empty response.');
    return body;
  }
  if (result && result.ok === false) {
    throw apiError(result, result.status);
  }
  if (result == null) throw apiError(null, 502, 'The authoring service returned an empty response.');
  return result;
}

export function apiError(body, status, fallback = 'The authoring request failed.') {
  const message = body?.error || body?.message || fallback;
  const error = new Error(message);
  error.error = message;
  error.status = status;
  error.code = body?.code;
  return error;
}

export function authoringRequest(expectedUser) {
  return (path, options = {}) => authenticatedFetch(path, options, expectedUser);
}

export function errorMessage(error, fallback = 'Something went wrong. Your edits are still here.') {
  if (error?.status === 409 || error?.code === 'VERSION_CONFLICT') {
    return 'This draft changed elsewhere. Your edits remain here; reload only after you have copied or resolved them.';
  }
  return error?.error || error?.message || fallback;
}

export function useAuthoringRequest(requestProp) {
  const { user } = useAuth();
  return useMemo(() => requestProp || authoringRequest(user), [requestProp, user]);
}

function useInstructorAccess() {
  const {
    user,
    profile,
    loading,
    ready,
    profileLoading,
    profileError,
    refreshProfile,
  } = useAuth();

  if (!ready) {
    return {
      state: 'blocked',
      title: 'Instructor sign-in is unavailable',
      message: 'Authentication is not configured on this deployment. Sign in is required for course authoring.',
    };
  }
  if (loading || profileLoading) return { state: 'loading' };
  if (!user) return { state: 'blocked', title: 'Sign-in required', message: 'Sign in to author and manage courses.' };
  if (profileError) return { state: 'error', error: profileError, retry: refreshProfile };
  if (!profile) {
    return {
      state: 'error',
      error: new Error('Your account profile is unavailable.'),
      retry: refreshProfile,
    };
  }
  if (!['INSTRUCTOR', 'BOTH'].includes(profile.role)) {
    return {
      state: 'blocked',
      title: 'Instructor access required',
      message: 'This area is limited to instructor and student/instructor profiles.',
    };
  }
  return { state: 'ready', user, profile };
}

export function InstructorAccess({ children }) {
  const access = useInstructorAccess();
  const router = useRouter();

  if (access.state === 'loading') {
    return <div className="authoring-access"><p>Checking instructor access…</p></div>;
  }
  if (access.state === 'error') {
    return (
      <div className="authoring-access">
        <h1>We could not load your account</h1>
        <p role="alert">{errorMessage(access.error, 'Account service unavailable.')}</p>
        <button type="button" className="authoring-btn" onClick={() => access.retry?.()}>Try again</button>
      </div>
    );
  }
  if (access.state !== 'ready') {
    return (
      <div className="authoring-access">
        <h1>{access.title}</h1>
        <p>{access.message}</p>
        <div className="authoring-actions">
          <Link className="authoring-btn" href="/login?next=%2Fteach%2Fcourses">Sign in</Link>
          <button type="button" className="authoring-btn ghost" onClick={() => router.push('/teach')}>Back to teaching</button>
        </div>
      </div>
    );
  }
  return children;
}

export function TextField({ label, value, onChange, disabled, id, multiline = false, hint, ...props }) {
  const generatedId = useId();
  const fieldId = id || generatedId;
  return (
    <label className="authoring-field" htmlFor={fieldId}>
      <span>{label}</span>
      {multiline ? (
        <textarea id={fieldId} value={value ?? ''} onChange={(event) => onChange(event.target.value)} disabled={disabled} {...props} />
      ) : (
        <input id={fieldId} value={value ?? ''} onChange={(event) => onChange(event.target.value)} disabled={disabled} {...props} />
      )}
      {hint && <small>{hint}</small>}
    </label>
  );
}

export function IconButton({ label, onClick, disabled, children, danger = false }) {
  return (
    <button
      type="button"
      className={`authoring-icon-btn${danger ? ' danger' : ''}`}
      aria-label={label}
      title={label}
      onClick={onClick}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

export function ArrayControls({ index, length, onMove, onDuplicate, onDelete, disabled }) {
  return (
    <div className="authoring-array-controls" aria-label="Item controls">
      <IconButton label="Move up" onClick={() => onMove(-1)} disabled={disabled || index === 0}>↑</IconButton>
      <IconButton label="Move down" onClick={() => onMove(1)} disabled={disabled || index === length - 1}>↓</IconButton>
      <IconButton label="Duplicate item" onClick={onDuplicate} disabled={disabled}>＋</IconButton>
      <IconButton label="Delete item" onClick={onDelete} disabled={disabled} danger>×</IconButton>
    </div>
  );
}

export function StatusPill({ status }) {
  return <span className={`authoring-status ${String(status || 'DRAFT').toLowerCase()}`}>{status || 'DRAFT'}</span>;
}

export function LoadingError({ loading, error, onRetry, children }) {
  if (loading) return <div className="authoring-state"><p>Loading…</p></div>;
  if (error) {
    return (
      <div className="authoring-state authoring-error-state">
        <p role="alert">{errorMessage(error, 'Unable to load this authoring data.')}</p>
        <button type="button" className="authoring-btn" onClick={onRetry}>Try again</button>
      </div>
    );
  }
  return children;
}
