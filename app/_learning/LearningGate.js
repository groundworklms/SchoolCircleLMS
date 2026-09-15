'use client';

import Link from 'next/link';
import { useAuth } from '../_auth/AuthProvider';
import { useAuthUser, useLearningStatus } from './useLearning';

/* Gates the Learn / Teach apps. Unlike the prototype's AuthGuard (a no-op when
   Firebase is unconfigured), the learning API cannot work without a verified
   identity, so this explains why rather than silently rendering an empty app:
     - Firebase not configured  -> "not configured on this deployment"
     - not signed in            -> link to /login (returns here afterwards)
     - signed in, wrong role    -> instructor-only notice (Teach)
   `children` is a render function receiving the Prisma-backed user. */
export default function LearningGate({ returnTo, requireInstructor = false, children }) {
  const { loading: firebaseLoading } = useAuth();
  const { user, loading: userLoading } = useAuthUser();
  const { status, loading: statusLoading } = useLearningStatus();

  if (firebaseLoading || statusLoading || userLoading) {
    return <div className="s-root" style={{ padding: '2rem' }}>Loading…</div>;
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
