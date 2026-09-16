---
name: No direct push to main
description: All changes go through a feature branch + PR; never push commits directly to main.
---

Never push commits directly to `main`. Always create a feature/fix branch, push that branch, and open a pull request for review/merge instead — even for small or docs-only changes.

**Why:** Explicit standing instruction from the repo owner. Direct-to-main pushes are not acceptable regardless of change size, and merging is a separate, explicit step the owner takes (or approves) themselves — an agent opening a PR should not also merge it without being asked.

**How to apply:** For any task that involves committing and pushing, create a new branch (e.g. `feature/...`, `fix/...`, `docs/...`), push it with `-u`, and open a PR against `main` (e.g. via `gh pr create`). Do not run `git push origin main` or merge a PR unless explicitly asked to.
