# Lesson generation: quality and richness plan

Companion to `remediation-plan.md`, which covers UI defects. This one covers what the generator
*produces* — correctness first, then richness. Ordered by value per hour, not by ambition.

Two inputs: the ASTRA course review (11 sections, 44 items, 5 blocking defects), and a code audit of
what the pipeline can already do but does not.

## What already exists and is switched off or unused

Worth reading before proposing anything new.

| Capability | State |
|---|---|
| **Diagram generation** | Fully built in Coursewright: constrained element schema, labels checked against the passage at the same grounding floor as prose, refusal path with a reason. `diagramSvg()` renders it, `labelSpots()` positions hotspots, `LearnerFeatures` passes it through. **Disabled by a hardcoded `diagrams: false`.** |
| **Scenario + coaching, discussion prompts, flashcards, instructor summary** | Generated today. |
| **Per-item ratification** | `ItemReview.js`. Every materialised Item lands PENDING; learner queries return APPROVED only. Shows each item with its citation and an HHEM support score measured against the keyed answer. Editing an item ratifies it in one action. |
| **Per-item AI revision seam** | `course-revisions.js` accepts `scope: 'question'` with a `questionId`, end to end through pending revision, review and approve. |
| **Grounded answer engine** | `groundedStudentAnswer()` — Anchor selects only from supplied passages, Sourcerer writes and fact-checks against that subset, Understudy judges before delivery. Passage-scoped, not course-scoped, so it is reusable for an instructor asking about a source. |

Model selection is already correct everywhere: our adapter is `(_model, system, prompt) => askJson(...)`
and discards the library's model hint, so every artifact call goes through the operator's Settings
choice. `COURSEWRIGHT_DIAGRAM_MODEL` and friends are dead in our wiring. What was lost with it is the
*intent* — the library asks for a stronger model on hard artifacts and a cheaper one on prose. If we
want that back it is a second Settings selection, never an env var.

---

## Tier 1 — hours each, and two of them are blocking

### 1.1 Answer-position shuffle and distribution validator

39 of 44 keys in the reviewed course are option 1. Option 4 is never correct. A learner who reads
nothing and always picks the first option scores 89%, so **every pre-test, post-test, gain score and
class-mastery number the platform has ever produced is noise.**

Root cause is one line — Coursewright's item prompt shows the model its own answer:

```
{"stem":"...","options":["A","B","C","D"],"answerIndex":0,"rationale":"..."}
```

Models copy the example. Nothing shuffles afterwards; `shuffle|randomi[sz]e|Math.random` has zero
matches across Coursewright and `lib/`.

Fix in three parts, in order of robustness:

1. Deterministic seeded shuffle at **persist** time, seeded on item id, remapping the stored key.
2. A distribution validator that fails a course when any option position holds more than ~35% or 0%
   of keys.
3. Change the prompt example so it does not show a fixed index.

**Constraint that must not be missed:** shuffle once at persist, *never* at render. Recorded attempts
store an answer index against the stored option order; shuffling at read time invalidates every
existing attempt and moves options under a learner mid-test.

### 1.2 Turn diagrams on

One flag. The generator, the grounding check, the renderer and the learner surface all exist. Cost is
one extra model call per section, and the artifact refuses rather than invents when the passage will
not support it.

### 1.3 Block approval while a lesson page is unwritten

The builder offers "Approve and publish" while its own status line reads "Rewrite lesson pages
(10/11 written)". `approveCourse` checks role, ownership, version staleness and pending revisions —
there is no written-pages gate anywhere. A course can be published with a section the learner cannot
read.

### 1.4 Surface the HHEM support score in item review

`support` is already computed per item — an entailment score of the item against its keyed answer —
and `ItemReview` already receives it. Every one of the ASTRA P1 "ungrounded stem" defects is exactly
what a low support score means. Check whether it is populated in practice before building any new
validator: the detector may already exist and simply not be shown.

---

## Tier 2 — a day each, and this is where it starts to look good

