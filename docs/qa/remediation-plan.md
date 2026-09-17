# QA remediation plan — live-app review, 17 Sep 2026

A browser pass over the full learning loop on <https://schoolcircle.tannerwhite.net>, signed in as an
instructor with `BOTH` role, system-dark theme. Thirteen findings, grouped below into the pull
requests that close them.

## What was verified working

Recorded because it is the half that usually goes unwritten, and because it is what the fixes must
not regress.

- Generation end to end, including a **12-section** course — the case that failed this morning with
  `section 0 is refused` twelve times over.
- Page-scoped citations on delivered lessons (`Grounded in AY27 8670 Prerequisite Coursebook p.135`).
- Uncovered objectives surfaced on the review screen as **NOT COVERED BY THIS COURSE**, named rather
  than silently dropped.
- Mastery correctly refusing to start without an approved shared plan, and saying why.
- **Approve and publish** gated behind an explicit "I reviewed version 0" acknowledgement.
- Rubric auto-fill populating all five task fields, with both honesty notices and an `SC-`prefixed
  derived code that cannot pass for an official one.
- Zip collections (48 / 58 / 3 documents) grouped, with per-collection select-all.
- Correct `radiogroup` / `radio` / `aria-checked` semantics on assessment options, and a restored
  attempt replaying as "Correct".
- Zero console errors or React warnings on load; every request 200; TTFB 203 ms.

## Two findings withdrawn after reading the code

Both looked like defects in the browser and are not.

**Source rows have no rename/remove.** The card renders `{source.canRemove && <RowActions/>}`, and
`listSources` sets `canRemove: isInstructor && record.ownerId === identity.id`. `hasRole('BOTH',
'INSTRUCTOR')` is true, so the role check passes — those documents belong to another account.
Hiding the actions is correct. What survives is a smaller affordance gap, carried below as PR 6.

**An answer is pre-selected on a pre-check.** It is a restored attempt, not a leaked key: one group
of four has a selection and the page reads "Correct".

---

## PR 1 — Dark-mode accent · small

Closes findings 1 and 13.

`--p-accent: #b3122e` is defined once, in the light palette. Both dark blocks redefine
`--p-accent-tint` and `--p-accent-border` to the lighter `#e0334f` but never `--p-accent` itself, so
every accent-coloured element in dark mode inherits a colour chosen for white.

| pair | measured | AA |
|---|---|---|
| accent on `--p-bg` | 2.47:1 | 4.5 |
| accent on `--p-surface` | 2.02:1 | 4.5 |
| accent on `--p-accent-tint` | 1.56:1 | 4.5 |

That is the active rail item, section headings, and "Review & publish" — the text a reader most
needs. Light mode is unaffected.

Candidates, computed against both dark surfaces and the tint composite:

| candidate | on bg | on surface | on tint |
|---|---|---|---|
| `#b3122e` (current) | 2.47 | 2.02 | 1.78 |
| `#e0334f` (tint/border already use it) | 3.85 | 3.16 | 2.79 |
| `#ef4d67` | 4.80 | 3.93 | 3.47 |
| `#ff6b80` | 6.21 | 5.09 | 4.49 |

Also lift `--p-faint` (4.27:1) to clear AA at 11–13 px.

`theme-contrast.test.mjs` missed this because `.s-rail-btn.on` is not in its selector list. Add it,
along with the accent-on-tint pair, so the regression cannot return.

**Files:** `app/prototype/prototype.css`, `tests/theme-contrast.test.mjs`

## PR 2 — Stop printing database ids · small

Closes finding 4. Raw cuids (`cmu51u8t2001es6011f3flar9`) are shown on the learner dashboard badge,
under every row of the create-course source picker, and on the review screen. Replace with the human
label already to hand (`sourceId`, then title), or drop.

**Files:** `app/prototype/Library.js`, learner dashboard, review screen

## PR 3 — Overlay collision · small

Closes finding 5. The student-view banner overlaps both floating buttons — including the QA
"Report an issue" widget testers are told to file bugs with. Banner right edge 717 px, chat FAB
begins at 667 px.

**Files:** `app/prototype/student.css`, `app/_components/widgets.css`

## PR 4 — Heading structure and control names · small

Closes findings 6, 10, 12. Twelve `<h1>` on the review screen, one per section — should be one page
`h1` with sections as `h2`. Row-action buttons all announce "Actions for course", identical on every
row. `h4 "Sections"` renders before the `h1` on the lessons page.

**Files:** review screen markup, `RowActions.js`, lessons markup

## PR 5 — Resolve a citation label without downloading the library · medium

Closes findings 8 and 7. `usePublicationName()` (`LearnerFeatures.js:136`) fetches the **entire**
`/sources` list — 109 summaries — to read one publication label for the "Grounded in…" line. That is
the 1,390 ms call on a learner page, and it grows with every upload. Same theme as issue #74.

Fix by resolving from the course record's own source data or a single `/sources/{id}`. Fold in the
duplicate `/api/learning/courses/{id}` fetch on the same page, since both are its network profile.

**Files:** `app/prototype/LearnerFeatures.js`

## PR 6 — Source card affordances · small/medium

Closes finding 3 as revised. Show approval status on the card and make ownership legible, so an
absent action reads as *someone else's document* rather than a missing feature.

**Files:** `app/prototype/SourceLibraryPreview.js`, `app/prototype/Library.js`

## PR 7 — Rubric identity and auto-fill feedback · medium

Closes findings 9 and 11. Two saved rubrics share a title and a code
(`SC-CONDUCT-MARINE-AIR-01`), separable only by "Draft" versus "Flagged for an SME" — add created
date or source. Auto-fill takes ~25 s behind a single static line; give it real progress.

**Files:** `app/prototype/InstructorFeatures.js`

## PR 8 — Create-course source picker · large, needs a product decision

Closes finding 2. The modal body is **5,967 px in a 471 px pane — 12.7 screens**, 109 checkboxes
inline, no search, no filter, no collapse, and the Course title field sits at offset 5,856 px,
below all of them. A direct consequence of zip upload landing without the picker adapting.

Not tunable; it needs a shape. Three options, smallest first:

1. Collapse each collection to a summary row that keeps its "Select all 48".
2. Add a search / filter box.
3. Move source selection into its own step ahead of title and objectives.

## Sequencing

Three PRs touch the same files, so they run in order. The rest are disjoint and can run at once.

```
PR 2  →  PR 6  →  PR 8         serial: all touch Library.js / SourceLibraryPreview.js
PR 4                           after PR 2: both touch review-screen markup
PR 1, PR 3, PR 5, PR 7         disjoint; parallel with the above and each other
```

Every PR: branch from current main, full local suite and build, CI green, merged one at a time, and
the fix re-checked on the live app before the next begins. New assertions go in a test file named
for their concern; the npm script wiring lands in one commit at the end, so parallel branches never
contend over `package.json`.
