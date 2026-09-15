# Arsenal verification matrix

## Latest host verification

After rebasing `replit/port` onto merged `origin/main` and reconciling Firebase
login and the landing page, the full workspace typecheck and all **27** API
tests passed. Both managed workflows started cleanly. A screenshot confirmed
the merged landing page renders without browser errors.

The running SchoolCircle `POST /api/doctrine` was checked with its real
`{ "question": "..." }` input:

- “According to MCDP 1, what is friction in war?” returned HTTP 200,
  `abstained: false`, and three citations to MCDP 1, chapter 1, printed page 5.
- “What is the current stock price of Microsoft?” returned HTTP 200,
  `abstained: true`, `abstainReason: "low_retrieval_score"`, and no citations.

These are live host-to-Anchor results, not injected fixtures. They supersede
earlier pre-configuration observations below. Firebase public configuration
and server token verification are wired, but an interactive sign-in and
instructor session have not been verified. Generic model, Rubricon, Whetstone,
and model-backed Understudy verification remain blocked by missing endpoint
configuration. The task is **not complete**.

This is a runnable verification record for the twelve repositories in
[`05-arsenal-contracts.md`](./05-arsenal-contracts.md). The current development API
has passed `pnpm --filter @workspace/api-server test` with 24 tests, including
labelled real-PostgreSQL LearningRecord roundtrip/CAS-cleanup coverage and route
tests; `pnpm run typecheck` has also passed and the API restarted cleanly. Those
results are separated below from fixture/injected-model evidence. They do not prove
a generic model endpoint, an OIDC callback, an instructor identity, or a complete
browser/deployed flow. Direct Anchor HTTP evidence is recorded separately; it does
not prove that the SchoolCircle host proxy has been restarted and retested with the
new Anchor configuration.

## Per-repository matrix

