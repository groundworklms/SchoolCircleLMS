# Planning and reporting contract

This note is the backend/UI handoff for Task 16. The native evidence routes are
mounted below `/api` by `lib/server/integration.js`; learner IDs come from the
verified session and are never accepted from a request body.

## Learner profile (Waypoint)

* `POST /api/learning/profile` accepts `{ "responses": { ... } }` only.
* Responses are a partial map of the Waypoint instrument (`v1` through `s2`).
  Missing, `null`, and empty-string answers remain unanswered. The server does
  not infer a score for an unanswered dimension.
* Invalid answered values (anything other than an integer `1..5`) are a `400`
  response. The authenticated user's name is used; a request cannot rename the
  profile.
* `GET /api/learning/profile` reloads the persisted `{ responses, profile,
  recommendations }` record. A missing record is `404` (`PROFILE_NOT_FOUND`).
  UI should render `profile.dims.<dimension>: null` as “not enough responses,”
  not as a low preference. `pace: "flexible"` and `structure: "balanced"` are
  Waypoint's neutral labels when those dimensions have no answered items.

## Syllabus and study planning (Cadence)

* `POST /api/learning/courses/:courseId/syllabus` is instructor-only. It
  validates a non-empty syllabus before persisting it on the instructor-owned
  course draft. Each item needs non-empty `title` and a real `due` date in
  `YYYY-MM-DD`; supplied hours/weight and completion flags are validated.
* `POST /api/learning/study-plan` never accepts a syllabus from the browser.
  It loads the approved, persisted course syllabus through the store. A course
  without one returns `404` (`SYLLABUS_NOT_FOUND`) so the UI can ask the
  instructor to add it. `asOf` may be supplied by the learner or persisted
  with the syllabus; it must be a real ISO date.
* A successful `201` contains Cadence's complete `plan.coas` with
  `catch_up`, `maintain`, and `get_ahead`, plus `selectedBlocks`, `reminders`,
  and a CRLF iCalendar string. Only blocks from the recommended COA are
  exported in the calendar. The saved record includes the planning input and
  can be reloaded with `GET /api/learning/study-plan?courseId=...`.
* `GET ...&format=ics` returns `text/calendar`; `format=reminders` returns
  `{ "reminders": [...] }`; missing saved plans are `404`.

## Instructor cohort reporting (Sextant/Waypoint)

* `GET /api/learning/analytics/cohort?courseId=...` and
  `GET /api/learning/profile/cohort?courseId=...` are instructor-only.
* Membership is the union of distinct IDs attached to persisted course
  attempts/mastery sessions, after the persistence layer verifies
  `User.role = LEARNER`. Instructor, blank, and unknown owners are not
  contributors. A learner appearing in both sources counts once. Raw attempts,
  answers, profile response maps, and learner IDs are never returned.
* Fewer than five distinct learners suppresses every aggregate (`gain`,
  `mastery`, gaps, and cohort profile) with `status:
  "insufficient_evidence"`. No small-cell answer or invented score is emitted.
* Contributor thresholds are independent of membership: overall gain and each
  objective require five distinct learner contributors with paired scored
  attempts (`phase: "pre"` and `phase: "post"` plus boolean `correct`); each
  mastery competency requires five distinct learner IDs. Union membership
  cannot authorize sparse stats. Conversational mastery turns alone cannot
  become false pre/post answers. A cohort with enough members but no real
  pre/post evidence returns an explicit `insufficient_evidence` gain.
* Waypoint retains the five-profile cohort shell but returns `null` for every
  dimension or modality cell answered by fewer than five profiles. Duplicate
  profile saves are deduplicated before both population and cell thresholds.

## After-action review (Hotwash)

* `POST /api/learning/aar/critiques` persists validated critique input on the
  instructor-owned course. `iteration` values are retained exactly (with an
  `inputIterations` label index) so trends can be inspected across course
  cycles.
* `POST /api/learning/aar` reads that persisted critique set, computes the
  deterministic Hotwash report, and saves an inspectable AAR containing the
  report, memo source, complete critique input, `inputIterations`, and
  critique-set provenance (also available under `input.provenance`).
  `GET /api/learning/aar?courseId=...` reloads that saved record.
* Without an explicitly injected model, the response is deterministic
  `source: "heuristic"` and `modelAvailable: false`; this is not represented
  as a model-written memo. A configured model that fails also falls back
  honestly to the heuristic source.

All route failures use `{ error, code }`. `503` with
`status: "unavailable"` is reserved for the separate Understudy fidelity
benchmark when no model is injected; it is never counted as a doctrine score.