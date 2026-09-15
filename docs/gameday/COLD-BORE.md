# Operation Cold Bore — battle plan

> This is the concise, historical battle plan for Operation Cold Bore. It does
> not supersede the dated evidence or operator documents:
> [`EVIDENCE-MATRIX.md`](./EVIDENCE-MATRIX.md) and
> [`RANGE-CARD.md`](./RANGE-CARD.md), both current authority as of
> **2026-09-15**. The full design stack remains in [`../`](../).

**AI Learning Hackathon · 15–18 Sep 2026 · Unclassified / releasable**

## Objective

Build one grounded learning spine that can serve five use cases:

| Use case | Intended binding | Current Next surface |
|---|---|---|
| **#1 Rubric Generator** | Standard → traceable rubric, with ambiguous material flagged for an instructor | `/teach` rubric generation and review |
| **#13 Instructional Design** | Objectives and sources → course structure and learning materials | `/teach` source and course authoring |
| **#16 MCPP Modernization** | MCWP 5-10 material → a planning-oriented course and scenario | Course authoring objective; no separate acceptance claim |
| **#12 AI Tutor** | Approved source → cited answer or explicit refusal | `/learn` tutor and source viewer |
| **#9 PME Mastery Eval** | Objective → rubric and discussion-to-mastery record | `/learn` mastery session; current evidence is matrix-bounded |

The five-use-case cluster remains the product objective, not a statement that
five production workflows have been accepted. The evidence matrix is the
authority for each route, provider, persistence, and verification boundary.

The use-case number **#9** is distinct from Thompson's GitHub issue **#9**.
Thompson retains run-of-show ownership for this use case.

## Current application baseline

SchoolCircle is one **Next.js 15 App Router** application. The root Next
process serves the landing page, authentication entry point, planning board,
learning UI, teaching UI, and native API route handlers. The current learning
surfaces are:

- `/learn` — authenticated learner dashboard, courses, mastery, tutor, source
  viewer, study plan, progress, and profile.
- `/teach` — authenticated instructor surface for sources, approval, course
  drafts, rubrics, syllabus, fidelity, AAR, and SCORM export controls.
- `/prototype` — retained historical prototype route; do not describe it as
  the current learning application.

The learning routes use verified identity and role boundaries and the current
data path is Prisma over PostgreSQL. Provider readiness is explicit: a
configured model or companion service is not inferred from a route existing,
and unavailable providers must remain unavailable rather than being represented
as successful output.

## Evidence boundary

The current evidence record is in
[`EVIDENCE-MATRIX.md`](./EVIDENCE-MATRIX.md) (dated 2026-09-15). The companion
[`RANGE-CARD.md`](./RANGE-CARD.md) is the current operator brief. In particular,
the current record does not establish hosted/cloud acceptance, a complete
browser journey, offline inference, production readiness, all companion
services, or consumption by an LMS.

The learning-loop proof records a development Next/PostgreSQL check on
2026-09-15: 20 root regression tests passed, 27 adapter/persistence tests
passed, typecheck passed, and a connected HTTP sequence used OpenRouter and
PostgreSQL without model mocks. Its deterministic connected check covered five
distinct learners and the cohort threshold without fabricating learning-gain
results. These are bounded development observations, not universal safety,
browser, cloud, offline, or educational-efficacy claims.

## Historical record

The following numbers and hardware statements are retained from the original
gameday material or its named evidence files. Dates are **not recorded** where
the source did not record one; counts have their original scope and must not be
combined as if they were one test run.

| Historical result | Original source and scope | Boundary |
|---|---|---|
| **5 / 5** use cases described as built and offline verified | Original Cold Bore SITREP; date not recorded | Historical planning claim, not current offline acceptance |
| **146** NAVMC 3500.44E tasks parsed and BARS-ready | Original Cold Bore corpus board; date not recorded | Historical corpus preparation, not a current route result |
| **345** grounded corpus chunks from TC 3-22.9 + MCWP 5-10 | Original Cold Bore SITREP; date not recorded | Historical combined-corpus claim |
| **163** MCWP 5-10 chunks and **345** app-FTS chunks | Original Cold Bore corpus board; date not recorded | Historical corpus/index counts; retain their separate scopes |
| **Jetson Orin Nano 8GB** and a five-service Anchor setup | Original Cold Bore hardware/SITREP; date not recorded | Historical target hardware, not current runtime evidence |
| **36-item** golden course | Original Cold Bore progress notes; date not recorded | Historical demo artifact claim |
| **17** Cadence tests and **16** Hotwash tests | Original Cold Bore gap-fill notes; date not recorded | Historical per-repository test counts |
| **700+** tests | Original WINPLAN arsenal scorecard; date not recorded | Historical aggregate claim; no consolidated current run is implied |
| **5 / 5** out-of-doctrine questions refused | Original WINPLAN selected demo-question claim; date not recorded | Historical test/demo claim; distinct from the harder adversarial set, not a current acceptance threshold |
| **13** native Request/Response tests and **27** adapter/auth/PostgreSQL tests | `arsenal-verification.md`, audit scope/date not recorded | Separate audit scopes; not additive and not an LMS/browser acceptance |
| **20** root and **27** adapter/persistence tests | `learning-loop-proof.md`, verified 2026-09-15 | Development evidence with the limits stated above |
| BARS traceability, cited-answer/refusal, mastery, and SCORM run-of-show described as complete | Original Cold Bore progress notes; date not recorded | Historical narrative result; no current route, offline, browser, or LMS acceptance |

The arsenal remains a historical architecture reference: Anchor, Quarry,
Rubricon, Coursewright, Sourcerer, Whetstone, Sextant, Understudy, Cartridge,
Cadence, Hotwash, and Waypoint. The current Next app wires selected adapters;
the evidence matrix records which seams are fixture-tested, persistence-tested,
or still unavailable.

## Reproducible root checks

Use the repository's **pnpm** scripts only:

```bash
pnpm install
pnpm run db:generate
pnpm run dev
```

The root server binds to `0.0.0.0` and uses `$PORT`, defaulting to **3000**.
`DATABASE_URL` points at the existing PostgreSQL database. The root app does
not replace or push the schema. There is no SQLite connection-string swap, no
Docker step, no second service, and no `ops/` runbook or script in this
repository.

For bounded checks, use `pnpm run typecheck`, `pnpm run test:next`,
`pnpm run test:api`, or `pnpm test`; read their scope alongside the evidence
matrix rather than converting a pass into a broader acceptance claim.

## Planning guardrails

- Treat `/learn` and `/teach` as the current learning surfaces; `/prototype`
  is historical context only.
- Treat approved-content and role checks as application boundaries, not as a
  certification of safety or production readiness.
- A SCORM export control and deterministic cartridge tests do not prove that a
  consuming LMS accepted or ran the package.
- Keep Thompson's ownership of the #9 run-of-show. Do not add repository
  automation or CI assumptions to this plan.
