import { isProfileComplete } from '../../lib/profile-options.js';
import { canAccessLocation, parse } from '../prototype/routes.js';

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

/**
 * The destination for a profile with no explicit same-site deep link.
 * Incomplete profiles always enter the AuthGuard-owned prototype onboarding
 * page; that page can then redirect to the selected role's shell. Completed
 * profiles land in the role's shell of the one app (see prototype/nav.js):
 * instructors in the course library, learners (and BOTH) on the student
 * dashboard.
 */
export function getDefaultDestination(profile) {
  if (!isProfileComplete(profile)) return '/prototype';
  return profile.role === 'INSTRUCTOR' ? '/prototype/instructor' : '/prototype';
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
  const location = parse(path);
  if (location.area === 'not-found') return false;
  // `canAccessLocation` contains the one intentional exception: an
  // instructor may preview the student library.
  return canAccessLocation(profile, location, true);
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