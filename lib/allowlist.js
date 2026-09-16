// Tester allowlist for sign-in.
//
// NEXT_PUBLIC_ALLOWED_EMAILS is a comma-separated list of emails that may sign
// in (case-insensitive). It is public config, baked into the client bundle like
// the rest of the Firebase settings, because the gate lives in the browser
// (AuthGuard + the login page). If it is unset the allowlist is OFF and any
// Firebase account may sign in — same "unconfigured = open" rule as the rest of
// auth, so nobody is locked out by a missing env var.

const raw = process.env.NEXT_PUBLIC_ALLOWED_EMAILS || '';

export const ALLOWED_EMAILS = raw
  .split(/[,;\s]+/)
  .map((e) => e.trim().toLowerCase())
  .filter(Boolean);

export const allowlistEnabled = ALLOWED_EMAILS.length > 0;

export function isAllowedEmail(email) {
  if (!allowlistEnabled) return true;
  return Boolean(email) && ALLOWED_EMAILS.includes(String(email).trim().toLowerCase());
}

export const DENIED_MESSAGE =
  "That account isn't on the tester list for this deployment. Ask the team to add your email.";
