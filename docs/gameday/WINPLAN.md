# WINPLAN — how we win this hackathon

The single source of truth for winning the MCU-NPS AI Learning Initiatives Hackathon.
Everything else in this kit supports this file: [`SCORING-CARD.md`](SCORING-CARD.md) is the rubric,
[`RANGE-CARD.md`](RANGE-CARD.md) is the operator's brief and demo runbook, [`COLD-BORE.md`](COLD-BORE.md)
is the battle plan, [`TEAM-PLAN.md`](TEAM-PLAN.md) is the lanes. If any of those disagree with this
file on *current state*, this file is right — the others are older.

**Win thesis:** We are the only team whose AI *cannot* make up doctrine — every claim cites the
manual or the system refuses, it's *verified* on-device (not asserted), the **grounding engine runs
offline on a $500 board with the network cable out** (measured, not asserted), and a human ratifies
everything before a Marine sees it. That is the whole game: **grounded · verified · offline at the
edge · human-led.** We don't win by having more features. We win by being the trustworthy one, and
by proving it live.

**Scope the offline claim precisely, every time.** *Anchor* — the grounding engine on the Orin —
is offline-proven: cable out, it still serves `/api/health`, `/api/corpus` and `/api/ask` with
paragraph-level citations, and still refuses out-of-corpus questions. *SchoolCircle*, the web app
around it, is **not** offline-capable yet: its sign-in still calls Firebase Authentication over the
internet. So we say "the grounding engine runs offline," never "the product runs offline." The
offline auth path is a known, named gap in progress — see criterion 4.

---

## Canonical facts (use these, not older copies)

- **Live app:** https://schoolcircle.tannerwhite.net — Firebase App Hosting, **auto-deploys from `main`**.
- **App routes today:** `/` (landing + login), `/prototype` (the student + instructor UI). The
  deeper docs sometimes say `/learn` — that is the *intended* product name; the route rename
  `/prototype → /learn` is tracked in **#8** (originally flagged in **#14**). Until it merges, the
  working route is **`/prototype`**.
- **Repo / org:** github.com/groundworklms — `SchoolCircleLMS` is the app; the 12-repo arsenal is
  alongside it.
- **Grounding:** Anchor on a Jetson Orin — cite-or-refuse, HHEM-verified, **and proven to answer
  with the network cable out**: `/api/health`, `/api/corpus` and `/api/ask` all served, real
  citations with paragraph-level locators, out-of-corpus questions refused (`abstained: true`,
  `abstain_reason: low_retrieval_score`). Generation runs on the board too. Corpus: **4,731 chunks
  across 14 publications.**
- **Anchor's address:** `http://192.168.55.1:8000` is **point-to-point USB device-mode** — reachable
  only from the one laptop the Orin is physically cabled to. No other laptop, and **never** the
  hosted Firebase deployment, can route to it.
- **Grounding on the hosted app:** `DOCTRINE_BASE_URL` is deliberately **unset** in
  `apphosting.yaml`, so the hosted app ships with no baked-in engine address. Set the address at
  runtime in **Settings → Doctrine engine** — no redeploy needed. See Risk B.
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
| 4 | **Security & Sustainability** | 15% | Apache-2.0 ×**13** public repos (12 arsenal + SchoolCircle), the test suite (**564 tests, 0 failures on the 17 Sep run; re-run 17 Sep 2026 confirmed 0 failures in every non-Postgres suite (the three DB suites need a local Postgres and were not run)**), **grounded answering with no cloud and no ATO dependency**, one swappable auth seam. **Name both gaps before a judge finds them: sign-in still needs Firebase Auth, so the app is not offline end-to-end yet, and the offline auth path is in progress.** | The org, the test run, the Anchor offline demo, `lib` auth seam. |
| 5 | **Team Collaboration** | 10% | Multiple lanes, multiple GitHub accounts in history, the issue board + QA-widget intake loop. **More than one teammate must speak in the 5 minutes.** | TEAM-PLAN, the commit history, the board. |

