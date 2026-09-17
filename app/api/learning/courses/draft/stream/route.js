// /api/learning/courses/draft/stream -- the same Coursewright draft as ../draft, reported as it
// happens: one JSON object per line for every objective, artifact and refusal, then the saved record.
import { learningRoute } from '../../../../../../lib/learning/http';
import { draftCourseStream } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';

/*
 * There was an `export const maxDuration = 300` here. It did nothing, and it
 * was believed twice to be the five-minute ceiling this stream dies at. It is
 * removed rather than raised, because a knob that is not connected to anything
 * is worse than no knob: it gets read as the control and it is not one.
 *
 * WHAT ACTUALLY ENDS THIS REQUEST AT FIVE MINUTES.
 *
 * Cloud Run's request timeout. It defaults to 300 seconds, and it is a clock on
 * the WHOLE response, not on time-to-first-byte -- Google's own wording for the
 * load balancer in front is "the maximum amount of time allowed between the
 * load balancer sending the first byte of a request to the backend and the
 * backend returning the last byte of the HTTP response". A stream still
 * emitting NDJSON at T+300 is cut; actively sending data does not reset it.
 * Cloud Run's documented maximum is 3600 seconds.
 *
 * WHY THE CEILING CANNOT BE RAISED FROM THIS REPOSITORY.
 *
 *   - Next.js `maxDuration` is documented as a value "deployment platforms can
 *     use from the Next.js build output"; its default is literally listed as
 *     "set by deployment platform". Vercel consumes it. Nothing reads it in a
 *     container under `next start`, and App Hosting documents no consumer of
 *     Next.js build metadata. On this platform the export is inert.
 *   - Firebase App Hosting's `apphosting.yaml` has no timeout setting. The
 *     `runConfig` block documents exactly five keys -- cpu, memoryMiB,
 *     concurrency, maxInstances, minInstances -- and the App Hosting REST
 *     schema and the firebase-tools `RunConfig` interface both carry those five
 *     and nothing else. There is no supported key to set.
 *
 * The only lever is `gcloud run services update --timeout` on the Cloud Run
 * service App Hosting manages, and whether that survives the next rollout is
 * undocumented; App Hosting states that each rollout adds a revision "using
 * your image and configuration", which suggests it would not. Treat it as an
 * untested operator action, not as a fix that lives in the codebase.
 *
 * WHAT THIS COSTS, MEASURED. Deep lessons run ~50s per section, so the stream
 * is lost at around five or six sections -- most real courses. It costs the
 * PROGRESS REPORT and nothing else: draftCourseRecord runs to completion on the
 * server after the request is torn down, createLearningRecord still writes the
 * course, and it appears in the library minutes later. The client says exactly
 * that when the stream ends without an outcome (see GenerationProgress), and
 * the modal's buttons now agree with it.
 */

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => draftCourseStream(identity, input));
