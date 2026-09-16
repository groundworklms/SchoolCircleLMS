# Instructor Navigation Consolidation

## Purpose and status

Implementation scope for the navigation consolidation. Make `/prototype/instructor` the single instructor workspace and the existing `/prototype` student shell the single learner workspace. The retired `/teach` and `/learn` page areas are deleted; no redirects, aliases or compatibility wrappers remain, so old bookmarks intentionally return not found.

**Historical navigation-phase plan:** The manual-authoring deferral described below has since been superseded by [AI-only course authoring](ai-course-authoring.md). Manual write paths and editor controls are now retired; saved releases, playback and evidence remain.

At this navigation milestone, manual course creation and editor integration were deferred. The scope preserved the manual backend, saved records and reusable editor code without adding a manual editor route. Published manual playback moved to `/prototype/published/:id`. Next.js, Firebase, saved-role authorization, existing course records and both delivery paths were retained. The URL containing “prototype” was not a reason to discard its real integrations.

## Findings and resulting boundaries

| Area | Current behavior | Consequence |
| --- | --- | --- |
| `/teach` and `/learn` | Retired page areas are deleted without redirects or aliases | Old bookmarks return not found; canonical shell navigation is the only active entry point. |
| `/prototype/instructor` | Instructor shell and course library | Sign-in and instructor navigation stay in the real workspace rather than a separate teaching shell. |
| `/prototype/instructor/courses` | Lists AI course records through the learning API | Real source upload, generation, review, approval and evidence functionality exists here. |
| Manual authoring | Backend, records and reusable editor remain dormant; no manual editor route is added | Manual creation is deferred instead of becoming a second instructor workflow. |
| Instructor navigation | The AI course library is the active authoring entry point | A single instructor shell avoids competing course workflows. |
| `/prototype/instructor/:id/builder` | Renders generated-course review for real records, prototype curriculum for demo records | The same-looking destination can mean live or demonstration content. |
| Unknown instructor course URLs | Can fall back to the default mock course after loading | Invalid or inaccessible records can appear to load successfully. |
| Learner navigation | The student shell owns generated delivery and the published manual player | Manual published releases remain playable at `/prototype/published/:id` without a second learner shell. |
| Login/deep links | Canonical shell and published-player destinations are role-checked | Retired namespaces are not valid post-login destinations. |

### Two real authoring contracts, not duplicate copies

**Generated courses:** The learning API persists `COURSE_DRAFT` records with sources, course content and citations. Approval validates content and sources and projects approved content into the typed learner delivery tables. This path supplies the AI course library, source review, fidelity, mastery, AAR and SCORM tools.

**Manual courses:** The authoring API persists `MANUAL_COURSE` records and immutable `MANUAL_RELEASE` snapshots. It provides structured editing, optimistic concurrency, publication, archive behavior, a separate learner reader, progress and attempt/result handling.

Both use LearningRecord storage but their payloads, IDs and lifecycle contracts are not interchangeable. Manual publication is not absent: its existing reader/API remains available through the published player at `/prototype/published/:id`. It is not the generated-course feed or typed delivery projection.

The prototype shell is now mixed live/demo code, not merely a static mockup. The manual editor and backend are preserved as dormant reusable code, but are not part of this navigation surface.

## Recommended information architecture

### One instructor workspace

- `/prototype/instructor` opens or redirects to `/prototype/instructor/courses`.
- **Courses** is the only top-level course-library entry for active generated records. Manual releases use the published-player route rather than an instructor editor entry; retain their origin/type discriminator and lifecycle status in backend contracts.
- **Source library** retains citable uploaded material.
- **Rubrics** retains existing rubric functionality.
- **Settings** uses an explicit supported destination rather than interpreting a reserved word as a course ID.
- Inside a selected course, show only working, applicable tools: content/builder, fidelity, mastery/results, AAR and export where supported. Do not add nonfunctional “Review” or other tabs merely to anticipate future features.
- Keep account settings distinct from course settings. Remove duplicate course listings where the same records appear as both library contents and a second teaching menu.
- Keep demonstration courses in an explicitly labeled sample/demo area. Never use them as fallback for a real record, loading failure or permission failure.

### Route contract

Use explicit canonical routes to avoid assuming the two record types share identifiers:

| Existing route | Proposed destination |
| --- | --- |
| `/teach` and `/learn` | Deleted; no redirect or alias |
| Manual authoring entry points | Deferred; no manual editor route |
| Published manual player | `/prototype/published/:id` |
| `/prototype/instructor/:id/builder` for generated records | `/prototype/instructor/courses/generated/:id/builder` |
| Existing generated-course fidelity/mastery/AAR links | Equivalent typed course route preserving the selected tool |

The published-player route distinguishes manual release IDs from generated course IDs without creating a second learner shell. The table describes the active route contract and explicit deletion/deferment decisions, not redirects to retain.

Preserve documented demo URLs separately. Validate reserved segments, record type, course ID and supported view explicitly; show loading, not-found, unavailable and forbidden states accurately. Unknown paths must not silently render a demonstration course.

