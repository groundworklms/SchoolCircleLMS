# Scoring card

The nine published judging criteria for the MCU-NPS AI Learning Initiatives
Hackathon, and where each one is already answered.

This card does not restate the demo. `RANGE-CARD.md` owns the pitch, the
five-minute shot, the runbook, and the contingencies. This is only the map from
what a judge scores to what we already have, so nothing strong goes unshown.

Nine criteria, 90 points. Five scored at full weight, four bonus at 0.05x.

## Scored

| Criterion | Weight | Already answered by | Gap |
|---|---|---|---|
| Mission Impact | 30% | The pitch, and the transition section: schoolhouse adoption, edge-first, MarineNet as the front door via LTI 1.3 with grade passback. | None. This is the heaviest criterion and our strongest. Open on it. |
| Technical Innovation | 25% | The verification throughline. Rubricon proves grounding, Sourcerer faithfulness, Whetstone mastery, Sextant learning gain, Understudy doctrinal fidelity. Five things proven, not asserted. | None. Say "proven not asserted" out loud; it is the line that separates us. |
| Usability & Design | 20% | The role switch, the cited answer with the HHEM badge, the live refusal. A judge understands the loop in one beat. | None. |
| Security & Sustainability | 15% | Apache-2.0 across **thirteen** public repos (twelve arsenal + SchoolCircle, verified 17 Sep); the test suite — **564 tests, 559 pass, 5 skipped, 0 failures on the 17 Sep run**, and re-verified since: Re-run 17 Sep 2026 on this branch: every suite that does not need Postgres was run (`test`, `test:ui-rendering`, `test:navigation`, `test:doctrine`, `test:doctrine-auth`, `test:student-grounding`, `test:source-library`, `test:account-profile`, `test:model`, `test:ai-authoring`, `test:authoring`, `test:roster`, `test:record-admin`, `test:db-policy`) and **every one reported 0 failures**. The three DB-backed suites (`test:db`, `test:roster-db`, `test:authoring-db`) were NOT run — no local Postgres — so say "0 failures outside the database suites", not "all green". The 564 figure is a single-pass total; the per-suite scripts overlap, so do not re-derive it by adding them up. Quote this repo's count, never a platoon-wide total nobody here has run; **grounded answering with no cloud call and no ATO dependency on the answer path**; one swappable auth seam toward CAC/SSO. | Two gaps to volunteer, both before a judge finds them: the auth seam, and the fact that sign-in still calls Firebase Auth, so the app is not offline end-to-end yet — Anchor is. Volunteered limitations read as credibility in this room. |
| Team Collaboration | 10% | Four lanes in `TEAM-PLAN.md`, four GitHub accounts in the history, the sprint board. | More than one person must speak during the five minutes. A single presenter reads as a single-contributor project. |

## Bonus, 0.05x each

**Living on the Edge.** Our strongest bonus, and it is measured rather than
asserted: with the network cable out, Anchor on the Orin still serves
`/api/health`, `/api/corpus` and `/api/ask` — cited answers with
paragraph-level locators over 4,731 chunks from 14 publications, and
out-of-corpus questions still refused. Generation runs on the board, so an
answer costs $0 in cloud spend. Beat 6 of the five-minute shot shows exactly
this. **Scope it the way the measurement scopes it:** the *grounding engine* is
what runs offline. SchoolCircle's sign-in still goes to Firebase
Authentication, so be signed in before the cable comes out, and say so — an
offline auth path is in progress and is not finished. "The whole product runs
offline" is a claim a judge can disprove in one click; "the engine that can't be
allowed to lie runs offline on a $500 board" is one we can prove on the table.

**Reach the Enterprise.** Won. SCORM export plus the LTI 1.3 path into MarineNet.
Show the export landing somewhere, not as a file on disk.

**Sanctioned and Approved.** *This one is currently unclaimed and it is free
points.* The criterion rewards using an already-approved DoW platform, naming
GenAI.mil specifically. The Range Card lists OpenRouter (Gemini) as the
authoring model. GenAI.mil serves Gemini over CampusNet with a CAC, so the
authoring call can point there instead. That is a base-URL and credential swap
on the one seam that already exists (`lib/model.js` in the OG tree,
`MODEL_BASE_URL` in the env), not an architecture change, and it does not touch
the on-board answering path at all. Needs a CAC and a CAC reader on site.
ChatGPT and Grok need NIPR; Gemini does not.

**Supercharge.** Partly claimed already through methodology: hybrid BM25 plus
dense retrieval with reciprocal-rank fusion, per-publication calibrated
thresholds, and HHEM entailment gating on asserted presuppositions. If NPS HPC
access lands, running the adversarial set as a threshold grid search turns a
methodology claim into a demonstrated one.

## The number to lead with

5 out of 5 out-of-doctrine questions correctly refused. Pair it with the honest
counterpart when asked: the adversarial set is deliberately harder than the
demo, and over-refusal is the cost we accept for it. A team that names its own
failure rate is the one a DoW audience believes.
