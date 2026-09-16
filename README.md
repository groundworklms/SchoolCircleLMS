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
`MODEL_BASE_URL` + `MODEL_ID` at an OpenAI-compatible model for the generation features
(both are optional for a first run — see `.env.example`). Unset means generation reports an
explicit `503 NO_PROVIDER`; there is no mock and no silent fallback.

Those two variables are only the bootstrap. The generation model is also chosen at runtime in
**Settings → Generation model** — a self-hosted endpoint or a hosted API key — which wins over
them and changes without a redeploy. See
[the generation provider](docs/generation-provider.md).

The product is offline and grounded **by default**: generation runs against self-hosted compute.
An OpenRouter overlay exists for authorized development and testing only, and is selected solely
by pointing `MODEL_BASE_URL` at that exact base URL alongside `OPENROUTER_API_KEY` — a key on its
own never selects a cloud provider. Do not enable it for production or offline deployments. See
[AI course authoring](docs/ai-course-authoring.md).

**Cloud and edge:** Cloud SQL PostgreSQL in the cloud, local PostgreSQL on the
hardware, with the same Prisma schema and a `DATABASE_URL` change. Data is not
automatically synchronized. See [cloud/local database setup](docs/CLOUD_POSTGRES.md)
for secure credentials, migrations, safe seeding, and the approval/rollout checklist.

## The learning loop (`/prototype`, `/api/learning`)

One app, two shells: learners at `/prototype`, instructors at `/prototype/instructor` (the
library — sources, course drafts, rubrics — lives at `/prototype/instructor/{courses,sources,rubrics}`).
The former `/learn` and `/teach` trees are retired — removed outright rather than redirected, so
those paths now 404 (`tests/legacy-route-removal.mjs` keeps them gone). Approved `LearningRecord`
courses appear alongside the mock demo courses and get the views the API can back; see
`app/prototype/learning.js`.

### Course creation

Source-grounded AI generation is the only authoring path. From the instructor
Courses library, select approved POI, materials or doctrine sources and generate
a grounded outline and lessons; objectives can be given one per line or left
blank for AI extraction. Instructors then request question or whole-lesson
revisions and approve an exact reviewed version. Approval materialises an
immutable release with its own delivery id — previous releases, learner
progress, attempts and results are never deleted — and learners receive
approved content with answer keys and rationales redacted.

The workflow uses the existing PostgreSQL `LearningRecord` table with separate
course-draft, revision, immutable-release, progress and attempt records. Linked
media uses HTTPS URLs; this version does not upload files.
See [AI course authoring](docs/ai-course-authoring.md) for the workflow, provider
and grounding rules.

**Manual authoring is retired.** The interactive Course builder and its editors
are gone, and the manual create/save/publish/archive endpoints answer
`410 MANUAL_AUTHORING_RETIRED` so older clients get a deterministic response
instead of a silent write. Records saved by that workflow, their published
playback, progress, grading and results are all preserved.
[The manual authoring contract](docs/MANUAL_AUTHORING_CONTRACT.md) is kept only
as a historical record of that retired API.

The eleven arsenal packages (Quarry, Coursewright, Rubricon, Sourcerer, Whetstone, Sextant,
Cadence, Hotwash, Waypoint, Cartridge, Understudy) are pinned by commit in `package.json` and wired
behind `/api/learning/*` — sources → cited course drafts → rubrics, tutor, mastery sessions, study
plans, analytics, AARs, SCORM export and fidelity benchmarks, every artifact persisted as a
`LearningRecord` and every approval a human click. Contracts: [`docs/learning-api.md`](docs/learning-api.md)
and [`docs/learning-evidence-api.md`](docs/learning-evidence-api.md).

Those routes need a verified identity (the Firebase sign-in, verified server-side with the public
project id — no service account) and answer `401` until Firebase is configured; the rest of the app
is unaffected. `npm test` runs the adapter and evidence contract tests against the real packages;
set `RUN_DB_TESTS=1` with a `DATABASE_URL` to include the Postgres round-trip tests.

## The one rule that never bends

Grounded, verified, offline, human-led. Every claim cites the source or the system refuses;
nothing `PENDING` reaches a learner.

## License

Apache-2.0.
