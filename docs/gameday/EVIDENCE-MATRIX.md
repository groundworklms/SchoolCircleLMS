# Gameday evidence matrix

**Reconciled: 2026-09-15. Documentation review only; no new measurements.**
This matrix governs current-state claims in Cold Bore, the Range Card and WINPLAN.
Thompson retains QA and run-of-show ownership under GitHub #9; this is a proposed
handoff supporting #14, not an issue assignment or submission approval.

## Reading the evidence

Every claim needs an environment, observation date, evidence class and source.
**Fixture** means controlled inputs/model I/O; **database** means persisted records;
**live cloud API** means actual hosted-provider HTTP, not a published deployment;
**browser** means only the interaction actually observed; **direct Anchor** means
the remote service (or explicitly identified host proxy); **offline hardware**
requires a disconnected rig observation; **consuming LMS** requires a named player.
Static source inspection is route/configuration evidence only, not a runtime pass.
An unknown historical date stays unknown: the reconciliation date is not a test date.

## Current and bounded evidence

| Claim | Environment / observation date / class | Source and allowable statement | Not established |
|---|---|---|---|
| Connected learning API loop | Development Next + PostgreSQL + OpenRouter `openai/gpt-4.1-mini`; 2026-09-15; live cloud API + database | [Learning-loop proof](../learning-loop-proof.md): fictional source ingestion/approval, course and rubric draft/approval, cited tutor answer and unsupported refusal, two mastery turns with reload and database comparison; isolated test records cleaned up | Published app, human SME review, browser sign-in, offline delivery, learning gain |
| Regression checks | Development Next/PostgreSQL; 2026-09-15; fixture + database | Same report: 20 root tests and 27 adapter/persistence tests, typecheck passed; model I/O controlled in deterministic suite | Do not add these to historical library totals or call them live provider tests |
| Browser evidence | Development Next; date not recorded in arsenal report; browser + database | [Arsenal verification](../arsenal-verification.md), “Next.js restoration”: test OIDC login, learner restricted from `/teach`, deliberate test-user promotion, source creation/approval and reload | Firebase production sign-in or the complete generated-course learner journey |
| Landing screenshot | Development Next; 2026-09-15; browser | Learning-loop report: landing rendered with an unidentified resource 404 | Full browser acceptance or zero browser errors |
| Anchor service and host proxy | Temporary remote Anchor tunnel and development host; dates not recorded; direct Anchor, with host-proxy HTTP separately observed | Arsenal report: health ready, corpus 13 publications/4,230 chunks; MCDP 1 friction answer with 3 citations and stock-price retrieval refusal; “Latest host verification” also records `/api/doctrine` answer/refusal | Current tunnel availability, published-host configuration, disconnected hardware or a general refusal rate |
| Export contract | Development Next/PostgreSQL; date not recorded; fixture + database | Arsenal restoration section: real Cartridge ZIP response and instructor-owned export audit | Consuming LMS launch, score/completion/resume, MarineNet acceptance |
| Planning/reporting companions | Development adapter suite; date not recorded; fixture + selected database checks | Arsenal per-repository matrix: Cadence, Hotwash, Waypoint, Sextant contracts and selected persistence | Complete browser planning/reporting, educational efficacy, invented pre/post gain |
| Current entry points | Workspace source inspected 2026-09-15; static, not runtime | `app/learn/page.tsx`, `app/teach/page.tsx`, `app/login/page.js`, `app/plan/page.js`, prototype catch-all and `app/api`: `/learn`, `/teach`, `/login`, `/plan`; `/` landing; `/prototype` retained legacy UI | A route existing does not prove its complete workflow; prototype output is not current learning-loop proof |

The arsenal report intentionally retains earlier setup failures, 24/27-test
snapshots and pre-configuration proxy observations. Its older “model unavailable”
and “proxy not retested” text is superseded **only for the specific flows** in its
later host/restoration sections and the dated learning-loop report. The live loop
does not prove all twelve companions or remove the separate fidelity/LMS gates.

## Preserved historical claims — not current cloud proof

Sources below are the pre-reconciliation Cold Bore and Range Card, retained in
Git history, plus WINPLAN and the arsenal report where named. Original run logs
and timestamps are not supplied by those gameday briefs. These are attributed
historical reports, not newly reproduced results.