Delete the old `/teach` and `/learn` page trees after relocating only the reusable delivery pieces required by the canonical shells. Do not add redirects, middleware rewrites or aliases for those namespaces. Remove them from safe post-login destination allowlists and update every internal link to the canonical route, preserving relevant course/lesson/release context in published-player links.

## Implementation sequence

### 1. Lock the route and feature inventory

Record every instructor entry point, shell link, course action and learner delivery link. Add characterization tests for current generated/manual course access and owner/role restrictions before relocating components.

Resolve the exact canonical URL helpers once; all navigation, login destinations, redirects, editor actions and breadcrumbs must use that contract. Do not make separate ad-hoc replacements.

### 2. Consolidate the instructor shell and course library

Do not adapt or relocate the manual editor into the preferred instructor shell. Keep manual creation deferred and remove its active listing/navigation entry while preserving its backend, records and reusable editor modules.

Present the active generated-course records through one library with explicit backend dispatch. Preserve the real AI draft/source workflows. Keep manual records available to their existing backend/publication contracts without adding an instructor editor entry. Handle partial API failure explicitly rather than displaying an apparently complete but incomplete list.

Do not build new AI revision behavior in this navigation change.

### 3. Reconcile links, entry points and demo separation

Remove hard-coded `/teach` and `/learn` links, redirects and manual authoring entry cards. Make instructor landing open the library, not a sample course. Keep published manual-player links on `/prototype/published/:id`.

Update role switching and onboarding destinations for Student, Instructor and Both. Preserve server-side authorization; client navigation is not an access-control substitute.

Separate mock content visibly from authenticated real courses. Replace unknown-course fallback with explicit states and validate unsupported tool URLs.

### 4. Preserve learner publication and delivery

Keep both existing publication services and their record types unchanged during navigation consolidation. No record conversion, ID rewriting, mass approval, database migration or silent manual-to-generated projection.

Preserve the manual reader's published-release, progress and grading behavior at `/prototype/published/:id`; retain generated-course learner redaction and approved-only delivery. The student shell is the only learner shell, and no manual editor is integrated into the instructor shell.

Delete the legacy learner page area after its supported published-player behavior is represented by the student shell. No compatibility routes remain. Audit login role handling against reader permissions, including instructor preview and Both accounts.

### 5. Remove redundant wrappers and verify

Remove competing page wrappers and labels only after supported functionality is reachable in the canonical workspace. Delete the complete `/teach` and `/learn` route trees; retain the independent authoring/publication backend services, reusable dormant editor code and saved records, not legacy page routes.

Run route/navigation tests, relevant authoring and learning regressions, and the native build. Perform one focused browser acceptance pass covering both record types, both roles, canonical deep links, reloads and publication visibility. Verify retired namespaces return not found and cannot be selected by post-login redirects. Search navigation, middleware, redirects, documentation and generated links for stale references. Do not call cloud models or mutate a shared database without the required authorization.

## Acceptance criteria

- One instructor shell, one Courses entry, and one consistent course navigation system.
- Instructor landing opens the real course library; no automatic sample-course selection.
- Existing generated courses remain discoverable with their original IDs and data. Manual records and backend contracts remain preserved without a new editor route.
- AI source upload/generation/approval remains reachable; published manual releases remain playable at `/prototype/published/:id`.
- `/teach`, `/learn` and every former child page are removed and return not found, with no redirect, alias or rewrite.
- All active internal links use canonical instructor/student routes; canonical deep links preserve the intended record and supported view.
- Refresh, browser back/forward, sign-in redirects and role switching work without bouncing between competing shells.
- Student-only accounts cannot reach instructor data or actions; owner isolation remains enforced.
- Draft/pending content remains unavailable to learners. Published manual and approved generated courses open their correct delivery paths.
- Invalid course IDs, forbidden records, unsupported tools and service failures do not display a mock course.
- Sample content is clearly separated from real courses.
- No data migration, deletion, blanket approval, framework change, production operation or model call is part of this tidy-up.

## Deferred until navigation is consolidated

Manual course creation and editor integration remain deferred. The desired AI-first flow remains the next authoring milestone: upload POI and supporting materials, generate the full course, give feedback on a question or whole lesson, regenerate only the requested scope, preserve revision history, re-review changed content, and release only after final approval.

Do not confuse shared navigation with completed authoring-model unification. Any later decision to unify the two storage/publication contracts requires a separate compatibility design and data-preservation review.

## Verified implementation references

- `app/prototype/InstructorShell.js`
- `app/prototype/StudentShell.js`
- `app/prototype/nav.js`
- `app/prototype/Prototype.js`
- `app/prototype/Library.js`
- `app/prototype/InstructorFeatures.js`
- `app/_authoring/editor-list.js`
- `app/_authoring/editor-main.js`
- `app/_authoring/editor-shared.js`
- `app/_learning/mastery-session.js`
- `lib/authoring/service.js`
- `lib/learning/core.js`
- `lib/learning/project-course.js`
- `tests/authoring-server.test.mjs`
- `tests/authoring-editor.test.mjs`
- `tests/authoring-player.test.mjs`
- `tests/legacy-route-removal.mjs`
- `tests/role-destination.test.mjs`
- `test/project-course.test.mjs`