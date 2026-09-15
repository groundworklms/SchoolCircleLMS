# SCORM runtime evidence

## Scope and result — 2026-09-15

Both SCORM 1.2 and SCORM 2004 exports passed the current native app export
contract with real signed-session verification, authoritative database roles,
isolated PostgreSQL course records and instructor-owned export audits.
No shared backend adapter, authoring screen, or package implementation was changed.

The local harness loads the manifest launch file from the returned ZIP, executes
the **original** runtime and inline courseware scripts, triggers their submit
handler, and checks the resulting SCORM calls and committed values. The DOM and
LMS API are simulated in Node VM; this is **not a browser rendering test,
an ADL conformance certification, or an actual LMS import**. The simulator
implements the initialization, writable score/status, commit and termination
subset used by this package, including SCORM string return values and lifecycle
rejection. It is not a full SCORM sequencing, persistence or error-code engine.

### Observed matrix

Each version ran passing and failing quiz attempts with both parent-frame and
opener API discovery (eight launches total):

| Check | SCORM 1.2 | SCORM 2004 |
|---|---|---|
| Authorized export | 200, ZIP | 200, ZIP |
| Manifest launch | `index.html` | `index.html` |
| Initialization | `LMSInitialize("")` | `Initialize("")` |
| Initial committed status | `cmi.core.lesson_status=incomplete` | `cmi.completion_status=incomplete` |
| Raw score, min, max | `100` or `0`, `0`, `100` | `100` or `0`, `0`, `100` |
| Scaled score | Not applicable | `1` or `0` |
| Final status | `passed` or `failed` | completion `completed`; success `passed` or `failed` |
| Commit | Two `LMSCommit("")` calls | Two `Commit("")` calls |
| Termination | `LMSFinish("")` | `Terminate("")` |
| All observed API results | String `"true"` | String `"true"` |
| Anonymous / learner export | 401 / 403 | 401 / 403 |
| Empty lesson / refusal-only section | 409 `COURSE_CONTENT_MISSING` | 409 `COURSE_CONTENT_MISSING` |
| Pending course / other instructor | Rejected, but **500 defect** | Rejected, but **500 defect** |

Exactly two export audits were persisted, both owned by the isolated instructor,
both referencing only the approved fixture. Rejections produced no audit rows.
All fixture users and records were removed successfully. No production data,
schema, real user role or existing course was changed.

## Fixture provenance and review

The harness reads the installed Cartridge `example/course.json` verbatim,
retaining its three fire-safety lessons and three questions. Review checked the
answer keys against the supplied text: “Aim at the base of the fire”, “At least
two”, and “Raise the alarm”. Approval is only for this isolated software fixture,
not operational safety instruction or the separately reviewed golden course.
The illustrative handbook citation is not claimed as a verified source.

The source must exist and contain its lessons/questions or the run fails. It
does not regenerate or replace missing source material. Negative variants are
separate isolated records for pending status, absent lessons and an empty
refused section. The approved source is never patched to make a check pass.

## Reproduce

```sh
# No database writes: tests simulator boundaries and actual package scripts.
node --test scripts/scorm/runtime-harness.test.mjs

# Explicit development-only opt-in: current auth/router/store contract.
node scripts/scorm/verify.mjs --development
```

The second command needs the existing development database and signed-session
configuration. It creates unique identities and records, uses the same
`dispatchRequest(..., { middleware: [authBoundary] })` boundary as Next's API
handler, and removes only records owned by the newly created identities.
It does not perform a Firebase/OIDC login or HTTP/proxy/browser test.
The development environment must point at its development database; a host
flag alone cannot independently establish database provenance.

Each run prints a `/tmp/scorm-runtime-...` directory containing both ZIPs and
sanitized `evidence.json`, including fixture/package hashes, every observed
runtime call, rejected response codes and cleanup status. No identity, token,
connection string or personal data is included. Exit 0 means no defects; exit 1
means verification/cleanup failed; exit 2 means exports/runtime checks completed
but contract defects were recorded. The observed contract run exited 2.

## Backend handoff: pending and non-owned courses return 500

Minimal reproduction with a valid instructor session:

1. Persist an isolated `COURSE_DRAFT` with status `PENDING`.
2. `GET /api/learning/export?courseId=<fixture>&version=1.2` (or `2004`).
3. Observe 500 `EVIDENCE_ERROR`, rather than a deliberate client-facing rejection.
4. Repeat against an approved course with another instructor: same result.

`createLearningEvidenceStore().getApprovedCourse` in `lib/server/db.js` returns
null for pending/non-owned records. `buildApprovedScorm` forwards that null to
`approvedCourseForCartridge` in `lib/server/arsenal-evidence.js`, whose
`requireObject` throws a generic TypeError. `sendError` in
`lib/server/routes/learning-evidence.js` defaults that error to 500.
No unauthorized ZIP leaks, but expected user-facing refusal is misclassified as
a server failure. The baseline/White backend lane should select the deliberate
409/404 policy (without disclosing another owner's course) and fix that boundary.
This export verification lane intentionally does not edit those shared files.

## Actual LMS status

No target LMS URL, authorized account or import permission was supplied.
No external LMS was accessed, no credentials were requested and no content was
uploaded to a third party. **MarineNet interoperability remains unverified.**
The local results do not establish import acceptance, sequencing, resume across
sessions, LMS gradebook persistence, or production readiness.

## Final checks

The four standalone harness tests passed; the authorized contract run completed
both exports and all eight launches, reporting the four version-specific 500
observations above and successful cleanup. `git diff --check` passed.
A separate root preview screenshot attempt returned an HTTP response failure;
no running-app visual verification is claimed. This task changed only its
standalone scripts and evidence document, not serving code or workflows.