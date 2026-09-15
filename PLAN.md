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
**Submission:** An AI-native Learning Management System — a Moodle alternative. Keep what Moodle
*represents*, raise usability, and integrate AI for tailored learning.

**Core stance:** AI assists instructors and students. The instructor stays in control of the
course and all authoritative training content.

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
- **Study-plan generator.** From syllabus + calendar, build a plan across 3 COAs: behind → catch
  up, on track → maintain, ahead → stay ahead. Integrate Outlook / text / email reminders.
- **Auto-enrollment.** CY/FY training and rank EPME requirements, with a personalized homepage —
  widgets showing what's outstanding.
- **Drag-and-drop study material.** Drop student outlines / typed notes as PDFs → organized study
  guides + practice questions with adjustable difficulty, multiple-choice and written questions,
  and an explanation of why an answer is right or wrong.
- **Mastery visualization.** Bar graph against the question bank showing command of each part of
  the curriculum.
- **Instructor insight loop.** Collect where students missed questions and why → feed instructors
  a brief lesson review to get the class back on track.
- **"How do I learn?" quiz.** Results go to faculty to shape lesson plans; recommended lesson
  plans become shareable and downloadable.
- **Interactive lessons.** Chatbot grounded in open-source information, Marine Corps doctrine,
  and student outlines.
- **Lesson-plan authoring.** Scrollable H5P content picker plus a prompt box to reach the desired
  presentation.

> "Literally endless possibilities." — the constraint is scope, not ideas.

## Feedback — Additional
- **Interoperability with surface-level applications** — MCTIMS and the rest of the systems a
  course already has to feed. Stop double-entering the same data.
- **Certificate / graduation package generation** — produce the grad package as an output of the
  course, not as a separate manual assembly job.
- **Reference generation from POIs** — pull references straight out of the curriculum's Programs
  of Instruction.

## Input — Sgt Webley
_Submitted ahead of the session._

**Automated AARs.** Take instructor and student input, reference the course itself, and analyze
data from previous classes to produce a comprehensive assessment of course shortcomings — then
filter and organize that feedback into short-term fixes and long-term course improvement.

- Operates on the **course**, not the student.
- Runs across **class iterations**, so it gets sharper every cycle.
- Turns end-of-course critiques into a ranked worklist.

## Idea Parking Lot
- [ ] Syllabus + calendar → adaptive study plan
- [ ] PDF drop → study guide + practice questions
- [ ] Mastery bar graph tied to the question bank
- [ ] Auto-enrollment for CY/FY + EPME
- [ ] Learner-profile survey feeding lesson planning
- [ ] Missed-question analytics → instructor lesson review
- [ ] Doctrine-grounded chatbot
- [ ] H5P picker + prompt box for authoring
- [ ] Lesson-plan repository
- [ ] Automated AARs across class iterations
- [ ] Interoperability layer
- [ ] Auto-generated certificates + graduation packages
- [ ] Reference generation from POIs
- [ ] **Embedded "Kahoot!"** — live in-class competitive quiz run off the generated question bank.
  Directly answers "not enough interactive lessons," and doubles as a live read on where the class
  actually is.
- [ ] _(add yours)_

## Shortlist
_Promote 3 from the parking lot. Judge each on: demoable in 5 days? shows AI doing something
Moodle structurally can't?_

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
- `2026-08-19` — Feedback request sent to A Co. staff.
- `2026-08-19` — **Next.js** as the platform, front and back.
- `2026-08-19` — Kickoff brainstorm session.

## Open Questions
- [ ] Do we need to register/submit anything before Sept 15?
- [ ] What's provided on-site vs. what we bring?
- [ ] Is pre-work allowed?
- [ ] Are we demoing against real course data or synthetic?
- [ ] Does "Moodle alternative" mean replace, or plug into existing Moodle?
- [ ] Who else from A Co. still owes feedback?
- [ ] Supercomputer allocation: model, serving stack, and access date.
- [ ] Is it network-isolated?
- [ ] Who administers it during the event?

## Timeline
- **Heads-up:** prep window is split — roughly today–Aug 20, then Sept 8–14. Plan around the gap.

- **Aug 19–20** — Lock the brief, narrow to a shortlist.
- **Aug 21 – Sept 7** — Quiet period. Async only.
- **Sept 8–12** — Final idea lock, environment setup, dry run.
- **Sept 14** — Travel / setup.
- **Sept 15–19** — Build + demo.

## Tech Stack
- Frontend: **Next.js** (React)
- Backend: **Next.js** — route handlers / server actions in the same app.
- Model / API: **Unknown.** Supposedly getting an allocation on a supercomputer at the event to
  run an agent on. Every model call goes behind one adapter module; feature code never imports a
  vendor SDK directly.
- Data source: **Course material from two schools — 28xx and 06xx.** Two curricula so the pipeline
  is proven to generalize, not tuned to one course. _Sourcing + releasability open._
- Deploy target:

## Next Actions
- [ ] (owner) — **Get course material from 28xx and 06xx** (POIs, student outlines, sample
  assessments). Needed before anything can be tested against real curriculum.
- [ ] (owner) — Confirm what's releasable / can leave the building for the event.
- [ ] (owner) — Run down the supercomputer allocation: model, serving stack, access date, who owns it.
- [ ] (owner) —