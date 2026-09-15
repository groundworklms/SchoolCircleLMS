# Learning evidence API

This document is the frontend contract for the six Arsenal evidence surfaces. The handler factory
is `createEvidenceHandlers({ store, model })` in `lib/learning/evidence.js`; the route files under
`app/api/learning/` bind it to Prisma persistence (`createLearningEvidenceStore` in `lib/db.js`) and
the configured model. Nothing here changes the existing `/api/plan` route.

All IDs in request bodies and query strings are **course IDs only**. Learner IDs come from the
verified identity resolved by `lib/auth.js` (Firebase bearer token -> Prisma `User`); clients cannot
select another learner. Instructor routes check the Prisma role and never return raw cohort
attempts, profile responses, or learner IDs.

## Common response and error rules

Successful JSON responses use the shapes below. Errors are:

```json
{ "error": "human-readable message", "code": "STABLE_CODE" }
```

The adapter returns `503` with an explicit `status: "unavailable"` for an Understudy benchmark
when no model is injected. It does not invoke a package default endpoint, read an API key, or count
model failures as doctrine failures.

## Study plan — Cadence

### `POST /api/learning/study-plan`

Creates and persists a plan for the authenticated learner. The server loads the syllabus from
`store.getStudyPlanInput`; the client cannot submit a replacement syllabus.

Request:

```json
{
  "courseId": "course_123",
  "asOf": "2026-02-01",
  "availability": 60,
  "ics": { "calendarName": "My study plan", "startHour": 18 }
}
```

`availability` is minutes per day or Cadence's weekday map. `asOf` is `YYYY-MM-DD`.
`status` is optional and, when supplied, is `behind`, `on_track`, or `ahead`.

Response `201`:

```json
{
  "plan": {
    "asOf": "2026-02-01",
    "status": "on_track",
    "recommended": "maintain",
    "coas": {}
  },
  "selectedBlocks": [],
  "ics": "BEGIN:VCALENDAR\r\n...",
  "reminders": [],
  "persisted": true
}
```

`plan.coas` is Cadence's complete `catch_up`, `maintain`, and `get_ahead` output. `selectedBlocks`
and ICS use the recommended COA only. `store.saveStudyPlan` persists the complete result.

### `GET /api/learning/study-plan?courseId=course_123[&format=json|ics|reminders]`

Returns the saved plan. `format=json` (default) returns the persistence record; `format=ics`
returns `text/calendar`; `format=reminders` returns `{ "reminders": [] }`. A missing saved plan is
`404`, rather than silently planning from client data.

## Analytics — Sextant

### `GET /api/learning/analytics?courseId=course_123`

Returns analytics over the authenticated learner's saved attempts and mastery reports:

```json
{
  "scope": "learner",
  "gain": { "objectives": [], "overall": {} },
  "gaps": [],
  "mastery": [],
  "privacy": { "cohortSuppressedBelow": 5, "learnerIdsReturned": false }
}
```

### `GET /api/learning/analytics/cohort?courseId=course_123`

Instructor-only class analytics. The same shape has `scope: "cohort"`. Sextant `classGaps` receives
the persisted `learnerId` values only to count **distinct** learners; the adapter fixes suppression at
`minCohort: 5` and never returns those IDs. Suppression applies to **gain, gaps, and mastery**, not
just the gaps rows. A one-learner or small-cell result returns an
`insufficient_evidence` object for aggregate fields and no class result is emitted. A missing learner
id is not counted as a learner.

Gain has a second evidence gate: only saved attempts with an explicit `phase` of `pre` or `post`
and a literal boolean `correct` are accepted. Whetstone mastery turns do not become incorrect
attempts, and a mastery report's `criteria` rows are counted only when `verdict` is one of
`developing`, `competent`, or `mastered`. If no true pre/post evidence exists, `gain` is an
`insufficient_evidence` object rather than a fabricated zero.

`GET /api/learning/analytics?scope=cohort` is retained as an equivalent guarded form for clients
that cannot use the explicit `/cohort` path.

## After-action review — Hotwash

### `POST /api/learning/aar`

Instructor-only action. Request body:

```json
{ "courseId": "course_123" }
```

The server loads persisted critiques from `store.getAarInput`, runs Hotwash's ranked `report`, and
saves it through `store.saveAar`. A deterministic memo is always returned. If the route factory was
given an explicit `model`, Hotwash may return a model narrative; otherwise `source` is `heuristic`
and `modelAvailable` is `false`.

Response `201`:

```json
{
  "report": {
    "sustains": [],
    "improves": [],
    "byArea": [],
    "meta": {}
  },
  "memo": "AFTER-ACTION REVIEW...",
  "source": "heuristic",
  "modelAvailable": false,
  "persisted": true
}
```

### `GET /api/learning/aar?courseId=course_123`

Returns the saved AAR; it does not re-run the benchmark or fabricate critiques.

## Learner preference survey — Waypoint

### `POST /api/learning/profile`

Persists a Waypoint survey for the authenticated learner. The request contains only the response
map:

```json
{ "responses": { "v1": 5, "v2": 4, "h1": 2 } }
```

Waypoint keeps unanswered dimensions `null`; the adapter does not guess them. Response `201`:

