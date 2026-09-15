<div align="center">

# SchoolCircle

### A grounded, offline, human-led learning platform.

**Grounded · Verified · Offline · Human-led**

Every answer cites the manual — or the system refuses. Nothing unreviewed reaches a student.

**[▶ Live demo](https://groundworklms.github.io/SchoolCircleLMS)** · [Spec stack](docs/README.md) · [Gameday kit](docs/gameday/README.md)

</div>

---

## What this is

SchoolCircle is the learning management app instructors and students use. It orchestrates a
platoon of standalone services (see [github.com/groundworklms](https://github.com/groundworklms)),
and routes **every** claim through **Anchor** — an offline grounding engine that answers only from
cited doctrine or refuses. AI drafts; a human ratifies; a student learns. That guarantee is the
product.

- **Instructor loop** — build a grounded course, review AI-drafted items, see class-wide gaps, improve.
- **Learner loop** — learn, ask a cited tutor, get calibrated by confidence-vs-correctness, master it.

## Repo layout

| Path | What it is |
|---|---|
| `web/` | The static showcase (landing + interactive demo) — deployed to GitHub Pages. |
| `docs/` | The full build & design spec stack (start at [`docs/README.md`](docs/README.md)). |
| `docs/gameday/` | The operator kit — Range Card, Cold Bore plan, team plan, boot prompts. |
| `app/`, `lib/`, `prisma/` | The Next.js 15 application (the real product). |

## The live demo

The interactive showcase in `web/` deploys automatically to
**https://groundworklms.github.io/SchoolCircleLMS** on every push to `main`. It's an illustrative
prototype of the full instructor + student experience — the spec stack is how it becomes the real
thing.

## Run the app locally

```bash
docker compose up -d          # local Postgres
cp .env.example .env.local    # set DATABASE_URL + DOCTRINE_BASE_URL (Anchor)
npm install
npm run db:deploy             # apply committed migrations to the confirmed dev database
NODE_ENV=development ALLOW_DEMO_SEED=true npm run db:seed # isolated demo fixtures only
npm run dev                   # http://localhost:3111
```

Point `DOCTRINE_BASE_URL` at a running **Anchor** instance for grounded answers, and
`MODEL_BASE_URL` + `MODEL_ID` at a self-hosted OpenAI-compatible model for the generation features
(both are optional for a first run — see `.env.example`). The product is offline: generation runs
against self-hosted compute, never a cloud API.

**Cloud and edge:** Cloud SQL PostgreSQL in the cloud, local PostgreSQL on the
hardware, with the same Prisma schema and a `DATABASE_URL` change. Data is not
automatically synchronized. See [cloud/local database setup](docs/CLOUD_POSTGRES.md)
for secure credentials, migrations, safe seeding, and the approval/rollout checklist.

## The one rule that never bends

Grounded, verified, offline, human-led. Every claim cites the source or the system refuses;
nothing `PENDING` reaches a learner.

## License

Apache-2.0.
