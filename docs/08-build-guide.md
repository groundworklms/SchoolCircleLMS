# 08 · Gameday Build Guide — SchoolCircleLMS from zero

You are a fresh instance building **SchoolCircleLMS**. This is the runnable order. Work top to
bottom; every step has a check. Your two authoritative briefs are the **Range Card** (demo wiring +
the four sequence diagrams) and the **Cold Bore plan** (arsenal, assembly, Orin access). This `docs/`
stack is the design + architecture detail behind them.

> **North star:** the ultimate *learning loop* for the learner and the ultimate *build → plan →
> review* loop for the instructor — grounded (every AI claim cites the manual or refuses), verified
> (HHEM on-device), human-led (nothing `PENDING` reaches a student), open-source — and grounded
> **offline**: Anchor answers on the board with the network cable out. The app’s own sign-in still
> needs Firebase Auth, so scope that claim to Anchor (see step 0 and step 9).
> See `00-north-star.md`, `06-learner-loop.md`, `07-instructor-loop.md`.

---

## 0 · Definition of done (check these at the end)
- [ ] `/prototype` renders in White's house style (frosted rail → content → agenda, Apple-gray + Marine scarlet) — role switch Instructor/Learner works.
- [ ] Instructor loop end-to-end: Studio generates a **cited** course (PENDING) → Review ratifies → Rubrics → Class progress → Course AAR.
- [ ] Learner loop end-to-end: Course/lessons → Ask (cite-or-refuse) → Mastery (discuss-to-mastery) → Study plan → progress.
- [ ] Ask tutor **widget** (bottom-right) answers or refuses against Anchor; **QA issue** widget (bottom-left, dev-only) files a repo issue with captured context.
- [ ] Offline check, scoped: pull the network cable — **Anchor** still answers `/api/health`,
  `/api/corpus` and `/api/ask` with paragraph-level citations, and still refuses out-of-corpus
  questions. **Log in first:** SchoolCircle’s sign-in goes through Firebase Authentication over the
  internet as configured today, so with the cable out the app cannot authenticate a new session.
  That is an auth-configuration property, not a property of the board. Demo Anchor’s offline
  proof, not the app’s.
- [ ] `docs/` stack copied into the repo. All arsenal repos installed. Prisma migrated + seeded.

---

## 1 · Scaffold + house style FIRST
```bash
npx create-next-app@latest schoolcirclelms --js --app --no-tailwind --eslint
cd schoolcirclelms
```
- App Router, React 19, Next 15. Dev port **3111** (`next dev -p 3111`).
- **Before any screen**, drop the design tokens + shell from **`01-design-system.md`** into `app/prototype/prototype.css` (the `:root` token palette + `.s-rail`/`.s-content`/`.s-agenda` shell + card/tile/prog/chat/step/cite/modal/widget classes). Everything you build after this is on-brand by default.
- Route group: `app/prototype/**` for the app (a single `[[...path]]` catch-all; `routes.js` holds the
  URL grammar), `app/api/**` for route handlers. `/learn` and `/teach` are **retired and must stay
  404** — `tests/legacy-route-removal.mjs` enforces it. Roles behind one swappable seam (`lib/auth.js`) → later CAC / SSO / LTI 1.3.

**Check:** an empty `/prototype` shows the frosted rail + Apple-gray ground.

## 2 · Bring the knowledge with you
```bash
cp -r ../grounded-training-demo/docs ./docs      # this stack travels with the repo
```

