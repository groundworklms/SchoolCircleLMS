# SchoolCircleLMS — Build & Design Spec

The document stack turns the grounded-training platform into a buildable spec: the learning loop
for learners and the course build, plan, and review tool for instructors — grounded in doctrine,
verified on-device, offline-capable, and human-led.

## The stack

| # | Doc | What it gives you |
|---|---|---|
| 00 | [north-star](00-north-star.md) | Vision, principles, and the two closed loops |
| 01 | [design-system](01-design-system.md) | Tokens, shell, components, widgets, and responsive rules |
| 02 | [architecture](02-architecture.md) | Spine, edge/host/cloud, flows, adapters, and offline operation |
| 03 | [data-model](03-data-model.md) | Prisma schema and privacy-by-query |
| 04 | [grounding-and-anchor](04-grounding-and-anchor.md) | Grounding adapter and abstention contract |
| 05 | [arsenal-contracts](05-arsenal-contracts.md) | Companion repository contracts and route/table wiring |
| 06 | [learner-loop](06-learner-loop.md) | Learner screens, calibration, and spaced repetition |
| 07 | [instructor-loop](07-instructor-loop.md) | Instructor build, plan, and review loop |
| 08 | [build-guide](08-build-guide.md) | Assembly checklist |
| 09 | [roadmap](09-roadmap.md) | Shipped, event, and horizon work |

## First principles

1. **Grounded** — every claim cites the exact paragraph, or the system refuses.
2. **Verified** — on-device entailment checks asserted specifics.
3. **Offline** — the delivery loop can run at the edge with the network pulled.
4. **Human-led** — AI drafts; an instructor ratifies. Nothing `PENDING` reaches a student.

## The arsenal

The twelve standalone Apache-2.0 repositories are `anchor`, `quarry`, `rubricon`, `coursewright`,
`sourcerer`, `whetstone`, `sextant`, `understudy`, `cartridge`, `cadence`, `hotwash`, and
`waypoint`. SchoolCircle orchestrates; Anchor grounds. See
[05-arsenal-contracts](05-arsenal-contracts.md).