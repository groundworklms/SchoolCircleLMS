# SchoolCircle learning API

All routes in this document live under `/api/learning`. They are Next.js route
handlers (`app/api/learning/**/route.js`) backed by Prisma/Postgres; the
handler logic is framework-free in `lib/learning/core.js` and
`lib/learning/evidence.js`, and the arsenal adapters live in
`lib/arsenal-core.js` and `lib/arsenal-evidence.js`. `GET /api/plan` is the
existing planning-board route and is intentionally not part of this API. The
Learn (`/learn`) and Teach (`/teach`) apps are the reference clients.

## Readiness and authentication

`GET /api/learning/status` is unauthenticated and reports the current
readiness boundary:

```json
{
  "auth": {
    "ready": false,
    "provider": "firebase",
    "acceptsHeaderRoles": false,
    "reason": "..."
  },
  "persistence": {
    "provider": "prisma-postgresql",
    "learningRecord": true,
    "destructiveMigrationPerformed": false
  },
  "arsenal": {
    "model": { "ready": false, "reason": "..." },
    "rubriconConfigured": false,
    "whetstoneConfigured": false,
    "doctrineConfigured": false
  }
}
```

Learning requests require a verified identity: the browser's Firebase ID token
sent as `Authorization: Bearer <token>` (`authFetch` in `lib/firebase.js` adds
it). `lib/auth.js` verifies the token with firebase-admin using only the public
project id (`NEXT_PUBLIC_FIREBASE_PROJECT_ID`; no service account), maps the
uid to the Prisma `User` row through `externalId = firebase:<project>:<uid>`
(created on first sight with the default `LEARNER` role), and reads the role
there. The route never accepts `x-user`, `x-role`, a bearer value interpreted
as a role, or an identity in a JSON body. Until Firebase is configured,
authenticated routes return `401 AUTH_REQUIRED` (or `503 AUTH_UNAVAILABLE`
when the identity database boundary cannot be reached). `GET /api/auth/user`
returns the resolved identity (`{ "user": null }` when anonymous). Promoting a
user to `INSTRUCTOR` is a database change to `User.role`, never an API call.

Instructor-only routes return `403 FORBIDDEN` for learners. A learner can only
read `APPROVED` source/course material. Generated artifacts start as `PENDING`
and never reach learner delivery until an instructor approves them.

`MODEL_BASE_URL` **and** `MODEL_ID` are both required for model-backed
operations. Missing configuration returns `503 NO_PROVIDER`; there is no mock
or cloud fallback. An explicitly selected
`https://openrouter.ai/api/v1` may use the runtime `OPENROUTER_API_KEY` for
authorized development/testing only; a key alone never selects that provider.
Rubricon and Whetstone ride this same shared model. Their upstream packages
freeze `ENDPOINT`/`MODEL` in module-level constants at import, so a per-helper
endpoint could never follow a runtime Settings change; instead Whetstone is
driven through its documented `Session` injection seam and Rubricon's BARS
generation runs on the shared model before being handed to Rubricon's own
`validateRubric` and `verifyTraceability`, which are unchanged and remain the
actual guarantee. The former `RUBRICON_*`/`WHETSTONE_*` variables are no longer
read, and `rubriconConfigured`/`whetstoneConfigured` now report shared-model
readiness. Anchor
remains an independent grounded HTTP service at `DOCTRINE_BASE_URL`; the
existing `/api/doctrine` route returns its explicit unavailable state when that
variable is absent.

## Persistence boundary

The additive Prisma `LearningRecord` model stores integration artifacts that do
not yet have dedicated LMS tables:

| field | meaning |
|---|---|
| `ownerId` | authenticated Prisma `User.id` |
| `type` | `SOURCE`, `COURSE_DRAFT`, `RUBRIC`, `TUTOR_TURN`, `MASTERY_SESSION`, `MASTERY_ATTEMPT`, `STUDY_PLAN`, `CRITIQUE_SET`, `AAR`, `FIDELITY_CASES`, or `FIDELITY` |
| `status` | `PENDING`, `APPROVED`, `ACTIVE`, `COMPLETE`, or `RECORDED` |
| `payload` | JSON containing source pages/chunks, citations, model output, transcript, shared-plan source/revision snapshot, or session state |
| `version` | Monotonic compare-and-set version for stateful mastery turns |