| Repo and reviewed SHA | Runnable command | Expected library output | Relevant SchoolCircle test/evidence | Auth / DB requirement | Live service requirement and current blocker |
|---|---|---|---|---|---|
| **Anchor** `fc9cc61a1a42121c3ad811f800b028805810ecf5` | `cd .cache/arsenal/anchor && pytest -q` | Pytest fixture/unit summary; pure retrieval, refusal, citation, and grounding tests can pass with stubs. Direct live probes also passed: `/api/health` 200 `ok=true` with generator/embeddings/reranker ready; `/api/corpus` 200 with 13 publications and 4,230 chunks; `/api/ask` produced both a cited answer and a retrieval refusal. | `artifacts/api-server/src/lib/doctrine.js`, `routes/doctrine.js`, `components/AskWidget.jsx`; direct live evidence below | `/api/doctrine` does not require SchoolCircle identity, but the API process must be restarted after configuration. | `https://calculations-probability-dozens-recommended.trycloudflare.com` is a temporary Cloudflare tunnel configured as `DOCTRINE_BASE_URL` with `DOCTRINE_TIMEOUT_MS`. Direct Anchor proof is live; the SchoolCircle adapter proxy has not yet been restarted/retested. The tunnel is ephemeral and not a durable production endpoint. |
| **Quarry** `465b7515732bbc08b80b6ec8684e1fc49c7985ea` | `pnpm --filter @workspace/api-server test` | Observed 24-test API summary, including the Quarry adapter/route coverage; deterministic extraction is fixture-tested. | `artifacts/api-server/test/learning-core.test.mjs`; `arsenal-core.js#ingestSource` | Route use requires verified instructor identity and Prisma persistence; package functions do not. | No model or remote service. Development Prisma roundtrip coverage passed; no instructor-authenticated live PDF flow is claimed. |
| **Coursewright** `f38d078a30195a6a6901ade22a3ce7484613fa57` | `pnpm --filter @workspace/api-server test` | Observed 24-test API summary; deterministic `chunk`, `match`, grounding, and refusal checks use injected seams. Full generation requires a configured model. | `artifacts/api-server/test/learning-core.test.mjs`; `arsenal-core.js#draftCourse`; `POST /api/learning/courses/draft` | Instructor auth, approved/persisted source records, and Prisma are required by the route. | SchoolCircle supplies the generic model seam (`MODEL_BASE_URL`, `MODEL_ID`); the upstream Coursewright defaults are not used. Generic model and instructor-authenticated live draft remain unverified. |
| **Sourcerer** `8a2e6831ebc6ced8ee71b0215fb0037d1cb7c1bb` | `pnpm --filter @workspace/api-server test` | Observed 24-test API summary; keyword retrieval, normalization, refusal, and faithfulness fixtures use injected `chat`. | `artifacts/api-server/test/learning-core.test.mjs`; `arsenal-core.js#tutorAnswer`; `POST /api/learning/tutor` | Authenticated learner/instructor, approved source passages, and Prisma are required by the route. | The adapter uses SchoolCircle's generic model seam and does not silently use Sourcerer's default endpoint. No generic model or instructor-authenticated tutor flow is live-proven. |
| **Rubricon** `1a3d88c9cef6e0239da060e936398fa6b999c6a9` | `pnpm --filter @workspace/api-server test` | Observed 24-test API summary; traceability, structural validation, agreement, and kappa outputs are local/injected. | `artifacts/api-server/test/learning-core.test.mjs`; `arsenal-core.js#generateRubric`; `POST /api/learning/rubrics/generate` | Instructor auth, source persistence, and Prisma are required by the route. | Production generation additionally requires `RUBRICON_ENDPOINT`, `RUBRICON_MODEL`, `RUBRICON_API_KEY`, and generic model readiness. These remain false/unconfigured; no live Rubricon result is claimed. |
| **Whetstone** `4b5d0a4be05a5a2161a4d46f9261ff88a43d8b2b` | `pnpm --filter @workspace/api-server test` | Observed 24-test API summary; deterministic `Session` progression with injected rubric/question/scorer, including terminal reports. | `artifacts/api-server/test/learning-core.test.mjs`; `arsenal-core.js#startMasterySession`; `pages/learn.tsx#MasteryWidget` | Authenticated learner/instructor, approved course/source, and Prisma are required. | Production start/turn requires `MODEL_BASE_URL`, `MODEL_ID`, `WHETSTONE_ENDPOINT`, `WHETSTONE_MODEL`, and `WHETSTONE_API_KEY`. Whetstone readiness is false; no live model/session proof is claimed. |
| **Sextant** `007a2c0f47fd50a9acbc3f3538814c1bf8683e95` | `pnpm --filter @workspace/api-server test` | Observed 24-test API summary; learning gain, class gaps, rollups, and small-cell suppression use deterministic analytics. | `artifacts/api-server/test/learning-evidence.test.mjs`; `arsenal-evidence.js#buildAnalytics` | Authenticated learner or instructor and persisted attempt/session records are required by routes. Cohort views require instructor role. | Current adapter uses deterministic analytics only and does not invoke optional competency model mode. Selected PostgreSQL persistence/route tests pass; no instructor-authenticated live aggregate is claimed. |
| **Understudy** `6ecb931b85af9cf36aab185f587dd3ede4a61d96` | `pnpm --filter @workspace/api-server test` | Observed 24-test API summary; grounding/verdict/fidelity fixtures and injected agent/judge benchmark. | `artifacts/api-server/test/learning-evidence.test.mjs`; `arsenal-evidence.js#evaluateFidelity`; `pages/instructor-features.tsx#InstructorFidelity` | Instructor auth, approved doctrine source records, persisted cases, and Prisma are required. | Understudy is instructor-only and receives an explicit model seam. Missing model returns `503`/`unavailable`; it is not a learner tutor fallback. No live model proof is claimed. |
| **Cartridge** `68f02aa93bca51c4d24f42b8392a4f5ad02c8db3` | `pnpm --filter @workspace/api-server test` | Observed 24-test API summary; deterministic SCORM 1.2/2004 ZIP and `validatePackage` result. | `artifacts/api-server/test/learning-evidence.test.mjs`; `arsenal-evidence.js#buildApprovedScorm`; `pages/teach.tsx#CourseCard` | Instructor auth and an approved persisted course are required by the instructor-only export route. | No model or remote service. A consuming LMS/SCORM player is outside this verification. Export route authorization tests pass; no instructor-authenticated live export is claimed. |
| **Cadence** `9b6b2df0ab1e11080510262a631ffb7e13acda4e` | `pnpm --filter @workspace/api-server test` | Observed 24-test API summary; deterministic COAs, hard availability cap, ICS, and reminders. | `artifacts/api-server/test/learning-evidence.test.mjs`; `arsenal-evidence.js#buildStudyPlan`; `pages/learner-features.tsx#LearnerStudyPlan` | Authenticated learner, approved persisted syllabus, and Prisma are required by the evidence route. | No model or remote service. Cadence is exposed at `/api/learning/study-plan`; the existing `/api/plan` planning board remains unchanged. Prisma-backed route tests pass; no authenticated live plan is claimed. |
| **Hotwash** `a972df65aa1c45c6b28c7fd6540a3b9303cf7b74` | `pnpm --filter @workspace/api-server test` | Observed 24-test API summary; deterministic ranked worklist and heuristic memo. Narrative output additionally accepts an injected model. | `artifacts/api-server/test/learning-evidence.test.mjs`; `arsenal-evidence.js#buildAar`; `pages/instructor-features.tsx#InstructorAAR` | Instructor auth, persisted critique set, and Prisma are required by the route. | Deterministic AAR works without a model; narrative model mode uses generic provider injection. Route/Prisma tests pass; no instructor-authenticated live AAR or provider result is claimed. |
| **Waypoint** `a861421b03399b8dc39f06aad113d1f064f465e4` | `pnpm --filter @workspace/api-server test` | Observed 24-test API summary; deterministic survey profile/recommendation and cohort aggregation. | `artifacts/api-server/test/learning-evidence.test.mjs`; `arsenal-evidence.js#buildProfile`; `pages/learner-features.tsx#LearnerProfile` | Authenticated learner profile persistence; instructor auth for cohort view; Prisma required by routes. | No model or remote service. Small cohorts return explicit insufficiency. Route/Prisma tests pass; no instructor-authenticated live profile result is claimed. |

