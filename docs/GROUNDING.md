# Grounding: citations and refusal for generated content

## What this adds

An adapter for an external service (Anchor -- https://github.com/jeranaias/anchor, an
offline, open-source doctrine tutor) that answers questions from indexed doctrine with
paragraph-level citations, and refuses when the corpus does not support an answer.

Opt-in via one environment variable. With `DOCTRINE_BASE_URL` unset, nothing changes.

## Why

`app/api/generate/route.js` sets the right rule in its system prompt:

> The POI is the authority. Derive only from what it states; never invent doctrine,
> publication numbers, or standards.

It is an instruction to the model rather than a check on the model, and a model told not
to invent doctrine can still do it. When it does, the output is indistinguishable from
output that didn't.

`PLAN.md` commits us to instructor review of generated assessments. Review is much cheaper
when each claim points at a paragraph the instructor can open: without a citation,
checking a generated question means re-deriving it from the POI by hand.

Three things make that possible, and none of them is a better prompt:

1. **Retrieval** — the model answers from specific retrieved paragraphs, not from memory.
2. **A citation to a checkable unit** — not "MCDP 1", which is a book, but the paragraph
   and the printed page.
3. **Refusal** — when retrieval finds nothing supporting, say so rather than answer anyway.

## The files

| File | |
|---|---|
| `lib/doctrine.js` | new — adapter, same shape as `textProvider()` |
| `app/api/doctrine/route.js` | new — `GET` status, `POST` a question |
| `lib/providers.js` | edit — registers `grounding` as a non-critical capability |
| `README.md` | edit — config section |
| `docs/GROUNDING.md` | new — this file |

`grounding` is deliberately **not** `critical`. Unset, `/api/capabilities` reports the
same blocking set it does today (`["text"]`), and the capabilities screen shows grounding
as unavailable with the reason.

### One decision worth a look in review

**An abstention returns HTTP 200, not an error.** "The corpus does not support an answer"
is a correct response. A 4xx would push callers into a `catch`, and the natural thing to
write in a catch is a fallback to the ungrounded model — which puts back exactly the
invented doctrine this is meant to prevent.

## Usage

```bash
# .env.local
DOCTRINE_BASE_URL=http://192.168.55.1:8000
DOCTRINE_TIMEOUT_MS=30000        # optional
```

Captured from a live service, not illustrative:

```json
{
  "abstained": false,
  "abstainReason": null,
  "answer": "Friction may be mental, physical, or external, imposed by enemy action, terrain, weather, or chance, or self-induced by factors such as lack of a clearly defined goal, lack of coordination, unclear or complicated plans... [1]",
  "citations": [
    { "n": 1,
      "citation": "MCDP 1, (20 June 1997), Ch 1: The Nature of War, \"Friction\", para 3, p.5",
      "pub_id": "MCDP 1",
      "page_printed": "5" }
  ],
  "retrieved": 8,
  "topScore": 3.8,
  "latencyMs": 10580
}
```

Out of corpus:

```json
{ "abstained": true, "abstainReason": "low_retrieval_score", "citations": [],
  "topScore": -4.12,
  "answer": "I can't answer that from the doctrine I have on this device. Nothing in the indexed corpus supports an answer to this question." }
```

Error codes map to status: `NO_DOCTRINE_SERVICE` → 503, `DOCTRINE_UNREACHABLE` /
`DOCTRINE_BAD_RESPONSE` / `DOCTRINE_ERROR` → 502, `BAD_REQUEST` → 400.

## The service behind it

`DOCTRINE_BASE_URL` is a URL — anything returning that shape works. I have one running —
**Anchor** ([github.com/jeranaias/anchor](https://github.com/jeranaias/anchor), open-source,
Apache-2.0) — and am offering it as the backend, which is why the seam is thin and the
backend replaceable.

It runs fully offline on a Jetson Orin Nano, holds 13 publications and 4,230 paragraphs
(all publicly releasable, screened before ingest), and puts every model-written practice
question behind human approval before a student sees it.

Measured 25 Aug 2026 against a **233-question** eval set — 122 in-corpus, 95
out-of-corpus, 16 answer-traps — grown deliberately hard: false-premise traps, quote
misattributions, stale-edition and wrong-count near-misses.

| | | basis |
|---|---|---|
| False-answer rate (answered when it shouldn't) | **15.8%** | 15/95 |
| Correct-abstention rate | 84.2% | 80/95 |
| Over-refusal rate (refused when it shouldn't) | 18.9% | 23/122 |
| Citation-correct rate | 99.0% | 99 answered |
| p50 / p95 latency | 6.1s / 18.7s | on device |

(The base pipeline, without the premise gate below, is 22.1% / 16.4%.) False-answer and
over-refusal belong together: refusing everything drives the first to zero and produces
something useless. Both are reported as the weak numbers, because they are.

**Where the false answers came from — and how the gate cuts them.** On *off-topic*
questions the gate is near-perfect. The false answers were almost all one failure: a
question that smuggles in a false specific — "the seven phases of the intelligence cycle",
"the 2011 TCCC Guidelines … suzetrigine", "the passage where MCDP 7 credits Patton".
Retrieval correctly finds the on-topic paragraph, it scores *high*, the reranker gate
passes it, and the small model then affirms the false specific. The reranker, the
calibration, and BM25 cannot catch this — retrieval is *right*; only the asserted specific
is false. So a **premise gate** was added: before answering, it extracts the question's
asserted specific and checks it against the retrieved passages with a small purpose-built
entailment model (Vectara HHEM-2.1-Open, 110M, Apache-2.0) running **offline** as a
separate CPU service. A 2B model cannot do this check — it scores true and false counts
alike — but HHEM discriminates cleanly (a true "three phases" scores 0.94, a false "six
phases" 0.01 against the same passage). That took false-answer **22.1% → 15.8%**, catching
cases like an invented drug and dose the base system had answered, at a rise in over-refusal
to 18.9% — and the *sum* of the two errors fell. The gate fails open: if the verifier is
unavailable the tutor still answers.

For a tutor that will sit in front of students, the point is a system that knows what it
can't verify and says so — measured honestly on a hard adversarial set, offline, on an 8GB
device.

## Scope

Not a UI change — no component or screen is touched. No new dependencies. Unset, no
behavioural difference.

If the direction is useful, the obvious next steps are wiring `/api/generate` through it
so study aids carry citations, and surfacing citations in the Student view. Both are
design calls rather than mine to make, so they are not in this PR.