The checked-in migrations (`prisma/migrations/`) first establish the existing
schema as a baseline (`20250915185900_init`) and then add `LearningRecord` plus
its optimistic `version` (`20250915190000_learning_records`). A deployment
against an empty database can run `prisma migrate deploy` (or
`npm run db:migrate` locally). An environment whose tables were created with
`prisma db push` before migrations existed should baseline the first migration
with `prisma migrate resolve --applied 20250915185900_init`, then deploy the
LearningRecord migration; no reset/drop is required.

## Source ingestion and approval

### `POST /api/learning/sources` — instructor

JSON body:

```json
{
  "title": "Training standard",
  "sourceId": "manual-01",
  "text": "The source text...",
  "pages": [
    { "page": 1, "text": "Printed page text..." }
  ]
}
```

`pages` is optional for text input, and so is `collection` — a grouping label
such as `"Lesson plans"` (one line, at most 80 characters; anything else is
stored as no collection). Quarry chunks the page text and records `text`,
`pages`, `chunks`, `outline`, `sections`, and parsed `tasks` in a
`PENDING SOURCE` record. The response is `201`:

```json
{
  "id": "record-id",
  "status": "PENDING",
  "title": "Training standard",
  "sourceId": "manual-01",
  "collection": null,
  "pages": 1,
  "chunks": 1,
  "tasks": 0
}
```

### `POST /api/learning/sources/pdf` — instructor

Multipart body with `file` and optional `title`/`sourceId`/`collection`. This
uses Quarry's existing PDF extraction seam, preserves printed page text, and
persists the same `PENDING SOURCE` shape. Uploads must be `application/pdf`,
begin with the `%PDF-` signature, and be no larger than 50 MiB. The legacy
`POST /api/ingest` parse-only response uses the same upload guard.

When `collection` is set and `sourceId` is not, the citation label defaults to
`<collection>/<filename>` rather than the bare filename, so a `lesson-01.pdf`
in "Lesson plans" and another in "Student material" stay distinguishable.

There is no zip endpoint. The instructor library unpacks a zip in the browser
and posts each PDF here with the zip's name as its `collection`, so every
document passes the same guards and a bad one fails alone.

### `GET /api/learning/sources` — authenticated

Returns source summaries. Learners see approved sources only; instructors see
the approved delivery list as well as their own sources as the authoring UI
needs.

### `GET /api/learning/sources/:id` — authenticated

Returns persisted page text and Quarry passages when the caller is the source
owner or the source is `APPROVED`. Course citations use this persisted record
id with a `p.N` page suffix (with `sourceId` retained as display metadata), so
a client can open the cited text through this authenticated endpoint. A learner
cannot open pending material.

### `POST /api/learning/sources/:id/approve` — instructor owner

Transitions a source to `APPROVED`. Approval is a human action; no generation
route transitions its own output to approved.

### `POST /api/learning/sources/approve` — instructor

Batch form of the above, for "approve all pending" on a collection:

```json
{ "ids": ["source-record-id", "..."] }
```

Each id passes through exactly the single-source gate (owner only, must have
addressable page text, version CAS). The batch is not atomic: the response is
`200` with what happened per id, so one scanned PDF with no text is reported
rather than holding up the documents beside it.

```json
{
  "approved": [{ "id": "source-record-id", "status": "APPROVED" }],
  "failed": [{ "id": "other-id", "code": "SOURCE_NOT_APPROVABLE", "error": "..." }]
}
```

A source the caller does not own reports `NOT_FOUND`. At most 200 ids per
request; an empty or malformed `ids` is `400`.

## Cited course drafting

### `POST /api/learning/courses/draft` — instructor

```json
{
  "title": "Defensive operations",
  "objectives": ["Explain the first performance step"],
  "sourceIds": ["source-record-id"],
  "diagrams": false
}
```

