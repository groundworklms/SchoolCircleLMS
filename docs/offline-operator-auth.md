# Local operator authentication (offline deployments)

## What this changes and what it does not

Before this seam, SchoolCircle could not authenticate anybody with the network
pulled. `lib/firebase-auth.js` verifies ID tokens against Google's public
certificates, the browser signs in against Google's identity endpoints, and a
Firebase ID token expires in about an hour — so a disconnected deployment could
not admit a new session and lost every live one within the hour. That was the
only remaining auth blocker to running disconnected.

**Now genuinely possible offline:** a named local operator can sign in on a
disconnected deployment, and their session stays valid for its whole configured
window (default 12 hours, up to 168) with no network call of any kind. The
session maps to a real Prisma `User` row, so `identity.id`, `identity.role`,
`requireAnyRole` and every ownership check downstream behave exactly as they do
for a Firebase session. No Prisma migration was needed.

**Still not established by this change:**

- Nothing here is evidence that the *rest* of the learner journey survives
  isolation. Grounded retrieval, the local model, assets, and the browser
  journey are separate prerequisites, unchanged by this work and still covered
  by the limits in [offline-delivery-verification.md](offline-delivery-verification.md).
- **This has not been exercised on a network-pulled deployment.** It is verified
  by unit tests against in-memory doubles and a successful `next build` only.
  There is no local Postgres in this environment, so the `User` upsert has never
  run against a real database on this path.
- It does not remove the need for a local database, which was already required.

## The flag, and why the hosted deployment cannot reach this

The seam is enabled only when **both** of these are true on the server:

| Variable | Requirement |
|---|---|
| `AUTH_MODE` | exactly `offline` (case-insensitive, trimmed) |
| `OFFLINE_AUTH_SECRET` | present, at least 32 characters |

`offlineAuthEnabled()` (`lib/offline-auth.js`) is the single gate, and every
entry point in the module checks it. With `AUTH_MODE` unset:

- `/api/auth/offline/session` answers **404 to every method**, with the same body
  a nonexistent route would produce. Nothing distinguishes "turned off" from
  "not built" to someone probing the hosted deployment.
- A perfectly valid offline token — one minted earlier by a real offline
  deployment — verifies as nothing, maps to no user, and never reaches Prisma.
- `authReadiness()` returns the object it always did, key for key. The `offline`
  block appears only on an opted-in deployment.
- `resolveIdentity` is the original single-line body.

A half-configured deployment (mode without a secret, a secret that is too short,
a mode spelled `offline-ish`, an unusable realm) is **disabled**, not degraded.

`NEXT_PUBLIC_AUTH_MODE=offline` is a separate, public build flag that only
decides whether the sign-in form is *rendered*. It grants nothing: a browser
that sets it alone gets a 404 from the session route and a 401 from every
authenticated call. Both flags must be set for offline sign-in to work.

## Signing scheme

```
token = "scoffline" "." "v1" "." base64url(payload JSON) "." base64url(mac)
mac   = HMAC-SHA256(key, "scoffline.v1." + base64url(payload JSON))
key   = scrypt(OFFLINE_AUTH_SECRET, "schoolcircle/offline-auth/v1", 32,
               {N: 16384, r: 8, p: 1})
```

- **Key source:** derived from `OFFLINE_AUTH_SECRET`, an explicit deployment
  secret, by scrypt. The derived key is cached against the secret that produced
  it, because re-deriving per request would put ~60 ms of CPU on every
  authenticated call. No key is ever auto-generated: a key the process invents
  cannot survive a restart, and silently invalidating every session is worse
  than refusing to start the mode. Same reasoning as
  `SETTINGS_ENCRYPTION_KEY` in `lib/settings-crypto.js`.
- **Why symmetric:** the only party that mints and the only party that verifies
  are the same process on the same machine. An asymmetric scheme would add a
  keypair to manage and buy nothing.
- **Why the MAC covers the encoded text** rather than a re-serialized object:
  there is then no canonicalization gap between what was signed and what is
  checked.
- **Constant-time comparison** of the two base64url MACs uses `secretEquals`
  from `lib/settings-crypto.js`.
- **No new crypto and no JWT library.** Node's `crypto` plus the existing
  `settings-crypto.js` helpers (`hashPassphrase`, `passphraseMatches`,
  `secretEquals`, `isHashedPassphrase`).

### Four segments, on purpose

An offline token has **four** dot-separated segments; a Firebase ID token always
has three, and `verifyFirebaseIdToken` rejects anything else outright. The two
token shapes are therefore disjoint, and `resolveIdentity` routes on shape
before anything touches the credential: an offline session never reaches the
Firebase verifier and a Firebase ID token never reaches the offline one. Offline
mode cannot launder a Firebase token, and a Firebase token that fails to verify
is still anonymous — offline is a peer credential, never a fallback.

### What the payload carries

```json
{"v":1,"sub":"sgt-okafor","realm":"local","iat":…,"exp":…,"jti":"…"}
```

**No role and no name.** Authorization always comes from the Prisma row the
subject maps to, exactly as it does for Firebase, so a token holder can never
assert its own role.

Checked locally on every request: signature, prefix/version, `realm` match
(a token minted for another realm is refused even though the same secret signed
it), `exp` in the future, `exp > iat`, and `iat` no more than 5 minutes ahead.

