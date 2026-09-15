# AI Learning Initiatives Hackathon — Sept 15–19

## Team
| Person | Strengths | Wants to own |
|---|---|---|
| SSgt White |  |  |
| SSgt Fryc |  |  |
| Sgt Webley |  |  |
| Cpl Thompson |  |  |

_Sgt Webley is out for this session — his input is captured below._

## The Brief
**Submission:** An AI-native Learning Management System — a Moodle alternative. Keep what Moodle *represents*, raise usability, and integrate AI for tailored learning.

**Core stance:** AI assists instructors and students. The instructor stays in control of the course and all authoritative training content.

- Judging criteria: **TBD**
- Deliverable format (demo / repo / deck): **TBD**
- Constraints (team size, tech, data, pre-work allowed): **TBD**

## Guardrails
_Non-negotiables. State these in the demo — the boundary is a feature._

- **No AI in proctoring or proctor-code creation.** Human input only. _(GySgt Flores, explicit)_
- Instructor reviews and approves all AI-generated assessments before use.
- Authoritative training content stays instructor-owned; AI drafts, humans ratify.

## Feedback — GySgt Flores
_A Co. / EFTS / BEC, Chief Instructor · received 19 Aug_

**Pain points**
- System outages — the main current complaint.
- UI feels dated next to accredited-college platforms (Blackboard as the benchmark).
- Enrollment only covers courses — not FY/CY training or PME.

**Don't lose**
- Course selection. The course browser is good enough to find a course and enroll.

**Wants**
- **Study-plan generator.** From syllabus + calendar, build a plan across 3 COAs: behind → catch up, on track → maintain, ahead → stay ahead. Integrate Outlook / text / email reminders. _(Drawn from his FFI experience: a syllabus and an Excel calendar, nothing connecting them.)_
- **Auto-enrollment.** CY/FY training and rank EPME requirements, with a personalized homepage — widgets showing what's outstanding.
- **Drag-and-drop study material.** Drop student outlines / typed notes as PDFs → organized study guides + practice questions. Adjustable difficulty, multiple-choice and written, with an explanation of *why* an answer is right or wrong. _(Benchmark: Thea Study.)_
- **Mastery visualization.** Bar graph against the question bank showing command of each part of the curriculum.
- **Instructor insight loop.** Collect where students missed questions and why → feed instructors a brief lesson review to get the class back on track.
- **"How do I learn?" quiz.** Questionnaire/survey for Marines; results go to faculty to shape lesson plans. Different courses yield different profiles. Recommended lesson plans become shareable + downloadable into a repository.
- **Interactive lessons.** Chatbot grounded in open-source information, Marine Corps doctrine, and student outlines.
- **Lesson-plan authoring.** Scrollable H5P content picker plus a prompt box to reach the desired presentation. Cuts manual instructor entry — and could reshape the Adult Learning Facilitator course toward teaching prompting.

> "Literally endless possibilities." — the constraint is scope, not ideas.

## Feedback — Additional
_Source: TBD — tell me who to attribute._

- **Interoperability with surface-level applications** — MCTIMS and the rest of the systems a course already has to feed. Stop double-entering the same data.
- **Certificate / graduation package generation** — produce the grad package as an output of the course, not as a separate manual assembly job.
- **Reference generation from POIs** — pull references straight out of the curriculum's Programs of Instruction.

## Input — Sgt Webley
_Submitted ahead of the session._

**Automated AARs.** Take instructor and student input, reference the course itself, and analyze data from previous classes to produce a comprehensive assessment of course shortcomings — then filter and organize that feedback into short-term fixes and long-term course improvement.

- Operates on the **course**, not the student — the thing being graded is the curriculum.
- Runs across **class iterations**, so it gets sharper every cycle.
- Turns end-of-course critiques, which currently go into a drawer, into a ranked worklist.

## Idea Parking Lot
_Everything goes here first. No filtering during brainstorm._

