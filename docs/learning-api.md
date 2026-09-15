# SchoolCircle learning API

All routes in this document are mounted below `/api/learning` by the native
Next catch-all handler (`app/api/[...path]/route.js`) and backed by
Prisma/Postgres. The framework-free learning modules in `lib/learning/` and
the shared arsenal adapters remain available for contract tests; the serving
implementation is the local `lib/server` route registry. `GET /api/plan` is
the existing planning-board route and is intentionally not part of this API.
The Learn (`/learn`) and Teach (`/teach`) apps are the reference clients.

## Readiness and authentication

`GET /api/learning/status` is unauthenticated and reports the current
readiness boundary:

```json
{
  "auth": {
    "ready": false,
    "provider": "replit-oidc",
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

Learning requests require a verified server-side identity. The route handler
never accepts `x-user`, `x-role`, a bearer value interpreted as a role, or an
identity in a JSON body. The auth boundary accepts a verified Firebase bearer
token or the original Replit Auth OIDC/PKCE session, resolves that identity to
the Prisma `User` row, and reads the role there. Until one configured provider
is available,
authenticated routes return `401 AUTH_REQUIRED` (or `503 AUTH_UNAVAILABLE`
when the identity database boundary cannot be reached).

Instructor-only routes return `403 FORBIDDEN` for learners. A learner can only
read `APPROVED` source/course material. Generated artifacts start as `PENDING`
and never reach learner delivery until an instructor approves them.

`MODEL_BASE_URL` **and** `MODEL_ID` are both required for model-backed
operations. Missing configuration returns `503 NO_PROVIDER`; there is no mock
or cloud fallback. Rubricon and Whetstone currently expose no raw chat
injection in their upstream releases, so production generation additionally
requires their isolated `RUBRICON_ENDPOINT`/`RUBRICON_MODEL`/`RUBRICON_API_KEY`
or `WHETSTONE_ENDPOINT`/`WHETSTONE_MODEL`/`WHETSTONE_API_KEY` triplets. A
missing triplet returns `503` rather than intercepting global environment or
fetch state. Anchor remains an independent grounded HTTP service at
`DOCTRINE_BASE_URL`; the existing `/api/doctrine` route returns its explicit
unavailable state when that variable is absent.

## Persistence boundary

The additive Prisma `LearningRecord` model stores integration artifacts that do
not yet have dedicated LMS tables:

| field | meaning |
|---|---|
| `ownerId` | authenticated Prisma `User.id` |
| `type` | `SOURCE`, `COURSE_DRAFT`, `RUBRIC`, `TUTOR_TURN`, `MASTERY_SESSION`, `MASTERY_ATTEMPT`, `STUDY_PLAN`, `CRITIQUE_SET`, `AAR`, `FIDELITY_CASES`, or `FIDELITY` |
| `status` | `PENDING`, `APPROVED`, `ACTIVE`, `COMPLETE`, or `RECORDED` |
| `payload` | JSON containing source pages/chunks, citations, model output, transcript, or session state |
| `version` | Monotonic compare-and-set version for stateful mastery turns |

The checked-in migrations first establish the imported baseline
(`20250915185900_init`) and then add `LearningRecord` plus its optimistic
`version` (`20250915190000_learning_records`). A deployment against an empty
database can run `prisma migrate deploy`. An environment that already has the
imported tables should baseline the first migration with
`prisma migrate resolve --applied 20250915185900_init`, then deploy the
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

`pages` is optional for text input. Quarry chunks the page text and records
`text`, `pages`, `chunks`, `outline`, `sections`, and parsed `tasks` in a
`PENDING SOURCE` record. The response is `201`:

```json
{
  "id": "record-id",
  "status": "PENDING",
  "title": "Training standard",
  "sourceId": "manual-01",
  "pages": 1,
  "chunks": 1,
  "tasks": 0
}
```

### `POST /api/learning/sources/pdf` — instructor

Multipart body with `file` and optional `title`/`sourceId`. This uses Quarry's
existing PDF extraction seam, preserves printed page text, and persists the
same `PENDING SOURCE` shape. The legacy `POST /api/ingest` parse-only response
is unchanged.

### `GET /api/learning/sources` — authenticated

Returns source summaries. Learners see approved sources only; instructors see
the approved delivery list as well as their own sources as the authoring UI
needs.

### `GET /api/learning/sources/:id` — authenticated

Returns persisted page text and Quarry passages when the caller is the source
owner or the source is `APPROVED`. Citation `source` values use this persisted
record id (with `sourceId` retained as display metadata), so a client can open
the cited text through this authenticated endpoint. A learner cannot open
pending material.

### `POST /api/learning/sources/:id/approve` — instructor owner

Transitions a source to `APPROVED`. Approval is a human action; no generation
route transitions its own output to approved.

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

### `GET /api/learning/courses` and `GET /api/learning/courses/:id` —
authenticated

Only approved courses are listed for delivery. An instructor may inspect their
own pending draft. Learner responses are redacted at the API boundary: answer
keys, `answerIndex`, rationales, and rubric indicators are not serialized.

### `POST /api/learning/courses/:id/approve` — instructor owner

Transitions a generated course draft to `APPROVED`. A learner attempting to
open a pending or unowned draft receives `404` rather than a pending-content
leak.

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

Rubricon validation and traceability checks run after the model output. The
`RUBRIC` record remains `PENDING` and includes `validation` and
`traceability`. The route calls upstream `generateRubric` with its isolated
configuration; malformed or ungrounded output is not silently repaired.

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
  "sourceId": "approved-source-id",
  "objectives": ["Explain the standard"],
  "maxTurns": 12
}
```

The route constructs the upstream Whetstone `Session` using its configured
model-backed `deriveRubric`, `firstQuestion`, and `scoreTurn` functions,
persists its transcript and state as an `ACTIVE
MASTERY_SESSION`, and returns the opening question and learner-safe report.
Rubric indicators are intentionally not returned as an answer key.

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

## Error contract

`400` indicates an invalid request shape; `401` missing verified identity; `403`
insufficient role; `404` inaccessible or missing approved content; `409` a
stale mastery turn or a rubric that failed human-approval gates; `503`
unavailable identity, model, or installed upstream package. The API does not
convert unavailable services into fabricated content.
