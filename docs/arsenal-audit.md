# Arsenal audit: SchoolCircle integration truth

This is a source audit of the twelve repos named by
[`05-arsenal-contracts.md`](./05-arsenal-contracts.md). It deliberately separates:

1. what the checked-out repository actually exports and can do;
2. what requires a model, service, dependency, or device; and
3. what SchoolCircle currently consumes.

**Audit status: in progress; service/browser verification is incomplete.**

`adapter-wired` below means that the current SchoolCircle/API source has an adapter
or import and route for that repo. It does **not** mean that the upstream repository
was merely cloned, or that a route has been proven against every live dependency. The
development API has passed its health/status/auth-boundary probes and selected Prisma
roundtrip tests; no claim of a live model, Anchor device, instructor OIDC callback,
production database, or complete browser flow is made by this document.

## Audit basis and provenance

The repos were inspected as shallow `main` clones under `.cache/arsenal`. The reproducible
clone form is:

```bash
git clone --depth 1 --branch main \
  https://github.com/groundworklms/<repo>.git .cache/arsenal/<repo>
git -C .cache/arsenal/<repo> rev-parse HEAD
```

Each checked-out clone has one shallow boundary. The resolved commit, remote, package
metadata, and machine-readable capability record are in
[`arsenal-revisions.json`](./arsenal-revisions.json). The `groundworklms` remote is the
provenance used here even where an upstream README badge or `package.json` still says
`jeranaias`; that metadata discrepancy is recorded rather than silently corrected.

