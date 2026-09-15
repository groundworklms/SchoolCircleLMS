---
name: Managed AI provisioning availability
description: A task runner may lack the provisioning callback documented by the AI integration skill
---

Check actual provisioning availability before promising immediate no-key hosted
model access inside an assigned task runner.

**Why:** Provisioning capabilities depend on execution context. Provider catalog
support does not establish whether the current runner can enable that provider.

**How to apply:** Check the current skill, available integration inventory, and
credential existence using secure tooling. Treat a missing setup operation as an
environment blocker, not proof that Replit lacks the feature. Do not invent an
endpoint, substitute simulated model results, or request private keys without
explaining the changed setup requirement.