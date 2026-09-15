# 08 · Gameday Build Guide — SchoolCircleLMS from zero

You are a fresh instance building **SchoolCircleLMS**. This is the runnable order. Work top to
bottom; every step has a check. Your two authoritative briefs are the **Range Card** (demo wiring +
the four sequence diagrams) and the **Cold Bore plan** (arsenal, assembly, Orin access). This `docs/`
stack is the design + architecture detail behind them.

> **North star:** the ultimate *learning loop* for the learner and the ultimate *build → plan →
> review* loop for the instructor — grounded (every AI claim cites the manual or refuses), verified
> (HHEM on-device), human-led (nothing `PENDING` reaches a student), offline-capable, open-source.
> See `00-north-star.md`, `06-learner-loop.md`, `07-instructor-loop.md`.

---

## 0 · Definition of done (check these at the end)
- [ ] `/learn` renders in White's house style (frosted rail → content → agenda, Apple-gray + Marine scarlet) — role switch Instructor/Learner works.
- [ ] Instructor loop end-to-end: Studio generates a **cited** course (PENDING) → Review ratifies → Rubrics → Class progress → Course AAR.
- [ ] Learner loop end-to-end: Course/lessons → Ask (cite-or-refuse) → Mastery (discuss-to-mastery) → Study plan → progress.
- [ ] Ask tutor **widget** (bottom-right) answers or refuses against Anchor; **QA issue** widget (bottom-left, dev-only) files a repo issue with captured context.
- [ ] Offline check: pull the network — Ask still answers (Anchor on the edge); generation degrades gracefully.
- [ ] `docs/` stack copied into the repo. All arsenal repos installed. Prisma migrated + seeded.

---

## 1 · Scaffold + house style FIRST
```bash
npx create-next-app@latest schoolcirclelms --js --app --no-tailwind --eslint
cd schoolcirclelms
```
- App Router, React 19, Next 15. Dev port **3111** (`next dev -p 3111`).
- **Before any screen**, drop the design tokens + shell from **`01-design-system.md`** into `app/learn/cosmos.css` (the `:root` token palette + `.s-rail`/`.s-content`/`.s-agenda` shell + card/tile/prog/chat/step/cite/modal/widget classes). Everything you build after this is on-brand by default.
- Route group: `app/learn/**` for the app, `app/api/**` for route handlers. Roles behind one swappable seam (`lib/auth.js`) → later CAC / SSO / LTI 1.3.

**Check:** an empty `/learn` shows the frosted rail + Apple-gray ground.

## 2 · Bring the knowledge with you
```bash
cp -r ../grounded-training-demo/docs ./docs      # this stack travels with the repo
```

## 3 · Data layer (Prisma)
- Add the **exact schema in `03-data-model.md`** (`User/Course/Section/Item/Attempt/Mastery/Schedule`, enums `Role/ItemKind/ItemStatus`). Postgres for the product; **SQLite for edge — swap `datasource.provider` + `DATABASE_URL`, nothing else.**
```bash
docker compose up -d            # local Postgres :5432  (edge: skip, use sqlite file)
cp .env.example .env.local      # set DATABASE_URL
npm install                     # runs prisma generate
npm run db:migrate              # create tables
npm run db:seed                 # TC 3-22.9 course + 1 instructor + 1 learner
```
**Privacy guardrail (do not break):** there is **no ClassGap table**. The instructor class view is a
`GROUP BY` over `Attempt` that never `SELECT`s `learnerId` (`lib/db.js → classGaps()`). Keep it a
query, not a table. See `03-data-model.md`.

## 4 · Consume the arsenal
Eleven npm libraries (Anchor is the external service). Install from GitHub:
```bash
npm i github:groundworklms/quarry github:groundworklms/coursewright github:groundworklms/rubricon \
      github:groundworklms/sourcerer github:groundworklms/whetstone github:groundworklms/sextant \
      github:groundworklms/understudy github:groundworklms/cartridge github:groundworklms/cadence \
      github:groundworklms/hotwash github:groundworklms/waypoint
```
Each is Apache-2.0, ESM, Node ≥18, pure/deterministic core with an injectable model client. Exact
exports + the call/return shape for each are in **`05-arsenal-contracts.md`**.

## 5 · Grounding (Anchor)
- Add `lib/doctrine.js` — the adapter (same shape as `textProvider()`), gated by `DOCTRINE_BASE_URL`. Unset → grounding reports unavailable, nothing else changes.
- **Abstention returns HTTP 200**, not an error. "The corpus doesn't support an answer" is a correct response; a 4xx pushes callers into a `catch` whose natural fallback is the ungrounded model — which re-introduces the invented doctrine we exist to prevent. See `04-grounding-and-anchor.md` for the exact `/api/ask` request/response contract (captured, not illustrative).
- Bring Anchor up on the Orin and open the tunnel (step 9).