## 3 · Data layer (Prisma)
- Add the **exact schema in `03-data-model.md`** (`User/Course/Section/Item/Attempt/Mastery/Schedule/LearningRecord`, enums `Role/ItemKind/ItemStatus`). **One schema, `provider = "postgresql"`, both ends** — Cloud SQL in the cloud, local Postgres on the hardware; change `DATABASE_URL`, keep the provider (`prisma/schema.prisma:4`). A SQLite **edge** target is a real goal but is **not** a connection-string-only swap (`docs/CLOUD_POSTGRES.md:251`) — do not plan the demo around one.
```bash
docker compose up -d            # local Postgres :5432, container schoolcircle-db
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
- **Abstention returns HTTP 200**, not an error. "The corpus doesn't support an answer" is a correct response; a 4xx pushes callers into a `catch` whose natural fallback is the ungrounded model — which re-introduces the invented doctrine we exist to prevent. See `04-grounding-and-anchor.md` for the `/api/ask` request/response contract, including which field names are Anchor’s wire format and which are the adapter’s.
- Bring Anchor up on the Orin. **No tunnel is needed**: Anchor binds the USB device-mode interface
  directly at `http://192.168.55.1:8000`, reachable from the one laptop the board is cabled to
  (`ops/tunnel.sh` exists only for reaching it from somewhere else). See `docs/orin-offline-config.md`.

## 6 · Environment (`.env.local`)
Copy `.env.example` and edit it — it is the authoritative list; the excerpt below is the short version.

```bash
DATABASE_URL="postgresql://schoolcircle:schoolcircle@localhost:5432/schoolcircle_dev?schema=public"
DOCTRINE_BASE_URL="http://192.168.55.1:8000"   # Anchor’s direct USB bind; unset = grounding off
DOCTRINE_TIMEOUT_MS=30000
# ONE shared text provider serves every helper (lib/providers.js). There is no
# per-repo <NAME>_API_KEY / _ENDPOINT / _MODEL trio — it was never implemented.
MODEL_BASE_URL="http://192.168.55.1:8080/v1"   # the Orin’s llama-server, $0 per call
MODEL_ID="/opt/tutor/models/gemma-4-E2B_q4_0-it.gguf"   # llama-server reports the full path as the id
MODEL_API_KEY=""                                # only if the endpoint needs one
# Cloud alternative (authorized dev/testing only):
# MODEL_BASE_URL="https://openrouter.ai/api/v1"; MODEL_ID="google/gemini-3.1-pro-preview"; OPENROUTER_API_KEY="sk-or-..."
```
- **`127.0.0.1:8000` only works if you are running the now-unnecessary SSH tunnel.** The proven
  address is `http://192.168.55.1:8000` (see step 5).
- There is **no `ops/get-key.sh`** — `ops/` holds only `orin-check.sh` and `tunnel.sh`. Put the key
  in `.env.local` by hand and never commit it.
- The generation provider can also be set at runtime in **Settings → Generation model**, which wins
  over these variables; the doctrine address likewise in **Settings → Doctrine engine**. On a hosted
  deployment that runtime panel is the *only* way — a USB address is unroutable from App Hosting, so
  `apphosting.yaml` deliberately leaves `DOCTRINE_BASE_URL` unset.

## 7 · Wire each surface to its soldier
The **Range Card's four sequence diagrams are the exact call chains** — build to them:

| Surface (route) | Soldiers | The call |
|---|---|---|
| **Studio** `POST /api/learning/courses/draft` (`/draft/stream` for SSE) | Quarry → Coursewright, grounded by Anchor, HHEM-verified | `draftCourseRecord()` in `lib/learning/core.js`; abstain drops the claim; items land `PENDING` |
| **Review** `POST /api/learning/courses/[id]/items/[itemId]/review`, `.../approve` | (human) + Cartridge on publish | approve/edit/reject → item status; `buildCartridge` → SCORM |
| **Ask** `POST /api/learning/tutor` (legacy alias `/api/doctrine`) | Sourcerer + Anchor + Understudy (fidelity gate) | `tutor()` in `lib/learning/core.js` → cite-or-refuse. Anchor unreachable → the engine is reported **unavailable** and the turn records `FAILED`; **there is no FTS fallback** |
| **Mastery** `POST /api/learning/mastery/sessions`·`/[id]/turn` | Whetstone | `startMastery`/`masteryTurn` → `MASTERY_SESSION`/`MASTERY_ATTEMPT` records |
| **Rubrics** `POST /api/learning/rubrics/generate` | Rubricon | `generateRubricRecord()` → BARS + κ; vague → flag SME |
| **Class progress** `GET /api/learning/analytics?scope=cohort` | Sextant | `learningGain/classGaps/masteryRollup` (aggregate, no learnerId) |
| **Course AAR** `/api/learning/aar`, `/api/learning/aar/critiques` | Hotwash | `hotwash({critiques})` → ranked worklist + memo |
| **Study plan** `/api/learning/study-plan` | Cadence | `plan()` → 3 COAs + `toICS()`; writes `Schedule`. (`/api/plan` is unrelated — it serves `PLAN.md`.) |
| **Learner profile** `/api/learning/profile`, `/api/learning/profile/cohort` | Waypoint | `profile()` + `classProfile()` |

