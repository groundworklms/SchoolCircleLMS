// /api/learning/courses/draft/stream -- the same Coursewright draft as ../draft, reported as it
// happens: one JSON object per line for every objective, artifact and refusal, then the saved record.
import { learningRoute } from '../../../../../../lib/learning/http';
import { draftCourseStream } from '../../../../../../lib/learning/core';

export const runtime = 'nodejs';
export const maxDuration = 300;

export const POST = learningRoute({ roles: ['INSTRUCTOR'] }, ({ identity, ...input }) => draftCourseStream(identity, input));