## Observed development verification

These observations are runtime evidence from the proxied development API, not
production or browser proof:

| Source/configuration check | Observed result | Meaning and remaining limit |
|---|---|---|
| Rebase | `replit/port` rebased onto `origin/main` at `fd925c7`; no pushes performed | The verification baseline includes the latest merged source. |
| `apphosting.yaml` | Latest merged config contains temporary Anchor tunnel `https://calculations-probability-dozens-recommended.trycloudflare.com` | The tunnel URL is ephemeral and can disappear or rotate; it is not durable production service discovery. |
| Firebase landing/login | Porting by the sync agent is in progress; Firebase verification auth bridge is in progress | No browser or live Firebase/OIDC callback proof is claimed. |

| Workspace check | Observed result |
|---|---|
| `pnpm --filter @workspace/api-server test` | 24 tests passed, including labelled PostgreSQL LearningRecord roundtrip/CAS cleanup and route tests |
| `pnpm run typecheck` | Passed for the full workspace |
| API restart | Clean |

### Direct Anchor service probes

These calls were made directly against the temporary Anchor tunnel, not through
the SchoolCircle `/api/doctrine` proxy:

| Direct request | Observed result |
|---|---|
| `GET https://calculations-probability-dozens-recommended.trycloudflare.com/api/health` | `200`; `ok=true`; generator, embeddings, and reranker all `true` |
| `GET https://calculations-probability-dozens-recommended.trycloudflare.com/api/corpus` | `200`; 13 publications and 4,230 chunks |
| `POST /api/ask` with `According to MCDP 1, what is friction in war?` | `200`; `abstained:false`; answer present; 3 citations to `MCDP 1 Ch1 Friction` paragraphs 1–3, printed p. 5 |
| `POST /api/ask` with `What is the current stock price of Microsoft?` | `200`; `abstained:true`; `abstain_reason: low_retrieval_score`; no citations |