## 6 · Environment (`.env.local`)
```bash
DATABASE_URL="postgresql://postgres:postgres@localhost:5433/schoolcircle"  # or file:./edge.db (sqlite)
OPENROUTER_API_KEY="sk-or-..."         # authoring model (prep only); pulled from the Orin, see below
DOCTRINE_BASE_URL="http://127.0.0.1:8000"   # Anchor via the tunnel; unset = grounding off
DOCTRINE_TIMEOUT_MS=30000
# Per-repo model config is optional — each platoon repo falls back to OPENROUTER_API_KEY.
# Override only when you want a different key/endpoint/model for one soldier:
#   COURSEWRIGHT_API_KEY / COURSEWRIGHT_ENDPOINT / COURSEWRIGHT_MODEL   (same pattern per repo)
```
Pull the authoring key from the Orin (never commit it): `bash ops/get-key.sh .env.local`.
Models: text `google/gemini-3-flash-preview`, diagrams `google/gemini-3.1-pro-preview` (OpenRouter).

## 7 · Wire each surface to its soldier
The **Range Card's four sequence diagrams are the exact call chains** — build to them:

| Surface (route) | Soldiers | The call |
|---|---|---|
| **Studio** `POST /api/generate/course` (SSE) | Quarry → Coursewright, grounded by Anchor, HHEM-verified | `generateCourse(poi, emit)`; abstain drops the claim; items land `PENDING` |
| **Review** `POST /api/items/:id/action` | (human) + Cartridge on publish | approve/edit/reject → `Item.status`; `buildCartridge` → SCORM |
| **Ask** `POST /api/ask` | Sourcerer + Anchor + Understudy (fidelity gate) | `askDoctrine(q)` → cite-or-refuse; FTS fallback still cites |
| **Mastery** `POST /api/mastery/start`·`/turn` | Whetstone | `deriveRubric/firstQuestion/scoreTurn` → `Attempt`/`Mastery` |
| **Rubrics** `POST /api/rubric/generate` | Rubricon | `generateRubric(task)` → BARS + κ; vague → flag SME |
| **Class progress** `/learn/insight` | Sextant | `learningGain/classGaps/masteryRollup` (aggregate, no learnerId) |
| **Course AAR** `POST /api/aar` | Hotwash | `hotwash({critiques})` → ranked worklist + memo |
| **Study plan** `POST /api/plan` | Cadence | `plan()` → 3 COAs + `toICS()`; writes `Schedule` |
| **Learner profile** `/learn/profile` | Waypoint | `profile()` + `classProfile()` |

Full per-surface detail: `06-learner-loop.md` (learner) and `07-instructor-loop.md` (instructor).

## 8 · The two widgets
- **Ask tutor** — floating icon **bottom-right**, persistent on every screen; opens a compact grounded chat wired to `POST /api/ask` (cite-or-refuse, HHEM badge, clickable citations → exact passage). This is the AI tutor as a widget.
- **QA issue-reporter** — floating icon **bottom-left, clear of the sidebar**, **dev-mode only** (`process.env.NODE_ENV !== 'production'` or a `?qa=1` flag). Auto-captures role / view / lesson / URL / screen / time; the reviewer types a note and it files a **prefilled GitHub issue** to the repo (label `qa`). Widget CSS/markup + the capture/submit JS are in `01-design-system.md` (they exist working in `grounded-training-demo/app.html` — copy from there).

## 9 · Ops / preflight (run cold, then again before the demo)
```bash
docker start schoolcircle-dev            # local Postgres
bash ops/tunnel.sh                       # workstation :8000 → Anchor on the Orin — KEEP OPEN
npm run dev                              # app on :3111
bash ops/orin-check.sh                   # link · services · health · corpus · key — all green
# then: open /learn/ask, ask "what is trigger control?" → confirm source = anchor
```
- Orin access facts (SSH key `id_ed25519` — NOT nahawi.pem — host, `/api/*` endpoints, key location): see the **Cold Bore ACCESS** section. Do not restate secrets in code or commits.
- ⚠ The tunnel is **not persistent**. If the tutor shows `source = fts`, re-run `ops/tunnel.sh`. If it drops mid-demo the **FTS fallback still answers *with citations*** — degrade, don't crash.

## 10 · Verify + demo
- Green-light checks: the `orin-check.sh` row is all-green; a cited answer + a live refusal both fire; a rubric generates; a mastery turn records a score; SCORM exports.
- Run the **5-minute run-of-show** and keep the **contingencies** handy — both in the Range Card (SHOW / CONTINGENCY).

---

## Known gotchas (Windows dev box)
- `node --test` prints `pass N / fail 0` then **dawdles on exit** — the summary line is the truth even if the shell hangs; wrap with `timeout`.
- `/tmp` path mismatch between Git Bash and Node — write to relative paths, not `/tmp`.
- The Anchor tunnel drops under rapid parallel SSH; `ops/*.sh` do all remote work in **one** SSH connection.
- Postgres dev container is `schoolcircle-dev` on host port **5433**.

## Build order in one line
`scaffold + tokens → copy docs → prisma migrate/seed → npm i arsenal → lib/doctrine + env → wire surfaces to soldiers → widgets → ops preflight → verify → run the show.` The build is **wiring, not inventing** — every soldier is already public, tested, and green.
