# Retrieval threshold calibration

Why the learner path refused questions the corpus could answer, what was measured
against the live index to establish it, and what the second threshold should be.

Measured on the Orin at `192.168.55.1:8000` (Anchor) and `:8080` (on-device
generator), index built 2026-08-20: **4,731 chunks across 14 publications**,
embeddings `bge-small-en-v1.5-q8_0`, 384-dim.

Reproduce with:

```
node scripts/retrieval-threshold-fixture.mjs      # build the question set from the live index
node scripts/retrieval-threshold-calibrate.mjs    # sweep the floor
node scripts/retrieval-threshold-e2e.mjs          # end-state safety, real model
```

## 1. The pipeline, as it actually runs

The live learner path is `POST /api/learning/tutor` -> `lib/learning/core.js`
`tutor()` -> `lib/student-grounding.js` `groundedStudentAnswer()`. Every gate
below is in that one function's call tree, in this order.

| # | Stage | Where | Score space | Refusal reason |
|---|-------|-------|-------------|----------------|
| 0 | `anchorScope` ranks the course's passages, keeps the top 16 | `student-grounding.js` | query-term coverage, `[0,1]` | none — **ranking only**, no threshold |
| 1 | Anchor `POST /api/ground` selects or abstains | Orin | cross-encoder reranker logits, **unbounded** | `anchor_abstained` |
| 2a | `keywordRetriever` drops every passage scoring exactly 0 | `sourcerer/src/retrieve.js` | query-term coverage, `[0,1]` | `not_in_sources` |
| 2b | **`minScore` floor on the best surviving score** | `sourcerer/src/sourcerer.js:57` | query-term coverage, `[0,1]` | `below_threshold` |
| 3 | Model must emit non-empty in-range `used` **and** an in-range inline `[n]` marker | `sourcerer.js:66-74` | — | `no_citation` |
| 4 | `verify: 'strict'` — every claim must be entailed by its own passages | `sourcerer/src/verify.js` | per-claim, fails closed | `unfaithful` |
| 5 | `citedPassages` — marker set must equal `used` set, and every cited passage must be byte-identical to one Anchor authorized | `student-grounding.js` | — | `citation_invalid` |
| 6 | Understudy `checkGrounding` — stem overlap between the **answer** and its **cited passages** >= 0.3 | `understudy/src/grounding.js` | stem overlap, `[0,1]` | `understudy_rejected` |
| 7 | Understudy `scoreCase` — independent examiner verdict must be `in-doctrine` and `conforms` | `understudy/src/benchmark.js` | verdict | `understudy_rejected` |

Gate 2b is the subject of this document. Note that it is preceded by a
*relevance* judgement (gate 1) and followed by **five** independent
*faithfulness* judgements (gates 3-7).

Two further facts about the live path worth recording:

- `SOURCERER_GROUNDING_URL` is explicitly rejected (`student-grounding.js`
  throws `serviceError('sourcerer')` if it is set), so Sourcerer's endpoint
  grounding mode is unreachable here by design — the authorization boundary
  stays with the caller. The retriever path is therefore the only production
  path, which is what makes `keywordRetriever` the live scorer.
- `arsenal-core.js` exports a second, similar entry point (`tutorAnswer`, also
  defaulting `minScore` to 0.2). It has **no importer** in `app/` or `lib/` —
  only tests — so it is not on the learner path and was left alone. If it is
  ever wired up, it needs the same treatment.

## 2. The two thresholds are not in the same space

This is the finding that makes the value question secondary.

**Anchor (gate 1)** ranks with a cross-encoder reranker. Measured on this board:

| Question | `top_rerank_score` | `top_effective_score` | Outcome |
|---|---|---|---|
| "What is the Marine Corps definition of maneuver warfare?" | **+7.53** | +6.66 | answered, cited to MCDP 3 p.50 |
| "What is the recommended torque spec for a Toyota Camry cylinder head bolt?" | **-4.73** | -6.20 | `abstained`, `low_retrieval_score` |

