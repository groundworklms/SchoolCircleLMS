<div align="center">

# SchoolCircle

### A grounded, offline, human-led learning platform.

**Grounded · Verified · Offline · Human-led**

Every answer cites the manual — or the system refuses. Nothing unreviewed reaches a student.

</div>

---

## What this is

SchoolCircle is the learning management app instructors and students use. It orchestrates a
platoon of standalone services and routes every claim through Anchor — an offline grounding
engine that answers only from cited doctrine or refuses. AI drafts; a human ratifies; a student
learns.

- **Instructor loop** — build a grounded course, review AI-drafted items, see class-wide gaps, improve.
- **Learner loop** — learn, ask a cited tutor, get calibrated by confidence-vs-correctness, master it.

## Repo layout

| Path | What it is |
|---|---|
| `app/` | The Next.js 15 application and route handlers. |
| `lib/` | Shared Prisma, grounding, model, and provider adapters. |
| `prisma/` | The extended Postgres schema and existing migrations. |
| `docs/` | Build, design, and integration documentation. |

## Run the app locally

```bash
pnpm install
pnpm run db:generate
pnpm run db:deploy          # apply committed migrations to the confirmed dev database
NODE_ENV=development ALLOW_DEMO_SEED=true pnpm run db:seed # isolated demo fixtures only
pnpm run dev
```

The server binds to `0.0.0.0` and uses `$PORT` when supplied (default `3000`). Set
`DATABASE_URL` for the existing Postgres database. Database migrations are owned by the API/data
lane; this root app does not replace or push the schema.

**Cloud and edge:** Cloud SQL PostgreSQL in the cloud, local PostgreSQL on the
hardware, with the same Prisma schema and a `DATABASE_URL` change. Data is not
automatically synchronized. See [cloud/local database setup](docs/CLOUD_POSTGRES.md)
for secure credentials, migrations, safe seeding, and the approval/rollout checklist.

## The learning loop (`/learn`, `/teach`, `/api/learning`)

The eleven arsenal packages (Quarry, Coursewright, Rubricon, Sourcerer, Whetstone, Sextant,
Cadence, Hotwash, Waypoint, Cartridge, Understudy) are pinned by commit in `package.json` and wired
behind `/api/learning/*` — sources → cited course drafts → rubrics, tutor, mastery sessions, study
plans, analytics, AARs, SCORM export and fidelity benchmarks, every artifact persisted as a
`LearningRecord` and every approval a human click. Contracts: [`docs/learning-api.md`](docs/learning-api.md)
and [`docs/learning-evidence-api.md`](docs/learning-evidence-api.md).

Those routes need a verified identity (Firebase or the original Replit session, verified server-side
with the public project id when Firebase is used — no service account) and answer `401` until an
auth provider is configured; the rest of the app is unaffected. `pnpm run test:upstream-learning`
runs the merged adapter and evidence contract tests against the real packages; `pnpm test` runs
the connected Next/API suites. Set `RUN_DB_TESTS=1` with a `DATABASE_URL` to include Postgres
round-trip tests where supported.

## The one rule that never bends

Grounded, verified, offline, human-led. Every claim cites the source or the system refuses;
nothing `PENDING` reaches a learner.

## License

Apache-2.0. See `LICENSE`.
