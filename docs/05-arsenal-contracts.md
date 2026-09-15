# 05 · The Arsenal — integration contracts

Every soldier in the platoon, and exactly how SchoolCircleLMS consumes it. The rule: **plain-JSON
contracts, not cross-imports.** Objectives → passages + citations → course JSON → rubric JSON →
attempts flow between the pieces as data; SchoolCircle orchestrates, Anchor grounds. No repo imports
another — they compose because their inputs and outputs are just JSON.

## How to consume

These are public GitHub repos under **github.com/groundworklms** (Apache-2.0). They are **not** npm-published.
Add each piece you wire as a git dependency:

```bash
npm i github:groundworklms/quarry github:groundworklms/coursewright github:groundworklms/sourcerer \
      github:groundworklms/rubricon github:groundworklms/whetstone github:groundworklms/sextant \
      github:groundworklms/understudy github:groundworklms/cartridge github:groundworklms/cadence \
      github:groundworklms/hotwash github:groundworklms/waypoint
```

- **ESM only, Node 18+.** Import from the package root, e.g. `import { buildCourse } from 'coursewright'`.
- Alternatives: pin a commit (`github:groundworklms/rubricon#<sha>`), add as git submodules, or vendor the
  `src/` if the enclave blocks git installs.
- **Anchor is not an npm import.** It is a separate offline HTTP service on the Jetson Orin, reached
  over `DOCTRINE_BASE_URL` — see `04-grounding-and-anchor.md`.

## Shared conventions (true of every JS repo)

- **Pure/deterministic core** — no model, no network, no key. You can run and test the whole core offline.
- **Optional model calls sit behind an injectable client + env** — never a hard-wired SDK. Config per repo:
  `<NAME>_API_KEY` (or `OPENROUTER_API_KEY`), `<NAME>_ENDPOINT`, `<NAME>_MODEL`; pass `{ chat }` / `{ ask }` /
  `{ fetch }` to inject a fake in tests. A network failure degrades to a heuristic or refusal, never a crash.
- **Every exported function validates its input and throws `TypeError`** on a bad shape.
- **The verification throughline** — each repo proves one property, not asserts it:
  rubricon = *grounding*, sourcerer = *faithfulness*, whetstone = *mastery*, sextant = *learning gain*,
  understudy = *doctrinal fidelity*.

## The map