The grounded answer and refusal establish direct Anchor service behavior,
including citation and low-retrieval abstention. They do not establish the
SchoolCircle host proxy path: `DOCTRINE_BASE_URL`/`DOCTRINE_TIMEOUT_MS` were
configured from the merged upstream settings, but the adapter has not yet been
restarted and retested. Anchor's internal generator/embeddings/reranker readiness
does not change the separate SchoolCircle generic model status, which remains
unavailable. The prior `/api/doctrine` `200 ready:false` probe was before this
Anchor configuration and must not be treated as a post-config result.

| Check | Observed result | Meaning and remaining limit |
|---|---|---|
| `curl .../api/healthz` | `200` | API health endpoint responds. |
| `curl .../api/learning/status` | `200`; `auth.ready: true`; `model.ready: false`; `rubriconConfigured: false`; `whetstoneConfigured: false`; `doctrineConfigured: false`; Prisma persistence present | Auth/configuration boundary and persistence declaration are reachable. No model, Rubricon, Whetstone, or Anchor service is configured. |
| `curl .../api/auth/user` | `200`, `{"user":null}` | Anonymous auth response is explicit; this is not a live OIDC callback or instructor identity. |
| `curl .../api/learning/sources` | `401`, `AUTH_REQUIRED` | Authenticated authoring boundary rejects anonymous access as intended. |
| `curl .../api/plan` | `200`, original markdown planning-board response | Existing planning board remains intact; Cadence does not replace it. |
| `curl .../api/doctrine` | Prior probe: `200`, `ready:false`, before the new Anchor env configuration | Historical pre-config result only; post-config SchoolCircle proxy restart/retest is pending. |

The UI paths are source-inspected only. Browser testing and final UI contract
corrections remain in progress and are not claimed here.

## SchoolCircle adapter checks

Run the current adapter, route, and persistence evidence suite from the workspace
root:

```bash
pnpm --filter @workspace/api-server test
```

Relevant files:

- `test/auth-session.test.mjs` checks signed-session and auth-boundary fixtures.
- `test/learning-core.test.mjs` checks Quarry, Coursewright, Sourcerer, Rubricon,
  Whetstone, explicit provider failures, and serialization with injected seams.
- `test/learning-evidence.test.mjs` checks Sextant, Cadence, Hotwash, Waypoint,
  Cartridge, Understudy, route authorization, cohort suppression, and injected
  store/model seams.

The observed output is 24 passing tests. Most package behavior uses fixtures,
in-memory stores, or injected models; labelled PostgreSQL roundtrip/CAS-cleanup
tests use the development database, and route tests exercise the API boundary.
Neither class proves a live model, Anchor, OIDC callback, instructor identity, or
browser flow. The API route commands, when configured, are:

```text
GET  /api/learning/status
POST /api/learning/sources
POST /api/learning/sources/pdf
POST /api/learning/sources/:id/approve
POST /api/learning/courses/draft
POST /api/learning/courses/:id/syllabus
POST /api/learning/courses/:id/approve
POST /api/learning/rubrics/generate
POST /api/learning/rubrics/:id/approve
POST /api/learning/tutor
POST /api/learning/mastery/sessions
POST /api/learning/mastery/sessions/:id/turn
GET|POST /api/learning/study-plan
GET /api/learning/analytics[?scope=cohort]
POST /api/learning/aar/critiques
GET|POST /api/learning/aar
GET|POST /api/learning/profile
POST /api/learning/fidelity/cases
GET|POST /api/learning/fidelity
GET /api/learning/export?courseId=<id>&version=1.2|2004
```

All route calls except `/api/learning/status` require the verified identity and
role documented in the matrix. The development Prisma baseline and
`LearningRecord` migration are deployed, and the passing suite includes selected
PostgreSQL roundtrip/CAS-cleanup coverage. A live instructor identity and
approved records are still required for instructor route calls.

