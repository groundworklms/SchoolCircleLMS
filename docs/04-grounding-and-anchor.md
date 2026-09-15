# 04 · Grounding & Anchor

The guarantee that makes this an *AI-native LMS* and not another chatbot: every generated claim and every tutor answer is tied to a paragraph of doctrine, or it refuses. This doc is the contract for the grounding seam and the service behind it.

See also: [02 · Architecture](02-architecture.md) · [05 · Arsenal & Contracts](05-arsenal-contracts.md).

---

## Why grounding is a *check*, not a prompt

The generation route's system prompt already says the right thing — *"The POI is the authority. Derive only from what it states; never invent doctrine, publication numbers, or standards."* But that is an **instruction to the model, not a check on the model**. A model told not to invent doctrine can still do it, and when it does, the output is indistinguishable from output that didn't.

Three things make the guarantee real, and none of them is a better prompt:

1. **Retrieval** — the model answers from specific retrieved paragraphs, not from memory.
2. **A citation to a checkable unit** — not "MCDP 1" (a book), but the paragraph and the printed page.
3. **Refusal** — when retrieval finds nothing supporting, say so rather than answer anyway.

Instructor review (the `PENDING → APPROVED` gate) is far cheaper when each claim points at a paragraph the instructor can open. Without a citation, checking a generated question means re-deriving it from the POI by hand.

---

## The seam

- **Adapter:** `lib/doctrine.js` — same shape as any other provider capability.
- **Routes:** `app/api/doctrine/route.js` (`GET` status, `POST` a question) and `app/api/ask/route.js` (the tutor path via `tutor.askDoctrine`).
- **Registration:** `grounding` is a **non-critical** capability in `lib/providers.js`. With `DOCTRINE_BASE_URL` unset, nothing changes — `/api/capabilities` reports the same blocking set (`["text"]`) and the capabilities screen shows grounding as unavailable with a reason.

```bash
# .env.local
DOCTRINE_BASE_URL=http://192.168.55.1:8000   # Anchor over the USB/SSH tunnel; unset = grounding off
DOCTRINE_TIMEOUT_MS=30000                     # optional
```

`DOCTRINE_BASE_URL` is just a URL — **anything returning the contract below works.** Anchor is the reference backend; the seam is deliberately thin so the backend is replaceable.

---

## The contract (exact, captured from a live service)

**Answered** (`POST /api/ask` with a question in-corpus):

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

**Abstained** (out of corpus):

```json
{
  "abstained": true,
  "abstainReason": "low_retrieval_score",
  "citations": [],
  "topScore": -4.12,
  "answer": "I can't answer that from the doctrine I have on this device. Nothing in the indexed corpus supports an answer to this question."
}
```

Fields:

| field | meaning |
|---|---|
| `abstained` | `true` = refused; the corpus doesn't support an answer |
| `abstainReason` | machine reason, e.g. `low_retrieval_score`, `uncited_answer`, `unsupported_premise` |
| `answer` | prose with inline `[n]` markers that map to `citations` |
| `citations[]` | `{ n, citation (human-readable locator), pub_id, page_printed }` — paragraph + printed page, not a book title |
| `retrieved` | passages retrieved for the question |
| `topScore` | top rerank score (negative → nothing relevant) |
| `latencyMs` | device latency |

### One decision that must not be "fixed"

**An abstention returns HTTP 200, not an error.** "The corpus does not support an answer" is a *correct* response. A 4xx pushes callers into a `catch`, and the natural thing to write in a catch is a fallback to the ungrounded model — which puts back exactly the invented doctrine this exists to prevent. Keep abstention on the 200 path.

**Error → status map** (these are the real failures, and they are distinct from abstention):

| condition | status |
|---|---|
| `NO_DOCTRINE_SERVICE` (`DOCTRINE_BASE_URL` unset) | 503 |
| `DOCTRINE_UNREACHABLE` / `DOCTRINE_BAD_RESPONSE` / `DOCTRINE_ERROR` | 502 |
| `BAD_REQUEST` | 400 |

On any of these the LMS **refuses or degrades to cited FTS — it never silently falls back to an ungrounded model.**

---

## The premise gate + HHEM (why a small model can't self-check)

Most false answers are not off-topic — they are a question that **smuggles in a false specific**: "the seven phases of the intelligence cycle", "the 2011 TCCC Guidelines … suzetrigine", "the passage where MCDP 7 credits Patton". Retrieval correctly finds the on-topic paragraph, it scores *high*, the reranker passes it, and a small generator then affirms the false specific. BM25, the reranker, and calibration cannot catch this — retrieval is *right*; only the asserted specific is false.

So Anchor adds a **premise gate**: before answering, it extracts the question's asserted specific and checks it against the retrieved passages with a purpose-built entailment model — **Vectara HHEM-2.1-Open (110M, Apache-2.0)** running **offline as a separate CPU service**. A 2B generator scores true and false counts alike; HHEM discriminates cleanly — a true *"three phases"* scores **0.94**, a false *"six phases"* **0.01** against the same passage. The gate **fails open**: if the verifier is unavailable the tutor still answers (degrade, don't crash).

### Measured honestly (233-question adversarial eval)

122 in-corpus, 95 out-of-corpus, 16 answer-traps — built deliberately hard (false-premise traps, quote misattributions, stale-edition and wrong-count near-misses).

| metric | value | basis |
|---|---|---|
| False-answer rate (answered when it shouldn't) | **15.8%** | 15/95 |
| Correct-abstention rate | 84.2% | 80/95 |
| Over-refusal rate (refused when it shouldn't) | 18.9% | 23/122 |
| Citation-correct rate | 99.0% | 99 answered |
| p50 / p95 latency | 6.1s / 18.7s | on device |

The premise gate moved false-answer **22.1% → 15.8%** at a rise in over-refusal to 18.9% — and the **sum of the two errors fell**. Report both together: refusing everything drives false-answer to zero and produces something useless. These are the *weak* numbers, reported as weak on purpose — the pitch is a system that knows what it can't verify and says so.

---

## How the LMS consumes it

- **Authoring** (`lib/course-gen.js` → `generateCourse`): each objective is drafted, then grounded through Anchor; **an unsupported claim is dropped, not guessed.** The generated `Item` carries its `citation` and HHEM `support` score and lands `PENDING` for review.
- **Tutor Ask** (`lib/tutor.js` → `askDoctrine`, `/api/ask`): cite-or-refuse straight to the learner; the answer shows the citation and (in the widget) the HHEM badge. Anchor down → cited Postgres FTS fallback (`source = fts`).
- **Enforced citation gate:** an answer that asserts factual sentences but carries **zero valid in-range `[n]` markers abstains** (`abstainReason: uncited_answer`) — independent of the verifier, so the floor ships even when HHEM is off. Never synthesize citations after the fact.

---

## The service behind it

**Anchor** — [github.com/groundworklms/anchor](https://github.com/groundworklms/anchor), Apache-2.0, offline. Runs on a Jetson Orin Nano; holds 13 publications and 4,230 paragraphs (all publicly releasable, screened before ingest). Access details (SSH, tunnel, ops scripts) are in the **Cold Bore plan (ACCESS)** and the **Range Card (RUNBOOK)**. The tunnel is **not** persistent — if the tutor shows `source = fts`, re-run `ops/tunnel.sh`; the FTS fallback is graceful if it drops mid-demo.
