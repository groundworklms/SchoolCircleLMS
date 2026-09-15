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