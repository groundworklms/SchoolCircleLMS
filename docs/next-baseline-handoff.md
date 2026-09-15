# Next.js baseline: ready-to-send review handoff

## Reconciled baseline — 2026-09-15

PR #46 merged at 21:43:24 UTC with final head
`a4df64626ebe6b2f247d4add6f91e05741a4750a`; merged main is
`2b883aecbbecfcb8a6fdc0073f343aa2289be894`.
Workspace merge `19499c6f421f74e73c447c6b920007338f5a82c3` incorporates that
main on `replit/port`. Recovery branch:
`backup/task10-next-baseline-reconciliation-38c9a98`.

The reconciliation preserves the local typed learning UI and catch-all API
registry rather than introducing duplicate page/route owners. Root companion
adapters re-export the retained server implementations. Upstream framework-free
learning modules, tests, additive migration files, and Firebase changes remain.
No database migration/reset or GitHub push was performed; artifact manifests
and the single serving Next runtime are unchanged.

Verification after reconciliation:

- Local connected regression: 20 root + 27 adapter/persistence tests pass, no skips.
- Imported upstream suite: 23 pass, 2 opt-in database tests skipped
  (`RUN_DB_TESTS` was not enabled); the local database-backed suite above ran.
- Typecheck and Next production build pass.
- Independent read-only merge audit found no actionable merge blockers.
- Managed workflow restarted and served `/` and `/api/auth/firebase-config` with
  HTTP 200. Landing screenshot renders. Browser reported an unidentified resource
  404; Next reported its development cross-origin warning, without server errors.
- All five findings are addressed in the retained serving implementations;
  scorer compatibility, model JSON format, explicit OpenRouter credential
  isolation, citation prompting, export ownership and cohort tests are retained.

The upstream-merge gate is resolved. Full populated browser learning/reporting
journeys remain assigned to the existing downstream tasks; this is not a claim
of live provider, browser sign-in, production migration, or deployed-host proof.

## Historical pre-merge gate and evidence — 2026-09-15

