# WINPLAN — how we win this hackathon

The single source of truth for winning the MCU-NPS AI Learning Initiatives Hackathon.
Everything else in this kit supports this file: [`SCORING-CARD.md`](SCORING-CARD.md) is the rubric,
[`RANGE-CARD.md`](RANGE-CARD.md) is the operator's brief and demo runbook, [`COLD-BORE.md`](COLD-BORE.md)
is the battle plan, [`TEAM-PLAN.md`](TEAM-PLAN.md) is the lanes. If any of those disagree with this
file on *current state*, this file is right — the others are older.

**Win thesis:** We are the only team whose AI *cannot* make up doctrine — every claim cites the
manual or the system refuses, it's *verified* on-device (not asserted), it runs *offline* on a $500
board with the network pulled, and a human ratifies everything before a Marine sees it. That is the
whole game: **grounded · verified · offline · human-led.** We don't win by having more features. We
win by being the trustworthy one, and by proving it live.

---

## Canonical facts (use these, not older copies)

- **Live app:** https://schoolcircle.tannerwhite.net — Firebase App Hosting, **auto-deploys from `main`**.
- **App routes today:** `/` (landing + login), `/prototype` (the student + instructor UI). The
  deeper docs sometimes say `/learn` — that is the *intended* product name; the route rename
  `/prototype → /learn` is tracked in **#8** (originally flagged in **#14**). Until it merges, the
  working route is **`/prototype`**.
- **Repo / org:** github.com/groundworklms — `SchoolCircleLMS` is the app; the 12-repo arsenal is
  alongside it.
- **Grounding:** Anchor on a Jetson Orin, offline, cite-or-refuse, HHEM-verified. Proven working on
  the local rig. **Not yet wired on the cloud app** (`DOCTRINE_BASE_URL` unset in Firebase) — see
  Risk B.
- **Authoring model seam:** `MODEL_BASE_URL` / `lib/model.js`. Currently a cloud model; the winning
  move is to point it at **GenAI.mil (Gemini over CAC)** — see the "free points" note below.

---

## 1 · Win condition — criterion by criterion

Nine criteria, 90 points (five scored, four bonus at 0.05x). For each: what we show, and the
artifact that proves it.

| # | Criterion | Wt | What we SHOW | Proof artifact |
|---|---|----|--------------|----------------|
| 1 | **Mission Impact** | 30% | Grounded training that can't lie, at the schoolhouse, edge-first; MarineNet as the front door via LTI 1.3 + grade passback. | The pitch + TRANSITION section (RANGE-CARD); SCORM export landing somewhere real. |
| 2 | **Technical Innovation** | 25% | The **verification throughline** — say "proven, not asserted" out loud: Rubricon=grounding, Sourcerer=faithfulness, Whetstone=mastery, Sextant=learning gain, Understudy=fidelity. | The five soldiers + the live refusal + HHEM badge. |
| 3 | **Usability & Design** | 20% | Role switch, cited answer with HHEM badge, the live refusal — the loop understood in one beat. The landing→login→app flow reads as a real product. | The live app; the Ask + QA widgets. |
| 4 | **Security & Sustainability** | 15% | Apache-2.0 ×**13** public repos (12 arsenal + SchoolCircle), **564 tests in this repo, 0 failures (5 skipped)**, offline delivery with no ATO dependency, one swappable auth seam. **Name the auth seam as a known gap before a judge finds it.** | The org, the tests, the offline demo, `lib` auth seam. |
| 5 | **Team Collaboration** | 10% | Multiple lanes, multiple GitHub accounts in history, the issue board + QA-widget intake loop. **More than one teammate must speak in the 5 minutes.** | TEAM-PLAN, the commit history, the board. |

**Bonus (0.05x each):**
- **Living on the Edge** — *won outright.* Pull the network; delivery still cites-or-refuses; $0/answer.
- **Reach the Enterprise** — *won.* SCORM export + LTI 1.3 path into MarineNet. Show the export landing, not a file on disk.
- **Sanctioned and Approved** — *FREE POINTS, currently unclaimed.* Point the authoring call at
  **GenAI.mil (Gemini, CAC over CampusNet)** instead of a commercial cloud model. It's a
  `MODEL_BASE_URL` + credential swap on the one seam that already exists — **no architecture change,
  does not touch offline delivery.** Needs a CAC + reader on site. **Owner: White + Morgan. Do this.**