### 2.1 Diagram quality

The renderer is a safe whitelist — `esc()` on text, `num()` on coordinates, `paint()` mapping five
tokens to CSS variables, a validated viewBox. It is a good foundation. What makes the output look
amateur is the vocabulary, not the safety:

- Only `circle`, `rect`, `line`, `text`. No arrowheads, so flow and direction cannot be drawn — which
  is most of what training diagrams are.
- No `text-anchor`, so a label cannot centre in a box.
- One stroke width, one font size: no visual hierarchy.
- **The model hand-computes absolute coordinates.** This is the real cause of wonky output.

Two changes, the second being the significant one:

1. **Extend the primitive vocabulary** — arrowhead markers, `path`/`polyline`, `text-anchor`,
   dashed strokes, a font-size tier, rounded containers, and semantic colour names (the current
   `glow` / `readout` / `glow2` read as borrowed from another product).
2. **Add a structured diagram type.** Most training diagrams are box-and-arrow: command
   relationships, process flow, hierarchy. Let the model emit *nodes and edges* and have the
   renderer lay them out deterministically. No coordinate arithmetic means consistently clean
   output, and it is far easier for the model to get right. Keep the freeform primitives for
   genuinely spatial subjects — a rifle, a circuit.

### 2.2 Cloze items

The blank *is* source text, so grounding is exact and free. It tests recall rather than recognition,
and it is structurally immune to the option-position bug because there are no options.

### 2.3 Ordered procedure

Quarry already extracts PERFORMANCE STEPS. Drag-to-order is gradable and the source states the order,
so grounding is exact. The best artifact fit in the whole list for this domain, and a checklist or
job aid falls out of the same data — printable, and useful with the network pulled.

### 2.4 AI assist inside item review

The screen, the evidence and the revision seam all exist; what is missing is the conversation. An
instructor sitting on a bad item with the cited page beside them and a model that can only speak from
that page catches the ASTRA P0 defects in seconds. This is the highest-value feature on the list
because it is a defect-*catching* surface, not only an authoring one.

---

## Tier 3 — larger, and worth doing in this order

### 3.1 Chat with a source before generating

The real gap: the tutor is course-scoped (`{ question, courseId }`) since the grounded-chat rework,
so there is no way to interrogate a source when no course exists yet. Wrap `groundedStudentAnswer`
over the source's passages. Would have caught the four-topic grab-bag title and the front-matter
sections *before* a generation run was spent.

### 3.2 Give the model the validators as tools

Generation today is a fixed pipeline of one-shot prompts; the model cannot check itself, so we
verify afterwards and refuse. The same validator code handed over as tools —
`verify_grounding(text)`, `retrieve_passage(query)`, `check_key_distribution(items)`,
`expand_acronym(term)` — turns refusal into self-correction. Notably `retrieve_passage` addresses the
root of the worst ASTRA defects: the item writer and the page writer were working from different
text.

### 3.3 Artifact selection per objective

Generating every artifact for every section is why a twelve-section course takes minutes and real
money. A procedure deserves an ordering exercise, a contrast deserves a comparison table, a
definition list deserves cloze. Let the model choose per objective and justify the choice: cheaper
and better at once. Without this, each artifact type added multiplies cost by section count.

---

## Sequencing

```
1.1 shuffle + validator   ── blocking; until it lands no score means anything
1.3 publish gate          ── blocking; small
1.2 diagrams on           ── one flag, immediate richness
1.4 support score         ── check first; may already be free
      │
2.1 diagram quality  2.2 cloze  2.3 procedure      ── independent, parallelisable
      │
2.4 AI in item review     ── highest value of the features
      │
3.1 source chat  →  3.2 validators as tools  →  3.3 per-objective selection
```

Tier 1 is correctness and costs hours. Tier 2 is what makes it look like a product. Tier 3 changes
the architecture and should not start before Tier 1 is done, because it multiplies whatever the
generator currently gets wrong.