**Bonus (0.05x each):**
- **Living on the Edge** — *the strongest bonus we hold, and it is measured.* Network cable out, the
  Orin still serves health, corpus and `/api/ask`: cited answers with paragraph-level locators, and
  out-of-corpus questions still refused. Generation runs on the board, so an answer costs **$0**.
  Volunteer the boundary in the same breath — the app's *sign-in* still needs Firebase Auth, so what
  is proven offline is the grounding engine, not the whole loop; offline auth is in progress.
- **Reach the Enterprise** — *won.* SCORM export + LTI 1.3 path into MarineNet. Show the export landing, not a file on disk.
- **Sanctioned and Approved** — *FREE POINTS, currently unclaimed.* Point the authoring call at
  **GenAI.mil (Gemini, CAC over CampusNet)** instead of a commercial cloud model. It's a
  `MODEL_BASE_URL` + credential swap on the one seam that already exists — **no architecture change,
  does not touch the on-board answering path.** Needs a CAC + reader on site. **Owner: White + Morgan. Do this.**
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
- Anchor grounding **verified end-to-end on the local rig, including with the network cable out** —
  cited answers with paragraph-level locators, correct refusals, HHEM scores, 4,731 chunks / 14 pubs.
- Prisma data layer builds + seeds (TC 3-22.9 course, instructor, learner).

**Left to do (tracked):**
- **#4 — the write path.** Approve/reject items, save attempts, roll up mastery, set schedule. *This is the critical path* — without it the human-in-the-loop guardrail and the learner loop don't persist. **(White)**
- **#6 — wire generate/ingest/plan through Anchor**, persist items as `PENDING` with citations. **(Morgan)**
- **#7 — corpus + ratification.** Screen doctrine, ingest, ratify items. **(Morgan)**
- **#8 — connect prototype screens to real data**; rename route `/prototype → /learn`; fix #13 (X-to-close), #12 (hover dots). **(McDonald)**
- **#9 — QA sweep + run-of-show ownership.** **(Thompson)**
- **#10 — TRACKING: the one full grounded loop, persisted end-to-end.** The demo target.
- **Cloud grounding** — the hosted app has no baked-in engine address by design; the operator sets
  one in **Settings → Doctrine engine** at runtime. A *stable* hosted-to-Orin path still needs a
  **named** Cloudflare tunnel (Risk B).
- **Landing + Firebase Auth** — in progress (this sprint).
- **Offline auth** — SchoolCircle's sign-in still requires Firebase Authentication over the
  internet. Another lane is building an offline auth path; it is **not done**. Until it lands, the
  offline proof we show is Anchor's, and we say so.

---

## 3 · The 5-minute run-of-show (rubric-maximizing)

Mapped to the beats in RANGE-CARD → SHOW, tuned so every beat scores something. **At least two
teammates speak.**

1. **Problem (0:45)** — the 90-second pitch, compressed. Land on *"not another hallucinating chatbot."* → *Mission Impact.*
2. **Generate (1:00)** — Studio: paste a POI → grounded course live, or reveal the banked golden course. Every lesson cited, all `PENDING`. → *Innovation, Usability.*
3. **Trust it — the mic drop (1:00)** — Ask: `What is trigger control?` → cited answer + HHEM badge. Then `What's the max range of a Javelin?` → **it refuses.** Silence. Let it land. → *Innovation.* **This is the moment we win.**
4. **Rubric from a raw standard (1:00)** — Rubrics: *Defend a Position* → traceable BARS anchors. Then a vague standard → **flagged for the SME, not guessed.** → *Innovation, Mission Impact.*
5. **Prove it teaches (0:45)** — role switch to Learner → Mastery → weak answer (coached), strong answer (mastered, score recorded). → *Usability, Mission Impact.*
6. **Where it runs (0:30)** — **be signed in and on the tutor page before you touch the cable.**
   Then **pull the network cable** → ask a doctrine question → still cited from the Orin; ask the
   out-of-corpus one → still refused. Name the boundary while it is unplugged: *"a fresh sign-in
   would still need Firebase Auth — that's the next thing we're closing. The grounding engine is
   what runs offline, and it just did."* Then plug back in and **Export SCORM** → "drops into
   MarineNet." → *Living on the Edge + Reach the Enterprise (both bonus), Security.*

Handoff plan: one person drives, a second narrates beats 3 and 6 (the differentiators) → satisfies *Team Collaboration.*

