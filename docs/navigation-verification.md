# Navigation consolidation verification

## Delivered

- Instructor authoring is AI-first inside the prototype instructor shell; manual creation is deferred.
- Published manual delivery is an in-shell student component alongside generated-course discovery.
- Legacy instructor and learner page trees are deleted, with no compatibility routes.
- Source-service failures and invalid/inaccessible course locations remain explicit.
- Sign-in retains canonical course, release and lesson query context.

## Automated evidence

- Default learning/auth/projection suite: 47 passed, four existing database-dependent tests skipped.
- Authoring service/editor/player regressions: 11 passed.
- Navigation, saved-role destinations and retired-route checks: 12 passed.
- Sign-in return-path tests: two passed.
- UI rendering suite, including partial source-service failures: 13 passed.
- Native Next production build passed; its route inventory contains neither retired page tree.
- Static code review approved after fixing lost sign-in context and source-error masking.

These checks use fixture/transport evidence where appropriate; they are not proof of a live authenticated saved-course journey.

## Live observations

The managed Next preview started successfully. Browser checks confirmed the landing and sign-in pages load, and an anonymous published-course link retains its complete destination/query through sign-in.

The following routes returned HTTP 404, not redirects:

- `/teach`
- `/teach/courses`
- `/teach/courses/fixture`
- `/learn`
- `/learn/library`
- `/learn/library/fixture`

## Remaining acceptance gate

Normal signup could not obtain a usable app session: the identity endpoint returned HTTP 503, with the visible error “Identity service unavailable.” Server logs show the underlying user upsert failing with PostgreSQL error 42809: “WITHIN GROUP is required for ordered-set aggregate rank.”

This observation identifies the failing account database operation, not a verified root cause or authorization to change the database. Authentication/backend/schema code was not changed by this consolidation.

Consequently, the authenticated instructor library, role switching and access enforcement in the browser, populated course readers, and saved learner state across reload still require live acceptance after the identity failure is resolved. No auth bypass or mocked live acceptance was used.

No model calls, course generation, submitted answers/progress, schema changes, database reset or bulk seeding were performed during this verification.