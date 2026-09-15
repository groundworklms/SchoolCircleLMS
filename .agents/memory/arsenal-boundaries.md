---
name: Arsenal integration boundaries
description: Verification pitfalls when composing the independently maintained ecosystem
---

Verify the complete producer → persistence → consumer boundary, not just each upstream import or adapter in isolation.

**Why:** Independently passing library tests and host typechecks did not catch incompatible JSON projections: course exports could be empty, conversational mastery could be misrepresented as pre/post assessment evidence, and UI requests could miss required inputs.

**How to apply:** Use actual upstream output fixtures through the stored-record projection and the exact UI request shape. Keep fixture evidence distinct from live model/service proof. Missing assessment evidence must remain insufficient evidence rather than an inferred incorrect answer or invented test phase.