Unbounded logits spanning at least -6.2 to +7.5. `GET /api/scoreboard` reports
Anchor's own floor as **`threshold: 3.0`** — in that logit space, and
per Anchor's `/api/ground` documentation, "compared against per-publication
calibrated scores".

**Sourcerer (gate 2b)** compares `minScore` against `keywordRetriever`'s score,
which is (`sourcerer/src/retrieve.js:23`):

```
score = |distinct query tokens present in the passage| / |distinct query tokens|
```

A fraction in `[0,1]`. No IDF, no length normalisation of the passage, no
embedding: pure query-term coverage.

So the two numbers cannot be compared, and no single constant can be right for
both: `0.2` is nonsense as a reranker logit (essentially "accept everything"),
and `3.0` is unreachable as a coverage fraction (it would refuse everything).
The thresholds were never two settings of one dial. They are two different
instruments, and only one of them was calibrated.

Anchor's own API documentation for `/api/ground` says so explicitly, and also
states the division of labour the implementation had drifted from:

> Selection is RELATIVE, not an absolute floor, and that is deliberate. Raw
> reranker logits are not comparable across passage lengths [...] The retrieval
> path's own 3.0 floor does not transfer here because it is compared against
> per-publication calibrated scores (D-054) [...] Anchor is the candidate filter
> here, not the faithfulness gate -- the caller runs a strict cite-or-refuse
> stage over whatever comes back, so an over-included passage costs a wasted
> candidate, while an over-excluded one costs the learner their answer with no
> way to tell that it existed.

### Why a coverage floor over-refuses specifically

The denominator is the length of the **question**. Sourcerer's stop list is 22
words (`a an the of to and or in on for with by is are be as at from that this
it its`) and contains no interrogatives or modals, so `what`, `how`, `why`,
`when`, `should`, `must`, `their`, `explain` all count as content words. They
inflate the denominator and essentially never appear in doctrine prose.

The result is that **the bar rises with how carefully a learner phrases the
question.** A terse "define maneuver" clears a coverage floor easily; the same
question asked properly, in a full sentence with context, does not. That is the
exact opposite of the behaviour wanted from a tutor, and it is worst for the
kind of considered question a student asks on stage.

Gate 2a compounds it: `keywordRetriever` also `.filter(d => d.score > 0)`, so a
passage Anchor's reranker selected on *semantic* grounds is **discarded
entirely** if it shares no literal token with the question. That is not
controllable by `minScore` at any value — including 0 — and it both shrinks the
evidence handed to the model and re-orders it lexically, discarding Anchor's
ranking.

## 3. The question set

`test/fixtures/retrieval-threshold-corpus.json` — 58 questions, built by
`scripts/retrieval-threshold-fixture.mjs` against the live index.

**36 answerable**, one per section, round-robinned across all 14 publications
(MCDP 1, 1-0, 1-1, 1-2, 1-3, 2, 3, 5, 6, 7, MCWP 3-11.3, MCWP 5-10, TC 3-22.9,
TCCC). These are Anchor's own recall items: each question was *generated from an
indexed chunk*, and the fixture stores that chunk verbatim (`source_text`) with
its paragraph-level locator. The ground truth is therefore held rather than
assumed — for every one of these questions we possess the passage that answers it.

**22 unanswerable**, each verified by putting it to `POST /api/ask` over the full
4,731-chunk index and keeping only those Anchor itself abstained on. Every
candidate abstained, with `top_rerank_score` from **-2.90 to -8.11** (against
+7.53 for the answerable control). The set mixes plainly out-of-domain questions
with doctrine-flavoured near misses — fitness reports, uniform regulations, UCMJ
punishments, drill, nuclear release authority, submarine procedure — because a
plausible-sounding question is what actually gets asked on stage. `dropped_unanswerable`
is empty: no candidate had to be discarded for being answerable after all.

