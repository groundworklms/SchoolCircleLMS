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
npm run db:migrate            # create the tables
npm run db:seed               # seed a TC 3-22.9 course + instructor + learner
npm run dev                   # http://localhost:3111
```

Point `DOCTRINE_BASE_URL` at a running **Anchor** instance (default `http://localhost:8000`). The
app runs in a resilient "sample mode" if the database isn't up yet, so `npm run dev` shows something
immediately.

**Edge build:** switch the Prisma `datasource` to `sqlite` and set
`DATABASE_URL="file:./schoolcircle.db"` — same schema, same seed, offline on a Jetson.

## The one rule that never bends

Grounded, verified, offline, human-led. Every claim cites the source or the system refuses;
nothing `PENDING` reaches a learner.

## License

Apache-2.0.
