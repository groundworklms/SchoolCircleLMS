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
| Security & Sustainability | 15% | Apache-2.0 across **thirteen** public repos (twelve arsenal + SchoolCircle, verified 17 Sep), **650 tests in this repo: 641 pass, 9 skipped, 0 failures** across 58 test files in one de-duplicated pass (`node --experimental-test-module-mocks --test <the 58 files CI's build job runs>`, measured on Node 24 locally; on Linux/CI it reads 643 pass / 7 skipped because two SCORM cases are POSIX-only — that 643 is derived from the measured 641 plus those two cases, each watched passing on Node 20 Linux) — quote this repo's number, not a platoon-wide total nobody here has run, offline delivery with no ATO dependency for the delivery loop, one swappable auth seam toward CAC/SSO. | State the auth seam as a known gap before a judge finds it. Volunteered limitations read as credibility in this room. |
| Team Collaboration | 10% | Four lanes in `TEAM-PLAN.md`, four GitHub accounts in the history, the sprint board. | More than one person must speak during the five minutes. A single presenter reads as a single-contributor project. |

## Bonus, 0.05x each

**Living on the Edge.** Won outright. Delivery runs on the Orin with the network
pulled, $0 per answer. Beat 6 of the five-minute shot already does this.

**Reach the Enterprise.** Won. SCORM export plus the LTI 1.3 path into MarineNet.
Show the export landing somewhere, not as a file on disk.

**Sanctioned and Approved.** *This one is currently unclaimed and it is free
points.* The criterion rewards using an already-approved DoW platform, naming
GenAI.mil specifically. The Range Card lists OpenRouter (Gemini) as the
authoring model. GenAI.mil serves Gemini over CampusNet with a CAC, so the
authoring call can point there instead. That is a base-URL and credential swap
on the one seam that already exists (`lib/model.js` in the OG tree,
`MODEL_BASE_URL` in the env), not an architecture change, and it does not touch
the offline delivery loop at all. Needs a CAC and a CAC reader on site.
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