- **Supercharge** — partly claimed via methodology (hybrid BM25+dense + RRF, per-pub calibrated
  thresholds, HHEM entailment gating). If NPS HPC access lands, run the adversarial set as a
  threshold grid search to turn the claim into a demonstration.

**The number to lead with:** *5 / 5 out-of-doctrine questions correctly refused.* When asked, name
the honest counterpart — the adversarial set is deliberately harder than the demo, and over-refusal
is the price we pay for never lying. A team that names its own failure rate is the one a DoW room
believes.

---

## 2 · Current state — built vs. left (honest)

**Working now:**
- Live app deploys from `main` (Firebase). Landing + login (in progress), `/prototype` UI, the 12-repo arsenal public + tested.
- Both signature widgets live: **Ask-the-doctrine** (grounded via `/api/doctrine`) and **QA report** (→ GitHub issues).
- Anchor grounding **verified end-to-end on the local rig** — cited answers, correct refusals, HHEM scores.
- Prisma data layer builds + seeds (TC 3-22.9 course, instructor, learner).

**Left to do (tracked):**
- **#4 — the write path.** Approve/reject items, save attempts, roll up mastery, set schedule. *This is the critical path* — without it the human-in-the-loop guardrail and the learner loop don't persist. **(White)**
- **#6 — wire generate/ingest/plan through Anchor**, persist items as `PENDING` with citations. **(Morgan)**
- **#7 — corpus + ratification.** Screen doctrine, ingest, ratify items. **(Morgan)**
- **#8 — connect prototype screens to real data**; rename route `/prototype → /learn`; fix #13 (X-to-close), #12 (hover dots). **(McDonald)**
- **#9 — QA sweep + run-of-show ownership.** **(Thompson)**
- **#10 — TRACKING: the one full grounded loop, persisted end-to-end.** The demo target.
- **Cloud grounding** — `DOCTRINE_BASE_URL` unset on Firebase (Risk B).
- **Landing + Firebase Auth** — in progress (this sprint).

---

## 3 · The 5-minute run-of-show (rubric-maximizing)

Mapped to the beats in RANGE-CARD → SHOW, tuned so every beat scores something. **At least two
teammates speak.**

1. **Problem (0:45)** — the 90-second pitch, compressed. Land on *"not another hallucinating chatbot."* → *Mission Impact.*
2. **Generate (1:00)** — Studio: paste a POI → grounded course live, or reveal the banked golden course. Every lesson cited, all `PENDING`. → *Innovation, Usability.*
3. **Trust it — the mic drop (1:00)** — Ask: `What is trigger control?` → cited answer + HHEM badge. Then `What's the max range of a Javelin?` → **it refuses.** Silence. Let it land. → *Innovation.* **This is the moment we win.**
4. **Rubric from a raw standard (1:00)** — Rubrics: *Defend a Position* → traceable BARS anchors. Then a vague standard → **flagged for the SME, not guessed.** → *Innovation, Mission Impact.*
5. **Prove it teaches (0:45)** — role switch to Learner → Mastery → weak answer (coached), strong answer (mastered, score recorded). → *Usability, Mission Impact.*
6. **Where it runs (0:30)** — **pull the network** → the tutor still cites-or-refuses, offline. Then **Export SCORM** → "drops into MarineNet." → *Living on the Edge + Reach the Enterprise (both bonus), Security.*

Handoff plan: one person drives, a second narrates beats 3 and 6 (the differentiators) → satisfies *Team Collaboration.*

---

## 4 · Critical path & top risks

**Critical path to a winning demo:** #4 write path → #10 loop persists → offline proof holds. If
only one thing gets finished, it's **#4** — it's what turns the UI into a *loop*.

