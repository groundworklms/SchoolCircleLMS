---
name: Git-pinned dependency installation
description: Package helper limitations when restoring this project's GitHub-pinned dependencies.
---

The package helper can reject npm GitHub dependency specifiers and an empty
package list. Do not substitute similarly named registry packages.

**Why:** The project's Arsenal dependencies are pinned to specific GitHub
commits; registry namesakes are not equivalent. A stale node_modules directory
can also make freshly fetched upstream code appear broken.

**How to apply:** Preserve the committed lockfile and restore its exact
dependencies with npm's clean-install operation when the helper cannot express
the existing dependency set. Do not interpret missing modules before restoration
as source regressions.

Do not commit regenerated lockfiles containing Replit-internal registry URLs.
Prefer preserving the portable upstream lock when dependency requirements did
not change.

**Why:** Regenerating a lock during workspace reconciliation embedded
package-firewall.replit.internal URLs that external CI runners cannot reach.

**How to apply:** Inspect resolved hosts after regeneration and run a clean
install with the public registry. Keep GitHub-pinned dependencies unchanged;
distinguish local clean-install results from hosted-CI evidence.