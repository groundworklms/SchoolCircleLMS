# Core learning-loop evidence

Verified on 2026-09-15 against the development Next.js app and PostgreSQL database.

## Results

| Evidence | Result | Boundary |
|---|---|---|
| Root Next regression suite | 20 passed | Real handlers and database; model I/O controlled in fixtures |
| Adapter/persistence suite | 27 passed | Includes companion contracts and PostgreSQL persistence |
| Typecheck | Passed | Static checks, not a new production build |
| Live HTTP loop | Passed | OpenRouter `openai/gpt-4.1-mini`, real HTTP and PostgreSQL, no model mocks |
| Landing-page preview | Renders | Browser reported an unidentified resource 404; no claim of a full browser test |

## Live sequence

1. Created one explicitly labeled test instructor and one test learner.
2. Ingested a fictional training passage and approved its source.
3. Generated a cited draft, reviewed it, confirmed pending content was hidden from the learner, and approved it.
4. Confirmed approved learner content omitted instructor answer keys.
5. Generated a rubric, validated its grounding, and approved it.
6. Obtained a supported tutor answer with an inline citation and resolved that citation to the approved source.
7. Confirmed an unsupported question was refused without citations. This may stop at retrieval rather than call the model.
8. Started mastery practice, reloaded it, answered, reloaded between turns, and completed a second turn.
9. Compared reloaded progress, version, transcript, report, and attempts against PostgreSQL.
10. Read learner analytics and confirmed the one-learner instructor cohort was suppressed.
11. Deleted only the records and users belonging to the live test. Cleanup passed.

The final connected live run generated one course draft and one rubric, made two tutor requests, and submitted two practice answers. Diagnostic runs were also performed before the final pass. These request counts are not a total token/cost estimate.

The deterministic connected test additionally exercises five distinct learners and verifies that instructor aggregates become available at the cohort threshold without fabricating pre/post assessment results.

## Reproduction

- Deterministic checks: `pnpm test`
- Static check: `pnpm run typecheck`
- Opt-in, paid live check: `node scripts/prove-learning-loop-live.mjs --live`

The live script refuses published hosts, uses the configured development domain, creates isolated test identities, and cleans up only their records. It requires the existing development schema and explicit model configuration. It never resets the database. Each run writes a bounded JSON summary to `/tmp` and prints its path.

## Limits

For the later browser implementation, observed instructor results, and remaining
identity/draft/learner blockers, see
[Browser learning acceptance](browser-learning-acceptance.md). The earlier HTTP
proof below is not evidence that the browser learner journey has passed.

- Signed test sessions exercised normal server verification and authoritative database roles. Browser Firebase/OIDC sign-in was not exercised.
- The instructor approval steps were real API requests, not a human review or a tested browser click journey.
- No proof of offline inference, production readiness, all twelve companion services, or the remote Anchor service is implied.
- Live grading is nondeterministic. Completion at a turn cap does not establish mastery, learning gain, or educational efficacy.
- The deferred access-control work remains deferred; existing protections were not disabled.
- Production was not migrated or configured, and no GitHub push was performed.
## Planning and reporting acceptance — 2026-09-15

Ownership was coordinated on GitHub integration issue #10. Main learner/teacher
pages and citation components were left unchanged. Reporting and approved-course
syllabus access are composed through the existing instructor feature export.

### Automated evidence

- `pnpm run typecheck`: passed.
- `pnpm test`: 36 Next/native tests and 27 integration tests passed, no skips.
- Focused evidence suites: 23 tests passed, including seven PostgreSQL tests.
- `RUN_DB_TESTS=1 node --test test/learning-handlers.test.mjs test/learning-persistence.test.mjs`:
  three passed.
- Real development-store fixtures verify profile edits/reload, persisted syllabus
  and three-COA plans, ICS/reminders, multiple critique submissions, saved AAR
  inputs/provenance/reload, and deterministic equal-timestamp ordering.
- Privacy regressions cover four versus five real learner users, duplicate and
  overlapping membership, instructor/unknown owners, profile deduplication, and
  absence of individual answers or identities in cohort responses.
- Final review additionally required cell-level contributor suppression. The
  focused evidence suite now has 26 passing tests. Five total members do not
  authorize sparse gain objectives, mastery competencies, or profile dimensions
  and modality cells. Gain requires five distinct paired pre/post contributors;
  other reported cells also require five distinct contributors. Repeated records
  cannot satisfy a cell threshold. Full tests and typecheck passed after this fix.

### Focused browser evidence

One browser pass used isolated synthetic users and an approved fictional course:

1. Saved a real syllabus title, future due date and two-hour estimate; reloading
   restored each field.
2. Generated a learner plan and reloaded all three COAs and the recommendation.
3. Saved three of twelve profile answers, reloaded, edited and saved again.
   Missing dimensions stayed explicitly unanswered.
4. Submitted critiques for two labeled iterations; inspected a saved heuristic
   AAR, both iterations, exact inputs and model-unavailable labeling after reload.
5. Confirmed small-cohort suppression and empty, failed, and populated fidelity
   states. The populated report included one scored and one excluded errored run.
6. Removed the two synthetic users and nine generated learning records and
   verified no fixture rows remained.

### Boundaries

Fresh-course planning was additionally checked after a review questioned the
planning-date payload. The course had no `asOf`; the instructor UI sent only
`{ syllabus }`. The captured learner POST sent `courseId`,
`asOf: "2026-09-15"`, `availability: 60`, and calendar options and returned 201
with all three COAs. `LearnerStudyPlan.handleCreate` supplies today's ISO date
at click time; it does not require a pre-seeded course date. The production test
now uses these exact panel payload shapes and verifies persisted input, reload,
and calendar output. The focused follow-up removed two users and three records
and verified zero remaining fixture rows.

- Browser authentication used signed test sessions, not a new interactive OIDC
  sign-in test. AAR browser evidence used deterministic generation without paid
  model calls; injected model failure is separately covered by route/DB tests.
- The calendar button was exercised, but Playwright did not emit a download
  event for its blob anchor. The authenticated endpoint returned `text/calendar`
  with VCALENDAR boundaries; calendar structure is covered by contract tests.
  Import into Outlook/Google Calendar was not tested.
- Some unrelated resource 404s appeared; tested feature flows still passed.
- Genuine pre/post gain input is supported and tested with explicit synthetic
  scored records. The existing conversational mastery producer does not create
  such evidence, so ordinary mastery-only courses correctly show insufficient
  evidence. Assessment producer/browser ownership remains with the learning lane.
- No production migration, real-doctrine upload, wargaming expansion, offline
  inference proof, or educational efficacy claim is implied.
