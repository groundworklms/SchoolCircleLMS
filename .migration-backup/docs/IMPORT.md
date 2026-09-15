# Importing from Moodle (and Canvas)

If the Marine Corps moves off Moodle, the courses already built in it have to come
across. This document pins the SchoolCircle content model to the two formats that
matter so the import is a mapping exercise, not a redesign.

## What we import from

| Source | Format | Notes |
|---|---|---|
| **Moodle course backup** | `.mbz` — a gzipped tar (older: zip) of XML | `moodle_backup.xml` is the master file. Sections under `sections/section_<id>/section.xml`; one folder per activity under `activities/<modname>_<id>/` with `<modname>.xml` (e.g. `lesson_173/lesson.xml`, `page_240/page.xml`, `quiz_496/quiz.xml`). Files are listed in `files.xml` and stored by content hash under `files/`. |
| **IMS Common Cartridge** | `.imscc` — zip with `imsmanifest.xml` | Moodle exports CC 1.1/1.3; Canvas exports CC 1.1 with Canvas extensions. `<organizations>` holds the item tree; `<resources>` holds pages (webcontent), QTI assessments, discussion topics, and weblinks. |
| **QTI** | `.xml` / `.zip` | Question banks. Both Moodle and Canvas export it. Maps to `check` items and practice-set questions. |

Start with **Common Cartridge**: both systems export it, and it carries structure,
pages, quizzes and discussions in one manifest. Add a native `.mbz` reader second for
the modules CC drops (Moodle Lesson branch structure, Book chapters, completion rules).

## The SchoolCircle model

```
Course                         POI course (M092721)
  Section                      POI annex (A — DC Fundamentals)
    Module  = a lesson         POI lesson (BE.02.04 Transformers)
      Item[]                   ordered; one screen each
        page        { title, blocks[] }
        check       { title, q, answers[], rationale }     gates Next
        practice    { title, text }                        links to the lesson's practice set
        attachments { title }                              files for this lesson
        (planned)   quiz · assignment · discussion · link · video · scorm
```

Blocks inside a `page`: `p`, `h`, `list`, `callout{kind,title,text}`, `terms{items}`,
`figure{caption,svg}`, `example{title,steps,result}`.

Interactive blocks — the H5P content types a schoolhouse actually uses, native so
they render without an H5P runtime and can be authored in the same tool as text:
`accordion{items}`, `hotspots{svg,spots}` (Image Hotspots), `video{prompts}`
(Interactive Video with timed notes and questions), `flashcards{cards}` (Dialog Cards).

Every item gets a stable id `<lessonId>#<n>`. Progress records (`prefs.progress[lessonId]`)
point at item ids, so reordering content does not orphan a learner's history.

Rules the player enforces, matching what instructors expect from Moodle/Canvas:

- Items are viewed **one at a time**, in order (Moodle Lesson pages; Canvas
  "students must move through requirements in sequential order").
- A `check` must be answered before Next unlocks (Moodle question page).
- Seeing a page marks it done; a check is done when answered. A lesson is complete
  when every item is done and the learner presses Finish.
- Backward navigation is always free; forward navigation stops at the first
  unanswered check.

## Moodle → SchoolCircle

| Moodle | SchoolCircle | How |
|---|---|---|
| Course | Course | Title, short name → `courseTitle`, `courseId`. Match to a POI by short name when one exists. |
| Section (topic / week) | Section (annex) | Order preserved. Section summary → the section's intro. |
| **Lesson** activity — content page | Module + `page` items | Each Lesson page becomes one `page` item, in the Lesson's *navigation* order (jumps), not edit order. Page HTML → blocks (see HTML below). |
| **Lesson** activity — question page | `check` item | Multiple choice → `answers[]` with `correct`; the correct-answer response → `rationale`. Other question types (short answer, matching) → planned. |
| **Lesson** — branch table / cluster | one Module per branch, or `page` with a `list` of links | Branching is flattened to the default path; alternate branches become extra modules, marked optional. |
| **Book** | Module; each chapter a `page` | Sub-chapters become `h` blocks inside the chapter page. |
| **Page** resource | Module with one `page` item | Or appended to the nearest lesson when the section is one lesson. |
| **Quiz** | `practice` (ungraded) or `quiz` (graded, planned) | Questions via QTI/Moodle XML into the question bank; graded quizzes become Assignments. |
| **Assignment** | Assignment | Due date, points, submission types. Lands on the Assignments tab. |
| **Forum** | Discussions | Each discussion → a thread; the forum's section decides the lesson it attaches to (or General). Posts → replies in order; the teacher's posts are marked instructor. |
| **File** / **Folder** resource | `attachments` item | Files stay instructor-approved by default (they came from an instructor). |
| **URL** | `link` item (planned) | |
| **Label** | `callout` block on the adjacent page | |
| **H5P** activity / content bank item | native block where one exists, else `h5p` item | See "H5P" below. |
| **SCORM** | `scorm` item (planned) | Keep the package; play it in an iframe. |
| Completion tracking rules | player rules | "Must view" → page seen; "must receive a grade" on a Lesson → check answered. |
| Access restrictions (date / prerequisite) | Module `unlockAt` / `requires[]` (planned) | Canvas prerequisites map the same way. |

