# Gameday team plan — lanes and evidence ownership

Four lanes support one Next.js application and one evidence record. Read this
with [`EVIDENCE-MATRIX.md`](./EVIDENCE-MATRIX.md), dated **2026-09-15**, and
the current operator brief [`RANGE-CARD.md`](./RANGE-CARD.md). The historical
objective and metrics remain in [`COLD-BORE.md`](./COLD-BORE.md).

## The team

| Member | Lane | Current mission |
|---|---|---|
| **Morgan (Jesse)** | Grounding, integration, and corpus | Keep source/provider boundaries explicit and reconcile adapter evidence |
| **White** | Next.js, Prisma, and API | Maintain the root app, PostgreSQL data path, auth/role boundaries, and route contracts |
| **McDonald** | Learning UI | Refine `/learn` and `/teach`; keep the historical `/prototype` separate from current claims |
| **Thompson** | QA and product voice | Review the learner/instructor experience, record bounded observations, and own **#9 run-of-show** |

## Current surfaces and ownership

### Morgan — grounding, integration, corpus

- Reconcile source citations, refusal behavior, provider readiness, and adapter
  results against the evidence matrix.
- Preserve the human approval boundary for source, course, rubric, and
  instructor-authored records.
- Track the historical five-use-case corpus and hardware numbers without
  presenting them as current offline acceptance.
- Distinguish fixture/injected-model checks, PostgreSQL persistence checks, and
  connected development HTTP checks.
- Do not treat a remote Anchor endpoint, cloud configuration, or an old Orin
  run as current deployment proof.

### White — Next.js and data

- Keep the single root Next.js process and native `app/api` route handlers.
- Maintain the Prisma PostgreSQL schema and existing migration history; no
  SQLite conversion or connection-string swap.
- Preserve verified identity and role boundaries: `/teach` is instructor-only
  and `/learn` is the learner surface.
- Keep provider failures explicit rather than filling them with simulated
  output.
- Use the repository's pnpm scripts and default Replit port behavior
  (`$PORT`, default `3000`).

### McDonald — learning UI

- Build against `/learn` and `/teach`, matching the existing learning shell and
  API hooks.
- Keep learner views limited to approved course/source projections and keep
  instructor review states visible.
- Treat `/prototype` as a historical reference while migrating no current
  evidence back to that route.
- Report UI observations with route and scope; a visual observation is not
  browser acceptance.

### Thompson — QA and product voice

- Review the current `/learn` learner path and `/teach` instructor path as
  product surfaces, subject to the authentication and provider boundaries.
- Own the issue/observation intake and the five-minute presentation order.
- Retain **GitHub issue #9 QA/run-of-show ownership for the full demo**.
  Use case #9 (PME Mastery Eval) is a separate identifier: explain its mastery
  objective, actual records, and any ELO stand-in or missing provider.
- Keep the presentation honest about the historical prototype, Orin/offline
  material, SCORM export, and any unverified browser or hosted behavior.

## Evidence hand-offs

1. **Source → authoring:** Morgan records source identity, approval state, and
   grounding scope; White keeps the persisted record boundary.
2. **Authoring → learner:** White and McDonald verify that `/learn` receives
   approved projections, while pending instructor material remains a review
   state.
3. **Mastery → run-of-show:** Thompson maps the #9 story to the actual
   `/learn` route and the evidence matrix, not to the historical prototype.
4. **Provider/test result → record:** The lane owner names the command,
   environment, date, and limits before calling a result evidence.

The feedback widget and issue board are coordination aids only. They do not
replace the dated evidence matrix, and no repository automation or CI workflow
is required for this plan.

## Working agreement

- Use **pnpm** only: `pnpm install`, `pnpm run db:generate`,
  `pnpm run dev`, `pnpm run typecheck`, and the scoped test scripts in
  `package.json`.
- Do not start a second API/web process. Do not use Docker or refer to
  `ops/` scripts; neither is part of this repository baseline.
- Use PostgreSQL through the existing `DATABASE_URL`; do not swap to SQLite or
  alter the schema as a documentation task.
- Separate current evidence from historical Cold Bore numbers and label
  unrecorded dates as unknown.
- Keep the five-use-case objective visible while reporting each route and
  provider at its actual evidence level.

## Initial setup

```bash
git clone https://github.com/groundworklms/SchoolCircleLMS
cd SchoolCircleLMS
pnpm install
pnpm run db:generate
pnpm run dev
```

The root Next server uses `0.0.0.0:$PORT` with a default port of `3000`.
Read the dated matrix and Range Card before interpreting a local result.
