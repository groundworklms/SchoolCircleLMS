# Browser learning journey — historical Replit acceptance

## Evidence classification and upstream boundary

All workflow observations, implementation descriptions, counts, commands, and
remaining-work items below describe the **2026-09-15 Replit development branch**,
not current upstream main. Present-tense wording in the historical record refers
only to that environment. These reports do not establish that unported UI,
Replit authentication, test issuers, or removed scripts are available upstream.
This docs-only submission did not rerun browser or external-provider journeys.

The inspected upstream baseline was
`4d799dad2028cf555ddecedeaecff0175abfc825`. Its reproducible repository gates are
`npm install`, `npm run build`, and `npm test`, subject to their documented
configuration. Database tests are opt-in; skipped tests are not database proof.
Those gates cannot establish browser acceptance, Firebase provider login, or
the historical Replit OIDC path. Historical `pnpm run typecheck` and
`test/tutor-locator.test.mjs` checks below are not upstream commands: that
typecheck script and locator test are absent at this baseline.

See [the earlier historical HTTP and reporting evidence](learning-loop-proof.md)
and [the native upstream learning API](learning-api.md). No production,
external-provider, offline inference, hardware, LMS, or educational-efficacy
acceptance is implied. No controlled source content, credentials, private user
data, or temporary test claims are included.

Development-only checks on 2026-09-15. **The latest continuation exercised the
previously blocked learner, tutor, and mastery browser flows successfully, with
the generation caveat below.** This document separates observed workflow
behavior from content quality and external-provider readiness; it does not
replace the earlier HTTP evidence.

## Historical latest continuation: previously blocked flows

After the user requested another check, the same named tester continued only
the previously unexecuted course/learner/tutor/mastery checks. No new tester or
whole-site pass was started.

- **Source preflight:** Coursewright's actual deterministic `chunk`/`match`
  functions found the exact fictional source/objective pair before generation
  (score 0.637, threshold 0.34). Its `fromDocuments` skips uncovered objectives;
  an empty section array is therefore not itself proof of model unavailability.
  The exact cause of the earlier empty draft was not reconstructed.
- **Instructor:** Real supported-test-issuer OIDC callback, authoritative
  instructor role, source creation, two-page inspection, source approval,
  one-section draft inspection, and course approval passed through the browser.
  Updated approval state and success feedback were visible.
- **Generation caveat:** The sole section was explicitly
  `refused: true`, with reason `lesson not grounded in the passage`. The inspector
  exposed that refusal. The course was still approvable because current approval
  checks require inspected nonempty sections, not a usable grounded lesson.
  This is workflow evidence, **not successful grounded lesson generation**.
  No lesson or answer key was fabricated.
- **Separate learner:** Real supported-test-issuer OIDC callback established a
  separate learner account. Dashboard and Courses displayed the approved course,
  the course deep link opened, and `/teach` correctly denied instructor access.
- **Tutor supported answer:** One question about water evaporation produced a
  grounded answer. Its citation opened the exact approved source record/page.
  Escape closed the locator and returned focus to the triggering button;
  tutor history was preserved.
- **Tutor refusal:** One unrelated mercury/Mars question returned
  `Refused: not_in_sources` with no citation control or fabricated HHEM score.
- **Mastery:** One answer produced saved feedback, a mastered evaporation
  criterion, 33% progress, and a next prompt without an object-rendering crash
  or answer-key disclosure. Navigating to Courses and back, then reloading the
  direct course URL, preserved feedback, transcript, progress, and next prompt.
- **Confidence:** The unavailable notice was verified in the browser. The
  teammate-owned first-class attempt/mastery/schedule write contract remains
  absent, so no confidence attempt was recorded. This is the task's explicit
  missing-contract branch, not a claim of implemented confidence persistence.

This continuation used one source, one source approval, one course draft, one
course approval, two tutor asks, one mastery session, and one answer. No separate
rubric generation was needed. Exact network counts were not instrumented.
The tester deleted exactly its two isolated users and six owned learning
records, cleared test claims, and restored the managed workflow's normal issuer.
No real accounts or production records were touched.

Firebase Google login was not retried. The earlier unauthorized-domain result
remains a recorded limitation of that provider; the successfully exercised
authentication path was Replit OIDC with the supported test issuer. This does
not establish human external-provider or production sign-in.

Evidence screenshots from this continuation: `2a3y6h` (source approval),
`xgcck9` (inspected refusal section), `slbh5z` (course approval), `ko89gj`
(separate learner course list), `fld293` (citation locator), and `aqeh53`
(reloaded 33% mastery progress). These are tester evidence IDs, not persistent
public URLs.

## Historical ownership checked before editing

The live GitHub issues were read:

