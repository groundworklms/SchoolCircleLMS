'use client';

import Link from 'next/link';
import { useAuth } from '../_auth/AuthProvider';
import AccountProfile from '../_auth/AccountProfile';
import AccountRecovery from '../_auth/AccountRecovery';
import { useLearningStatus } from './useLearning';

/* Gates the Learn / Teach apps. Unlike the prototype's AuthGuard (a no-op when
   Firebase is unconfigured), the learning API cannot work without a verified
   identity, so this explains why rather than silently rendering an empty app:
     - Firebase not configured  -> "not configured on this deployment"
     - not signed in            -> link to /login (returns here afterwards)
     - signed in, wrong role    -> instructor-only notice (Teach)
   `children` is a render function receiving the Prisma-backed user. */
export default function LearningGate({ returnTo, requireInstructor = false, children }) {
  const {
    loading: firebaseLoading,
    profile: user,
    profileLoading: userLoading,
    profileError: userError,
    refreshProfile,
  } = useAuth();
  const {
    status,
    error: statusError,
    loading: statusLoading,
    refetch: retryStatus,
  } = useLearningStatus();

  if (firebaseLoading || statusLoading || userLoading) {
    return <div className="s-root" style={{ padding: '2rem' }}>Loading…</div>;
  }

  if (userError) {
    return <AccountRecovery error={userError} onRetry={refreshProfile} returnTo={returnTo} />;
  }

  if (statusError) {
    return (
      <Notice title="Learning tools unavailable">
        <p>{statusError.error || statusError.message || 'We could not check learning access.'}</p>
        <button type="button" className="p-btn" style={{ width: 'max-content' }} onClick={retryStatus}>
          Try again
        </button>
      </Notice>
    );
  }

  if (!status?.auth?.ready || !user) {
    return (
      <Notice title="Sign-in required">
        <p>{status?.auth?.reason || 'Sign in to use the learning tools.'}</p>
        {status?.auth?.ready && (
          <Link href={`/login?next=${encodeURIComponent(returnTo)}`} className="p-btn" style={{ width: 'max-content' }}>
            Sign in
          </Link>
        )}
      </Notice>
    );
  }

  if (!user.profileCompletedAt) {
    return <AccountProfile onboarding />;
  }

  if (requireInstructor && user.role !== 'INSTRUCTOR') {
    return (
      <Notice title="Instructor access required">
        <p>You are signed in as a learner. This area is restricted to instructors.</p>
        <Link href="/learn" className="p-btn" style={{ width: 'max-content' }}>Go to the learner app</Link>
      </Notice>
    );
  }

  return children(user);
}

function Notice({ title, children }) {
  return (
    <div className="s-root" style={{ padding: '2rem', display: 'flex', flexDirection: 'column', gap: '1rem' }}>
      <h2>{title}</h2>
      {children}
    </div>
  );
}
