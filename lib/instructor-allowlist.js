// Server-side allowlist of emails that may hold an instructor role through the
// self-serve account form.
//
// This is the ONE sanctioned path by which the online account endpoint will let
// an account raise its OWN role to INSTRUCTOR/BOTH; every other self-serve
// elevation is refused (lib/account-profile.js). Role is still primarily seeded
// by a trusted path -- a database seed, the offline operator roster, or an admin
// action -- exactly as lib/auth.js keeps the Prisma role authoritative for both
// sign-in paths. This list only widens who the online form may promote.
//
// INSTRUCTOR_EMAILS is deliberately NOT a NEXT_PUBLIC_ value: an authorization
// decision must never be made from config baked into the client bundle, so this
// is read only on the server. And unlike the tester sign-in allowlist, the
// unconfigured state here is CLOSED -- an empty list promotes nobody -- because
// failing open on an authorization gate is the whole defect being fixed.
//
// The env is parsed on each call rather than once at module load: this is an
// authorization gate, so it must honour a rotated allowlist without waiting on a
// redeploy, and a stale module-scope cache would be a foot-gun.
export function instructorEmails() {
  return (process.env.INSTRUCTOR_EMAILS || '')
    .split(/[,;\s]+/)
    .map((e) => e.trim().toLowerCase())
    .filter(Boolean);
}

export function isInstructorEmail(email) {
  if (!email) return false;
  return instructorEmails().includes(String(email).trim().toLowerCase());
}