## Mapping to a `User` row — no migration

`User.externalId` already carries a namespaced subject (`firebase:<project>:<uid>`).
An offline operator mirrors that convention:

```
offline:<realm>:<subject>
```

Subjects and realms are restricted to `[A-Za-z0-9][A-Za-z0-9._@-]{0,127}` so
neither can contain a colon and spell another subject's external id. **No new
column, no new table, no migration** — which matters because `migrate.yml`
applies migrations to the live Cloud SQL database on merge to main.

The upsert mirrors `resolveFirebaseUser` exactly, including the rule that
matters most:

```js
create: { externalId, name, ...(role ? { role } : {}) },
update: {},
```

The roster's `role` **seeds a brand-new account only**. `update: {}` means an
operator demoted in the database stays demoted whatever the roster says, so
deployment configuration can create an offline instructor but can never promote
an account that already exists. Without this, every offline operator would be a
`LEARNER` forever and no instructor could exist on a disconnected box.

An offline operator's email — if the roster carries one — is **never** marked
verified, because nothing verified it.

## The operator roster

`OFFLINE_AUTH_OPERATORS` is a JSON array of entries generated by:

```sh
printf '%s' 'correct horse battery staple' \
  | node scripts/offline/operator-passphrase.mjs sgt-okafor INSTRUCTOR 'SSgt Okafor'
```

The passphrase is read from **stdin, never argv or the environment**, so it
cannot land in shell history, a process listing, or a CI log. Each entry stores
only an scrypt salt and hash (`hashPassphrase`), so the roster can be stored and
reviewed without carrying a way in. Parsing is strict: an entry without a real
scrypt envelope, with a colon in its subject, with a role that is not a Prisma
`Role`, or a duplicate subject, is dropped. Malformed JSON is an empty roster,
not a crash.

Surrounding whitespace on a passphrase is insignificant, because
`passphraseMatches` trims — existing shared behaviour, reused deliberately
rather than forked. That is pinned by a test.

## The way in

`POST /api/auth/offline/session` with `{ subject, passphrase }` returns
`{ token, expiresAt, user }`. It:

- answers 404 when the mode is off;
- gives **one message** for an unknown operator and a wrong passphrase alike,
  and pays one scrypt verification against a throwaway hash for an unknown
  subject so the two cannot be told apart by timing;
- throttles to 5 failures per subject per minute (429 with `Retry-After`) —
  a shared local box is exactly where a passphrase is worth grinding at and
  there is no external rate limiter in front of a disconnected deployment. The
  throttle is in-process and resets on restart: friction against a script, not
  an account-lockout policy;
- resolves the minted token through the same path an API request takes, so a
  session is only handed out when it already maps to a usable `User` row.

`GET` on the same path reports `{ enabled, sessionHours }` and **names no
operator** — a subject is half a credential and that read is unauthenticated.

In the browser, `lib/offline-session.js` stores the session in `localStorage`
and presents it as a Firebase-user-shaped object with a `getIdToken()`, so
`authFetch`, `authenticatedFetch` and the profile coordinator work unchanged.
That object is cached per token on purpose: the coordinator compares users by
reference to decide which response may publish, so a fresh object per render
would look like a new account per render. A Firebase token always wins when one
exists — the offline token only fills the gap a disconnected deployment leaves.

The email allowlist (`NEXT_PUBLIC_ALLOWED_EMAILS`) does not apply to an offline
session: operators need no email address, and the server-side roster is already
the gate. Without that exemption, a deployment with an allowlist set would
bounce every offline operator on sight.

## Residual risk

1. **`AUTH_MODE` set by mistake on a hosted deployment.** This is the one real
   exposure. It is not sufficient on its own — `OFFLINE_AUTH_SECRET` must also
   be present and at least 32 characters, and `OFFLINE_AUTH_OPERATORS` must
   carry a valid scrypt entry before anyone can actually sign in — so reaching
   it takes three deliberate configuration mistakes, not one. Mitigation:
   `apphosting.yaml` does not define any of these variables, and `.env.example`
   states they must be left unset on the hosted deployment. A reviewer checking
   this only has to confirm `AUTH_MODE` is absent from hosted configuration.
2. **A leaked `OFFLINE_AUTH_SECRET` forges any subject.** It is a signing key;
   treat it as one. Rotating it invalidates every outstanding session
   immediately, which is the intended recovery. Changing `OFFLINE_AUTH_REALM`
   also invalidates them, but creates new `User` rows, so prefer rotating the
   secret.
3. **No revocation before expiry.** A minted session is valid for its whole
   signed window; there is no local revocation list. Removing an operator from
   the roster stops new sign-ins but does not kill a live session. Keep
   `OFFLINE_AUTH_SESSION_HOURS` as short as the deployment tolerates, and rotate
   the secret to revoke immediately.
4. **The throttle is per-process and in-memory.** A restart clears it, and it
   does not survive multiple instances. Acceptable for a single-box
   disconnected deployment; it is not an account-lockout policy.
5. **`localStorage`, not an httpOnly cookie.** Same exposure the Firebase ID
   token already has in this app (`authFetch` reads it in JS and sends a bearer
   header), so this introduces no new class of risk — but it does mean XSS on
   an offline deployment yields a session token valid for hours rather than one.
6. **Untested against a real database.** See the top of this document.
