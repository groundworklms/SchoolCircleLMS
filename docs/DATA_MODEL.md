# Data model (Postgres + Prisma)

The persistence layer for the grounded LMS. Where the doctrine adapter talks to Anchor, this
is where the LMS keeps its own state: users, the course, generated items, attempts, mastery,
and the spaced-repetition schedule.

## Stack

- **Postgres** for the real product (local dev via `docker-compose.yml`; managed Postgres in
  the approved enclave for the enterprise/Track-B deployment).
- **The same schema on local PostgreSQL** for offline/edge (a Jetson at a schoolhouse):
  keep the Prisma provider and change `DATABASE_URL`. Cloud and local data remain
  independent; a URL change does not synchronize them. SQLite requires additional
  compatibility work and is not supported by this setup.
- **Prisma** as the ORM/migration tool.

## Get it running (local)

```bash
docker compose up -d          # local Postgres on :5432
cp .env.example .env.local    # then set DATABASE_URL (default matches the compose file)
npm install                   # runs prisma generate
npm run db:deploy             # apply migrations to the confirmed dev target
NODE_ENV=development ALLOW_DEMO_SEED=true npm run db:seed # isolated demo fixtures only
```

See [Cloud PostgreSQL setup](CLOUD_POSTGRES.md) for target confirmation, seeding
guards, Cloud SQL networking and Secret Manager setup.

## The tables

| Model | What it holds |
|---|---|
| `User` | instructor or learner. `externalId` reserves the LTI `sub` claim, so local accounts and MarineNet/SSO identities share one table later without a migration. |
| `Course` / `Section` | the course tree; `Course.sourceId` is the Anchor corpus id (e.g. `TC 3-22.9`). |
| `Item` | a generated lesson claim / question / scenario, with its **citation**, HHEM **support** score, and an **approval status** — the human-in-the-loop guardrail (nothing `PENDING` reaches a student). |
| `Attempt` | one answer. `confidence` is captured **before** the reveal; with `correct` it is the calibration signal — the confidently-wrong learner. `gradedAgainst` records the citation the answer was graded against. |
| `Mastery` | derived per-learner, per-section mastery + calibration gap. |
| `Schedule` | confidence-weighted spaced repetition: `dueAt`, `interval`. |

## The privacy boundary lives in the schema, not the UI

There is **no `ClassGap` table.** The instructor's class view is a query — `classGaps()` in
`lib/db.js` — that groups `Attempt` by section and **never selects `learnerId`**. So an
instructor sees where the *class* is weak (miss rate by section, the confidently-wrong
cohort), and *cannot* be handed one Marine's answers, by construction. Individual data
(`Attempt`, `Mastery`) is only ever read on a learner-scoped path, for that learner. Keep it
this way: do not add a learner filter to the aggregate query, and do not turn the aggregate
into a per-student table.

## MarineNet-readiness (why this shape)

- **Auth** is not modeled as passwords here; `User.externalId` is the seam. A local-credentials
  provider now, an LTI 1.3 / SSO provider later — same `User` rows.
- **Scores/completion** derive from `Attempt` + `Mastery`, which map cleanly to *both* LTI
  grade-passback (`cmi`-free) and SCORM `cmi.core.score`/`lesson_status`. One model, two
  export targets — so MarineNet integration is a connector, not a rewrite.
