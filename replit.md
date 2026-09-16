# SchoolCircle project constraints

## Keep Next.js

SchoolCircle must remain the original **Next.js** application. Do not replace it
with Vite, migrate it into a separate frontend/API monorepo, or introduce a
parallel application framework unless the user explicitly authorizes that change.

The team is developing the same GitHub repository concurrently. A framework port
creates incompatible work and merge conflicts. Preserve the upstream application
structure and limit Replit compatibility changes to workspace configuration.

Make changes on a feature branch and submit a pull request into `main`.
Do not commit/push directly to `main`, merge, or publish without explicit approval.

## QA issue triage and branch topology

The owner's own GitHub account for filing QA issues on this repo is `tewhite4`
— other accounts (`canester67`, `N0t-A-User`, `jeranaias`) are other
testers/teammates, not the owner. When asked to pull "my issues," filter to
`tewhite4`.

Routine QA-fix work has historically accumulated on `THOMPSON-UPDATES` (owner's
branch, cut from `main`) and shipped to `main` in batches. That branch can fall
behind `main` — check `git log --oneline origin/THOMPSON-UPDATES..origin/main`
before building on it; if it's meaningfully behind, branch a small/self-contained
fix straight off current `main` instead rather than editing superseded code.

See `.agents/memory/` for more detail (branch drift status, what shipped vs. was
deliberately deferred in recent QA batches, etc.) — check it before starting new
work in this repo.

## Self-service profile roles

Users may select Student, Instructor, or Both during onboarding and in Settings.
The owner explicitly approved granting instructor permissions immediately when
Instructor or Both is saved; no approval queue is required. Changing back to
Student removes instructor permissions. Keep authorization tied to the saved
database role, never to an unverified token claim or a client-only view switch.