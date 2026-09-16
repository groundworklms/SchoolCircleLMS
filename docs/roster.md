# Core class roster

Instructors can open **Roster** for their own generated or manually authored
courses. Real rosters use the existing `LearningRecord` model; no new migration
is introduced. Prototype courses are explicitly labeled **LOCAL DEMO ONLY**
and keep their changes in that browser.

## Supported

- Full roster, optional five-row view, name/email search, section/status filters,
  and name/section sorting.
- Manual enrollment and atomic CSV import with `name,email,section` headers.
  Section is optional. A course supports 500 retained enrollments, including
  dropped records. Duplicate server imports preserve existing enrollments.
- Drop with reason/effective date, retained history, and reactivation. The date
  records the effective date; it is not a scheduler for future status changes.
- Formula-safe CSV export, including drop reason/date.
- Messages to an individual, selected active students, or all active students.
  Delivery is **in-app only**, not email. Message retries reuse an operation ID.
- Recipient-only inbox and saved read state. The signed-in Firebase email must
  match the enrolled address and have verified ownership. Unverified email
  accounts must verify their email with the identity provider before reading.

Attendance, SIS lookup, outbound email, seating charts, waitlists, guardian
contacts, private notes, and advanced group management remain outside this scope.
The named roster does not expose learner answers or change cohort analytics privacy.

## Verification

```sh
node --test test/auth.test.mjs tests/roster-server.test.mjs tests/roster-ui*.mjs
npm run build
```

An optional native PostgreSQL test is available:

```sh
SCHOOLCIRCLE_DB_ENV=development RUN_DB_TESTS=1 node tests/roster-postgres.mjs
```

Run it only against a confirmed development database with the existing upstream
schema already applied. It creates isolated synthetic fixtures, verifies a
500-person import and concurrent duplicate enrollment, and removes its fixtures.
It does not apply migrations. Do not point it at production.

Browser-local demo checks and in-memory service tests are not evidence of
authenticated production delivery. This workspace lacks the upstream
`LearningRecord` table, so native database and signed-in cross-user delivery
verification remain outstanding.