- [Frontend lane](https://github.com/groundworklms/SchoolCircleLMS/issues/8):
  assigned to canester67, covering prototype screens. Its discussion records
  the prototype lesson-reader integration as done, with other screens remaining.
- [Write-path lane](https://github.com/groundworklms/SchoolCircleLMS/issues/4):
  assigned to tewhite4, covering item approval, attempts, mastery, and schedules.

Historical implementation changes were limited to the then-existing Next `/learn`, `/teach`, shared
learning hooks, and Firebase login/provider UI. No prototype QA issues were
created or taken over, and no backend, schema, production, or authorization
gates were changed. The active API is the catch-all Next handler's
`lib/server/integration.js` registry, not the similarly named inactive modules.

## Implemented in the historical branch (not an upstream feature inventory)

- Firebase login resolves the authoritative server user before choosing the
  default instructor/learner destination; safe explicit return paths remain
  supported. Auth initialization failures are visible. Teaching/learning gates
  expose Firebase and Replit sign-in separately. Role navigation is not login.
- Source and draft inspection expose loading, retry, failure, and success states.
  Approval refreshes list and detail state without unmounting populated cards.
  Draft approval is disabled until inspected, nonempty sections are available.
- Tutor citations resolve the actual serving contract: `source` contains
  `<record-id> p.<page>`, while `sourceId` is a human label. The locator checks
  record identity, approval, and exact page, with explicit unavailable states,
  keyboard return, and focus restoration. Refusals show no citations or invented
  HHEM score.
- Learner navigation stores the selected area/course in the URL. Mastery consumes
  persisted questions, criteria, feedback, and transcript without rendering
  object values directly or displaying answer-key fields. Submission guards,
  inline errors, and awaited refreshes prevent stale-question interaction.
- Query hooks cancel obsolete requests, clear Firebase-user-scoped data on
  identity changes, and refresh on window focus and successful mutations.
- Confidence practice explicitly says unavailable and records no attempt.
  The serving app has no teammate-owned confidence attempt/mastery/schedule
  write endpoint to consume. No replacement endpoint or schema was introduced.
  Conversational mastery is not presented as pre/post assessment evidence.

## Historical earlier bounded browser results (superseded where noted above)

One named tester covered the pass and continuations of its blocked portions.
No fresh tester or whole-site repeat was launched.

| Check | Result | Limit |
|---|---|---|
| Public landing and Firebase login form | Passed | Anonymous render only |
| Firebase Google sign-in | Blocked | `Firebase: Error (auth/unauthorized-domain)` on the development preview domain |
| Replit OIDC browser login/callback | Passed with supported test issuer | Not proof of a human production/provider account login |
| Authoritative role enforcement | Passed | Isolated test subject initially mapped to LEARNER and was denied `/teach`; only its test-owned DB role was provisioned as INSTRUCTOR |
| Instructor source creation/inspection/approval | Passed | One fictional source; both pages inspected; APPROVED and success message visible without stale PENDING state |
| Generated draft inspection | Blocked | One draft displayed zero sections; root cause was not established |
| Draft approval | Not executed | Tester declined to approve the empty draft |
| Separate learner sign-in and populated course | Not executed | No approved generated course was available from this pass |
| Tutor exact-page click/return and refusal | Not executed in browser | Pure locator regression tests passed, but do not establish browser acceptance |
| Mastery submission/navigation/reload | Not executed in browser | Implemented and typechecked, not claimed as browser-proven |
| Confidence practice persistence | Blocked | Teammate write-path contract is absent |

The normal external Replit issuer reached its hosted login page; no credentials
were entered. The successful callback above used the supported test issuer,
normal state/nonce/PKCE verification, and authoritative database roles—not
forged cookies, client role toggles, or disabled gates.

Counts: one source, one source approval, one draft, zero course approvals,
zero rubrics, zero tutor asks, zero mastery answers, and zero confidence attempts.
Exact network request counts were not instrumented. Two unspecified 404 resource
loads appeared during the course flow; no root cause is claimed.

All created test users and their learning records were deleted by exact owned
identity/record selection. No real users or shared records were changed. Temporary
issuer claims were cleared and the original managed workflow was restored.

## Other historical verification (not upstream reproduction commands)

- `pnpm run typecheck`: passed.
- `node --test test/tutor-locator.test.mjs`: four tests passed, including the
  real citation shape, human-label separation, malformed/conflicting locators,
  exact page matching, and no page substitution.
- `git diff --check`: passed.
- Focused code review identified the initial citation field mismatch; after
  correction the locator-only re-review passed.
- The post-check empty-draft approval guard was confirmed statically, not with
  another browser run.

## Remaining work recorded after the historical continuation

These are historical gaps, not a statement of current upstream ownership or
an instruction to introduce a competing backend. Recheck current issues and
merged fixes before implementation.

1. Improve generation/review handling for skipped objectives and refusal-only
   drafts. The latest pass proves the browser workflow but not usable grounded
   lesson generation; approval currently accepts an inspected refusal section.
2. Correct Firebase authorized-domain configuration through the identity owner
   if Firebase sign-in on this development host is required.
3. After the existing write-path owner delivers the contract, connect confidence
   capture before disclosure to that contract, verify one persisted attempt and
   resulting mastery/schedule, and refresh the learner UI. Do not create a
   competing backend.