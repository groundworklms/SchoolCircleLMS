---
name: QA batch #48-#64 — what shipped and what was deliberately skipped
description: Scope notes for the tewhite4 QA ticket batch fixed in PR #72, so related follow-up issues aren't mistaken for regressions.
---

Issues #48, #50, #51, #52, #54, #55, #56, #57, #58, #61, #62, #63, #64 (all `tewhite4`, see [[issue-author-filter]]) were fixed together in PR #72 (merged into `main` via `THOMPSON-UPDATES`). #53 was already fixed by an earlier commit before this batch.

**Why this matters:** several of these fixes were intentionally scoped down from the literal issue text, and a later agent/dev might otherwise "fix" something that was already a deliberate decision.

**How to apply — know these before touching related code:**
- **#64 (Class Roster)**: only the "core functionality" from the issue was built (view/search/sort/filter, add, drop-and-keep-for-records + reactivate, message, export CSV). The issue's "additional" wishlist — CSV/SIS bulk import, groups/sections, attendance, seating charts, per-student notes/flags, waitlist automation, bulk multi-select actions — was explicitly left out as scope creep for a single pass. Don't treat their absence as a bug.
- **#63 (Ask-the-doctrine lesson gating)**: implemented as a best-effort **keyword match** on lesson titles, not real content-aware gating. This app's real doctrine corpus (marksmanship, via an Anchor service) has no actual link to the mock course content (electronics/radio-net lessons) — there's no shared taxonomy to gate on. The heuristic only visibly triggers when a question happens to reference a locked lesson's title words. Building "real" gating would require either a shared content taxonomy between the corpus and the POI/lesson data, or backend cooperation from the Anchor service — neither exists today.
- **#62/#61 (lesson locking)**: gating is based on *actual* per-lesson completion in `prefs.progress` OR the course's week-based mock schedule status (whichever is further along) — not just real completion. Pure real-completion gating was tried first and rejected: it locked almost the entire course for any student persona that hadn't actually clicked through every lesson's interactive content, contradicting the dashboard's own "13/48 done" narrative built from the mock schedule. The two are reconciled so the demo doesn't look broken.
- **Left-hand rail scroll (#80)**: fixed separately in PR #81, cut from `main` directly (see [[thompson-updates-branch]] for why).