- [ ] Syllabus + calendar → adaptive study plan (3 COAs, calendar/reminder integration)
- [ ] PDF drop → study guide + practice questions with answer rationale
- [ ] Mastery bar graph tied to the question bank
- [ ] Auto-enrollment for CY/FY + EPME, requirements widget homepage
- [ ] "How do I learn?" learner-profile survey feeding lesson planning
- [ ] Missed-question analytics → auto-drafted lesson review for instructors
- [ ] Doctrine-grounded chatbot for interactive lessons
- [ ] H5P picker + prompt box for lesson authoring
- [ ] Lesson-plan repository (share + download)
- [ ] **Automated AARs** — course-level shortcomings from instructor + student input across class iterations, sorted into short- and long-term fixes _(Webley)_
- [ ] Interoperability layer — sync with MCTIMS and adjacent systems instead of re-keying
- [ ] Auto-generated certificates + graduation packages
- [ ] Reference generation from POIs
- [ ] **Embedded "Kahoot!"** — live in-class competitive quiz run off the generated question bank. Directly answers "not enough interactive lessons," and doubles as a live read on where the class actually is.
- [ ] _(add yours)_

## Shortlist
_Promote 3 from the parking lot. Judge each on: demoable in 5 days? shows AI doing something Moodle structurally can't?_

### A.
- **What it does:**
- **Why it wins:**
- **Riskiest part:**

### B.
- **What it does:**
- **Why it wins:**
- **Riskiest part:**

### C.
- **What it does:**
- **Why it wins:**
- **Riskiest part:**

## Decision Log
- `2026-08-19` — Submission is an AI-native LMS / Moodle alternative.
- `2026-08-19` — Feedback request sent to A Co. staff; first response in from GySgt Flores.
- `2026-08-19` — **Next.js** as the platform, front and back.
- `2026-08-19` — Kickoff brainstorm session.

## Open Questions
- [ ] Do we need to register/submit anything before Sept 15?
- [ ] What's provided on-site vs. what we bring (accounts, API keys, hardware)?
- [ ] Is pre-work allowed, or does everything have to be built during the event?
- [ ] Are we demoing against real course data, or synthetic? What's releasable — and does taking 28xx/06xx material to the event change the answer?
- [ ] Does "Moodle alternative" mean replace, or plug into existing Moodle?
- [ ] Who else from A Co. still owes feedback — do we wait or move?
- [ ] **Supercomputer allocation — what is it, actually?** Which model/weights, what serving stack, how do we call it?
- [ ] Do we get access *before* Sept 15 to test against, or only at the event?
- [ ] Is it network-isolated? That decides whether any hosted API is even an option.
- [ ] Who administers it — who do we call when it's down at 0200 on day 3?

## Timeline
**Heads-up:** prep window is split — roughly today–Aug 20, then Sept 8–14. Plan around the gap.

- **Aug 19–20** — Lock the brief, narrow to a shortlist.
- **Aug 21 – Sept 7** — Quiet period. Async only.
- **Sept 8–12** — Final idea lock, environment setup, dry run.
- **Sept 14** — Travel / setup.
- **Sept 15–19** — Build + demo.

## Tech Stack
- Frontend: **Next.js** (React)
- Backend: **Next.js** — route handlers / server actions in the same app. One repo, one deploy, no separate API service to stand up.
- Model / API: **Unknown.** Supposedly getting an allocation on a supercomputer at the event to run an agent on.
  - **Design for the swap:** every model call goes behind one adapter module. Feature code never imports a vendor SDK directly. If the allocation changes, is late, or turns out to be something else, we change one file.
  - **Need a local dev path regardless.** If the compute only exists at the event, nothing gets tested before Sept 15 — that's a build-week risk, not a stack choice.
- Data source: **Course material from two schools — 28xx and 06xx.** Two curricula so the pipeline is proven to generalize, not tuned to one course. _Sourcing + releasability open._
- Deploy target:

## Next Actions
_Owner + date on every line, or it doesn't count._

- [ ] (owner) — **Get course material from 28xx and 06xx** (POIs, student outlines, sample assessments). Needed before anything can be tested against real curriculum.
- [ ] (owner) — Confirm what's releasable / can leave the building for the event.
- [ ] (owner) — Run down the supercomputer allocation: model, serving stack, access date, who owns it.
- [ ] (owner) —
