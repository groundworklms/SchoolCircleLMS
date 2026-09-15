# WINPLAN — an evidence-led plan

This is a planning document, not a competing source of truth. Current state
and acceptance boundaries live in
[`EVIDENCE-MATRIX.md`](./EVIDENCE-MATRIX.md), dated **2026-09-15**. The current
operator brief is [`RANGE-CARD.md`](./RANGE-CARD.md). This plan must not
override either document or turn a historical demo statement into evidence.

## Win thesis

The product objective is a grounded, human-led learning loop: source-backed
answers, explicit refusal when grounding is insufficient, and instructor review
before learner delivery. That is a design thesis with bounded supporting
evidence, not an absolute safety claim. The useful differentiator is the
clarity of the boundary: show what was tested, what was fixture-backed, and
what remains unavailable.

## Current baseline

SchoolCircle is a single Next.js 15 App Router application using Prisma over
PostgreSQL. The current learning routes are:

- `/learn`: authenticated learner dashboard, approved-course view, mastery,
  tutor/source view, study plan, progress, and profile.
- `/teach`: authenticated instructor authoring, source approval, course drafts,
  rubric review, fidelity, AAR, and SCORM export controls.
- `/prototype`: the retained historical prototype; it is not the current
  learning route.

The root process is the Replit Next process. It uses `pnpm`, binds to
`0.0.0.0`, and defaults `$PORT` to **3000**. `DATABASE_URL` is the existing
PostgreSQL connection. There is no SQLite swap, Docker instruction, or
repository `ops/` script in the current baseline.

The current status and test limits are evidence questions, not assumptions:
model, Rubricon, Whetstone, and doctrine readiness can be unavailable; browser,
hosted/cloud, offline-inference, production, and consuming-LMS acceptance are
not claimed unless the dated matrix says otherwise.

## Five-use-case objective

| # | Objective | Current product face | Honest planning position |
|---|---|---|---|
| **1** | Rubric generation from a standard | `/teach` Rubrics | Surface exists; use matrix for provider and persistence evidence |
| **13** | Instructional design | `/teach` Sources and Courses | Generic authoring surface; no separate course acceptance claim |
| **16** | MCPP modernization | Course objective using MCWP 5-10 material | Historical target; no standalone current acceptance claim |
| **12** | AI tutor | `/learn` tutor/source view | Exercise only with configured provider and approved source |
| **9** | PME mastery evaluation | `/learn` mastery session | Historical stand-in ELOs; real EWSDEP 8670 material and current acceptance remain separate gates |

## A bounded presentation sequence

Use the sequence in the current Range Card, recording any new observation in
the evidence matrix rather than relying on this plan:

1. Explain the five-use-case objective and the source-review boundary.
2. Show `/teach` source and draft controls, including pending versus approved
   state, only where the configured development environment supports it.
3. Show `/learn` approved-course, tutor, and mastery surfaces, labeling model
   availability and persistence evidence.
4. Show a cited answer/refusal or a deterministic test result with its exact
   scope; do not present a fixture as a live provider result.
5. Show SCORM generation only as an export artifact/route observation. Do not
   claim that a remote or consuming LMS accepted it.

Thompson retains **#9 run-of-show ownership** and the product-facing ordering
of these beats. A presentation is not a browser acceptance test; a hosted
link is not cloud acceptance; and an offline aspiration is not offline proof.

## Risks and decisions

| Risk | Decision rule |
|---|---|
| Provider is unavailable | Surface the explicit unavailable state; do not substitute a fabricated result |
| Authenticated browser journey is incomplete | Record the route/API boundary and keep browser acceptance unclaimed |
| Historical Orin/offline demonstration is not reproducible | Preserve it as historical hardware evidence; do not call the current Next app offline-verified |
| Export is not consumed by an LMS | Keep the export/contract result separate from LMS acceptance |
| Historical docs disagree with the matrix | The dated matrix wins; update the record, not the claim |

## Historical metrics retained

The original win plan reported **700+ tests**, **5 / 5** refused adversarial
questions, a Jetson/Anchor offline demonstration, and the five-use-case
cluster. Dates and aggregate scopes were not recorded there. The original Cold
Bore record retains the **146** NAVMC tasks, **163** MCWP chunks, **345**
app-FTS/combined chunks, Orin hardware, 36-item course, and per-repository
Cadence/Hotwash counts. These remain useful historical context; none is a
current cloud, browser, offline, or LMS acceptance statement.

The dated learning-loop proof records 20 root regression tests, 27
adapter/persistence tests, a passing typecheck, a connected OpenRouter/
PostgreSQL development sequence, and a deterministic five-learner cohort
check. Its limits remain in force: no browser sign-in proof, human browser
review proof, offline inference, production readiness, or full companion
service verification.

## Root commands

```bash
pnpm install
pnpm run db:generate
pnpm run dev
pnpm run typecheck
pnpm test
```

These commands describe the repository's reproducible root checks only. No
Docker, `ops/` scripts, or repository automation is part of the run plan.