The observed development `GET /api/learning/status` response reports
`auth.ready: true`, `arsenal.model.ready: false`,
`arsenal.rubriconConfigured: false`, `arsenal.whetstoneConfigured: false`, and
`arsenal.doctrineConfigured: false`, alongside Prisma persistence. That status is
an availability report, not a successful model/service or OIDC callback check.

## Exact configuration gates in current source

The following names are read by the current SchoolCircle API. No values are
asserted here:

| Capability | Environment names read | Gate / consequence |
|---|---|---|
| Prisma persistence | `DATABASE_URL` | Required by `prisma/schema.prisma`; current datasource is PostgreSQL. The development baseline and `LearningRecord` migration are deployed and selected tests round-trip against PostgreSQL; each deployment still needs its own database. |
| Signed sessions | `SESSION_SECRET` | Required to create/verify the `sid` cookie or bearer session. Development auth readiness is true; no instructor session was used in the proxy probes. |
| OIDC client | `OIDC_CLIENT_ID` **or** `REPL_ID` | Required by `authReadiness()` and `/api/login`; `ISSUER_URL` is optional and defaults to `https://replit.com/oidc`. Readiness is true in development, but discovery/callback and instructor identity remain unverified. |
| Trusted auth origin / credentialed CORS | `AUTH_ALLOWED_HOSTS`, `AUTH_ALLOWED_ORIGINS`, `REPLIT_DOMAINS`, `REPLIT_DEV_DOMAIN`, `REPLIT_DEPLOYMENT_DOMAIN`, `APP_ORIGIN`; CORS additionally reads `WEB_ORIGIN`, `FRONTEND_ORIGIN` | Production callback/origin checks require a trusted host/origin. Development loopback is allowed only under the source rules. |
| Generic SchoolCircle model | `MODEL_BASE_URL`, `MODEL_ID`; optional `MODEL_API_KEY` | Both base URL and model ID are required for `providerStatus().ready`; API key is sent when present. Used by Coursewright, Sourcerer, Whetstone seams and evidence model injection. |
| Anchor doctrine | `DOCTRINE_BASE_URL`; optional `DOCTRINE_TIMEOUT_MS` | URL must point to a running Anchor `/api/ask`. The temporary Cloudflare tunnel is configured and direct health/corpus/ask probes pass; missing URL yields explicit `NO_DOCTRINE_SERVICE` and never fabricates an answer. The SchoolCircle proxy still needs restart/retest, and the tunnel is not durable production service discovery. |
| Rubricon production generation | `RUBRICON_ENDPOINT`, `RUBRICON_MODEL`, `RUBRICON_API_KEY` | All three are required by the explicit adapter gate, in addition to generic model readiness. |
| Whetstone production generation | `WHETSTONE_ENDPOINT`, `WHETSTONE_MODEL`, `WHETSTONE_API_KEY` | All three are required by the explicit adapter gate, in addition to generic model readiness. |
| Hotwash narrative / Understudy evidence | No additional SchoolCircle env names | Both receive the generic model only when it is ready. Hotwash has a deterministic memo; Understudy returns explicit `unavailable` without an injected model. Upstream default `UNDERSTUDY_*`/other package variables are intentionally not consulted by the adapter. |

At the time of this audit, the generic model, Rubricon, and Whetstone services
remain unavailable; direct Anchor is live only through the temporary tunnel. The
development API, Prisma migration, auth readiness, anonymous authorization
boundary, route tests, selected PostgreSQL roundtrips, and direct Anchor health,
corpus, grounded-answer, and refusal behavior are verified. Remaining blockers are
the SchoolCircle proxy restart/retest, live OIDC callback/instructor identity,
approved source/course data for authenticated flows, generic model/Rubricon/Whetstone
service evidence, and browser verification. Firebase landing/login porting and its
verification auth bridge, plus final UI contract corrections, remain in progress.