---

## 4 · Critical path & top risks

**Critical path to a winning demo:** #4 write path → #10 loop persists → the Anchor offline proof
holds (engine green, signed in before the cable moves). If
only one thing gets finished, it's **#4** — it's what turns the UI into a *loop*.

| Risk | Impact | Mitigation |
|---|---|---|
| **A — write path not wired (#4)** | Mastery/approve don't persist; the loop is a slideshow | White owns it head-down; until done, demo the banked golden course + the live tutor (which already works). Live persistence is the goal, banked is the floor. |
| **B — grounding on the hosted link** | On the live link, the tutor shows "connect Anchor" instead of grounding | **Decided, and the first attempt failed — record it so nobody repeats it.** We pinned `DOCTRINE_BASE_URL` to a Cloudflare **quick** tunnel hostname in `apphosting.yaml`; it was measured **dead, 502**, because a quick tunnel takes a brand-new hostname on every restart while the pin stayed fixed. The pin has been **removed**: the hosted app now ships with `DOCTRINE_BASE_URL` unset and the operator types the current address into **Settings → Doctrine engine** at runtime — no redeploy. Note `192.168.55.1:8000` is point-to-point USB and **can never** be reached from the hosted deployment, so the hosted path needs a tunnel hostname, not the USB address. If it must stay up unattended, use a **named** Cloudflare tunnel (stable hostname). The *demo* runs on the local rig regardless; the hosted link is for judges revisiting. |
| **C — proving offline** | The whole differentiator | Rehearse beat 6 cold. `ops/orin-check.sh` green before every run, and **Settings → Doctrine engine** green as well — that light is a live probe, not a reading of the config. Two hard constraints: there is **no** FTS fallback anywhere in the code, so if the engine link drops the tutor fails honestly — recover the link rather than talking over it; and **sign in before the cable comes out**, because sign-in still calls Firebase Auth and a logged-out browser cannot get back in while unplugged. |
| **D — doc drift** | Teammates burn time on 404s / dead links | Fixed in this pass (see below). Keep `/prototype` as the working route until #8 renames to `/learn`. |
| **E — single presenter** | Caps Team Collaboration at a low score | Assign speaking beats now (see run-of-show). |

---

## 5 · Marching orders — per worker & per branch

Branch convention: work on `feature/<lane>-<short>` off `main`, open a PR, keep CI green (the
build-check gate is live), merge to `main` → auto-deploys. Never push straight to `main` for app
code.

### Morgan — `jeranaias` · Lead: grounding, integration, corpus
- **Issues:** #6, #7, #10 (tracking). **Branches:** `feature/grounding-*`, `feature/corpus-*`.
- Keep Anchor green every morning (`ops/orin-check.sh`; Anchor binds the USB interface directly, so
  `ops/tunnel.sh` is optional now, not a required step). Own the offline proof (beat 6).
- Wire generate/ingest/plan through Anchor; persist `PENDING` items with citations (#6).
- Own the corpus + be the human ratifier; curate the banked golden course (#7).
- **Risk B is decided** (runtime address in Settings; a named tunnel if the hosted link must ground
  unattended) — carry it out rather than re-litigate it. Still open: the **GenAI.mil authoring
  swap** (free bonus points) with White.
- Integrate everyone's lanes into the one loop (#10). Narrate the differentiator beats in the demo.

### White — `tewhite4` · Backend & function + hosting
- **Issues:** #4 (critical path), #5 (Firebase — mostly done; now do the auth + `MODEL_BASE_URL` env wiring. Leave `DOCTRINE_BASE_URL` **unset** in `apphosting.yaml` — a pinned quick-tunnel hostname is what died 502; the engine address is a runtime setting now). **Branches:** `feature/write-path`, `feature/firebase-auth`.
- **#4 is the single most important task on the board:** approve/reject, attempts, mastery, schedule — persisted. Nothing `PENDING` reaches a learner.
- Wire the landing + Firebase Auth login → `/prototype`; protect the app route.
- Set `MODEL_BASE_URL` → GenAI.mil for the "Sanctioned & Approved" bonus (with Morgan).
- Keep the two-targets rule: cloud config swap, not a fork; never let cloud break the on-board
  answering path.

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