Coursewright receives the selected source documents and uses the SchoolCircle
model wrapper as its injectable ask callback. Grounding refusals remain in the
stored result. The response is `201` with a `PENDING COURSE_DRAFT` record id,
title, section count, and source ids.

After Coursewright, each usable section gets a second grounded pass -- `pages`
(default on; `"pages": false` opts out) -- that expands the lesson paragraph
into a short lesson a learner reads one screen at a time: an `intro`, 3-5
`pages` of typed blocks (`p`, `h`, `list`, `callout`, `terms`, `example`,
`accordion`) and a one-sentence explanation per diagram `label`. Every block is
checked against the same passage union the lesson was grounded in, at the same
overlap floor, and a block the passage cannot back is dropped rather than
saved; a section whose pages cannot be grounded keeps its paragraph and records
`refusals.pages`. The streaming twin reports the pass as `phase: "pages"`, one
event per section.

### `POST /api/learning/courses/:id/pages` — instructor owner

Runs the same page pass over a saved course -- one drafted before the pass
existed, or whose sections refused. Each section's citation is resolved back to
the approved source text it was grounded in. Responds with `expanded` and a
per-section `{ id, title, pages, reason }`. On an `APPROVED` course the new
content is also carried onto the release's `LESSON` rows, and an approved row
goes back to `PENDING`: the words a learner reads the lesson through changed,
so the instructor ratifies them again. `503` when no model is configured.

### `GET /api/learning/courses` and `GET /api/learning/courses/:id` —
authenticated

Only approved courses are listed for delivery. An instructor may inspect their
own pending draft. Learner responses are redacted at the API boundary: answer
keys, `answerIndex`, rationales, and rubric indicators are not serialized.

### `POST /api/learning/courses/:id/approve` — instructor owner

Transitions a generated course draft to `APPROVED` and materialises it into the
first-class `Course` / `Section` / `Item` tables. The initial `Course.id` is
the record id; approving a reviewed revision creates an immutable replacement
whose id is `record-id:release:<revision-record-id>`. The authoring record's
`deliveryCourseId` points at the current replacement. Existing Item/Attempt/
Schedule rows are never deleted. The rows land in the same transaction as the
course compare-and-set, so a stale or failed projection cannot publish.
`GET /api/courses` then serves the current release to authenticated learners
and instructors. Learner item projections omit answer keys, rationales, and
support scores; instructor projections retain review fields.

```json
{
  "id": "record-id",
  "status": "APPROVED",
  "version": 2,
  "deliveryCourseId": "record-id:release:revision-record-id",
  "materialised": {
    "courseId": "record-id:release:revision-record-id",
    "sections": 3,
    "items": 11
  }
}
```

`GET /api/courses/:id` accepts the generated root id and resolves the current
immutable delivery release. `?releaseId=<approved-release-id>` pins a
historical release; direct release ids from the list response are also
accepted. Both routes require a verified `LEARNER`, `INSTRUCTOR`, or `BOTH`
identity. A learner attempting to open a pending or unowned draft receives
`404` rather than a pending-content leak. SCORM export accepts the same
optional `releaseId`; mastery sessions persist the selected `releaseId` and
analytics default to the current release while retaining explicit historical
selection.

## Planning a whole course

A hundred documents and forty-eight lessons do not fit the single-draft path:
the outline prompt pastes every selected source, and the objective cap is
twelve. A plan runs the same generation one bounded step per request.

### `POST /api/learning/plans` — instructor

`{ "title": "", "sourceIds": [...], "diagrams": true }` -> `201` with the plan.
Every source must be approved. `GET /api/learning/plans` lists the caller's
plans; `GET /api/learning/plans/:id` returns one (owner only). A plan carries
`status` (`survey` | `outline` | `map` | `build` | `complete`), `survey`
(one entry per source read: kind, summary, topics, lessons it enumerates),
`annexes[].lessons[]` (id `A.01`, title, objective, `sourceIds`, `cites`,
`status` planned/drafted/failed/ungrounded with `reason`), `dropped` (what the
outline asked for and the rules rejected), `counts` and `courseId`.

### `POST /api/learning/plans/:id/{survey|outline|map|build}` — owner

