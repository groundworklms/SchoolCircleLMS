# 09 · Roadmap — MVP → the ultimate platform

Honest map of where we are and what "ultimate" adds. Three tiers: **Shipped now** (real, tested, in the arsenal), **Gameday build** (wiring the parts we have into SchoolCircleLMS), and **Horizon** (net-new, seam already reserved). Nothing here is vaporware — each row names what already exists so the next step is small.

Legend: ✅ shipped · 🔨 gameday build · 🔭 horizon

---

## The engine & guardrails

| Capability | State | Exists today | Smallest next step |
|---|---|---|---|
| Cite-or-refuse grounding | ✅ | Anchor's own `POST /api/ask` on the board, called by `lib/doctrine.js` and enforced in code | — |
| On-device HHEM verification + premise gate | ✅ | Anchor verifier service | — |
| Human-in-the-loop review | ✅ | `Item.status` PENDING/APPROVED/REJECTED | — |
| Offline **grounding** on the edge | ✅ | Anchor on a Jetson Orin answers, cites and refuses with the network cable out (measured 16 Sep 2026) | — |
| Doctrinal-fidelity gate | ✅ | Understudy (strict mode, benchmark) | surface it in the `/api/learning/tutor` response as a badge |
| Offline **app** (sign-in without the internet) | 🔨 | Firebase Auth works; signing in without a Google endpoint is **not available on the default configuration** | an auth mode that does not require a Google endpoint |
| SQLite edge database | 🔭 | one Prisma schema on `provider = "postgresql"`, Cloud SQL and local Postgres both proven | real work, not a connection-string swap (`docs/CLOUD_POSTGRES.md:251`) — provider change plus type/migration follow-through |

## The learner loop

| Capability | State | Exists today | Smallest next step |
|---|---|---|---|
| Ask-the-doctrine tutor | ✅ | Sourcerer + Anchor; Ask widget in showcase | point `DOCTRINE_BASE_URL` at the live Orin |
| Discuss-to-mastery | ✅ | Whetstone (rubric, scoreTurn, Session) | `/api/learning/mastery/sessions` + `/[id]/turn` (present) |
| Practice + **confidence calibration** | 🔨 | `Attempt.confidence` in schema; captured before reveal | render the confidence prompt + the confidently-wrong readout |
| **Confidence-weighted spaced repetition** | 🔨 | `Schedule` table (`dueAt`, `interval`) | a nightly (or on-open) job that promotes/demotes interval by correctness×confidence |
| Adaptive study plan (3 COAs) | ✅ | Cadence (`plan`, `toICS`) | feed real syllabus + calendar; surface COA picker |
| "How do I learn?" onboarding | ✅ | Waypoint (`profile`, `classProfile`) | one-time survey on first login → bias the path/COA |
| Progress / mastery | ✅ | Sextant (`learningGain`, `masteryRollup`) | read `Attempt`/`Mastery` on the learner-scoped path |
| Reminders (Outlook / text / email) | 🔭 | Cadence `toICS` (calendar file today) | add an email/text sender behind an adapter; `.ics` already covers calendar import |

## The instructor loop

| Capability | State | Exists today | Smallest next step |
|---|---|---|---|
| Ingest doctrine (PDF → tasks) | ✅ | Quarry (`pdfText`, `chunkText`, `extractTasks`) | drag-and-drop → `/api/ingest` |
| Generate a cited course | ✅ | Coursewright (`buildCourse`, `fromDocuments`), grounded | `/api/learning/courses/draft` + `/draft/stream` SSE (present) |
| Review / ratify | ✅ | `/api/learning/courses/[id]/items/[itemId]/review` and `.../approve` | — |
| Rubrics from standards | ✅ | Rubricon (`generateRubric` + κ reliability) | `/api/learning/rubrics/generate` (present) |
| SCORM / LMS export | ✅ | Cartridge (`buildCartridge`, `validatePackage`) | `GET /api/learning/export` (present) |
| Class insight (aggregate, private) | ✅ | Sextant + `classGaps()` query (no learnerId) | Insight screen reads it |
| Course AAR across iterations | ✅ | Hotwash (`hotwash`, `narrativeAAR`) | `/api/learning/aar` (present) + an AAR screen |
| Live in-class quiz (Kahoot-style) | 🔭 | question bank from Coursewright | a room/session model + websocket or poll; a Live Control screen |
| **QA issue-reporter widget** | ✅ | in the showcase (auto-captures context → GitHub issue) | ship a dev-mode build flag to enable it in-app |

## Interop & enterprise (the MarineNet story)

| Capability | State | Exists today | Smallest next step |
|---|---|---|---|
| Auth (CAC / SSO / LTI 1.3) | 🔨 | `User.externalId` seam; `lib/auth.js` swappable | add an LTI 1.3 launch provider that maps `sub`→`externalId` |
| LTI grade passback | 🔭 | `Attempt`/`Mastery` map to `cmi`-free scores | an AGS (Assignment & Grade Services) connector |
| MCTIMS / adjacent-system interop | 🔭 | plain-JSON course/roster shapes | a one-way export connector first (stop double-entry), then two-way |
| Certificate / graduation package | 🔭 | Cartridge (SCORM today) | `Cartridge+`: a PDF/zip grad-package generator as a course output |
| Auto-enrollment (CY/FY + EPME) | 🔭 | requirements homepage in the design | a requirements source adapter → auto-create `User`/enrollment |

## Authoring depth

| Capability | State | Exists today | Smallest next step |
|---|---|---|---|
| Cited micro-lessons + assessments | ✅ | Coursewright | — |
| H5P-style interactive content picker | 🔭 | course tree structure | an H5P export target from the course JSON |
| Reference generation from POIs | ✅ | Quarry (`extractTasks`, `sections`) | surface a "references" panel from the parsed POI |
| Deeper analytics over time | 🔭 | Sextant `competencyEvidence` (Bloom's) | persist competency snapshots per iteration; trend them |

---

## Sequencing for gameday

1. **Stand up the spine:** Anchor on the Orin — it binds `192.168.55.1:8000` over USB, so no tunnel is needed from the cabled laptop; SchoolCircleLMS scaffold; Postgres (Cloud SQL in the cloud, local Postgres on the hardware — same provider).
2. **Close the instructor loop first** (it produces the content the learner loop consumes): ingest → generate → review → publish.
3. **Close the learner loop:** ask → mastery → practice+calibration → progress → spaced review.
4. **Light up insight → AAR** to show the loop *closing* (the demo's strongest beat).
5. **Widgets on:** Ask tutor + QA reporter.

Everything in tiers ✅/🔨 is reachable in the build window; 🔭 items are the "after the win" story — real because the seam already exists in the schema or a repo.

See [08-build-guide.md](08-build-guide.md) for the concrete assembly, and [00-north-star.md](00-north-star.md) for the loops these rows serve.