```json
{
  "profile": {
    "name": "Authenticated learner",
    "dims": {},
    "dominantModality": "visual",
    "pace": "flexible",
    "structure": "balanced",
    "answered": 3
  },
  "recommendations": [],
  "persisted": true
}
```

The name is taken from authenticated user data, never the request body.

### `GET /api/learning/profile`

Returns the authenticated learner's saved profile. `GET /api/learning/profile/cohort?courseId=...`
is instructor-only and aggregates saved profiles with Waypoint `classProfile` only for learners with
saved attempts/session records tied to that instructor-owned approved course, and only when
persistence reports at least five distinct learners; it exposes no raw responses. Below the threshold
it returns `status: "insufficient_evidence"` and `profile: null`.

## SCORM export — Cartridge

### `GET /api/learning/export?courseId=course_123[&version=1.2|2004]` — instructor

Loads the approved course projection using `store.getApprovedCourse` scoped to the instructor owner,
converts it to Cartridge's plain course shape, builds a package, and **validates the ZIP before sending
bytes**. This endpoint is instructor-only because Cartridge embeds answer keys in the SCORM
courseware. The server rejects pending/rejected items (`COURSE_NOT_APPROVED`) and never accepts a
course object from the browser. Successful responses are `application/zip` attachments with
`X-SCORM-Version`.

The store projection may be:

* Prisma-like `{ title, sections: [{ items: [{ kind, status: "APPROVED", ... }] }] }`; every item
  must be explicitly `APPROVED` and lesson/question text must be non-empty; or
* approved Coursewright `{ title, approved: true, sections: [{ lesson, pre, post, cite }] }`; every
  section must contain non-empty `lesson`, `pre`, and `post` question content; or
* a pre-shaped `{ title, approved: true, lessons, quiz }` projection produced by persistence code.

An approved title with a Coursewright refusal or empty lesson/test projection is rejected with
`COURSE_CONTENT_MISSING`; it is never converted to a blank Cartridge lesson.

## Doctrinal fidelity — Understudy

### `POST /api/learning/fidelity`

This is a separate, explicit **instructor action**. It is not called by tutor answer handling.
Request:

```json
{ "courseId": "course_123" }
```

The server loads saved benchmark `cases`, `persona`, and approved doctrine passages through
`store.getFidelityInput`. It calls Understudy's `benchmark` with two injected model roles:
`agent` and an independent `judge`. If no `model` was provided to
`createEvidenceRouter`, response `503` is:

```json
{
  "status": "unavailable",
  "reason": "No injected model is configured for the Understudy agent and independent judge.",
  "report": null,
  "runs": [],
  "persisted": false
}
```

With a model, response `201` is `{ "status": "complete", "report": {}, "runs": [], "persisted":
true }`. Understudy excludes `errored` model/network runs from its fidelity denominator; the
adapter does not turn them into a fake pass or an `off-doctrine` verdict. `GET
/api/learning/fidelity?courseId=...` reads the saved result only.

## Persistence seam

The backend core supplies an object with these methods. Each receives one object argument; every
method must scope its query by the authenticated ID(s) it receives and return `null` for no saved
record. The route never passes a client-provided `learnerId`.

```js
store.getStudyPlan({ learnerId, courseId })
store.getStudyPlanInput({ learnerId, courseId }) // { syllabus, asOf?, availability?, status? }
store.saveStudyPlan({ learnerId, courseId, input, plan, selectedBlocks, ics, reminders })

store.listLearnerAttempts({ learnerId, courseId? })       // explicit Sextant pre/post records only
store.listLearnerMasteryReports({ learnerId, courseId? }) // Whetstone report-shaped records
store.listCohortAttempts({ instructorId, courseId? })     // { attempts, distinctLearnerCount } OR array with learnerId
store.listCohortMasteryReports({ instructorId, courseId? }) // { sessions, distinctLearnerCount } OR array

store.getAar({ instructorId, courseId })
store.getAarInput({ instructorId, courseId }) // { critiques, courseTitle? }
store.saveAar({ instructorId, courseId, report, memo, source, modelAvailable })

store.getLearnerProfile({ learnerId })
store.saveLearnerProfile({ learnerId, responses, profile, recommendations })
store.listCohortProfiles({ instructorId, courseId? }) // { entries, distinctLearnerCount } OR entries with learnerId

store.getApprovedCourse({ instructorId, courseId })
store.recordExport({ instructorId, courseId, version, validation }) // optional audit hook

store.getFidelityEvaluation({ instructorId, courseId })
store.getFidelityInput({ instructorId, courseId })
  // { cases, persona, doctrine or retriever, k?, strict?, groundingThreshold? }
store.saveFidelityEvaluation({ instructorId, courseId, status, report, runs })
```

## Explicit model seam

`model` is optional for deterministic Hotwash output and required for Understudy fidelity. To use the
current self-hosted provider, the backend should inject a wrapper rather than having this adapter read
provider environment variables:

```js
const model = ({ capability, role, system, user, json }) =>
  generateJSON({
    system,
    prompt: user,
    schema: json ? capability === 'understudy' ? UNDERSTUDY_SCHEMA : AAR_SCHEMA : undefined
  });
```

The adapter also accepts `{ complete(payload) }`, `{ chat(system, user) }`, and
`{ generateJSON(args) }`. Tests use a clearly labelled deterministic fixture model; production must
pass the current model provider explicitly.