**Page HTML → blocks.** Moodle stores page bodies as HTML. Convert deterministically:
`<p>` → `p`; `<h2>`–`<h4>` → `h`; `<ul>`/`<ol>` → `list`; `<dl>` or a two-column
table → `terms`; `<img>`/`<svg>` with a caption → `figure`; a blockquote or a
Moodle "info"/"warning" box → `callout`. Anything unrecognised becomes a `p` with the
text extracted, and the original HTML is kept on the item (`html`) so nothing is lost.
Long pages are **not** split automatically — a Moodle Page becomes one screen; the
instructor splits it in the authoring tool if it should be several.

### H5P

Moodle ships H5P natively (the H5P activity and the content bank, Moodle 3.9+). A
`.h5p` file is a zip: `h5p.json` (the content type and library versions) and
`content/content.json` (the authored content), plus any media. The content type is
what decides the import:

| H5P content type | SchoolCircle |
|---|---|
| Accordion | `accordion` block |
| Image Hotspots | `hotspots` block — hotspot `x`/`y` are already percentages in H5P |
| Interactive Video | `video` block — `interactions[]` with `duration.from` → `prompts[].at`; Multiple Choice interactions → `kind: 'question'`, Text → `kind: 'note'` |
| Dialog Cards / Flashcards | `flashcards` block |
| Multiple Choice / Single Choice Set / Question Set | `check` items (one per question), or the lesson's practice set |
| Course Presentation | one `page` per slide; each slide's elements → blocks |
| Fill in the Blanks, Drag and Drop, Drag the Words, Mark the Words | `check` variants (planned) |
| Timeline, Chart, Summary, Branching Scenario | `h5p` item: keep the package, play it in an iframe with the H5P standalone runtime |

Anything we cannot map keeps its package and plays as-is, so nothing is lost on
import. Mapped types become native blocks, which is what makes them editable in the
same authoring tool as the surrounding text — the "H5P picker plus a prompt box"
the chief instructor asked for is one tool, not two.

## Canvas → SchoolCircle

Canvas has no separate lesson type; a **Module** is the lesson and its **items** are the
screens. That is a 1:1 map to `Module.items[]`:

| Canvas module item | SchoolCircle |
|---|---|
| Page | `page` |
| Quiz (practice / ungraded survey) | `practice` |
| Quiz (graded) / Assignment | Assignment |
| Discussion | Discussions — attached to the module it sits in |
| File | `attachments` |
| External URL / External tool | `link` / `scorm` (planned) |
| Text header | `h` block, or a module sub-heading |
| Requirement "view" / "mark done" / "submit" / "score at least" | player rules above |
| "Sequential order" / prerequisites | already the default; `requires[]` (planned) |

## What the importer produces

The importer writes the same shape `lessonContent.js` holds today, plus a `source`
stamp on every item so nothing loses its provenance:

```js
{ id: 'BE.02.04#3', type: 'page', title: 'The turns ratio', blocks: [...],
  source: { system: 'moodle', module: 'lesson', id: 173, page: 912 } }
```

That stamp is what makes re-import safe: run it again after the Moodle course changes
and items match by source id, not by position.

## Order of work

1. `lib/import/cc.js` — read `imsmanifest.xml`, walk `<organizations>`, resolve
   `<resources>`, emit Course → Section → Module → Item. Pages via the HTML→blocks
   converter; QTI multiple-choice → `check`. *(Covers Moodle and Canvas exports.)*
2. `lib/import/mbz.js` — untar, read `moodle_backup.xml`, then per-activity XML for the
   modules CC drops: Lesson navigation order and question pages, Book chapters,
   completion rules.
3. An Import screen on the instructor side: drop the file, see the tree it produced,
   approve, and it lands as a course — same pattern as the POI ingest.
4. Re-import by `source` id.

Items marked *(planned)* above are model additions, not importer work — add the item
type to the player and the mapping falls out.
