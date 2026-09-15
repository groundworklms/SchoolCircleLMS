---
name: Rebase artifact registration
description: Restoring managed artifact registration after intermediate Git rebase states.
---

A rebase that temporarily checks out a pre-artifact commit can unregister
artifacts and remove their managed workflows even when the final tree restores
the original manifests.

**Why:** Artifact discovery observes intermediate working-tree states, not
only the final Git commit.

**How to apply:** After the rebase, inspect the artifact inventory. If manifests
exist but registrations are missing, pass identical manifest contents through
the validated artifact replacement workflow to restore registration. Do not
create duplicate artifacts or manually configure replacement workflows.