Candidate pools are 16 real doctrine chunks, which is the production cap
(`MAX_ANCHOR_PASSAGES`), so `anchorScope` passes the pool through intact and
Anchor sees exactly the request shape it sees in production. An answerable
question's pool contains its own grounding chunk plus 15 distractors from *other*
publications; an unanswerable question's pool contains 16 distractors and nothing
that answers it.

## 4. What Anchor alone does (gate 1)

| | answerable (36) | unanswerable (22) |
|---|---|---|
| grounded | **36** | 2 |
| abstained | 0 | **20** |
| grounding chunk retained | 35/36 | n/a |

Anchor is doing its job well: it never abstained on an answerable question, kept
the true grounding chunk in 35 of 36 cases, and abstained on 20 of 22
unanswerable ones. It is also highly selective — a mean of **1.47** authorized
passages per answerable question out of the 16 offered.

## 5. The sweep (gate 2b)

Over-refusal is counted two ways. "all 36" counts any answerable question Anchor
grounded; "clean 35" excludes the one case where Anchor did not retain the true
grounding chunk, since a refusal there is not attributable to this gate.

| `minScore` | over-refused (all 36) | over-refused (clean 35) | unanswerable past gate 2 (of 2) |
|---|---|---|---|
| 0 | 0 | 0 | 2 |
| 0.05 | 0 | 0 | 2 |
| 0.08 | 0 | 0 | 1 |
| 0.10 | 0 | 0 | 1 |
| 0.15 | 0 | 0 | 1 |
| 0.16 | 1 | 0 | 1 |
| 0.18 | 2 | 1 | 1 |
| **0.20 (shipped)** | **2** | **1** | 1 |
| 0.25 | 3 | 2 | 1 |
| 0.29 | 4 | 3 | 0 |
| 0.30 | 4 | 3 | 0 |
| 0.40 | 12 | 11 | 0 |
| 0.50 | 19 | 18 | 0 |

The lexical filter (gate 2a) caused **no** `not_in_sources` refusals on this set,
but did discard 4 of 53 Anchor-authorized passages (92.5% survived), taking two
cases from 3 authorized passages down to 1. That is lost evidence rather than a
lost answer here, but it is not controllable by `minScore`.

### The two classes overlap, so no threshold separates them

Top-coverage scores, clean answerable (n=35):

```
0.176 0.231 0.250 0.308 0.312 0.333 0.333 0.333 0.368 0.381 0.385 0.421 0.455
0.455 0.462 0.467 0.467 0.467 0.500 0.500 0.500 0.500 0.500 0.500 0.533 0.533
0.533 0.556 0.571 0.611 0.611 0.643 0.667 0.696 0.733
```

Unanswerable questions that cleared Anchor (n=2): **0.077** and **0.286**.

