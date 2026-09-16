'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { useAuth } from './AuthProvider';
import AccountProfile from './AccountProfile';
import AccountRecovery from './AccountRecovery';
import { isAllowedEmail } from '../../lib/allowlist';
import { isProfileComplete } from '../../lib/profile-options.js';

/* Gates a route behind Firebase auth. Critically, if Firebase is NOT configured
   (`ready` false), this is a NO-OP — the app stays fully usable and nobody is
   locked out. Only when auth is actually configured do we require a session.

   When NEXT_PUBLIC_ALLOWED_EMAILS is set, a session whose email is not on the
   list is signed out and bounced to /login. The login page refuses such
   accounts up front; this is the backstop for sessions that predate the list
   or slipped past it. */
export default function AuthGuard({ children }) {
  const {
    user,
    profile,
    profileLoading,
    profileError,
    loading,
    ready,
    signOut,
    signOutError,
    refreshProfile,
  } = useAuth();
  const router = useRouter();

  const denied = Boolean(user) && !isAllowedEmail(user.email);
  // Set once we have bounced a denied session: the sign-out flips `user` to
  // null and re-runs this effect, which must not issue a second redirect that
  // would drop the ?denied flag.
  const bounced = useRef(false);

  useEffect(() => {
    if (!ready || loading || bounced.current) return;
    if (denied) {
      bounced.current = true;
      void signOut().catch(() => {});
      router.replace('/login?denied=1');
    } else if (!user) {
      router.replace('/login');
    }
  }, [ready, loading, user, denied, router, signOut]);

  // Auth not configured → let everyone through unchanged.
  if (!ready) return children;

  if (loading) return <div className="scl-fullcenter">Checking your session…</div>;

  if (!user || denied) return null; // redirecting to /login

  if (profileLoading) return <div className="scl-fullcenter">Loading your account…</div>;

  if (profileError) {
    return <AccountRecovery error={profileError} onRetry={refreshProfile} returnTo="/prototype" />;
  }

  if (!profile) return <div className="scl-fullcenter">Loading your account…</div>;

  // profileCompletedAt is retained for audit/history, but the onboarding
  // contract now includes role, branch, and (for military branches) a valid
  // pay-grade/rank pair. Older completed timestamps must not bypass it.
  if (!isProfileComplete(profile)) return <AccountProfile onboarding />;

  return (
    <>
      <div className="scl-authpill">
        <span>
          {profile?.name || user.displayName || user.email || 'Signed in'}
          {profile?.rank ? ` · ${profile.rank}` : ''}
        </span>
        <button onClick={() => void signOut().catch(() => {})}>Sign out</button>
        {(profileError || signOutError) && (
          <span role="alert" title={profileError?.message || signOutError?.message}>
            {profileError?.error || signOutError?.error || 'Account action failed'}
          </span>
        )}
      </div>
      {children}
    </>
  );
}
