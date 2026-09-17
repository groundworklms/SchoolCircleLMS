'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import '../prototype/student.css';
import { useAuth } from './AuthProvider';
import { validateProfileFields } from './profile-form';
import {
  getPayGrades,
  getRanks,
  PROFILE_ROLES,
  SERVICE_BRANCHES,
} from '../../lib/profile-options.js';

function messageFor(error, fallback) {
  if (typeof error?.error === 'string' && error.error) return error.error;
  if (typeof error?.message === 'string' && error.message) return error.message;
  return fallback;
}

function optionsFor(getOptions, ...args) {
  try {
    return getOptions(...args) || [];
  } catch {
    return [];
  }
}

function nextMilitarySelection(branch) {
  const grades = optionsFor(getPayGrades, branch);
  const payGrade = grades.length === 1 ? grades[0].value : '';
  const ranks = payGrade ? optionsFor(getRanks, branch, payGrade) : [];
  const rank = ranks.length === 1 ? ranks[0].value : '';
  return { payGrade, rank };
}

function roleLabel(role) {
  return role === 'INSTRUCTOR' || role === 'BOTH'
    ? 'Switch between your learner and instructor spaces. Instructor access is granted by your administrator.'
    : 'Learner tools are available as soon as you save.';
}

/**
 * The actual, dependency-injectable profile form. Keeping this component
 * independent from useAuth makes the complete onboarding flow easy to verify
 * in a browser without creating a Firebase session or connecting to a
 * database. Production callers should use the default wrapper below.
 */
