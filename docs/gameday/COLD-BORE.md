# Operation Cold Bore — Battle Plan

> This is the gameday battle plan for **Operation Cold Bore**. Companion file: [`RANGE-CARD.md`](./RANGE-CARD.md). Full design + architecture doc stack lives in [`../`](../).

**Battle Plan · AI Learning Hackathon · 15–18 Sep 2026 · Unclassified · Releasable**

---

## Operation — COLD BORE

The cold-bore shot is the first round from a clean barrel — the one that has to count. **We've fired it: the anchor is built and proven on real doctrine.** This is the plan to win not one use case but a **cluster of five** — with a single grounded platform. SchoolCircle on the surface, Anchor grounding it offline on a Jetson Orin, engineered so each use case is the **same spine wearing a different face**.

- ◆ **Anchor use case:** #1 Rubric Generator — built
- ◆ **Cluster:** 5 of 17 use cases, one platform
- ◆ **Team:** 5, led by SSgt White
- ◆ **Live showcase:** jeranaias.github.io/grounded-training-demo

---

## SITREP — Combat power on hand

Day 1 hasn't started and the hardest piece is already done. This is where we open from:

| Metric | Meaning |
| --- | --- |
| **5 / 5** | use cases built (#9 on a stand-in until ELOs land) · offline verified |
| **146** | real NAVMC 3500.44E tasks parsed & BARS-ready |
| **345** | grounded corpus chunks (TC 3-22.9 + MCWP 5-10) |
| **Orin** | grounding engine live & fully offline (5 services) |

---

## SCHEME — Win the cluster — one anchor, one spine, five faces

We don't build five features. We build **one grounded engine** and point it at five problems. Two of its three primitives were already standing; the anchor added the third. Every target use case is this spine with a different input→output binding — and they **compound**: the rubric engine from #1 is literally requirement #4 of #9.

**Primitive 1 · Ground — Anchor** ✓
Hybrid retrieval + cite-or-refuse + HHEM verification. Runs offline on the Orin.

**Primitive 2 · Generate — Structured generator** ✓
Source text → structured artifact, with **flag-ambiguous / abstain**. Now speaks BARS too.

**Primitive 3 · Review — Human-in-the-loop** ✓
Approve / edit / revise / reject. Nothing AI-made ships unratified.

---

## THE FIVE — Target use cases

Each is the spine, bound to a different input and output. Rivals = teams already registered on that use case; thin competition + deep fit is how we pick our shots.

| Use case | Category | Rivals | Delivered by the spine | Status |
| --- | --- | --- | --- | --- |
| **#1 Rubric Generator** | Perf Assessment | 1 | T&R standard → **BARS** anchors, traceable, flag-ambiguous | Built |
| **#13 Instructional Design** | Content Gen | 2 | objectives → lessons · tests · discussion prompts · scenario · instructor summary | Built |
| **#16 MCPP Modernization** | Content Gen | 1 | MCWP 5-10 → lessons + planning scenario + AI coaching | Built |
| **#12 AI Tutor** | Personalized | 3 | corpus → cited answer, or honest refusal | Built |
| **#9 PME Mastery Eval** | Perf Assessment | 0 | ELOs → rubric *(reuses #1)* + discuss-to-mastery → LMS | Built · ELO-swap |

**Beyond the five:** #17 Red Cell (Wargaming) is built as a standalone repo — [Understudy](https://github.com/groundworklms/understudy) — and **set aside**. And two more of the chief instructor's asks now have repos of their own: [Cadence](https://github.com/groundworklms/cadence) (adaptive study plan, three COAs) and [Hotwash](https://github.com/groundworklms/hotwash) (automated course AAR) — the study-plan and after-action gaps from the schoolhouse brief, filled.

---

## ARSENAL — The open-source arsenal

Twelve standalone Apache-2.0 products — each useful on its own, none referencing the others. Assembled, they **are** the platform. All public, all tested, all green.

| Repo | Link | Description | Tag |
| --- | --- | --- | --- |
| **Anchor** | [github.com/groundworklms/anchor](https://github.com/groundworklms/anchor) | Offline grounding engine — hybrid retrieval · cite-or-refuse · HHEM verification, on the edge. | grounds everything |
| **⛏️ Quarry** | [github.com/groundworklms/quarry](https://github.com/groundworklms/quarry) | Dense PDFs → coordinate-aware text, retrieval-ready chunks, structured tasks + outline. | ingestion |
| **📏 Rubricon** | [github.com/groundworklms/rubricon](https://github.com/groundworklms/rubricon) | Standards → BARS rubrics; verifies grounding + inter-rater reliability (Cohen's/weighted/Fleiss' κ). | use case #1 |
| **📐 Coursewright** | [github.com/groundworklms/coursewright](https://github.com/groundworklms/coursewright) | Objectives + sources → a full cited course (lessons · tests · scenario · summary) as JSON. | #13 · #16 |
| **🔮 Sourcerer** | [github.com/groundworklms/sourcerer](https://github.com/groundworklms/sourcerer) | Cite-or-refuse Q&A over your docs, with a faithfulness check on every answer. | #12 |
| **🪨 Whetstone** | [github.com/groundworklms/whetstone](https://github.com/groundworklms/whetstone) | Conversational discuss-to-mastery against a rubric, grounded, with a mastery report. | #9 |
| **🧭 Sextant** | [github.com/groundworklms/sextant](https://github.com/groundworklms/sextant) | Learning artifacts → learning gain, class gaps, competency evidence (Bloom's). | #6 · #14 |
| **🎭 Understudy** | [github.com/groundworklms/understudy](https://github.com/groundworklms/understudy) | A doctrine-bound agent + a fidelity benchmark — answers in-doctrine or refuses, scores its own fidelity. | #17 · fidelity gate |
| **🎴 Cartridge** | [github.com/groundworklms/cartridge](https://github.com/groundworklms/cartridge) | A course → a SCORM 1.2/2004 cartridge that drops into any LMS and reports scores. | MarineNet export |
| **📅 Cadence** | [github.com/groundworklms/cadence](https://github.com/groundworklms/cadence) | Syllabus + calendar → a study plan across three COAs (catch up / maintain / get ahead), with an .ics calendar export + reminders. | study-plan gap-fill |
| **🔥 Hotwash** | [github.com/groundworklms/hotwash](https://github.com/groundworklms/hotwash) | End-of-course critiques → a ranked AAR worklist: sustain / improve, short- vs long-term, across class iterations. | course-AAR gap-fill |
| **🧭 Waypoint** | [github.com/groundworklms/waypoint](https://github.com/groundworklms/waypoint) | "How do I learn?" survey → per-learner and per-class lesson-planning guidance for faculty. | learner-profile gap-fill |

The thirteenth piece is **SchoolCircle** — the instructor/learner host. It stays its own app; the arsenal are the parts it fields.

---

## ASSEMBLY — How it comes together on Day 1

The connective tissue is **plain-JSON contracts**, not cross-imports — the pieces compose without knowing about each other. Objectives → passages + citations → course JSON → rubric JSON → attempts flow between them; SchoolCircle orchestrates, Anchor grounds.

1. **Ground.** Bring up [Anchor](https://github.com/groundworklms/anchor) on the Orin (offline), open the tunnel (`ops/tunnel.sh`), and ingest the corpus with [Quarry](https://github.com/groundworklms/quarry) → chunks + tasks.
2. **Author.** SchoolCircle calls [Coursewright](https://github.com/groundworklms/coursewright) (objectives+passages → course) and [Rubricon](https://github.com/groundworklms/rubricon) (standard → BARS), grounded through Anchor; the instructor reviews.
3. **Deliver.** Learners hit [Sourcerer](https://github.com/groundworklms/sourcerer) (cited tutor / refusal) and [Whetstone](https://github.com/groundworklms/whetstone) (discuss-to-mastery) — both cite-or-refuse, offline-capable.
4. **Measure.** [Sextant](https://github.com/groundworklms/sextant) turns the resulting attempts + sessions into learning gain, gaps, and competency evidence for the instructor's view.
5. **Plan.** [Cadence](https://github.com/groundworklms/cadence) turns a syllabus + calendar into a study plan across three COAs, exported to the learner's calendar (.ics) with reminders.
6. **Improve.** End-of-course critiques + Sextant's trends feed [Hotwash](https://github.com/groundworklms/hotwash) → a ranked AAR worklist that sharpens the next iteration.
7. **Export.** Any course → [Cartridge](https://github.com/groundworklms/cartridge) → a SCORM cartridge that drops into MarineNet / Moodle and reports completion + score.
8. **Wargame (set aside).** [Understudy](https://github.com/groundworklms/understudy) stands up a doctrine-bound cell + a fidelity benchmark — claimed as its own artifact, off the live critical path.

Gameday order: `clone → npm install → wire env (OpenRouter key · DOCTRINE_BASE_URL) → docker + npm run dev → ops/orin-check → run the show`. The build is **wiring, not inventing** — every part is already tested and green.

---

## BUILD KIT — What a cold instance needs to build it

The full design + architecture spec lives as a documentation stack — **[github.com/jeranaias/grounded-training-demo/docs](https://github.com/jeranaias/grounded-training-demo/tree/main/docs)** (north-star · design-system · architecture · data-model · grounding · arsenal-contracts · learner-loop · instructor-loop · build-guide · roadmap). **Copy that `docs/` folder into the new repo on day one.** The load-bearing essentials, inline:

| Field | Detail |
| --- | --- |
| **Design** | Apple-gray `#f5f5f7` · Marine scarlet `#b3122e` · frosted rail · borderless cards on soft shadow · 18px radius · SF system font. Exact tokens + shell + components in `docs/01`. |
| **Data** | Prisma: `User · Course · Section · Item · Attempt · Mastery · Schedule`. Confidence-before-reveal calibration; spaced-repetition `Schedule`; **no ClassGap table** (privacy by GROUP BY, never selecting learnerId). Postgres → SQLite is a connection-string swap for the edge. Full schema in `docs/03`. |
| **Grounding** | Adapter via `DOCTRINE_BASE_URL` → Anchor `/api/ask`. Contract: `{ abstained, abstainReason, answer, citations:[{n,citation,pub_id,page_printed}], topScore }`. **An abstention returns HTTP 200** — never fall back to an ungrounded model. Detail in `docs/04`. |
| **Consume** | The 11 npm soldiers install straight from GitHub; Anchor is the HTTP service. |

```bash
npm i github:groundworklms/{quarry,rubricon,coursewright,sourcerer,whetstone,sextant,understudy,cartridge,cadence,hotwash,waypoint}
```

```bash
# .env.local
DATABASE_URL=postgresql://…            # or file:./edge.db for the SQLite edge build
OPENROUTER_API_KEY=…                   # authoring / prep only — never at delivery
DOCTRINE_BASE_URL=http://192.168.55.1:8000   # Anchor on the Orin
DOCTRINE_TIMEOUT_MS=30000
# optional per-repo model calls: <NAME>_API_KEY / <NAME>_ENDPOINT / <NAME>_MODEL
```

- **Learner loop.** profile (Waypoint) → adaptive path (Cadence) → cited lesson → Ask tutor (Sourcerer + Anchor) → discuss-to-mastery (Whetstone) → practice + confidence → spaced review → progress. `docs/06`
- **Instructor loop.** ingest (Quarry) → generate (Coursewright, grounded) → ratify → rubrics (Rubricon) → publish / SCORM (Cartridge) → run live → class insight (Sextant) → course AAR (Hotwash) → iterate. `docs/07`

The runnable step-by-step (scaffold → tokens → prisma → install arsenal → wire each surface to its soldier → widgets → preflight → demo) is `docs/08-build-guide.md`. Cross-checked against the Range Card's four integration sequences.

---

## HARDENING — Platform work that serves the whole cluster

These aren't use cases — they're the cross-cutting capability that makes every use case land. Build once, every face benefits.

### H-1 · Grounding trust — make it visible *(Day 2, critical)*
Judges will ask "how do I know it isn't hallucinating?" — we answer on screen: click a citation → the exact passage; show the HHEM score; ask an out-of-doctrine question → it refuses.
- Serves: #1 · #12 · #9
- Payoff: **the mic-drop** — not another chatbot.

### H-2 · Offline at the edge *(Day 3)*
Pull the network and the whole delivery loop still runs on the Orin. The reason we're on a Jetson at all.
- Serves: all five
- Payoff: **airplane mode, live.**

### H-3 · MarineNet / SCORM export *(Day 3)*
Export a course/agent to SCORM, load it into a player, report completion + score. Answers #9's "embed in Moodle/MCeLE" requirement directly.
- Serves: #9 · #13
- Payoff: **"it drops into MarineNet."**

### H-4 · Accounts & roles *(Day 1)*
Instructor vs. learner login behind a swappable interface — the CAC/SSO/LTI seam made visible, and a two-person demo.
- Serves: #9 · #12
- Payoff: **real roles, LTI seam shown.**

---

## PROGRESS — Already in the bag

Momentum going into Day 1 — everything here is done, tested, and committed locally (no PRs pushed until the word is given).

### ◧ Built & proven

- [x] **#1 Rubric Generator — complete.** Studio (146 real tasks) → grounded BARS → SME review (edit/approve/reject each anchor) → JSON export. Live at `/learn/rubrics`.
- [x] **#12 AI Tutor — complete.** Ask the doctrine → cited answer or honest refusal, wired live to Anchor on the Orin (HHEM-verified, score shown), app-FTS fallback. The out-of-doctrine refusal fires for real. Live at `/learn/ask`.
- [x] **#13 + #16 — complete.** Pipeline now generates a grounded scenario-with-coaching, higher-order discussion prompts, and an instructor summary. A full **MCPP course** (MCWP 5-10) generated alongside marksmanship — MEU planning scenario, SFAD-C coaching, Bloom's-tier prompts. Course switcher live on `/learn`.
- [x] **#9 Mastery agent — built (stand-in).** Grounded discuss-to-mastery at `/learn/mastery`: derives a rubric from the objective, probes, scores each answer, coaches the gap, advances, records a score for the LMS. Proven weak→developing, strong→mastered. Swaps to real 8670 ELOs on MCeLE access.
- [x] **Offline VERIFIED.** Broke the cloud key: tutor still answered via Anchor, refusal still fired, courses still rendered, generation failed gracefully. Zero external assets. Runbook: `ops/OFFLINE.md`.
- [x] **Roles & auth — built.** Instructor vs. learner behind one swappable seam (`lib/auth.js`) → LTI 1.3 / SSO / CAC. Tabs filter by role; Studio/Rubrics/Insight guarded server-side. Verified by URL.
- [x] **Gap-fills built — Cadence & Hotwash.** The chief instructor's two open asks now have real, tested repos: **Cadence** (syllabus+calendar → 3-COA study plan + .ics, 17 tests) and **Hotwash** (course critiques → ranked AAR across iterations, 16 tests). **Public & green** — `github.com/groundworklms/cadence · /hotwash`.
- [x] **Run-of-show REHEARSED.** All beats pass live end-to-end: generate · cited answer + refusal (Anchor/HHEM) · rubric · mastery · SCORM export. Demo-day gotcha caught: the Anchor tunnel isn't persistent — run `ops/tunnel.sh` at start (fallback to FTS is graceful if it drops).
- [x] **Public showcase refreshed.** jeranaias.github.io/grounded-training-demo — platform landing, real grounded output, and the linked arsenal; the full interactive instructor + student system at `/app.html` (with a live Ask-tutor widget and a QA issue-reporter).
- [x] **BARS proven on real doctrine.** Anchors traceable to source performance-steps; vague standards correctly flag for SME definition rather than inventing criteria.
- [x] **Corpus staged.** 44E parsed → 146 tasks; MCWP 5-10 (current) ingested = 163 chunks; TC 3-22.9 retained. App FTS = 345 chunks.
- [x] **Pipeline hardened + golden course banked.** Per-request timeout (a hung model call can't stall a run); a full 36-item course saved as the guaranteed demo artifact.

### ◈ Corpus board

| Document | For | Status |
| --- | --- | --- |
| NAVMC 3500.44E | #1 | 146 tasks |
| MCWP 5-10 (MCPP) | #16 | 163 chunks |
| TC 3-22.9 | #13 · #12 | on Orin + app |
| MCDP 1 / 5 / … | #12 · #16 | on Orin |
| EWSDEP 8670 ELOs | #9 | gated · MCeLE |

---

## PHASING — The four days

- **D-0 ✓ (DONE):** Anchor #1 built · Corpus staged · Golden course · Orin + key set
- **Day 1 (15 SEP):** #12 AI Tutor (Ask) · #13 / #16 content · H-4 roles
- **Day 2 (16 SEP):** H-1 grounding trust · Live refusal · #9 mastery machinery
- **Day 3 (17 SEP):** H-2 offline loop · H-3 SCORM export · Integration freeze
- **Day 4 (18 SEP):** Run-of-show ×2 · Scorecard + metrics · Present

---

## ACCESS — Quick-start & the kit

Open cold on Day 1 with minimum friction. Security hardening is a deliberate Day-4 task — for now, tuned to **move fast**.

### ⌘ Orin — "doctrine-tutor"

| Field | Detail |
| --- | --- |
| **Device** | Jetson Orin Nano 8GB · host `orin-vanguard` · air-gapped, offline |
| **SSH** | key-based; USB device-mode only. Use `id_ed25519`, not nahawi.pem. |
| **Anchor** | `http://127.0.0.1:8000/api/*` — ask · corpus · health · learn |
| **Auth key** | OpenRouter at `~/.secrets/openrouter.env` (600). Workstation authors; the Orin stays offline. |
| **sudo** | Rarely needed; password in local team notes — deliberately not in this doc. |

```bash
ssh -i ~/.ssh/id_ed25519 vanguard@192.168.55.1
```

⚠ One SSH connection at a time — the USB link times out under rapid parallel connections. The ops scripts already run in a single session.

### ▚ Ops & the app — `nps-hackathon/ops/`

| Task | Detail | Command |
| --- | --- | --- |
| **Daily check** | Link, services, health, corpus, key — one shot each morning. | `bash ops/orin-check.sh` |
| **Key → .env** | Pull the authoring key into an app env file. | `bash ops/get-key.sh path/.env` |
| **Run the app** | Next.js on `:3111`; Postgres in Docker. | `docker start schoolcircle-dev && npm run dev` |
| **#1 live at** | `/learn/rubrics` — the Rubric Studio + SME review, working now. | — |

---

## HONESTY — Category scorecard

Told straight against the six official categories — now with a standalone, tested repo behind most of them. A team that knows exactly where it stands earns the room's trust.

| Category | Our position by 18 Sep | What backs it |
| --- | --- | --- |
| **Content Generation** | Built | #13 + #16 via **Coursewright** (course/scenario/discussion) — tested & green |
| **Performance Assessment** | Built | #1 **Rubricon** + #9 **Whetstone** + analytics via **Sextant** + course AAR via **Hotwash** — four repos |
| **Personalized Learning** | Built | #12 AI Tutor via **Sourcerer** + Anchor (cite-or-refuse, offline); adaptive study plan via **Cadence**; learner profiles via **Waypoint** |
| **Operational Support** | Adjacent | the grounded Q&A surface (**Sourcerer**); #15 territory |
| **Simulation** | Partial | the MCPP planning scenario + coaching (**Coursewright**) |
| **Wargaming** | Repo built | #17 via **Understudy** — doctrine-bound agent + fidelity benchmark, set aside |

---

## FINALE — Five-minute run-of-show

One platform, visibly doing five jobs. Rehearse until it runs cold.

1. **The problem.** *(0:45)* AI content is fast but hallucinates — unacceptable for doctrine. Meet the platform: SchoolCircle + Anchor on a Jetson.
2. **Generate a grounded course.** *(1:00 · #13)* Instructor loads a POI + doctrine → a complete cited course builds (or reveal the golden course).
3. **Trust it.** *(1:00 · #12 · trust)* Click a citation → the exact passage. Show the HHEM score. Ask an out-of-doctrine question → it refuses. *Mic drop.*
4. **Rubric from a raw standard.** *(1:00 · #1)* Paste a T&R standard → BARS anchors, traceable. Then a vague one → flagged for the SME, not guessed.
5. **Prove it teaches.** *(0:45 · #9)* Learner discusses to mastery / takes pre→post; the instructor's class view lights up.
6. **Where it runs.** *(0:30)* Pull the network — still working, offline on the edge. Then: exports to SCORM, drops into MarineNet.

---

*OPERATION COLD BORE · living document · unclassified / releasable · one grounded platform · five use cases · SchoolCircle + Anchor*
