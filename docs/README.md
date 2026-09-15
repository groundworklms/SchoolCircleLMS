# SchoolCircleLMS — Build & Design Spec

The document stack that turns the grounded-training platform into a buildable, definitive spec:
**the ultimate learning loop for the learner, and the ultimate course build / plan / review tool
for the instructor** — grounded in doctrine, verified on-device, offline-capable, human-led.

This stack is the companion to the two gameday artifacts (the **Cold Bore plan** and the
**Range Card**). A fresh instance should read those two first for the mission and the wiring, then
use these for the exact design, data model, contracts, and build steps. **Copy this `docs/` folder
into the new repo on day one** so the knowledge travels with the code.

## The stack

| # | Doc | What it gives you |
|---|---|---|
| 00 | [north-star](00-north-star.md) | The vision, the four principles, the two closed loops, how the 12 soldiers map on |
| 01 | [design-system](01-design-system.md) | Exact tokens, the frosted-rail shell, every component, the two widgets, responsive rules |
| 02 | [architecture](02-architecture.md) | The spine, edge/host/cloud, the three flows, the adapter pattern, offline |
| 03 | [data-model](03-data-model.md) | The full Prisma schema, privacy-by-query, edge SQLite swap, MarineNet-readiness |
| 04 | [grounding-and-anchor](04-grounding-and-anchor.md) | The Anchor adapter + exact `/api/ask` contract, abstention-returns-200, the premise gate + HHEM |
| 05 | [arsenal-contracts](05-arsenal-contracts.md) | Every repo: install, exports, exact call, in→out, which surface/route/table it drives |
| 06 | [learner-loop](06-learner-loop.md) | The learning loop, screen by screen — calibration + spaced repetition engine |
| 07 | [instructor-loop](07-instructor-loop.md) | The build/plan/review loop, screen by screen |
| 08 | [build-guide](08-build-guide.md) | Gameday assembly — a runnable checklist from zero to demo |
| 09 | [roadmap](09-roadmap.md) | Beyond MVP to the "ultimate" version — what's shipped, what's gameday, what's horizon |

## First principles (the whole stack in four lines)

1. **Grounded** — every claim cites the exact paragraph, or the system refuses. Never invent doctrine.
2. **Verified** — HHEM entailment on-device checks the asserted specifics; proven, not asserted.
3. **Offline** — the delivery loop runs on a Jetson with the network pulled; $0 per answer.
4. **Human-led** — AI drafts; an instructor ratifies. Nothing `PENDING` reaches a student.

## The arsenal

Twelve standalone, Apache-2.0, tested repos under [github.com/groundworklms](https://github.com/groundworklms) —
`anchor · quarry · rubricon · coursewright · sourcerer · whetstone · sextant · understudy · cartridge ·
cadence · hotwash · waypoint`. SchoolCircle orchestrates; Anchor grounds. See
[05-arsenal-contracts](05-arsenal-contracts.md).

## Live reference

The interactive showcase (in the target design) is at
[jeranaias.github.io/grounded-training-demo](https://jeranaias.github.io/grounded-training-demo) —
landing + the full instructor/student app at `/app.html`. It is an illustrative prototype; this stack
is how it becomes the real thing.