export function AccountProfileForm({ auth = {}, onboarding = false }) {
  const {
    profile,
    profileLoading = false,
    updateProfile,
    signOut,
    signOutError,
  } = auth;
  const [name, setName] = useState('');
  const [role, setRole] = useState('');
  const [branch, setBranch] = useState('');
  const [payGrade, setPayGrade] = useState('');
  const [rank, setRank] = useState('');
  const [legacyRank, setLegacyRank] = useState('');
  const [formError, setFormError] = useState(null);
  const [saved, setSaved] = useState(false);
  const [saving, setSaving] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const mountedRef = useRef(true);
  const saveRequestRef = useRef(0);
  const profileIdRef = useRef(null);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
    };
  }, []);

  // Reset fields only when the Firebase-backed account changes. This avoids
  // clobbering an in-progress edit when the provider publishes a save.
  useEffect(() => {
    profileIdRef.current = profile?.id || null;
    saveRequestRef.current += 1;
    setSaving(false);
    if (!profile) {
      setName('');
      setRole('');
      setBranch('');
      setPayGrade('');
      setRank('');
      setLegacyRank('');
      setFormError(null);
      setSaved(false);
      return;
    }
    setName(profile.name || '');
    setRole(profile.role || '');
    setBranch(profile.branch || '');
    setPayGrade(profile.payGrade || '');
    setRank(profile.rank || '');
    // Older accounts can have a free-text rank but no branch/grade. Keep that
    // value visible until the member chooses a valid new combination.
    setLegacyRank(profile.rank || '');
    setFormError(null);
    setSaved(false);
  }, [profile?.id]);

  const payGradeOptions = useMemo(
    () => (branch && branch !== 'CIVILIAN' ? optionsFor(getPayGrades, branch) : []),
    [branch],
  );
  const rankOptions = useMemo(
    () => (
      branch && branch !== 'CIVILIAN' && payGrade
        ? optionsFor(getRanks, branch, payGrade)
        : []
    ),
    [branch, payGrade],
  );
  const legacyRankIsOption = rank && rankOptions.some((option) => option.value === rank);
  const militaryBranch = Boolean(branch && branch !== 'CIVILIAN');
  // Only an account that already holds the instructor capability may change its
  // role from this form. The server is the real gate (lib/account-profile.js
  // refuses to grant instructor to an account that lacks it); this just keeps
  // the form from offering a promotion path it knows will be clamped, so a
  // learner is never shown a control that silently does nothing.
  const instructorEntitled = profile?.role === 'INSTRUCTOR' || profile?.role === 'BOTH';

  const onBranchChange = (event) => {
    const nextBranch = event.target.value;
    setBranch(nextBranch);
    setSaved(false);
    setFormError(null);
    if (!nextBranch || nextBranch === 'CIVILIAN') {
      setPayGrade('');
      setRank('');
      return;
    }
    const next = nextMilitarySelection(nextBranch);
    setPayGrade(next.payGrade);
    setRank(next.rank);
  };

  const onPayGradeChange = (event) => {
    const nextGrade = event.target.value;
    setPayGrade(nextGrade);
    setRank('');
    setSaved(false);
    setFormError(null);
    if (!nextGrade || !branch || branch === 'CIVILIAN') return;
    const ranks = optionsFor(getRanks, branch, nextGrade);
    if (ranks.length === 1) setRank(ranks[0].value);
  };

  const save = async (event) => {
    event.preventDefault();
    setFormError(null);
    setSaved(false);

    // A member without instructor entitlement can only ever save as a learner;
    // never submit a role the server would refuse and clamp.
    const submittedRole = instructorEntitled ? role : 'LEARNER';
    const validation = validateProfileFields({ name, role: submittedRole, branch, payGrade, rank });
    if (validation.error) {
      setFormError(validation.error);
      return;
    }
    const payload = validation.value;
    const requestId = saveRequestRef.current + 1;
    saveRequestRef.current = requestId;
    const expectedProfileId = profile?.id || null;

    setSaving(true);
    try {
      if (typeof updateProfile !== 'function') {
        throw new Error('Account profile saving is unavailable. Please try again.');
      }
      await updateProfile(payload);
      if (
        !mountedRef.current ||
        saveRequestRef.current !== requestId ||
        profileIdRef.current !== expectedProfileId
      ) return;
      setName(payload.name);
      setRole(payload.role);
      setBranch(payload.branch);
      setPayGrade(payload.payGrade || '');
      setRank(payload.rank || '');
      setLegacyRank('');
      setSaved(true);
    } catch (error) {
      if (
        !mountedRef.current ||
        saveRequestRef.current !== requestId ||
        profileIdRef.current !== expectedProfileId
      ) return;
      setFormError(messageFor(error, 'Unable to save your account. Please try again.'));
    } finally {
      if (
        mountedRef.current &&
        saveRequestRef.current === requestId &&
        profileIdRef.current === expectedProfileId
      ) {
        setSaving(false);
      }
    }
  };

  const handleSignOut = async () => {
    setFormError(null);
    setSigningOut(true);
    try {
      if (typeof signOut === 'function') await signOut();
    } catch (error) {
      if (mountedRef.current) {
        setFormError(messageFor(error, 'Unable to sign out. Please try again.'));
      }
    } finally {
      if (mountedRef.current) setSigningOut(false);
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
              ? 'The details SchoolCircle uses across your learner and instructor spaces.'
              : 'Saved to your account, shown across your spaces.'}
          </p>
        </div>
      </div>

      <form onSubmit={save} noValidate>
        <label className="s-profile-field" htmlFor="account-profile-name">
          <span>Name</span>
          <input
            id="account-profile-name"
            name="name"
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
          <small id="account-profile-name-help">Required · 1–80 characters</small>
        </label>

        <label className="s-profile-field" htmlFor="account-profile-role">
          <span>Role</span>
          {instructorEntitled ? (
            <select
              id="account-profile-role"
              name="role"
              value={role}
              onChange={(event) => {
                setRole(event.target.value);
                setSaved(false);
                setFormError(null);
              }}
              required
            >
              <option value="">Choose a role…</option>
              {(PROFILE_ROLES || []).map((option) => (
                <option key={option.value} value={option.value}>{option.label}</option>
              ))}
            </select>
          ) : (
            <input
              id="account-profile-role"
              name="role"
              type="text"
              value="Student"
              readOnly
              aria-describedby="account-profile-role-help"
            />
          )}
          <small id="account-profile-role-help">
            {instructorEntitled
              ? (role ? roleLabel(role) : 'Choose learner, instructor, or both.')
              : 'Your role is managed by your administrator.'}
          </small>
        </label>

        <label className="s-profile-field" htmlFor="account-profile-branch">
          <span>Service branch</span>
          <select
            id="account-profile-branch"
            name="branch"
            value={branch}
            onChange={onBranchChange}
            required
          >
            <option value="">Choose a service branch…</option>
            {(SERVICE_BRANCHES || []).map((option) => (
              <option key={option.value} value={option.value}>{option.label}</option>
            ))}
          </select>
          <small id="account-profile-branch-help">
            Civilian profiles do not use a pay grade or rank.
          </small>
        </label>

        {militaryBranch ? (
          <>
            <label className="s-profile-field" htmlFor="account-profile-pay-grade">
              <span>Pay grade</span>
              <select
                id="account-profile-pay-grade"
                name="payGrade"
                value={payGrade}
                onChange={onPayGradeChange}
                required
              >
                <option value="">Choose a pay grade…</option>
                {payGradeOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
            </label>

            <label className="s-profile-field" htmlFor="account-profile-rank">
              <span>Rank</span>
              <select
                id="account-profile-rank"
                name="rank"
                value={rank}
                onChange={(event) => {
                  setRank(event.target.value);
                  setLegacyRank('');
                  setSaved(false);
                  setFormError(null);
                }}
                required
                disabled={!payGrade}
                aria-describedby="account-profile-rank-help"
              >
                <option value="">
                  {payGrade ? 'Choose a rank…' : 'Choose a pay grade first…'}
                </option>
                {rank && !legacyRankIsOption && (
                  <option value={rank}>{rank} (saved legacy value)</option>
                )}
                {rankOptions.map((option) => (
                  <option key={option.value} value={option.value}>{option.label}</option>
                ))}
              </select>
              <small id="account-profile-rank-help">
                Limited to the selected branch and pay grade.
              </small>
            </label>
            {legacyRank && !rank && (
              <div className="s-profile-editor-note" role="note">
                Previously saved rank: <strong>{legacyRank}</strong>. Select a valid rank to replace it.
              </div>
            )}
          </>
        ) : (
          legacyRank && branch !== 'CIVILIAN' && (
            <div className="s-profile-editor-note" role="note">
              Previously saved rank: <strong>{legacyRank}</strong>. Choose a military branch,
              pay grade, and valid rank to replace it.
            </div>
          )
        )}

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
            <button
              className="p-btn ghost"
              type="button"
              onClick={handleSignOut}
              disabled={signingOut || saving}
            >
              {signingOut ? 'Signing out…' : 'Sign out'}
            </button>
          )}
        </div>
      </form>
    </section>
  );
}

/**
 * Preserve the original authenticated component API for all production
 * callers. Tests and the temporary browser verification page can inject the
 * same auth contract through AccountProfileForm.
 */
export default function AccountProfile({ onboarding = false }) {
  const auth = useAuth();
  return <AccountProfileForm auth={auth} onboarding={onboarding} />;
}