One step of the stage the plan is in; a call for another stage is a no-op that
returns the plan. The client repeats the call until `status` moves on:

- `survey` reads the next three unsurveyed sources -- each sampled evenly
  within a character budget -- and catalogues them in one model call per batch.
- `outline` is one model call over the catalogue: annexes and lessons, one
  objective each (a `poi`-kind source's own lesson list is followed), capped
  at 12 annexes / 60 lessons; `{ "again": true }` re-outlines before any
  lesson is built.
- `map` is retrieval, no model: the passages that cover each objective are
  ranked across every selected source and the lesson's `sourceIds` are the
  sources they belong to. A lesson nothing covers is `ungrounded` and not built.
- `build` drafts the next planned lesson through `draftCourse` (grounding,
  citations, refusals and the page pass unchanged) over the lesson's mapped
  sources, and appends it as a section -- carrying `annex` and `lessonId` --
  to the plan's `COURSE_DRAFT`, created on the first build. The response
  carries `built: { id, title, ok, reason }`.

`POST /api/learning/plans/:id/retry` `{ "lessonId": "B.03" }` queues a failed or
ungrounded lesson again. The finished draft is reviewed, approved and ratified
like any other; `POST /api/learning/courses/:id/items/approve-all` approves
every item still PENDING on the release in one deliberate action (withheld
items are untouched).

## Answering a check in a generated course

### `GET /api/learning/courses/:id/attempts` — learner or instructor

```json
{
  "id": "record-id",
  "releaseId": "record-id:release:revision-record-id",
  "items": [{
    "id": "record-id:s1:pre1",
    "sectionIndex": 0,
    "sectionTitle": "Movement fundamentals",
    "phase": "pre",
    "ordinal": 1,
    "stem": "Which principle applies?",
    "options": ["Use cover", "Ignore terrain"]
  }],
  "answers": { "record-id:s1:pre1": { "optionId": "0", "correct": true, "feedback": "…" } }
}
```

`lessons` carries the release's `LESSON` rows: `released` is whether the row is
`APPROVED`, and only then `text`, `citation` and `content` are present.
`content` is the structured teaching content that rides on the same row
(`intro`, `pages`, `labels`, `diagram`, `flashcards` -- see
`lib/learning/project-course.js` `lessonContent`), so one ratification decision
governs the prose and the pages a learner reads it through; a withheld row
withholds all of it. The learner reader (`app/prototype/LearnerFeatures.js`)
builds its screens from this response alone, through
`lib/learning/lesson-pages.js`.

The answerable set is the `APPROVED` `QUESTION` half of the selected release's
materialised items and nothing else, so a `PENDING` or `REJECTED` item is never
listed and its text never leaves the server. No keyed answer, rationale or
support score is returned. `answers` contains only the calling learner's own
recorded attempts, newest first per item.

### `POST /api/learning/courses/:id/attempts` — learner or instructor

```json
{ "itemId": "record-id:s1:pre1", "optionId": "0", "attemptId": "uuid", "releaseId": "…" }
```

`optionId` is the index of the chosen option on the materialised row, because
the keyed answer is an index into that row's `options`. The response is
`{ "result": { "blockId", "optionId", "correct", "feedback" }, "releaseId",
"recorded" }` — the same result shape the published manual reader returns, so
one presentation serves both. The rationale reaches the learner here and only
here, after they have committed to a choice.

`attemptId` is an idempotency key: retrying the same answer replays the stored
result (`recorded: false`) instead of banking a second attempt, and reusing the
key for a different answer is `409 CONFLICT`. A different choice is a genuine
second attempt and both stay on record.

The attempt is persisted as a `MASTERY_ATTEMPT` record owned by the verified
learner, carrying `courseId`, `releaseId`, `itemId`, `sectionId`, `objective`
(the section title), `phase`, `correct`, `gradedAgainst` (the item's citation)
and the result. That is the shape the evidence store already filters for, so a
recorded answer feeds Sextant learning gain and class gaps directly. Unlike a
conversational mastery turn, a keyed check **does** establish `phase` and
`correct`; `phase` is derived server-side from the materialised item id and is
omitted when the id states none, rather than being invented.

## Shared mastery plan review

An approved course may have one or more reviewed shared mastery-plan revisions.
The plan is generated and reviewed separately from the course approval so the
instructor can inspect the canonical competency indicators before learners
start new sessions. Only the instructor who owns the approved course may create
or approve a plan. A plan is always tied to an approved source; the route does
not accept learner-supplied indicators or an unapproved source.

### `POST /api/learning/courses/:id/mastery-plan` — instructor owner

```json
{
  "sourceId": "approved-source-record-id"
}
```

The route creates a reviewed shared mastery-plan revision in `PENDING` state.
The instructor review projection contains canonical criteria in the
Whetstone-compatible shape:

```json
{
  "courseId": "approved-course-record-id",
  "sourceId": "approved-source-record-id",
  "revision": "revision-token",
  "status": "PENDING",
  "criteria": [
    {
      "elo": "Inspect and record a safe library checkout",
      "indicators": {
        "developing": "…",
        "competent": "…",
        "mastered": "…"
      }
    }
  ]
}
```

The `developing`, `competent`, and `mastered` indicators are canonical review
content, not learner answer keys. The response must remain pending until the
course owner has inspected the criteria.

### `POST /api/learning/courses/:id/mastery-plan/approve` — instructor owner

```json
{
  "revision": "revision-token"
}
```

Approves exactly the reviewed pending revision selected by the course owner.
An approved revision is immutable: later plan work creates a new pending
revision rather than changing the plan copied into existing sessions. The
endpoint rejects a revision from another course/source, a non-owner, a
non-pending revision, or a course/source that is no longer approved. Approval
does not alter prior mastery sessions or their saved reports.

### Learner-safe course metadata

An authenticated learner opening an approved course may receive only the
shared plan metadata needed to start a session:

```json
{
  "masteryPlan": {
    "status": "APPROVED",
    "sourceId": "approved-source-record-id",
    "revision": "revision-token"
  }
}
```

Learner responses do not serialize the canonical indicators. In the course
detail UI this metadata is represented by **Shared mastery plan**; it does not
expose the instructor review projection or answer-key content.

### `POST /api/learning/courses/:id/syllabus` — instructor owner

Persists the dated syllabus used by Cadence and the downstream study-plan
adapter. Body:

```json
{
  "syllabus": [
    { "id": "lesson-1", "title": "Safety check", "due": "2026-06-10", "hours": 1 }
  ],
  "asOf": "2026-06-01",
  "availability": 60,
  "status": "on_track"
}
```

Every item must have a real `YYYY-MM-DD` due date; the API does not fabricate
dates from a course title. Cadence then receives this saved syllabus through
the evidence persistence bridge.

## Rubric generation and review

### `POST /api/learning/rubrics/generate` — instructor

```json
{
  "sourceId": "source-record-id",
  "task": {
    "code": "TASK-01",
    "title": "Perform the task",
    "condition": "Given the assigned equipment",
    "standard": "Complete the task safely",
    "performanceSteps": ["Inspect", "Complete"]
  }
}
```

The source must already be `APPROVED`, as for every other grounded generator.

`courseId` and `objective` are optional and only valid together. They record
which course objective the rubric judges, and the server checks both against
the course record: the course must be the caller's, the objective must be one
the draft teaches, and the source must be one the course was generated from.
A rubric may still be generated without them -- a standard can become a BARS
scale on its own.

Rubricon validation and traceability checks run after the model output. The
`RUBRIC` record remains `PENDING` and includes `validation` and
`traceability`. The route calls upstream `generateRubric` with its isolated
configuration; malformed or ungrounded output is not silently repaired.

`GET /api/learning/rubrics` lists the owner's rubrics as
`{ id, status, title, taskCode, sourceId, courseId, objective, dimensions,
flagged, createdAt }`. `dimensions` counts the BARS dimensions Rubricon
returned; a flagged rubric has none and reports `flagged: true` instead.

`GET /api/learning/rubrics/:id` and `POST /api/learning/rubrics/:id/approve`
are instructor-owner review endpoints. Rubrics are not learner delivery
content.

## Evidence authoring inputs

### `POST /api/learning/aar/critiques` — instructor

Persists `{ "courseId": "...", "critiques": [...] }` as a critique set. The
separate Hotwash `POST /api/learning/aar` route reads that saved set; it never
accepts an ephemeral client-only critique list.

### `POST /api/learning/fidelity/cases` — instructor

Persists Understudy cases against approved source records:

```json
{
  "courseId": "course-record-id",
  "sourceIds": ["approved-source-id"],
  "persona": "A doctrine-constrained instructor",
  "cases": [
    { "situation": "The learner asks...", "expect": "Refuse unsupported action." }
  ]
}
```

The fidelity route loads the selected approved source passages from Prisma and
passes them to Understudy. Doctrine is never copied from an untrusted request
body.

## Tutor: cite or refuse

### `POST /api/learning/tutor` — authenticated

```json
{
  "question": "What does the standard require?",
  "sourceIds": ["approved-source-id"],
  "history": [
    { "role": "user", "text": "..." },
    { "role": "assistant", "text": "..." }
  ]
}
```

Sourcerer receives only the selected approved passages for learners. The
response always includes `answer`, `refused`, `reason`, and `citations`. If
retrieval is too weak, the model errors, a citation marker is missing, or
faithfulness verification fails, the answer remains a refusal. The transcript,
question, result, and citations are saved as a `TUTOR_TURN` record. There is no
fallback to an ungrounded answer.

## Whetstone mastery

### `POST /api/learning/mastery/sessions` — authenticated

```json
{
  "courseId": "approved-course-record-id",
  "releaseId": "approved-course-record-id:release:revision-record-id",
  "sourceId": "approved-source-id",
  "objectives": ["Explain the standard"],
  "maxTurns": 12
}
```

For an approved course with an approved shared mastery plan, a new session
resolves that plan server-side and copies its immutable criteria, `sourceId`,
and `revision` into the session snapshot. The learner starts it from **Start
new session** in the course detail UI; the learner does not submit or choose
canonical indicators. The session response exposes only learner-safe plan
metadata (`sourceId` and `revision`), not the indicator text.

The pinned Whetstone scorer and its progression contract are unchanged. The
route constructs the upstream Whetstone `Session` using its configured
model-backed `deriveRubric`, `firstQuestion`, and `scoreTurn` functions, then
persists its transcript and state as an `ACTIVE MASTERY_SESSION`. Existing
sessions retain their prior copied plan (or legacy course/source state) and
are never silently re-based onto a newly approved revision. Rubric indicators
are intentionally not returned as an answer key.

### `POST /api/learning/mastery/sessions/:id/turn` — session owner

```json
{ "answer": "The learner's response..." }
```

The turn is scored against the approved course/source relationship, the
session state is updated with a compare-and-set version, and a
`MASTERY_ATTEMPT` record stores the answer, result, report criteria verdicts,
transcript, source record/page citations, and completion state. Conversational
mastery is not represented as a Sextant pre/post attempt: the API does not
invent `correct` or `phase`. The response contains Whetstone's verdict,
feedback, next question, score, `complete`, and `stalled`. The session always
terminates at its configured caps. No autonomous proctoring is performed.

## Shared-plan cohort boundary

`GET /api/learning/analytics/cohort?courseId=<course-id>` must compare only
sessions whose copied shared-plan `sourceId` **and** `revision` both match.
Sessions from another source, another plan revision, or a legacy session
without the shared-plan metadata are not combined into that cohort result.
The existing privacy threshold remains **five distinct learners per
competency**; a smaller or mixed-revision population is reported as
privacy-suppressed/insufficient evidence rather than lowering the threshold or
blending incompatible plans. No individual transcript, raw answer, learner ID,
or canonical indicator text is returned.

## Error contract

`400` indicates an invalid request shape; `401` missing verified identity; `403`
insufficient role; `404` inaccessible or missing approved content; `409` a
stale mastery turn, an invalid/non-pending mastery-plan revision, or a rubric
that failed human-approval gates; `503`
unavailable identity, model, or installed upstream package. The API does not
convert unavailable services into fabricated content.