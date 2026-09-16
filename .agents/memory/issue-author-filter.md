---
name: Issue author filter
description: Only treat GitHub issues/PRs authored by tewhite4 as the owner's own QA reports to act on.
---

The repo owner's own GitHub account for filing QA issues on `groundworklms/SchoolCircleLMS` is `tewhite4`. Other accounts (`canester67`, `N0t-A-User`, `jeranaias`, etc.) also file issues/PRs on this repo but are other testers/teammates, not the owner.

**Why:** The owner wants their own reported items worked on, not other testers' noise mixed in when asked to "pull my issues" or similar.

**How to apply:** When listing, counting, or picking "recent issues"/"recent PRs" to act on for the owner, filter to `user.login == "tewhite4"` unless explicitly asked to include others.
