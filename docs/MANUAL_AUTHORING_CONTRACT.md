# Manual authoring contract (RETIRED)

> **Retired — historical record only.** Source-grounded AI generation is now the
> only course-authoring path; see [AI course authoring](ai-course-authoring.md).
> The mutating endpoints below answer `410 MANUAL_AUTHORING_RETIRED` and reach
> neither authentication nor the database. `GET /api/authoring/courses` and
> `GET /api/authoring/courses/[id]/results` still serve saved records, and every
> course published through this workflow keeps its playback, progress, grading
> and results. Nothing here describes a writable API any more.

Manual creation is independent of AI services. Keep Next.js. Store this additive
workflow in existing LearningRecord rows with distinct MANUAL_* types, not in
the legacy generated-course payload. No live migrations are required.

## Instructor API

- GET/POST `/api/authoring/courses`: `{courses}` / `{course}`; create `{title}`.
- GET/PATCH `/api/authoring/courses/[id]`: `{course}`; save `{version,draft}`.
- POST `/api/authoring/courses/[id]/publish`: `{version}` -> `{course}`.
- POST `/api/authoring/courses/[id]/archive`: `{version,archived:boolean}` -> `{course}`.
- GET `/api/authoring/courses/[id]/results`: `{results:{learners,completed,blocks:[{blockId,responses,accuracy}]}}`.

Course: `{id,version,status,publishedReleaseId,draft}`; status is DRAFT,
PUBLISHED or ARCHIVED. Draft: `{title,summary,objectives:string[],lessons}`.
Lesson: `{id,title,blocks}`. All IDs are unique bounded opaque strings.
Publishing freezes a release. Editing the draft never changes an existing
release. Archive hides learner access while retaining history; restore restores
prior availability. CAS versions protect against lost updates. Only the
instructor owner can edit, publish, archive or read aggregate results.

## Blocks

Every block has `id` and `type`:

- text: `{body}` (safe Markdown, no raw HTML rendering)
- image/video: `{url,alt,caption}`
- attachment: `{url,label}`
- accordion: `{items:[{id,title,body}]}`
- flashcards: `{cards:[{id,front,back}]}`
- hotspots: `{url,alt,points:[{id,x,y,label,body}]}`; coordinates are percentages
- check/scenario: `{prompt,body,options:[{id,text}],correctOptionId,explanation}`;
  body is optional scenario context, exactly one option is correct

Partial drafts may contain empty fields. Publishing validates usable content,
required fields, unique IDs, bounded sizes and valid choices. Media/attachment
URLs must be HTTPS and must not contain credentials. This release supports
linked media, not direct file uploads. Duplicate operations generate fresh IDs
for lessons, blocks and nested choices.

## Learner API

All authenticated roles can view published courses.

- GET `/api/authoring/library`: `{courses:[{id,title,summary,publishedReleaseId}]}`
- GET `/api/authoring/library/[id]?releaseId=optional`:
  `{release:{id,courseId,content},progress}`
- POST `/api/authoring/library/[id]/attempts`:
  `{releaseId,blockId,optionId,attemptId}` -> `{result,progress}`
- POST `/api/authoring/library/[id]/progress`:
  `{releaseId,blockId}` -> `{progress}`

Result: `{blockId,optionId,correct,feedback}`.
Progress: `{completedBlockIds,completed,total,percent,answers}`, where answers
maps block IDs to `{optionId,correct,feedback}`.

Published content strips correctOptionId and explanation. Only the server grades
answers and releases feedback after submission. Passive-block completion must
never complete a check. Correct answers complete checks; wrong answers may be
retried. Idempotency keys are bound to user/release/payload. Progress writes
must be safe under concurrent requests. Releases may be pinned across refresh
and later publication, but must belong to the requested non-archived course.
No draft access through the library API.

## Shared renderer and routes

`app/_authoring/ManualLesson.js` default export accepts
`{content,preview,progress,onAnswer,onComplete,busy}`.
Preview simulates feedback locally using draft answers; production calls
onAnswer(blockId,optionId) / onComplete(blockId) and trusts only server responses.

Instructor routes: `/teach/courses`, `/teach/courses/[id]`.
Learner routes: `/learn/library`, `/learn/library/[id]`.
Provide explicit loading/error/retry, pending save states and unsaved-edit
protection. No mock data in production. Main navigation links both entry points.

## Security and verification

Use verified Firebase-to-database identity, instructor/BOTH roles and ownership,
no-store responses, strict input limits, and sanitized server errors. Instructor
results are aggregate only; accuracy is suppressed below five distinct learners.
No live data is used during verification. Use disposable native PostgreSQL and
an isolated browser harness. Keep manual functions operational with AI disabled.