Full per-surface detail: `06-learner-loop.md` (learner) and `07-instructor-loop.md` (instructor).

## 8 · The two widgets
- **Ask tutor** — floating icon **bottom-right**, persistent on every screen; opens a compact grounded chat wired to `POST /api/learning/tutor` (cite-or-refuse, HHEM badge, clickable citations → exact passage). This is the AI tutor as a widget.
- **QA issue-reporter** — floating icon **bottom-left, clear of the sidebar**, **dev-mode only** (`process.env.NODE_ENV !== 'production'` or a `?qa=1` flag). Auto-captures role / view / lesson / URL / screen / time; the reviewer types a note and it files a **prefilled GitHub issue** to the repo (label `qa`). Widget CSS/markup + the capture/submit JS are in `01-design-system.md` (they exist working in `grounded-training-demo/app.html` — copy from there).

## 9 · Ops / preflight (run cold, then again before the demo)
```bash
docker start schoolcircle-db             # local Postgres (container name from docker-compose.yml)
npm run dev                              # app on :3111
bash ops/orin-check.sh                   # link · services · health · corpus — all green
# then: open /prototype, sign in, open a course's tutor, ask "what is trigger control?"
#       → expect a cited answer; then ask a Javelin question → expect a refusal
```
- **No tunnel step.** Anchor binds `192.168.55.1:8000` over USB device-mode; `ops/tunnel.sh` is only for reaching the board from a machine it is *not* plugged into.
- **Sign in before you pull the cable.** Firebase Authentication is an internet endpoint; Anchor's offline proof does not extend to the app's login.
- Orin access facts (SSH key `id_ed25519` — NOT nahawi.pem — host, `/api/*` endpoints, key location): see the **Cold Bore ACCESS** section. Do not restate secrets in code or commits.
- ⚠ If the Orin link drops there is **nothing to degrade to** — the tutor reports the grounding engine unavailable and records the turn `FAILED`. Do not stand there waiting for a cited fallback answer: re-seat the USB cable, then `sudo systemctl restart tutor-api` on the board.

## 10 · Verify + demo
- Green-light checks: the `orin-check.sh` row is all-green; a cited answer + a live refusal both fire; a rubric generates; a mastery turn records a score; SCORM exports.
- Run the **5-minute run-of-show** and keep the **contingencies** handy — both in the Range Card (SHOW / CONTINGENCY).

---

## Known gotchas (Windows dev box)
- `node --test` prints `pass N / fail 0` then **dawdles on exit** — the summary line is the truth even if the shell hangs; wrap with `timeout`.
- `/tmp` path mismatch between Git Bash and Node — write to relative paths, not `/tmp`.
- The Orin's SSH link drops under rapid parallel connections; `ops/*.sh` do all remote work in **one** SSH connection.
- Postgres dev container is `schoolcircle-db` on host port **5432** (`docker-compose.yml`) — not `schoolcircle-dev` on 5433.
- **Git Bash rewrites Unix-looking env values.** `STUDENT_LOCAL_MODEL_ID=/opt/tutor/...` becomes `C:/Program Files/Git/opt/tutor/...` via MSYS path conversion, which then fails the adapter's exact-match check as `STUDENT_LOCAL_MODEL_UNAVAILABLE`. Prefix with `MSYS_NO_PATHCONV=1`.

## Build order in one line
`scaffold + tokens → copy docs → prisma migrate/seed → npm i arsenal → lib/doctrine + env → wire surfaces to soldiers → widgets → ops preflight → verify → run the show.` The build is **wiring, not inventing** — every soldier is already public, tested, and green.