`u-submarine-ops` ("What is the procedure for a submarine to conduct an emergency
blow and surface?") scores **0.286** — higher than two genuinely answerable
doctrine questions at 0.176 and 0.158. The distributions overlap, so:

- zero over-refusal requires `minScore <= 0.176`;
- blocking `u-submarine-ops` at this gate requires `minScore >= 0.29`, which
  over-refuses **3 of 35** real doctrine questions (8.6%).

**No value of `minScore` achieves both.** Query-term coverage simply is not a
relevance signal for this task: it measures how much of the question's wording
the passage happens to repeat, which is why the submarine question — full of
words like "procedure", "conduct", "emergency", "surface" that recur throughout
doctrine prose — outscores a well-posed question about MCDP 3.

### The over-refusal, demonstrated end to end

The clean over-refusal at the shipped value is an entirely fair MCDP 3 question:

> What are the primary challenges facing the United States in the current global
> political landscape, and what is the resulting shift in how potential
> adversaries might operate?

Anchor grounds it and authorizes 2 passages, including the chunk the question was
written from. Run through the real pipeline against the live Orin:

```
SOURCERER_MIN_SCORE=0.2 -> refused  reason=below_threshold  anchor=grounded  cites=0
```

It is refused **before any model call is made**, on a coverage score of 0.1765.
This is precisely the failure mode that reads as "it doesn't work" on stage: the
question is fair, the corpus answers it, Anchor found the passage, and the
learner is told no.

## 6. Safety: the decisive end-to-end run

Because the gate is `topScore < minScore`, it is monotone — lowering `minScore`
only ever lets more through. `minScore=0` therefore makes it inert and is the
*worst case* for false answers: if nothing gets through at 0, nothing gets
through at any higher value. That single run bounds the whole table.

`scripts/retrieval-threshold-e2e.mjs --class unanswerable --min-score 0`, against
the live Anchor and the live on-device generator:

```
answered: 0   refused: 22   errored/inconclusive: 0
UNCITED ANSWERS (must be 0): 0
PASS: no unanswerable question produced an answer at the most permissive floor.
```

All 22 refused. Twenty were stopped by Anchor (`anchor_abstained`). The two that
Anchor passed — including `u-submarine-ops`, the one no acceptable threshold
could have blocked — were refused at **gate 3 by the model's own cite-or-refuse**
(`reason=unsupported`: the model was shown the passages and declined to answer
from them).

So the gate that actually catches the case `minScore` could not is the strict
stage Anchor's contract says the caller is responsible for running. Gate 2b was
not adding safety; it was only removing answers.

## 7. Recommendation

**Default `minScore` to 0, keep it tunable via `SOURCERER_MIN_SCORE`.**

- It eliminates the measured over-refusal (0 of 35 at any value <= 0.176, and 0
  at the default).
- It lets **zero** unanswerable questions reach an answer, measured end-to-end on
  real hardware, at the most permissive setting there is.
- It puts refusal where the architecture already put it — Anchor filters
  candidates, and five independent faithfulness gates decide whether an answer is
  allowed out.

This is not "turn off a safety check". Gates 1 and 3-7 are untouched, and
`cite-or-refuse` is pinned by `test/retrieval-threshold.test.mjs`, which asserts
over a matrix of model failure modes at four different floors that an answer
without a citation is unreachable.

`SOURCERER_MIN_SCORE` remains for the event: if a demo corpus behaves differently,
the floor can be raised from the environment without a code change. Values
outside `[0,1]` are meaningless in a coverage space and fall back to the default,
so a typo cannot silently refuse every question.

### What this does NOT fix

- **The on-device model is the next binding constraint.** A single
  production-shaped call to the Jetson's `gemma-4-E2B_q4_0` measures ~9-10 s, the
  learner path needs three (answer, faithfulness, examiner), and
  `LOCAL_CHAT_TIMEOUT_MS` is 15 s per call with `MODEL_CALL_TIMEOUT_MS` at 20 s.
  In repeated runs the same answerable question completed once (reaching
  `citation_invalid` — the 2B model failed the inline-marker contract, not the
  threshold) and failed three times with `STUDENT_LOCAL_MODEL_UNAVAILABLE`. That
  intermittency is a pre-existing local-model integration issue, independent of
  retrieval calibration, and is **not** addressed here. It does not affect any
  conclusion above: the gate-2 sweep is model-independent, and the `0.2`
  over-refusal happens before any model call.
- **`n_ctx` is 4096 with a single slot.** Anchor's selectivity (~1.5 passages per
  question) keeps prompts small today, but a course whose library authorizes many
  long passages will overflow the on-device context.
- **Gate 2a** still discards zero-overlap passages that Anchor authorized and
  re-orders the rest lexically, throwing away Anchor's reranker ordering. It cost
  no answers on this set but did discard 4 of 53 authorized passages. Replacing
  SchoolCircle's custom retriever so it preserves Anchor's order and keeps all
  authorized passages would remove the last lexical influence from the path; it
  is a larger change and was deliberately left out of this one.
- **`arsenal-core.js` `tutorAnswer`** still defaults to `minScore` 0.2. It has no
  production importer and was left alone.