The contract itself says the eleven JavaScript repos are Git dependencies, Anchor is an
HTTP service, and the pieces compose as JSON ([contract lines 10–35](./05-arsenal-contracts.md#L10-L35)).
The current API package pins all eleven JavaScript repos to the reviewed SHAs. Current source
inspection finds an adapter and route for every one, with learner/instructor UI for the principal
flows. "Adapter-wired" below means source wiring exists; it does **not** mean a live model,
Anchor process, instructor identity, or complete deployed end-to-end path was verified. The
development Prisma baseline and LearningRecord migration have been deployed, and selected
tests exercise a real PostgreSQL roundtrip; this is not production deployment proof.
The runnable commands and blockers are listed in [`arsenal-verification.md`](./arsenal-verification.md).

## Truthful capability matrix

| Repo, resolved `main` ref, and role | Verified exports and primary call/API shape | Runs locally without network/model | External requirements and non-local behavior | Contract drift found | Current SchoolCircle status |
|---|---|---|---|---|---|
| **anchor** · `fc9cc61a1a42121c3ad811f800b028805810ecf5`<br>Offline FastAPI doctrine tutor; remote `groundworklms/anchor` | No npm exports. `POST /api/ask` accepts `{"question": string}` and returns `question`, `retrieved`, `top_rerank_score`, `top_pub_id`, `top_effective_score`, `citations`, `abstained`, `abstain_reason`, plus `text`/`sources` on an answer and optional `grounding`. Also exposes `POST /api/ask/stream` SSE, learning, review, instructor, records, corpus, health, and telemetry routes. See `src/api/main.py` and `src/generation/pipeline.py`. | Pure chunking, retrieval gates, citation/refusal checks, grounding helpers, and API tests can use local fixtures/stubs. `GroundingVerifier` runs with an injected `ask_model` or local HHEM stub. A production answer requires an indexed corpus and model services. | Python device requirements (FastAPI, Uvicorn, Pydantic, SQLite/`sqlite-vec`, YAML) plus a corpus/config and local generator, embedding, and reranker services (documented ports 8080–8082). Optional HHEM verifier is another local service. It is designed for an air-gapped Jetson, not a cloud API. | The contract shows `{q}` and output names `abstainReason`, `answer`, `topScore`, and `latencyMs`; the service uses `{question}`, `abstain_reason`, `text`, `top_rerank_score`, and `latency_s` (the SchoolCircle adapter maps these). The contract’s `/api/doctrine` route is an app wrapper, not an Anchor route. | **Adapter-wired.** `artifacts/api-server/src/lib/doctrine.js` POSTs to Anchor `/api/ask`; `routes/doctrine.js` serves `/api/doctrine`; `schoolcircle/src/components/AskWidget.jsx` renders citations and refusal. The adapter is HTTP-only and intentionally reports unavailable when `DOCTRINE_BASE_URL` is absent; Anchor itself is not configured or live-verified here. |
| **quarry** · `465b7515732bbc08b80b6ec8684e1fc49c7985ea`<br>PDF/text extraction and structure | Root: `pdfText`, `PdfParseError`, `chunkText`, `extractTasks`, `outline`, `sections`. Subpaths: `quarry/chunk`, `quarry/tasks`, `quarry/outline`, `quarry/pdf`. Primary calls: `pdfText(bytes) -> {text, pages, pageTexts}`, `chunkText(text, maxWords=180)`, `extractTasks(text, opts?)`. | `chunkText`, `extractTasks`, `outline`, and `sections` are deterministic. `pdfText` is local-only when passed local PDF bytes. | Node 18+ and local `pdfjs-dist`; no model, network, or API key. | The contract says PDF/POI bytes and `{text}`; this repo has a PDF parser and a text task parser, not a POI-specific parser, and `pdfText` returns `pages` and `pageTexts` too. The contract’s `pageTexts` key export is not a function; it is part of the `pdfText` result. | **Adapter-wired.** `arsenal-core.js:ingestSource` imports Quarry at call time and preserves page/chunk citations. `POST /api/learning/sources` and `/api/learning/sources/pdf` persist `SOURCE` records; `/teach` exposes text ingestion and source approval. Adapter tests include persistence/route coverage; no live PDF service or instructor flow is claimed. |
| **coursewright** · `f38d078a30195a6a6901ade22a3ce7484613fa57`<br>Cited course generation | Root exports `buildCourse`, `fromDocuments`, `isRefusal`, `verifyGrounding`, `chunk`, `match`. Actual generation shape is `buildCourse(spec, emit?, options?)` where `spec` contains `title` and `objectives`; `fromDocuments(spec, emit?, options?)` takes `documents` and objectives. `options.ask`/fetch can be injected. | `chunk`, `match`, `verifyGrounding`, and refusal checks are deterministic. Full generation can run offline only with a deterministic injected `ask`/fetch; the default path calls a model. | Node 18+, no package dependency. Default generation uses `COURSEWRIGHT_API_KEY`/`OPENROUTER_API_KEY`, endpoint/model env vars, and optional diagram model. | Contract signatures say `buildCourse(objectives, {ask}?)` and `fromDocuments(docs, objectives, {ask}?)`; source/README use one spec object and separate `emit` then `options`. The documented output is richer than the contract’s generic `items` shape: sections contain lesson, pre/post, flashcards, diagram, and per-artifact refusals. | **Adapter-wired.** `arsenal-core.js:draftCourse` calls `fromDocuments` with the SchoolCircle model seam and preserves generated course JSON/refusals. `POST /api/learning/courses/draft` persists `COURSE_DRAFT` as `PENDING`; `/teach` offers source-backed draft and approval. Requires configured model and persistence for production calls. |
| **sourcerer** · `8a2e6831ebc6ced8ee71b0215fb0037d1cb7c1bb`<br>Cite-or-refuse document Q&A | Root exports `ask`, `normalizeEndpointResponse`, `keywordRetriever`, `embedRetriever`, `verifyFaithfulness`, `summarizeFaithfulness`. Primary call is `ask(question, opts?)`, not an object-only call. Options include `passages`, `retriever`, `endpoint`, `chat`, `verify`, `k`, `minScore`, and history. | Keyword retrieval, endpoint normalization, refusal thresholds, and faithfulness summary are local. `ask` can be exercised without network using passages plus an injected `chat`; verification accepts an injected chat. | Node 18+ and no package dependency. Default `ask` model calls the OpenRouter-compatible endpoint; `embedRetriever` needs an embeddings endpoint. Endpoint grounding is an external HTTP service and returns citations without passage text. | Contract shows `ask({q, passages\|retriever\|endpoint,...})`; actual API is `ask(question, opts)`. Contract names `verifyFaithfulness`/`keywordRetriever`/`embedRetriever` but omits the exported normalizer and summary helper. `verify` intentionally throws on endpoint-only results because there is no passage text to verify. | **Adapter-wired.** `arsenal-core.js:tutorAnswer` calls Sourcerer over approved persisted passages, with strict cite-or-refuse semantics. `POST /api/learning/tutor` persists `TUTOR_TURN`; the existing global Ask widget remains the separate Anchor `/api/doctrine` surface. Route/Prisma tests pass, but no tutor model or instructor-authenticated live flow is claimed. |
| **rubricon** · `1a3d88c9cef6e0239da060e936398fa6b999c6a9`<br>BARS rubric generation and rater reliability | Root exports `generateRubric`, `taskToText`, `verifyTraceability`, `validateRubric`, `percentAgreement`, `cohenKappa`, `weightedKappa`, `fleissKappa`, `interpretKappa`, `reliabilityReport`, `TIERS`. | Traceability, structural validation, agreement, and kappa calculations are pure/local. | Node 18+ and no package dependency. `generateRubric` calls the configured OpenAI-compatible endpoint and reads `RUBRICON_API_KEY` or `OPENROUTER_API_KEY`. | Contract lists `isValidRubricShape`, but the root entry point does not export it (it is only a named export from `src/rubric.js`). Contract promises `generateRubric(task, {ask}?)`; actual source is `generateRubric(task)` with no injected client option. Invalid task/model failures use `Error` or returned `{error}` in places, not the global “every bad shape throws `TypeError`” claim. | **Adapter-wired.** `arsenal-core.js:generateRubric` enforces explicit `RUBRICON_ENDPOINT`, `RUBRICON_MODEL`, and `RUBRICON_API_KEY` in production, then validates/trace-checks output. `/api/learning/rubrics/generate`, `/api/learning/rubrics/:id`, and approval persist `PENDING`/`APPROVED` records. No dedicated rubric UI is present and no live Rubricon call is claimed. |
| **whetstone** · `4b5d0a4be05a5a2161a4d46f9261ff88a43d8b2b`<br>Conversational mastery loop | Root exports `deriveRubric`, `firstQuestion`, `scoreTurn`, `computeScore`, `LEVELS`, `Session`, `masteryReport`. `new Session({objectives, source, scorer?, deriveRubric?, firstQuestion?, maxTurns?, maxAttemptsPerCriterion?, maxTranscript?})`; `start()`, `answer(text)`, `report()`. | `Session` progression is deterministic with injected scorer/rubric/question functions; score/report helpers are local. Default rubric/question/scoring paths call a model. | Node 18+ and no package dependency. Default model calls use `WHETSTONE_API_KEY`/OpenRouter and endpoint/model env vars. | Contract says `objective` singular in the constructor; source uses `objectives` (string or array). Constructor caps and some invalid options throw `RangeError`, contrary to the global TypeError statement. | **Adapter-wired.** `arsenal-core.js` owns start/answer/restore/serialization and keeps terminal `complete`/`stalled` state. `/api/learning/mastery/sessions` and `/:id/turn` persist `MASTERY_SESSION`/`MASTERY_ATTEMPT`; `/learn` renders the session. Requires model, auth, and database for production calls; no live Whetstone proof is claimed. |
| **sextant** · `007a2c0f47fd50a9acbc3f3538814c1bf8683e95`<br>Learning gain, privacy-preserving class gaps, mastery rollups | Root exports `learningGain`, `classGaps`, `masteryRollup`, `summarize`, `competencyEvidence`; subpaths `sextant/analytics`, `sextant/competency`. | All analytics and `competencyEvidence(...,{heuristicOnly:true})` are deterministic/local. | Node 18+ and no package dependency. Model mode for `competencyEvidence` is optional, injectable, and falls back to the heuristic; it reads `SEXTANT_*` env vars when not injected. | Contract map is broadly accurate, but its claim that the whole JS set has no model/network/key is too broad: `competencyEvidence` has an optional model path. `classGaps` suppresses by distinct `learnerId` cohort, which an adapter must preserve rather than aggregate by attempt count when IDs exist. | **Adapter-wired.** `arsenal-evidence.js:buildAnalytics` filters explicit pre/post evidence and enforces Sextant cohort suppression without returning learner IDs. `/api/learning/analytics` serves learner and instructor cohort scopes; `/learn` renders learner progress. The 24-test run includes route and selected PostgreSQL persistence coverage; no instructor-authenticated live aggregate is claimed. |
| **understudy** · `6ecb931b85af9cf36aab185f587dd3ede4a61d96`<br>Doctrine-constrained stand-in and fidelity benchmark | Root exports `respond`, `doctrineRetriever`, `groundResponse`, `benchmark`, `scoreCase`, `fidelityReport`, `checkGrounding`, `normalizeVerdict`, `VERDICTS`, `UNKNOWN`, `tokenize`; subpaths `benchmark` and `grounding`. `respond({persona, doctrine\|retriever, situation, strict?, chat?})`; `benchmark(cases, opts)`. | Retriever, grounding proxy, response gate, verdict normalization, and fidelity aggregation are local. `respond`/benchmark can be deterministic with injected chat and judge. | Node 18+ and no package dependency. Default agent/judge paths use `UNDERSTUDY_*` model endpoints; benchmark isolates errored runs and excludes them from its denominator. | Contract is mostly accurate. The source additionally exports `tokenize`, `VERDICTS`, and `UNKNOWN`; the contract’s shared TypeError promise does not cover every runtime error path, so callers should use the documented response/error fields. | **Adapter-wired as instructor-only evaluation.** `arsenal-evidence.js:evaluateFidelity` runs an independent benchmark over approved doctrine and returns explicit `unavailable` without an injected model. `/api/learning/fidelity` plus persisted case/evaluation routes and `/teach` expose the instructor check; ordinary learner tutor turns never call Understudy. No live model proof is claimed. |
| **cartridge** · `68f02aa93bca51c4d24f42b8392a4f5ad02c8db3`<br>SCORM package builder | Main export `buildCartridge`, `validatePackage`, `safe` from `src/cartridge.js`. `buildCartridge(course, {version: '1.2' or '2004'}) -> Promise<Buffer>`; `validatePackage(zip) -> Promise<{valid,version,issues}>`. | Local and reproducible with the declared dependency installed; fixed ZIP timestamps make identical input byte-stable. Validation never throws for non-ZIP input. | Node 18+ and `jszip`; no network/model/key. Course title is required; lessons/quiz must be arrays. | Contract says `masteryScore` is a `buildCartridge` option; source reads it from `course.masteryScore` and options only selects SCORM version. Package metadata points to `jeranaias/cartridge` while the audited remote is `groundworklms/cartridge`. | **Adapter-wired, instructor-only.** `arsenal-evidence.js:buildApprovedScorm` converts only approved course items, builds both supported versions, validates the ZIP before sending, and records exports. `GET /api/learning/export?courseId=&version=` and approved-course export controls in `/teach` are present. Requires instructor auth and a persisted approved course; no LMS/player or live export proof is claimed. |
| **cadence** · `9b6b2df0ab1e11080510262a631ffb7e13acda4e`<br>Study scheduling and calendar export | Root exports `plan`, `assessStatus`, `COAS`, `addDays`, `diffDays`, `toICS`, `toReminders`; subpaths `plan` and `ics`. `plan({syllabus, availability, asOf, status?})`; `toICS(blocks, opts?)`. | Entire package is pure/deterministic; no model, network, or key. | Node 18+ and no package dependency. Validates real calendar dates and availability hard caps. | Contract is materially accurate. The app’s original planning board is intentionally not replaced; Cadence is exposed through separate learning-evidence study-plan routes. | **Adapter-wired on separate routes.** `arsenal-evidence.js:buildStudyPlan` calls Cadence and emits ICS/reminders. `POST/GET /api/learning/study-plan` and `format=ics|reminders` persist/read plans; `/learn` renders the separate Study Plan view. `/api/plan` remains the existing planning board. Prisma-backed route tests pass; no authenticated live plan is claimed. |
| **hotwash** · `a972df65aa1c45c6b28c7fd6540a3b9303cf7b74`<br>Course critique and AAR worklist | Root exports `rollup`, `trendByArea`, `rankFindings`, `sustains`, `hotwash`, `heuristicMemo`, `narrativeAAR`; subpaths `aar` and `narrative`. `hotwash({critiques, epsilon?})`; `narrativeAAR(report, opts?)`. | Analytics and `heuristicMemo` are pure/local. | Node 18+ and no package dependency. `narrativeAAR` optionally calls a model and falls back to a deterministic memo on I/O failure. | Contract is materially accurate, but its “all core is deterministic” language should be scoped to analytics; narrative has an optional model path. | **Adapter-wired.** `arsenal-evidence.js:buildAar` persists critiques first, always has Hotwash's deterministic memo, and only uses an explicitly injected model for narrative output. `/api/learning/aar/critiques`, `/api/learning/aar`, and `/teach` provide the instructor AAR flow. Route/Prisma tests pass; no live model or instructor-authenticated AAR is claimed. |
| **waypoint** · `a861421b03399b8dc39f06aad113d1f064f465e4`<br>Learner preference profile and faculty cohort view | Root exports `scoreProfile`, `profile`, `recommendations`, `toMarkdown`, `defaultInstrument`, `DIMENSIONS`, `classProfile`; subpaths `profile` and `cohort`. `profile(responses, opts?)`; `classProfile(entries, opts?)`; `toMarkdown(profile)`. | Entire package is pure/deterministic; no model, network, or key. Unanswered dimensions stay `null`; Markdown names are escaped. | Node 18+ and no package dependency. Responses are integer Likert values 1–5; malformed input throws `TypeError`. | Contract is materially accurate. This is a delivery preference instrument, not a validated fixed “learning style”; the adapter retains that framing and does not turn `dominantModality` into a learner diagnosis. | **Adapter-wired.** `arsenal-evidence.js:buildProfile` and `buildCohortProfile` call Waypoint while suppressing small cohorts and raw learner IDs. `/api/learning/profile` and `/api/learning/profile/cohort` persist/read profiles; `/learn` renders the learner survey. Prisma-backed route tests pass; no instructor-authenticated live profile flow is claimed. |

## Contract drift and integration implications

These are the high-impact mismatches that should be resolved before installing the
contract text as an npm/git dependency recipe:

1. **Repository identity is inconsistent.** The contract names `groundworklms`, and the
   audited remotes resolve there, while the JavaScript package metadata and README badges
   currently identify `jeranaias`. Pin the remote and commit from
   `arsenal-revisions.json`; do not infer provenance from package metadata.
2. **The object shapes in the map are aspirational in several rows.** Sourcerer is
   `ask(question, opts)`, not `ask({q,...})`; Coursewright takes a `spec` object plus
   `emit`/`options`; Whetstone uses `objectives`; and Anchor receives `question`, not `q`.
   Adapters should normalize at the boundary rather than make every UI caller know both
   shapes.
3. **The shared error contract is not source truth.** The contract says every exported
   function rejects a bad shape with `TypeError`. Rubricon has `Error` paths and returned
   `{error}` model failures; Whetstone uses `RangeError` for session caps; Anchor is
   HTTP/Pydantic validation; and Understudy intentionally returns refusal/error records.
4. **“Injectable model client” is unevenly implemented.** Coursewright, Sourcerer,
   Whetstone, Sextant, Understudy, and Hotwash expose an injection seam in the checked
   source. Rubricon’s current `generateRubric` does not accept the `{ask}` option shown
   by the contract. Anchor uses local services and an injected callable in its grounding
   leaf rather than a JavaScript client.
5. **Refusal is not the same as infrastructure failure.** Understudy explicitly
   distinguishes `errored` from a deliberate refusal; Sourcerer falls through from an
   endpoint error but deliberately throws if endpoint-only citations are asked to be
   verified; Anchor’s SchoolCircle adapter surfaces unavailable/502 states and does not
   turn abstention into an ungrounded answer. Preserve these distinctions.
6. **The source now contains the named adapter seams, but they remain unverified at
   runtime.** `lib/arsenal-core.js` wires Quarry, Coursewright, Rubricon, Sourcerer,
   and Whetstone; `lib/arsenal-evidence.js` wires Sextant, Cadence, Hotwash, Waypoint,
   Cartridge, and instructor-only Understudy. The learning and evidence routers persist
   through Prisma and the `/learn`/`/teach` surfaces call the principal routes. This is
   source integration evidence, not deployment or live-service proof.

## Current wiring and remaining verification

The matrix distinguishes selected PostgreSQL persistence roundtrips from an
authenticated, seeded end-to-end aggregate flow. It does not mean that development
Prisma is absent or that migration work is pending. The development migration and
selected PostgreSQL roundtrips are now verified as recorded above.

The source now follows the intended composition order:

1. Quarry ingests text/PDF pages into persisted, addressable passages.
2. Coursewright drafts a course from those passages; Rubricon separately generates
   trace-checked rubrics. Both remain `PENDING` until instructor approval.
3. Sourcerer answers over approved passages with strict cite-or-refuse behavior.
   Anchor remains the separate doctrine tutor at `/api/doctrine`; its abstentions are
   not retried through an ungrounded model.
4. Whetstone starts and restores persisted mastery sessions only against approved
   course sources, retaining transcripts and terminal `complete`/`stalled` state.
5. Sextant aggregates explicit learning evidence with cohort suppression, Hotwash
   builds AARs from persisted critiques, and Waypoint owns learner profiles plus
   suppressed cohort summaries.
6. Cadence is exposed through `/api/learning/study-plan` and does not replace the
   existing `/api/plan` planning board. Cartridge exports only approved course items
   and validates the generated package before sending it.
7. Understudy is an independent instructor fidelity benchmark. It is deliberately
   not part of ordinary learner tutor requests.

The remaining work is service and flow verification, not a claim of completion:
`pnpm --filter @workspace/api-server test` passed 24 tests, including labelled PostgreSQL
LearningRecord roundtrip/CAS-cleanup and route tests; `pnpm run typecheck` also passed.
The development Prisma baseline and LearningRecord migration are deployed, the API restarted
cleanly, and the proxy probes are recorded in [`arsenal-verification.md`](./arsenal-verification.md).
Anchor, the generic model provider, Rubricon, and Whetstone endpoints remain unconfigured;
the live OIDC callback and instructor identity were not exercised. UI paths are source-inspected
only, with final UI contract corrections and browser testing still in progress.

The companion [`arsenal-revisions.json`](./arsenal-revisions.json) is intentionally
machine-readable and contains the same per-repo evidence without relying on Markdown
table parsing.