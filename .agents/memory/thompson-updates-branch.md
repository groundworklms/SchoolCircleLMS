---
name: THOMPSON-UPDATES branch and where the live app actually lives
description: Owner's durable work branch, how it relates to main, and which files are the real live prototype vs. a dead-end static shell.
---

The repo owner's personal accumulation branch is `THOMPSON-UPDATES`, created off `origin/main`. Historically, ongoing QA-fix work gets committed there and PR'd into `main` in batches, rather than one fresh `feature/*` branch per small fix.

**Why:** The owner wants a single durable branch for routine QA/fix work so PRs can be reviewed and merged in batches, on top of [[no-direct-push-to-main]] (never push straight to `main`).

**How to apply:** For routine QA-ticket-style fixes, default to `THOMPSON-UPDATES` (or a branch based on its current tip) unless told otherwise. For a fix that's small, self-contained, and unrelated to whatever `THOMPSON-UPDATES` is currently carrying, branching straight off current `main` instead is fine and often safer — see the drift note below.

**Known drift (as of 2026-09-16):** `main` picked up a large shell-unification refactor (PR #76, `feat/unify-shells`) that folded `/teach` and `/learn` into the instructor/student shells and changed the left-rail layout to a compact icon-only design. `THOMPSON-UPDATES` did **not** pick up that refactor. Before doing more work on `THOMPSON-UPDATES`, check how far it's fallen behind `main` (`git log --oneline origin/THOMPSON-UPDATES..origin/main`) — if it's meaningfully behind, either merge `main` into it first or branch the new fix straight off `main` instead, rather than editing what may be pre-refactor, superseded code.

**Also worth knowing:** the real live app (served at `/prototype`) is the Next.js code under `app/prototype/*.js`, with real backend wiring (Prisma schema, `/api/*` routes, `lib/*`). The file `web/app.html`, if it still exists, is a separate static front-end-only shell with no backend wiring — a dead end from an earlier branch (`feature/dashboard-tile-nav-19`), not the thing to keep polishing. Target `app/prototype/*.js` and its backing API/lib code for "polish the live app" work.