| Original claim | Environment / date / class | Source / scope / present use |
|---|---|---|
| ~5 s cited/HHEM answer; ~4.5 s BARS rubric | Historical local/edge stack; date unknown; offline hardware report (rubric execution placement unspecified) | Range Card “NUMBERS”; approximate timings without sample count or method. Do not apply to cloud latency |
| 5/5 out-of-doctrine questions refused (100%) | Historical local rig; date unknown; offline hardware report | Range Card “NUMBERS” and WINPLAN; five selected questions only, not a safety guarantee or benchmark across arbitrary questions |
| 4,230 chunks / 13 publications | Historical edge; date unknown; offline hardware report, separately corroborated by direct Anchor corpus probe | Range Card “NUMBERS”; arsenal direct probe confirms that service snapshot, not current app database corpus |
| 146 NAVMC 3500.44E tasks; 345 app FTS chunks; 163 MCWP 5-10 chunks | Historical prototype/app and Orin corpus; date unknown; database / offline hardware report | Cold Bore SITREP and corpus board; TC 3-22.9 retained, MCDP 1/5 reported on Orin; do not equate with current approved Next content |
| Five use cases built; #9 used stand-in ELOs | Historical `/prototype` stack; date unknown; browser/offline hardware report | Cold Bore progress; real EWSDEP 8670 ELOs gated by MCeLE. Five-use-case objective retained, not five current acceptances |
| Broken cloud key: tutor/refusal/course rendering continued, generation failed; zero external assets; five services | Historical local rig; date unknown; offline hardware report | Cold Bore progress and SITREP, referencing external `ops/OFFLINE.md`; a broken-key check alone does not demonstrate complete network isolation on the current Next stack |
| Full rehearsal, BARS source traceability/vague-standard flags, mastery weak→developing and strong→mastered | Historical prototype with Orin tunnel; date unknown; browser/offline hardware report | Cold Bore progress; scope is that rehearsal, not today's browser or learning efficacy |
| 36-item golden course; marksmanship and MCPP course banked | Historical authoring/prototype; date unknown; database/artifact report | Cold Bore progress; current reviewed banked-course readiness needs a separate report and accessible record |
| 12 repos / 700+ passing tests; Cadence 17 and Hotwash 16 tests | Historical companion repositories; date/revisions not supplied in briefs; fixture/library report | Range Card numbers and Cold Bore progress; not a reproducible current aggregate; pinned revisions appear in arsenal report |
| ~$0.10/course; $0 offline delivery; ~$500 board | Historical architecture; date unknown; estimates, not test evidence | Range Card numbers/transition and WINPLAN; not measured current costs, total ownership cost or assurance of no authorization requirements |
| 8/17 use cases backed by products | Historical product inventory; date unknown; source inventory, not execution evidence | Range Card numbers; primary demonstration still targets #1, #13, #16, #12, #9; Understudy #17 set aside |

No HHEM score, citation, refusal sample, test count, or approval flag supports
“cannot hallucinate,” “every claim verified,” or “no ATO required.” LTI/CAC/SSO
seams and SCORM packaging are integration intentions, not enterprise acceptance.

## Reports that may advance the run-of-show

Thompson should attach each report to the exact beat and environment before
changing its gate. Record date, revision, configuration names (no secrets), role,
approved course/source identifiers, expected and observed outcome, and failures.

| Existing workstream | Required handoff / gate |
|---|---|
| Shared Next baseline | Final build/test/typecheck and route baseline; do not infer deployment from local changes |
| Reviewed golden course | Releasability, SME reviewer/date, approved records, citation access, learner-safe output, fallback load/reload evidence |
| Browser learning journey | Real sign-in for learner/instructor, role restrictions, review/publish, citations, mastery reload/persistence; distinguish Firebase from test OIDC |
| Offline delivery | Named hardware, local app/database/model/auth dependencies, banked content, disconnected network procedure, tutor/refusal/mastery/reload and failures |
| SCORM runtime | Named player + SCORM version, launch/initialize, score/completion, commit/finish and resume evidence; target MarineNet check stays separate |
| Planning/reporting | Real role-specific saved plan/calendar/profile/AAR and cohort thresholds; distinguish mastery evidence from pre/post gain |
| GitHub coordination / Thompson QA | Link these reports and decide beats; no teammate issue changes are performed by this reconciliation |