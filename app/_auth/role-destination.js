import { isProfileComplete } from '../../lib/profile-options.js';

const LEARNER_ROLES = new Set(['LEARNER', 'BOTH']);
const INSTRUCTOR_ROLES = new Set(['INSTRUCTOR', 'BOTH']);

function cleanPath(value) {
  if (typeof value !== 'string' || !value.startsWith('/') || value.startsWith('//')) return null;
  // Backslashes are treated as path separators by some URL parsers and can
  // turn a seemingly local redirect into an external one.
  if (value.includes('\\')) return null;
  return value;
}

function pathPart(value) {
  const path = cleanPath(value)?.split(/[?#]/, 1)[0] || null;
  if (!path || path.split('/').some((part) => part === '.' || part === '..')) return null;
  return path;
}

function isPath(path, root) {
  return path === root || path.startsWith(`${root}/`);
}

function roleAllows(profile, role) {
  if (role === 'instructor') return INSTRUCTOR_ROLES.has(profile?.role);
  if (role === 'learner') return LEARNER_ROLES.has(profile?.role);
  return false;
}

/**
 * The destination for a profile with no explicit same-site deep link.
 * Incomplete profiles always enter the AuthGuard-owned prototype onboarding
 * page; that page can then redirect to the selected role's shell.
 */
export function getDefaultDestination(profile) {
  if (!isProfileComplete(profile)) return '/prototype';
  return profile.role === 'INSTRUCTOR' ? '/teach' : '/learn';
}

/**
 * Return true only for same-site routes that the persisted role is allowed to
 * open. This intentionally does not accept arbitrary absolute paths: login's
 * `next` parameter is a navigation hint, not an open redirect.
 */
export function isSafeDeepLink(next, profile) {
  if (!isProfileComplete(profile)) return false;
  const path = pathPart(next);
  if (!path) return false;

  if (isPath(path, '/teach')) return roleAllows(profile, 'instructor');
  if (isPath(path, '/learn')) return roleAllows(profile, 'learner');
  if (isPath(path, '/prototype/instructor')) return roleAllows(profile, 'instructor');
  if (isPath(path, '/prototype')) return roleAllows(profile, 'learner');
  return false;
}

/**
 * Resolve a post-login destination only after the persisted profile has been
 * fetched. Explicit safe deep links win; otherwise the role's native app wins.
 */
export function getPostLoginDestination(profile, next = null) {
  if (isSafeDeepLink(next, profile)) return next;
  return getDefaultDestination(profile);
}

// Descriptive aliases keep this small pure module convenient for callers and
// tests without duplicating the redirect policy.
export const defaultRoleDestination = getDefaultDestination;
export const postLoginDestination = getPostLoginDestination;
export const roleDestination = getPostLoginDestination;
export const isPermittedDeepLink = isSafeDeepLink;