| Repo | key exports | exact call | in → out | SchoolCircle surface · route · `lib` · table |
|---|---|---|---|---|
| **anchor** *(HTTP service)* | `POST /api/ask` | `fetch(DOCTRINE_BASE_URL + '/api/ask', { method:'POST', body:{ q } })` | `{ q }` → `{ abstained, abstainReason, answer, citations:[{n,citation,pub_id,page_printed}], retrieved, topScore, latencyMs }` (see 04) | grounds **everything** · `/api/doctrine`, `/api/ask` · `lib/doctrine.js` · reads Chunk corpus (edge) |
| **quarry** | `pdfText, pageTexts, chunkText, extractTasks, outline, sections`; `PdfParseError` | `chunkText(text, maxWords)` · `extractTasks(text, {headerRe?})` · `pdfText(bytes)` | PDF/POI bytes+text → `{ text }`, retrieval-sized `chunks[]`, `tasks[]`, `outline[]`, `sections[]` | Studio ingestion · `POST /api/ingest/corpus`, `/api/pdf-text` · `lib/pdf-text.js`,`lib/poi-parser.js` · `Chunk.createMany` |
| **coursewright** | `buildCourse, fromDocuments, isRefusal, verifyGrounding, chunk, match` | `buildCourse(objectives, { ask }?)` · `fromDocuments(docs, objectives, { ask }?)` · `verifyGrounding(text, passage, threshold)` | objectives + cited passages → a course `{ sections:[{ title, items:[{kind,stem,options,answer,rationale,citation}], refusals }] }` (ungrounded artifacts **rejected**, not just flagged) | Studio · `POST /api/generate/course` (SSE) · `lib/course-gen.js` · `GenJob`,`JobEvent`,`Course`,`Section`,`Item(PENDING)` |
| **rubricon** | `generateRubric, verifyTraceability, validateRubric, cohenKappa, weightedKappa, fleissKappa, reliabilityReport, isValidRubricShape`; `TIERS` | `generateRubric(task, { ask }?)` · `weightedKappa(a, b, { categories }?)` | T&R standard → BARS `{ dimensions:[{tier, anchor, sourceStep}] }`; rater arrays → κ (ordinal order via `TIERS`/explicit `categories`, **never alphabetical**) | Rubrics · `POST /api/rubric/generate`, `/api/rubric/:id/review` · `lib/rubric-gen.js` · `Rubric` |
| **sourcerer** | `ask, verifyFaithfulness, keywordRetriever, embedRetriever` | `ask({ q, passages\|retriever\|endpoint, verify, minScore=0.2, chat })` | question + sources → `{ answer, citations, refused, reason, faithfulness }` — **refuses** (no fabricated cites; requires an in-range `[n]` marker; below `minScore` → refuse) | Ask the doctrine (tutor) · `POST /api/ask` · `lib/tutor.js` · reads Chunk (FTS fallback) |
| **whetstone** | `deriveRubric, firstQuestion, scoreTurn, Session, computeScore, masteryReport`; `LEVELS` | `new Session({ objective, source, deriveRubric?, firstQuestion?, maxTurns })` · `session.answer(text)` · `scoreTurn(state, answer)` | discuss-to-mastery: each turn → `{ verdict, coaching, nextQuestion, score, complete, stalled }`; always terminates | Mastery check · `POST /api/mastery/start`,`/api/mastery/turn` · `lib/mastery.js` · `Attempt`,`Mastery` |
| **sextant** | `learningGain, classGaps, masteryRollup, summarize, competencyEvidence` | `learningGain(attempts)` · `classGaps(attempts, { minCohort=5 })` · `competencyEvidence(transcript, { heuristicOnly\|fetch })` | attempts/sessions → gain (Hake's *g*, `null` on a missing phase), class gaps (**distinct-learnerId cohort suppression**), mastery rollup, Bloom evidence | My Progress · Class progress/Insight · `/learn/insight`, `lib/db.js classGaps()` · reads `Attempt`,`Mastery` |
| **understudy** | `respond, benchmark, fidelityReport, checkGrounding, scoreCase, normalizeVerdict, groundResponse` | `respond({ persona, doctrine\|retriever, situation, strict, chat })` · `benchmark(cases, { judge, chat })` | situation → `{ inDoctrine, action, citations, grounding, errored }`; strict = grounded **and** non-empty action **and** ≥1 citation; benchmark → `fidelity` (errored runs excluded) | Ask fidelity gate · #17 Red Cell · behind `/api/ask` · — |
| **cartridge** | `buildCartridge, validatePackage, safe` | `buildCartridge(course, { version:'1.2'\|'2004', masteryScore })` · `validatePackage(zip)` | course JSON → a SCORM `.zip` (escaped, reproducible; `masteryScore` = real pass threshold, `failed` below); `validatePackage` **parses the XML** | Export · `GET /api/scorm/:courseId` · `lib/scorm.js` · reads `Course`/`Section`/`Item` |
| **cadence** | `plan, assessStatus, toICS, toReminders`; `COAS` | `plan({ syllabus, availability, asOf, status })` · `toICS(blocks, opts)` | syllabus + calendar → 3 COAs (availability is a **hard cap**), `.ics` (RFC-5545 folded, sequenced, midnight-safe) + reminders | Study plan · `POST /api/plan` · `lib/plan.js` · `Schedule` |
| **hotwash** | `hotwash, rollup, rankFindings, trendByArea, sustains, narrativeAAR, heuristicMemo` | `hotwash({ critiques })` · `narrativeAAR(report, { chat }?)` | critiques (+ iterations) → ranked worklist `{ sustains, improves:[{area,impact,priority,horizon,trend}], meta }` (chronological ordering; grades the course) | Course AAR · `POST /api/aar` *(planned)* · reads `Attempt` + critiques |
| **waypoint** | `profile, scoreProfile, recommendations, classProfile, toMarkdown`; `defaultInstrument`, `DIMENSIONS` | `profile(responses, { name })` · `classProfile(entries)` | "how do I learn?" Likert → `{ dominantModality, pace, structure, dims }` + recommendations; class → modality mix + faculty guidance; `toMarkdown` (escaped) | Learner profile / path shaping · `/learn/profile` *(planned)* · `lib/profile.js` · — |

**SchoolCircle is the twelfth-plus piece** — the instructor/learner host (Next.js + Prisma). It stays its
own app; the arsenal are the parts it fields. The `lib/*` modules are thin wrappers that call these repos
(or embed the same logic) and persist to Postgres; see `02-architecture.md` and `03-data-model.md`.

### The compounding contract in one line

`POI → Quarry(chunks/tasks) → Anchor(index) → Coursewright+Rubricon(cited course + BARS, grounded) →
human review → delivery: Sourcerer/Whetstone answer & assess (Understudy gates fidelity, Anchor
cite-or-refuse) → Sextant measures → Hotwash improves → Cadence re-plans → Cartridge exports.`
Each arrow is JSON. Any piece is usable alone; assembled, they are the platform.
