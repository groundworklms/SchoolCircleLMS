// Tester allowlist for sign-in.
//
// NEXT_PUBLIC_ALLOWED_EMAILS is a comma-separated list of emails that may sign
// in (case-insensitive). It is public config, baked into the client bundle like
// the rest of the Firebase settings, because the gate lives in the browser
// (AuthGuard + the login page). If it is unset the allowlist is OFF and any
// Firebase account may sign in — same "unconfigured = open" rule as the rest of
// auth, so nobody is locked out by a missing env var.
//
// The server reads it too, for one decision: whether "instructor" is a role a
// known person holds or one anybody who signed up gave themselves
// (app/api/learning/model-settings/route.js). Read on each call rather than at
// module load so that decision follows the environment a test or a process
// actually has; Next.js still inlines the literal `process.env.NEXT_PUBLIC_*`
// reference into the client bundle.

function parse(raw) {
  return String(raw || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function allowedEmails() {
  return parse(process.env.NEXT_PUBLIC_ALLOWED_EMAILS);
}

/** True when sign-in is restricted to a known list of accounts. */
export function allowlistEnabled() {
  return allowedEmails().length > 0;
}

export function isAllowedEmail(email) {
  const allowed = allowedEmails();
  if (allowed.length === 0) return true;
  return Boolean(email) && allowed.includes(String(email).trim().toLowerCase());
}

export const DENIED_MESSAGE =
  "That account isn't on the tester list for this deployment. Ask the team to add your email.";
