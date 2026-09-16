'use client';

import { useEffect, useState } from 'react';
import '../prototype/student.css';
import { useAuth } from './AuthProvider';
import { validateProfileFields } from './profile-form';

function messageFor(error, fallback) {
  if (typeof error?.error === 'string' && error.error) return error.error;
  if (typeof error?.message === 'string' && error.message) return error.message;
  return fallback;
}

/**
 * The account profile is deliberately separate from the learning survey. The
 * former is the persisted identity used by every shell; the latter remains
 * learner-owned preference data in Waypoint.
 */
export default function AccountProfile({ onboarding = false }) {
  const {
    profile,
    profileLoading,
    updateProfile,
    signOut,
    signOutError,
  } = useAuth();
  const [name, setName] = useState('');
  const [rank, setRank] = useState('');
  const [formError, setFormError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);

  // Reset fields only when the Firebase-backed account changes. This avoids
  // clobbering an in-progress edit when the provider publishes a save.
  useEffect(() => {
    if (!profile) {
      setName('');
      setRank('');
      return;
    }
    setName(profile.name || '');
    setRank(profile.rank || '');
    setFormError(null);
    setSaved(false);
  }, [profile?.id]);

  const save = async (event) => {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    const validation = validateProfileFields(name, rank);
    if (validation.error) {
      setFormError(validation.error);
      return;
    }
    const { name: nextName, rank: nextRank } = validation.value;

    setSaving(true);
    try {
      await updateProfile({ name: nextName, rank: nextRank });
      setName(nextName);
      setRank(nextRank);
      setSaved(true);
    } catch (error) {
      setFormError(messageFor(error, 'Unable to save your account. Please try again.'));
    } finally {
      setSaving(false);
    }
  };

  const handleSignOut = async () => {
    setFormError(null);
    setSigningOut(true);
    try {
      await signOut();
    } catch (error) {
      setFormError(messageFor(error, 'Unable to sign out. Please try again.'));
    } finally {
      setSigningOut(false);
    }
  };

  if (profileLoading && !profile) {
    return <div className="s-profile-editor-status">Loading your account…</div>;
  }

  if (!profile) {
    return (
      <div className="s-profile-editor-status" role="alert">
        We could not load your account. Please try again.
      </div>
    );
  }

  return (
    <section className={`s-profile-editor${onboarding ? ' onboarding' : ''}`}>
      <div className="s-profile-editor-head">
        <div>
          <h2>{onboarding ? 'Finish setting up your account' : 'Account profile'}</h2>
          <p>
            {onboarding
              ? 'Choose the name and rank you want SchoolCircle to use across your learning spaces.'
              : 'These details are saved to your account and appear in both learner and instructor spaces.'}
          </p>
        </div>
      </div>

      <form onSubmit={save} noValidate>
        <label className="s-profile-field">
          <span>Name</span>
          <input
            type="text"
            value={name}
            maxLength={80}
            autoComplete="name"
            onChange={(event) => {
              setName(event.target.value);
              setSaved(false);
            }}
            aria-describedby="account-profile-name-help"
            required
          />
          <small id="account-profile-name-help">1–80 characters</small>
        </label>

        <label className="s-profile-field">
          <span>Rank <em>(optional)</em></span>
          <input
            type="text"
            value={rank}
            maxLength={40}
            autoComplete="organization-title"
            onChange={(event) => {
              setRank(event.target.value);
              setSaved(false);
            }}
            aria-describedby="account-profile-rank-help"
          />
          <small id="account-profile-rank-help">Up to 40 characters</small>
        </label>

        {(formError || signOutError) && (
          <div className="s-profile-editor-error" role="alert">
            {formError || messageFor(signOutError, 'Unable to complete that request.')}
          </div>
        )}
        {saved && <div className="s-profile-editor-success" role="status">Saved.</div>}

        <div className="s-profile-editor-actions">
          <button className="p-btn" type="submit" disabled={profileLoading || saving}>
            {profileLoading || saving ? 'Saving…' : 'Save profile'}
          </button>
          {onboarding && (
            <button className="p-btn ghost" type="button" onClick={handleSignOut} disabled={signingOut || saving}>
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}