| Risk | Impact | Mitigation |
|---|---|---|
| **A — write path not wired (#4)** | Mastery/approve don't persist; the loop is a slideshow | White owns it head-down; until done, demo the banked golden course + the live tutor (which already works). Live persistence is the goal, banked is the floor. |
| **B — cloud grounding unset** | On the live link, the tutor shows "connect Anchor" instead of grounding | **Decide:** (1) tunnel the Orin's Anchor to Firebase (`DOCTRINE_BASE_URL` → a Funnel/Cloudflare tunnel) so the cloud link fully grounds, or (2) keep grounding **edge-only** and put a one-line banner on the cloud app. The *demo* runs on the offline rig regardless — the cloud link is for judges revisiting. **Decision owner: Jesse.** |
| **C — proving offline** | The whole differentiator | Rehearse beat 6 cold. `ops/orin-check.sh` green before every run, and **Settings → Doctrine engine** green as well — that light is now a live probe, not a reading of the config. There is **no** FTS fallback in the code: if the link drops the tutor fails honestly, so recover the link rather than talking over it. |
| **D — doc drift** | Teammates burn time on 404s / dead links | Fixed in this pass (see below). Keep `/prototype` as the working route until #8 renames to `/learn`. |
| **E — single presenter** | Caps Team Collaboration at a low score | Assign speaking beats now (see run-of-show). |

---

## 5 · Marching orders — per worker & per branch

Branch convention: work on `feature/<lane>-<short>` off `main`, open a PR, keep CI green (the
build-check gate is live), merge to `main` → auto-deploys. Never push straight to `main` for app
code.

### Morgan — `jeranaias` · Lead: grounding, integration, corpus
- **Issues:** #6, #7, #10 (tracking). **Branches:** `feature/grounding-*`, `feature/corpus-*`.
- Keep Anchor green every morning (`ops/orin-check.sh` + tunnel). Own the offline proof (beat 6).
- Wire generate/ingest/plan through Anchor; persist `PENDING` items with citations (#6).
- Own the corpus + be the human ratifier; curate the banked golden course (#7).
- **Decide Risk B** (tunnel the Orin vs edge-only + banner) and the **GenAI.mil authoring swap** (free bonus points) with White.
- Integrate everyone's lanes into the one loop (#10). Narrate the differentiator beats in the demo.

### White — `tewhite4` · Backend & function + hosting
- **Issues:** #4 (critical path), #5 (Firebase — mostly done; now do the auth + `DOCTRINE_BASE_URL`/`MODEL_BASE_URL` env wiring). **Branches:** `feature/write-path`, `feature/firebase-auth`.
- **#4 is the single most important task on the board:** approve/reject, attempts, mastery, schedule — persisted. Nothing `PENDING` reaches a learner.
- Wire the landing + Firebase Auth login → `/prototype`; protect the app route.
- Set `MODEL_BASE_URL` → GenAI.mil for the "Sanctioned & Approved" bonus (with Morgan).
- Keep the two-targets rule: cloud config swap, not a fork; never let cloud break the offline path.

### McDonald — `canester67` · Frontend (mentored)
- **Issues:** #8 (+ #13, #12). **Branch:** `feature/frontend-*`.
- Connect the `/prototype` screens to White's real API + seeded data — start with the lesson reader.
- Do the route rename `/prototype → /learn` (closes the #14 drift for real).
- Fix #13 (X-to-close) and #12 (hover-to-expand severity dots). Pick up new QA issues as they land.
- Pair with Morgan/White; ask early, commit often.

### Thompson — `N0t-A-User` · QA & product voice
- **Issue:** #9. No branch (files issues).
- Walk the **live app** (https://schoolcircle.tannerwhite.net) — *not* the old static demo — as student AND instructor. File every bug/idea via the **QA widget** (now on the real app).
- Own the board: what blocks the demo, what makes a judge say "wow." Shape + own the 5-minute run-of-show; take a speaking beat.

### Fryc — `sakurascriptofficial-crypto` · **PROPOSED lane — Jesse to confirm**
- **Proposed:** Frontend polish + landing/auth support, **pairing with McDonald**. Rationale: `/prototype` needs a screen-by-screen polish pass to match the static demo's feel, and the landing+login is net-new surface — two people on frontend clears it faster while McDonald focuses on data-wiring.
- **Proposed issues:** a new "screen-by-screen polish pass" issue + support on the landing/auth (#5 frontend side).
- **Proposed branch:** `feature/polish-*`.
- *If confirmed*, add Fryc to TEAM-PLAN as the 5th lane and assign the polish issue.

---

## Doc-drift fixed in this pass
`/learn` operator instructions and dead demo links were corrected to the working route
(`/prototype`) and the live URL (schoolcircle.tannerwhite.net) across the gameday kit, with a note
that `/learn` is the intended post-#8 name. If you find another stale `/learn` or
`grounded-training-demo` link, it's safe to update it the same way.
