# Persistent account profiles

The account name, optional military rank and completion timestamp live on the
existing Prisma User. Military rank is descriptive text, never an authorization
role. The existing Firebase verifier maps the same namespaced external identity;
provider names seed new users only. Existing names and roles are never backfilled
or overwritten on sign-in. Existing accounts confirm their name once because
their completion timestamp starts NULL. The learning-preferences survey is separate.
The default `/prototype` route and the `/learn` and `/teach` routes share account
onboarding and recovery. Both learner and instructor Settings expose the editor.
Prototype role switching remains a demo view choice, not a database role change.
When Firebase is unconfigured, only the existing prototype demo remains available;
it does not claim to save an authenticated profile.

## API

`GET /api/account/profile` and `PATCH /api/account/profile` require a verified
Firebase bearer token. PATCH accepts only `{ "name": "...", "rank": null }`
(rank may also be text). Name is required, trimmed, at most 80 characters;
rank is optional, trimmed, at most 40 characters. Control characters and unknown
keys are rejected. ID, role, external identity and completion date cannot be
specified by the caller. Only the authenticated database ID is updated.

Responses are not cached. Failed verification or database operations never
report a successful save. No browser storage is used for account profiles.

## Safe migration procedure — requires separate approval

No migration or deployment is performed by this PR. Follow `CLOUD_POSTGRES.md`
and the existing Cloud SQL connector instructions; do not change connectivity.

1. Confirm the intended instance, database, migration history, operator permissions
   and a restorable backup in a secure operator session. Coordinate concurrent
   releases. Compare the actual schema with the existing migrations. If tables
   lack migration history, stop and review baselining; never blindly mark applied.
2. Inspect `20260915230000_account_profile/migration.sql`: it only adds nullable
   `rank VARCHAR(40)` and `profileCompletedAt TIMESTAMP(3)` columns. Existing IDs,
   names, roles, external IDs and related learning records are preserved. No seed,
   table rewrite, reset, user deletion or role backfill is intended.
3. Test against an isolated restored copy first. Schedule a brief schema-lock
   window; PostgreSQL ALTER TABLE takes a lock even for nullable additions.
4. With separately injected migrator credentials, set the existing non-secret
   `SCHOOLCIRCLE_DB_ENV` and `DATABASE_TARGET_CONFIRM` acknowledgments, run
   `npm run db:status`, then (only with approval) `npm run db:deploy`.
   Do not place credentials in commands or logs. Never run `db push`,
   `migrate reset`, seeds, or migrations from build/start.
5. Confirm migration history, columns and runtime role grants. Generate Prisma
   client during normal installation/build. Deploy the reviewed application
   revision only after the migration is present and rollout is approved.
6. For application rollback, leave the additive columns and saved data intact;
   do not drop columns automatically. Older application versions may overwrite
   preferred names on sign-in, so prefer a forward fix or retain the stable-name
   authentication fix during rollback.

## Verification boundaries

Unit/handler tests inject identity/verifier seams. Native PostgreSQL integration
uses a private temporary cluster, not workspace or Cloud SQL credentials. These
can establish migration preservation, database reconnect persistence and account
ownership, but cannot establish real Firebase login or deployed connectivity.

Run `npm run test:account-profile` for account validation, ownership, retry and
session-race regressions; CI runs this alongside the existing tests/build.
`npm run test:db` covers upgrade from the old schema with an existing instructor,
new-user creation, reconnect persistence, stable chosen names and zero schema drift.

After an approved rollout, separately verify real sign-in, first-use completion,
editing/clearing rank, refresh and sign-in from a second connected browser,
sign-out/account switching, and retry after an unavailable identity/database
service. Verify both existing instructors and learners retain their IDs/roles.
Those deployed checks are not claimed by isolated test results.