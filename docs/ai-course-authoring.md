# AI-only course authoring

## Workflow

The instructor Courses library generates courses from selected approved POI,
materials and doctrine sources. Objectives can be supplied one per line or left
blank for AI outline extraction. Outline generation is bounded to twelve
objectives per request; malformed, ungrounded or oversized outlines fail explicitly.
Coursewright must produce every requested section rather than silently skip one.

Instructor previews and student lessons share the retained manual-course visual
template: content blocks, typography, question choices and feedback presentation.
The model supplies structured course content, not executable HTML or styles.

Instructors can request a question or whole-lesson revision. Requests carry the
reviewed version and stable target IDs. The server validates saved sources and
grounding, updates only the selected scope, and commits the candidate, root pointer
and history together. A stale request is rejected. Successive candidates supersede
the prior pending candidate without changing released material.

Final approval includes the exact reviewed version. Approval and typed delivery
materialization commit together. Replacement releases have their own delivery IDs;
previous typed releases and learner evidence are not deleted. Learners receive
approved content with answer aliases recursively redacted, never pending candidates.

## Provider and grounding

Development explicitly selects OpenRouter through MODEL_BASE_URL and MODEL_ID and
uses the existing server-side OPENROUTER_API_KEY secret. The configured
google/gemini-3.1-pro-preview model was found in the public model catalog with
structured-output support. The key is not copied to client code or documentation.
No paid inference was performed during this work.

The same server model adapter supports an explicitly configured OpenAI-compatible
Orin endpoint later. A key alone never selects a cloud provider, and provider
failures never produce fabricated courses or a silent endpoint switch.

The existing Anchor doctrine retrieval/answer path and Arsenal adapters remain.
Coursewright grounding uses the selected approved source records; this does not
claim that a live Anchor service was provisioned or tested.

## Retired manual writes

Manual create, edit, publish and archive/restore endpoints return HTTP 410 with
MANUAL_AUTHORING_RETIRED and perform no database writes. Dormant editor controls
are removed. Existing manual record reads, published playback, progress, attempts,
grading and results remain supported; no stored records were deleted or converted.
The retired teach/learn page trees remain absent.

## Verification boundaries

The native Next build, model transport tests, manual-retirement/playback tests,
UI rendering tests and AI revision/delivery contracts pass. Revision tests cover
ownership, stale requests, repeated revisions, pending visibility and immutable
prior releases. Tests use synthetic fixtures, not live persisted account data.
Live provider inference and authenticated persistence acceptance are not claimed.
Account repair, schema operations, production changes and paid inference were
outside this implementation.

The branch was rebased onto fetched upstream main and remains replit/port. Rebase
intermediate states disrupted local environment metadata; the original Node.js 24,
PostgreSQL 16 and stable-25_05 Nix settings were restored, along with the original
artifact files and managed preview. No further configuration replay is required.