**Blocked, not a reconciled baseline.** PR [#46](https://github.com/groundworklms/SchoolCircleLMS/pull/46)
is open and unmerged at `7b114c703d45b196082b7daa1a634f7761bbfd3d`.
Current GitHub main is `697e4086d7c96041e39c346b3f0d12c5d3f6a173`.
The PR API reports its base SHA as `580a406cb59c8f58e753adf72d515bc2b31debd3`;
that is not the current main revision.

Author: **tewhite4**. No assignees or requested reviewers are recorded.
PR #42 is also open, unmerged, and authored by tewhite4; this handoff neither
replaces it nor changes ownership. Related coordination remains on issues
#4/#26 and integration tracker #10.

Public GitHub REST reads refreshed the PR, all five inline comments, reviews,
issue comments, changed-file list, head checks/status, and main. There is one
COMMENTED automated review, no issue comments, zero check runs, and zero
commit statuses (combined status `pending`). These are not passing CI results.
The six affected source files were read directly from the exact PR head without
checking out, importing, or merging its branch.

This document has **not** been posted to GitHub. It is ready for White or the
existing GitHub coordination lane; write permissions were not retested here.

## Message for White: smallest pre-merge fixes

All five inline findings remain present in the refreshed source:

| PR file | Confirmed problem | Minimal correction |
|---|---|---|
| `lib/arsenal-core.js` | Restore loop copies `rubric` to `session.rubric`; Whetstone needs `criteria` | Remove `rubric` from the generic loop; assign `session.criteria = state.rubric`, else use legacy `state.criteria`. Do not call `start()` on restore. |
| `lib/learning/evidence.js` | Attempt count wins `??`, including zero, ignoring session-only learners | Carry learner-ID sets from both collections and count their union, deduplicating overlap. Do not use `max`, sum counts, or concatenate without deduplication. |
| `app/learn/LearnerTutor.js` | `.map((cj) => ...)` reads undeclared `c` and `j` | Change signature to `.map((c, j) => ...)`. |
| `app/learn/LearnerFeatures.js` | `.map((midx) => ...)` reads undeclared `m` and `idx` | Change signature to `.map((m, idx) => ...)`. |
| `app/teach/InstructorFeatures.js` | `.map((ri) => ...)` reads undeclared `r` and `i` | Change signature to `.map((r, i) => ...)`. |

Local equivalents already have these corrections in `lib/server/arsenal-core.js`,
`lib/server/routes/learning-evidence.js`, and the three corresponding
`app/_learning/*.tsx` components. Adapt the narrow changes to the PR layout;
do not wholesale copy directories across the two route architectures.

### Preserve the more recent, locally proven fixes

- Keep the narrowly scoped terminal scorer adapter on **both start and restore**.
  The pinned Whetstone scorer can return final mastered/complete with an unchanged
  index. Normalize only that exact last-criterion case to the next index; do not
  weaken Session validation or convert other malformed results.
- Keep generic unconstrained object requests in `json_object` mode and structured
  property schemas in `json_schema` mode. PR `lib/model.js` still always requests
  `json_schema`.
- A stored OpenRouter key alone must not activate a provider. Require explicit URL
  and model; send that key only to the HTTPS OpenRouter origin, otherwise require
  an endpoint-specific key. Preserve corresponding Rubricon/Whetstone handling.
- Keep the tutor instruction requiring an inline citation marker inside the answer.
  Do not append citations after generation or relax cite-or-refuse.
- Keep export records owned by the verified instructor, approved-course ownership
  checks, mastery-only cohort membership, and mixed/overlapping cohort regressions.

## Verification package

Fresh local verification at workspace HEAD
`6b811c4d0fb8f327078d820f494c23927602ae0f`:

- `pnpm test`: **20 root tests + 27 adapter/persistence tests passed; zero skips**.
- `pnpm run typecheck`: passed.
- No new live provider calls, production changes, schema setup, runtime changes,
  GitHub writes, or branch reconciliation were performed.

Relevant existing tests to retain/adapt:

- `tests/core-learning-loop.test.mjs`: real Next handlers, auth and PostgreSQL,
  real pinned companion scorer with intercepted model transport, saved/reloaded
  intermediate and terminal turns, version advancement and rubric redaction.
- `tests/model-format.test.mjs`: JSON transport format and credential isolation.
- `tests/evidence-production.test.mjs`: instructor export ownership, four/five
  mastery-only learners, overlapping/disjoint attempt and session membership.

Before accepting the PR's UI, add populated render tests for:

1. A supported tutor response containing at least one citation; render the source
   label/page without a ReferenceError.
2. Learner analytics with a nonempty mastery array; render the row without a
   ReferenceError.
3. A fidelity result with a report and nonempty runs; render verdict/grounding
   without a ReferenceError.

These are test requirements for the handoff, **not claims of completed browser
testing**. Also assert meaningful values from real API projections: fixing the
callback names alone does not validate the UI's expected report shape. The
queued browser/reporting tasks cover that broader journey.

## Resume only after upstream merge

1. Re-read PR state and main; confirm the merged commit is reachable from main.
2. Preserve a recoverable local branch/worktree backup and inventory local changes.
3. Incorporate merged main only on `replit/port`, never the unmerged PR head.
4. Compare the actual resolved working tree against merged main and the backup.
   Preserve original routes, Firebase behavior, recent learning fixes, and the
   managed root Next preview.
5. Resolve duplicate `.js`/`.tsx` page ownership and explicit-versus-catch-all API
   ownership deliberately. Retain one serving app, existing pnpm tooling and
   database; do not run schema resets or replacement setup.
6. Run the connected regression and typecheck on the reconciled tree, restart the
   existing managed workflow after runtime changes, and check preview/logs.

The checklist above describes the former gate; see the reconciliation result at
the top for the completed merge and verification.