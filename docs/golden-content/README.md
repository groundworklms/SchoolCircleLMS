# Golden-content review package

**PENDING — synthetic rehearsal only. No real publication is approved by this package.**

This package supports the content owner on [GitHub #7](https://github.com/groundworklms/SchoolCircleLMS/issues/7).
The public issue was read on 2026-09-15: it assigns corpus screening, golden-course
curation and ratification to the content/SME owner. It contains no release decision.
No human reviewer was available in this task session. API approval in the earlier
[live proof](../learning-loop-proof.md) is not human review.

## Files and evidence

- `manifest.json`: provenance, publication candidates, missing release evidence and review owner.
- `inputs.json`: exact reused fictional source, course-generation inputs, banked lesson/scenario,
  rubric review reference and mastery objective. The banked draft is a review aid,
  **not** an importable Coursewright response or a replacement for the missing 36-item bank.
- `cases.json`: grounded, unsupported, false-premise, ambiguous-standard and gated-PME cases.
- `../../scripts/validate-golden-content.mjs`: repository-only checks (run command below).

The existing live-proof passage is reused verbatim rather than generating fresh
content for appearance. Its page 1 is a **fixture page**, not a printed doctrine page.
All real-publication candidates remain unavailable. A published repository's prior
claim of releasability, a citation in a seed, or an API `APPROVED` status is not a
distribution statement or a reviewer signature. No databases, hardware, controlled
libraries, production records or real source publications were accessed.

## Reproduce without side effects

From the repository root:

```sh
node scripts/validate-golden-content.mjs
```

This reads local fixtures and checks passage reuse, citations, coverage and pending
gates. It makes no network/model/database calls and imports nothing. Passing means
package consistency, **not** an evaluation pass or approval.

## Opt-in development import/generation

Use the current [learning API](../learning-api.md), not the planned routes in the
older instructor-loop design. An authorized instructor must explicitly choose an
isolated development instance and dedicated synthetic test accounts. Do not use a
published host or shared learner/class records. Use the existing signed-in session;
do not copy tokens or credentials into files. Generation may incur model charges.

1. Run the local validator. Confirm the target is development and record the run
   identifier and package revision in a local evidence ledger without personal data.
2. With the instructor session, `POST /api/learning/sources` using `inputs.source`
   plus `text = inputs.source.pages.map(p => p.text).join('\n\n')`. Use a unique
   run suffix for `sourceId` and title to distinguish runs. Expect 201 and `PENDING`.
   Keep the returned **record `id`**; the submitted `sourceId` is only a label.
3. Stop for source review. Check every passage and the synthetic-only release scope.
   Only after the instructor records a real decision may they explicitly call
   `POST /api/learning/sources/{recordId}/approve` with `{}`. The generator can accept
   an owner's pending source, so this procedure adds a deliberate review gate.
4. `POST /api/learning/courses/draft` with `inputs.courseDraft` plus
   `sourceIds: [recordId]`. Expect 201/PENDING. `GET /api/learning/courses/{id}`
   as the owner to inspect the actual generated sections, citations, questions,
   scenario, coaching and instructor summary. Never substitute `bankedDraft` into
   persistence or assume that regeneration is byte-identical.
5. `POST /api/learning/rubrics/generate` with
   `{sourceId: recordId, task: inputs.rubricTask}`. Expect PENDING; inspect all
   anchors against page 1 and `bankedDraft.rubricReviewReference`. Missing level
   definitions must remain flagged. Do not assert that an unflagged rubric is
   correct merely because the automated traceability checks pass.
6. Leave course and rubric PENDING until the instructor completes the ledger
   below. Only after approval may they explicitly invoke the respective
   `/courses/{id}/approve` and `/rubrics/{id}/approve` endpoints with `{}`.
   Flagged/ungrounded rubrics must not be approved. Do not bypass rejection via DB edits.
7. In a dedicated learner session, run `POST /api/learning/tutor` with
   `{sourceIds: [recordId], question: case.question}` for the tutor cases.
   App citations use **`recordId p.1`**, not the fixture label. Resolve them through
   `GET /api/learning/sources/{recordId}` and match the exact quote and page.
   The app uses `refused`; Anchor's older contract uses `abstained`. A refusal is
   HTTP 200, not transport failure. Missing model/service configuration is blocked,
   not a passing refusal. Run the ambiguous case through rubric generation with
   its vague standard; never approve that result automatically.
8. Only with approved course and source, start
   `POST /api/learning/mastery/sessions` with `inputs.masteryStart` plus
   `{sourceId: recordId, courseId}`. Keep this synthetic; termination at two turns
   is not mastery or learning gain. The PME case remains unavailable.
9. Hand off locally retained generated records and evidence only after content
   review and release clearance. No auto-cleanup/reset is supplied: use a disposable
   development dataset and coordinate its disposal with its owner. The existing
   `prove-learning-loop-live.mjs --live` creates/deletes its own records and approves
   them programmatically; it is **not** this human-review procedure.

## Review ledger and handoff gate

Current decision for source, lesson, rubric, planning scenario and mastery objective:
**PENDING; reviewer not yet attested; no approval date or evidence.**

For each artifact, the content owner records outside Git if identifying details are
needed: package revision/checksum; generated record ID; source edition; exact printed
page and paragraph (fixture page for synthetic content); release evidence; review
date; accountable reviewer; APPROVE / EDIT / REVISE / REJECT; reasons; changed claims;
unresolved ambiguities; and permitted audience/environment. Publish only a sanitized
decision reference here after authorization. An edit requires another citation check.

| Open question | Owner / resolution required |
|---|---|
| Where is the existing 36-item bank? | Content owner supplies location and provenance; inspect before replacing or copying. |
| Which publication editions are approved? | Content owner verifies official publication copy, date/change, distribution notice, printed-page mapping and upload authorization. |
| What separates satisfactory from proficient? | Instructor supplies authorized level definitions; retain ambiguity until then. |
| Is real MCPP coverage available? | Not here. Obtain reviewed MCWP 5-10 input through authorized handling; synthetic planning is not doctrine validation. |
| Are PME ELOs available? | No. Gated material stays outside this public repository, including derived text/evals. |

For downstream browser/offline verification, deliver this package as **available
synthetic inputs, pending human review**. Approved instructional inputs: **none**.
Record each case as NOT_RUN / PASS / FAIL / BLOCKED with actual citation, refusal
reason, model/service identity and evidence reference. Do not commit transcripts
with personal/controlled data. Browser execution, device isolation and SCORM runtime
proof belong to their respective lanes; this package makes no claims about them.