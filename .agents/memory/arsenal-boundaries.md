---
name: Arsenal integration boundaries
description: Verification pitfalls when composing the independently maintained ecosystem
---

Verify the complete producer → persistence → consumer boundary, not just each upstream import or adapter in isolation.

**Why:** Independently passing library tests and host typechecks did not catch incompatible JSON projections: course exports could be empty, conversational mastery could be misrepresented as pre/post assessment evidence, and UI requests could miss required inputs.

**How to apply:** Use actual upstream output fixtures through the stored-record projection and the exact UI request shape. Keep fixture evidence distinct from live model/service proof. Missing assessment evidence must remain insufficient evidence rather than an inferred incorrect answer or invented test phase.

Injected model helpers can bypass upstream orchestration that the production
transport still executes. Include a transport-level fixture that runs the real
upstream scorer across persistence/reload and both intermediate and final turns.

**Why:** An in-memory injected scorer can pass while the real scorer and session
disagree on progression. Live model output may also omit required citations even
when it is valid JSON; mocked answers with perfect markers cannot prove that path.

**How to apply:** Test production transport contracts and perform a bounded,
explicitly authorized live check. Keep citation and grounding gates unchanged;
correct the request contract rather than manufacturing evidence after generation.

Trace the active HTTP dispatcher before treating an auth or learning module as
the serving contract; similarly named migration-era modules can disagree.

**Why:** A browser workflow investigation found both Firebase-only and
Firebase/OIDC implementations in the same workspace. Reading an inactive module
gave the wrong answer about which sign-in flow could actually be tested.

**How to apply:** Start at the mounted Next API entry point and follow its
registry and middleware imports before designing clients or acceptance tests.