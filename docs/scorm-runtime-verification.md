# SCORM runtime verification

## Scope

This tooling verifies two separate boundaries:

1. `runtime-harness.mjs` runs the **original** launch file and courseware scripts
   from a Cartridge ZIP inside a small Node VM. It simulates the DOM and the
   SCORM 1.2/2004 API subset used by the package.
2. `verify.mjs` calls SchoolCircle's native `evidenceHandlers().exportScorm`
   and the native `learningRoute` boundary for the anonymous request. Authenticated identities
   come from `resolveFirebaseUser`'s existing `userClient`/`verifier` test seam.
   The seam accepts only run-local synthetic profiles; roles are read back from
   the isolated Prisma `User` rows. There are no compatibility sessions,
   cookies, dispatchers, forged role headers, or production Firebase
   credentials.

The harness is a simulated player contract, not a browser rendering test, an
ADL conformance certification, or an actual LMS import. It checks initialization,
incomplete state, writable score/status values, commit, termination, and the
pass/fail result produced by the original package scripts. It does not prove
sequencing, resume across sessions, LMS persistence, gradebook behavior, or
MarineNet interoperability.

## Focused checks

```sh
node --test scripts/scorm/runtime-harness.test.mjs test/scorm-verification.test.mjs
```

The standalone harness runs both supported versions, passing and failing
attempts, and parent/opener API discovery. Each version therefore has four
launches. The source package is read verbatim from the installed
`cartridge/example/course.json`; the harness never supplies a fabricated
lesson, question, score, or completion call.

## Isolated database contract run

The verifier owns its database target. It creates a fresh cluster in a random
`/tmp` directory, configures local Unix-socket trust and host authentication
rejection, starts PostgreSQL with `listen_addresses=''`, creates the
`schoolcircle_scorm_test` database, and applies the committed SQL migrations
over that socket:

```sh
node scripts/scorm/verify.mjs
```

No external database URL or database-name flag is accepted. The guard requires
the exact mode-0700 socket directory and marker created by this invocation,
rejects arbitrary URL query/fragment parameters and TCP ports (the sole
runner-generated host query must equal that socket), and strips inherited
database host variables before importing Prisma. Migrations therefore run only
against the private cluster; the cluster, socket, schema, fixture rows, and
temporary database are removed after the run. The evidence ZIPs and
`evidence.json` report are retained in the printed random
`/tmp/scorm-runtime-*` directory. No connection string, password, token, or
personal identity is written to the report. This follows the private-cluster
pattern in `tests/postgres-integration.mjs` while keeping the SCORM fixtures
and cleanup local to this verifier.

The focused private-cluster run completed migration, both exports, all eight
simulated launches, twelve rejection checks, and cleanup. It exited `0` with
two ZIP exports, all twelve rejections matching the native status/code policy,
and the three fixture identities and four records removed successfully. The
retained report records the native `400 BAD_REQUEST` rejection for pending and
other-owner null projections.

The verifier creates three unique Firebase-seam identities:

| Identity | Persisted role | Deliberately contradictory token claim |
|---|---|---|
| owner | `INSTRUCTOR` | `LEARNER` |
| learner | `LEARNER` | `INSTRUCTOR` |
| other owner | `INSTRUCTOR` | `LEARNER` |

It creates four run-local `COURSE_DRAFT` records owned by the instructor:

| Case | Fixture source | Expected native contract |
|---|---|---|
| approved | Unchanged Cartridge example | ZIP for 1.2 and 2004 |
| pending | Same source, `PENDING` record | Rejected |
| refused | A rejection marker with no replacement lesson text | `409 COURSE_NOT_APPROVED` |
| missing | Approved record with empty lesson/question arrays | `409 COURSE_CONTENT_MISSING` |

For each version, anonymous, learner, other-owner, pending, refused, and
missing requests are recorded. Only the owner/approved request is exported.
Both returned ZIPs are saved in a random `/tmp/scorm-runtime-*` directory and
run through pass/fail × parent/opener (eight simulated launches total). The
report also checks that exactly two `SCORM_EXPORT` records exist and that both
reference only the approved fixture. Cleanup deletes only records owned by the
three identities created by that invocation.

## Baseline/native rejection policy

The verifier records observed native status/code pairs and requires the
baseline status/code pair for each case. On baseline,
`getApprovedCourse` returns `null` for a pending course or a course owned by
another instructor; the native `approvedCourseForCartridge` boundary raises a
`TypeError`, and the current native error table reports `400 BAD_REQUEST`.
That is the existing native rejection policy. Refused content returns `409
COURSE_NOT_APPROVED`, and empty approved content returns `409
COURSE_CONTENT_MISSING`; a changed status or code is recorded as a
verification defect. No unauthorized ZIP is sent and no rejection creates an
export audit. This tooling does not change the export implementation.

## Evidence limits

The report distinguishes local simulated-player and native-handler evidence
from external LMS proof. No target LMS URL, authorized account, import
permission, or gradebook access is assumed. Therefore this run cannot establish
LMS import acceptance, sequencing, resume, gradebook persistence, or
MarineNet readiness.