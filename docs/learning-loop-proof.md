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

- Signed test sessions exercised normal server verification and authoritative database roles. Browser Firebase/OIDC sign-in was not exercised.
- The instructor approval steps were real API requests, not a human review or a tested browser click journey.
- No proof of offline inference, production readiness, all twelve companion services, or the remote Anchor service is implied.
- Live grading is nondeterministic. Completion at a turn cap does not establish mastery, learning gain, or educational efficacy.
- The deferred access-control work remains deferred; existing protections were not disabled.
- Production was not migrated or configured, and no GitHub push was performed.