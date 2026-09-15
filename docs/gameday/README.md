# Gameday kit

This kit is supporting planning material for the current Next.js app. Read the
dated [`EVIDENCE-MATRIX.md`](EVIDENCE-MATRIX.md) and current
[`RANGE-CARD.md`](RANGE-CARD.md) first; both are current authority as of
**2026-09-15**. Narrative plans must not turn historical results into
acceptance claims.

## Current routes

| Route | Surface |
|---|---|
| `/` | Landing page and sign-in entry |
| `/learn` | Authenticated learner surface |
| `/teach` | Authenticated instructor surface |
| `/plan` | Planning-board reader |
| `/prototype` | Historical prototype; not the current learning surface |

The app is one Next.js 15 process. The root Replit command uses **pnpm**, binds
to `0.0.0.0`, and defaults `$PORT` to `3000`. The current data path is Prisma
over PostgreSQL. There is no SQLite connection-string swap, Docker instruction,
second service, or repository `ops/` script in this baseline.

```bash
pnpm install
pnpm run db:generate
pnpm run dev
```

The repository's bounded checks include `pnpm run typecheck`,
`pnpm run test:next`, `pnpm run test:api`, and `pnpm test`. Their scope and
limits are recorded in [`EVIDENCE-MATRIX.md`](EVIDENCE-MATRIX.md).

## Files

| File | Purpose |
|---|---|
| [`EVIDENCE-MATRIX.md`](EVIDENCE-MATRIX.md) | Dated current evidence and explicit limits |
| [`RANGE-CARD.md`](RANGE-CARD.md) | Current operator brief and presentation boundaries |
| [`COLD-BORE.md`](COLD-BORE.md) | Five-use-case objective and labeled historical record |
| [`WINPLAN.md`](WINPLAN.md) | Evidence-led planning; cannot override the matrix |
| [`TEAM-PLAN.md`](TEAM-PLAN.md) | Current lanes and evidence hand-offs |
| [`BOOT.md`](BOOT.md) | Historical boot prompts; use the current root commands above |
| [`SCORING-CARD.md`](SCORING-CARD.md) | Judging criteria and planning references |
| [`DATA-HANDLING.md`](DATA-HANDLING.md) | Data-handling guidance |
| [`../README.md`](../README.md) | Deep design and architecture documentation index |

## Lane reading

- **Morgan / White:** [`../02-architecture.md`](../02-architecture.md),
  [`../03-data-model.md`](../03-data-model.md),
  [`../04-grounding-and-anchor.md`](../04-grounding-and-anchor.md),
  [`../05-arsenal-contracts.md`](../05-arsenal-contracts.md),
  [`../08-build-guide.md`](../08-build-guide.md), and
  [`../07-instructor-loop.md`](../07-instructor-loop.md).
- **McDonald:** [`../01-design-system.md`](../01-design-system.md),
  [`../06-learner-loop.md`](../06-learner-loop.md), and
  [`../07-instructor-loop.md`](../07-instructor-loop.md).
- **Thompson:** [`TEAM-PLAN.md`](TEAM-PLAN.md),
  [`RANGE-CARD.md`](RANGE-CARD.md), and the learner/instructor loop docs above.

Keep five-use-case objectives, historical Orin/corpus/test metrics, and current
route evidence separate. Hosted/cloud, browser, offline-inference, production,
and consuming-LMS acceptance are not implied by this kit unless added to the
dated evidence matrix. Thompson retains the #9 run-of-show; the use-case #9
label is separate from any issue number.